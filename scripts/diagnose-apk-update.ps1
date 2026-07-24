# YunoSeek 服务器端 APK 更新检查 403 诊断脚本
# 适用：Windows Server + PowerShell 5.1+
# 用法：powershell -ExecutionPolicy Bypass -File scripts\diagnose-apk-update.ps1
#
# 可选环境变量：
#   $env:GITHUB_TOKEN  服务器配置的 GitHub Token（用于验证有效性）
#   $env:GITHUB_REPO   仓库标识，默认 KasumiAmi/YunoSeekAPP
#
# 诊断项：
#   1. 服务器 /api/apk/version 端点（current=2 与 current=3 对比）
#   2. 服务器 IP 的 GitHub API 速率限制剩余配额
#   3. 从服务器视角直连 GitHub Releases /latest 能否拿到
#   4. 服务器配置的 GITHUB_TOKEN 有效性（如已设置）
#   5. Release body 中 versionCode 标记解析（含 CRLF 兼容性验证）
#   6. 服务器端点缓存行为（连续 3 次调用看是否返回同一结果）

# ============== 配置 ==============
$ErrorActionPreference = "Continue"
$Server = "https://yunoseek.ownbangdream.asia"
$Repo = if ($env:GITHUB_REPO) { $env:GITHUB_REPO } else { "KasumiAmi/YunoSeekAPP" }
$Token = $env:GITHUB_TOKEN
$Abi = "arm64-v8a"

# 颜色辅助（PS 5.1 兼容）
function Write-Section($title) {
    Write-Host ""
    Write-Host ("=" * 70) -ForegroundColor DarkCyan
    Write-Host "  $title" -ForegroundColor Cyan
    Write-Host ("=" * 70) -ForegroundColor DarkCyan
}
function Write-Ok($msg)   { Write-Host "  [OK]   $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "  [FAIL] $msg" -ForegroundColor Red }
function Write-Info($msg) { Write-Host "  [INFO] $msg" -ForegroundColor Gray }

# PS 5.1 没有 -SkipHttpErrorCheck，统一用 try/catch 包装
function Invoke-Json {
    param(
        [string]$Url,
        [hashtable]$Headers = @{},
        [int]$TimeoutSec = 15
    )
    try {
        $resp = Invoke-WebRequest -Uri $Url -Headers $Headers -TimeoutSec $TimeoutSec -UseBasicParsing
        return @{ Status = $resp.StatusCode; Body = $resp.Content; Error = $null }
    } catch [System.Net.WebException] {
        $status = $_.Exception.Response.StatusCode.value__
        $body = ""
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $body = $reader.ReadToEnd()
        } catch {}
        return @{ Status = $status; Body = $body; Error = $_.Exception.Message }
    } catch {
        return @{ Status = 0; Body = ""; Error = $_.Exception.Message }
    }
}

Write-Host ""
Write-Host "  YunoSeek APK 更新检查诊断" -ForegroundColor White
Write-Host "  服务器: $Server" -ForegroundColor Gray
Write-Host "  仓库:   $Repo" -ForegroundColor Gray
Write-Host "  Token:  $(if ($Token) { '已设置 (' + $Token.Substring(0,4) + '...)' } else { '未设置' })" -ForegroundColor Gray

# ============== 1. 服务器端点对比测试 ==============
Write-Section "1. 服务器 /api/apk/version 端点对比"

# current=2（旧版本，应触发更新）
$r1 = Invoke-Json -Url "$Server/api/apk/version?current=2&abi=$Abi"
Write-Info "current=2 → HTTP $($r1.Status)"
Write-Info "Body: $($r1.Body)"
if ($r1.Status -eq 200) {
    try {
        $d = $r1.Body | ConvertFrom-Json
        if ($d.latestVersionCode -gt 2) { Write-Ok "latestVersionCode=$($d.latestVersionCode) > 2，差异检测正常" }
        else { Write-Warn "latestVersionCode=$($d.latestVersionCode)，未大于 current=2" }
    } catch { Write-Warn "响应非 JSON 或解析失败" }
} elseif ($r1.Status -ge 500) {
    Write-Err "服务器 $($(r1.Status)) 错误：$($r1.Body)（这是 app 看到假的'已是最新'的根因）"
} else {
    Write-Warn "非预期状态码"
}

# current=3（当前版本，应返回 hasUpdate=false）
$r2 = Invoke-Json -Url "$Server/api/apk/version?current=3&abi=$Abi"
Write-Info "current=3 → HTTP $($r2.Status)"
Write-Info "Body: $($r2.Body)"
if ($r2.Status -eq 200) {
    try {
        $d = $r2.Body | ConvertFrom-Json
        if ($d.latestVersionCode -le 3) { Write-Ok "latestVersionCode=$($d.latestVersionCode) <= 3，正确识别为最新" }
        else { Write-Warn "latestVersionCode=$($d.latestVersionCode) > 3，服务端未识别新 versionCode=3" }
    } catch {}
}

# ============== 2. 服务器 IP 的 GitHub 速率限制 ==============
Write-Section "2. 服务器 IP 的 GitHub API 速率限制（未认证）"

$rl = Invoke-Json -Url "https://api.github.com/rate_limit"
if ($rl.Status -eq 200) {
    try {
        $d = $rl.Body | ConvertFrom-Json
        $core = $d.resources.core
        $reset = [DateTimeOffset]::FromUnixTimeSeconds($core.reset).LocalTime.ToString("HH:mm:ss")
        Write-Info "限制: $($core.limit)/小时   剩余: $($core.remaining)   重置: $reset"
        if ($core.remaining -le 5) {
            Write-Err "剩余配额即将耗尽！这就是 403 的直接原因"
            Write-Info "解决：服务器侧给 GitHub 调用加 GITHUB_TOKEN（5000/小时）"
        } elseif ($core.remaining -lt 30) {
            Write-Warn "剩余配额偏低，高峰期可能触发 403"
        } else {
            Write-Ok "配额充足，当前 IP 未被限流"
        }
    } catch { Write-Warn "解析失败：$($rl.Body)" }
} else {
    Write-Err "rate_limit 端点 HTTP $($rl.Status)：$($rl.Error)"
}

# ============== 3. 从服务器视角直连 GitHub Releases ==============
Write-Section "3. 从服务器视角直连 GitHub Releases /latest"

$headers = @{ "Accept" = "application/vnd.github+json"; "User-Agent" = "YunoSeek-Diag" }
if ($Token) { $headers["Authorization"] = "Bearer $Token" }

$gh = Invoke-Json -Url "https://api.github.com/repos/$Repo/releases/latest" -Headers $headers
Write-Info "HTTP $($gh.Status)"
if ($gh.Status -eq 200) {
    try {
        $d = $gh.Body | ConvertFrom-Json
        Write-Ok "拿到 Release: tag=$($d.tag_name)  id=$($d.id)"
        Write-Info "Assets: $($d.assets.Count) 个"
        $d.assets | ForEach-Object { Write-Info "  - $($_.name)  ($([math]::Round($_.size/1MB,2)) MB)" }
    } catch { Write-Warn "解析失败" }
} elseif ($gh.Status -eq 403) {
    Write-Err "GitHub 返回 403：被限流或 token 无效"
    Write-Info "响应体: $($gh.Body)"
} elseif ($gh.Status -eq 404) {
    Write-Err "404：仓库不存在或无 Release（检查 $Repo 拼写与可见性）"
} else {
    Write-Err "HTTP $($gh.Status)：$($gh.Error)"
}

# ============== 4. GITHUB_TOKEN 有效性验证（如已设置）==============
if ($Token) {
    Write-Section "4. 服务器配置的 GITHUB_TOKEN 有效性"

    $tu = Invoke-Json -Url "https://api.github.com/user" -Headers @{ "Authorization" = "Bearer $Token"; "User-Agent" = "YunoSeek-Diag" }
    Write-Info "HTTP $($tu.Status)"
    if ($tu.Status -eq 200) {
        try {
            $d = $tu.Body | ConvertFrom-Json
            Write-Ok "Token 有效，身份: $($d.login)"
        } catch {}
    } elseif ($tu.Status -eq 401) {
        Write-Err "401：Token 无效或已过期"
    } elseif ($tu.Status -eq 403) {
        Write-Err "403：Token 有效但被限流（极少见，看下方 rate_limit）"
        try {
            $d = $tu.Body | ConvertFrom-Json
            Write-Info "GitHub 返回: $($d.message)"
        } catch {}
    } else {
        Write-Warn "HTTP $($tu.Status)：$($tu.Error)"
    }

    # 带 token 的速率限制（5000/小时）
    $rlAuth = Invoke-Json -Url "https://api.github.com/rate_limit" -Headers @{ "Authorization" = "Bearer $Token"; "User-Agent" = "YunoSeek-Diag" }
    if ($rlAuth.Status -eq 200) {
        try {
            $d = $rlAuth.Body | ConvertFrom-Json
            $core = $d.resources.core
            $reset = [DateTimeOffset]::FromUnixTimeSeconds($core.reset).LocalTime.ToString("HH:mm:ss")
            Write-Info "带 Token 限制: $($core.limit)/小时   剩余: $($core.remaining)   重置: $reset"
            if ($core.limit -ge 5000) {
                Write-Ok "Token 已生效（5000/小时额度）"
            } else {
                Write-Warn "Token 调用仍走 60/小时配额——服务器请求未带 Authorization 头"
            }
        } catch {}
    }
} else {
    Write-Section "4. GITHUB_TOKEN 有效性"
    Write-Warn "未设置 `$env:GITHUB_TOKEN，跳过。建议服务器侧配置以提升配额至 5000/小时。"
}

# ============== 5. Release body 中 versionCode 解析验证 ==============
Write-Section "5. Release body versionCode 标记解析（含 CRLF 兼容性）"

if ($gh.Status -eq 200) {
    try {
        $d = $gh.Body | ConvertFrom-Json
        $body = $d.body
        Write-Info "原始 body（前 200 字符）:"
        Write-Host "    $($body.Substring(0, [Math]::Min(200, $body.Length)))" -ForegroundColor DarkGray

        # 检查换行符
        $hasCRLF = $body -match "`r`n"
        $hasLF = $body -match "(?<!`r)`n"
        if ($hasCRLF) { Write-Info "换行符: CRLF (\r\n)" }
        elseif ($hasLF) { Write-Info "换行符: LF (\n)" }
        else { Write-Info "换行符: 无（单行）" }

        # 模拟服务端正则解析（兼容 CRLF/LF）
        $m = [regex]::Match($body, "<!--\s*versionCode:\s*(\d+)\s*-->")
        if ($m.Success) {
            $vc = [int]$m.Groups[1].Value
            Write-Ok "解析到 versionCode = $vc"
            if ($vc -eq 3) { Write-Ok "与 build.gradle 一致（versionCode=3）" }
            else { Write-Warn "与 build.gradle 不一致！服务端会据此判断 hasUpdate" }
        } else {
            Write-Err "未匹配到 versionCode 标记。服务端正则可能不兼容 CRLF 或格式有变"
            Write-Info "建议服务端正则: /<!--\s*versionCode:\s*(\d+)\s*-->/（不要用 ^...$ 多行模式）"
        }
    } catch { Write-Warn "解析失败" }
} else {
    Write-Warn "GitHub Releases 未拿到，跳过此步（先解决第 3 步）"
}

# ============== 6. 服务器端点缓存行为 ==============
Write-Section "6. 服务器端点缓存行为（连续 3 次调用）"

for ($i = 1; $i -le 3; $i++) {
    $r = Invoke-Json -Url "$Server/api/apk/version?current=2&abi=$Abi"
    $ts = Get-Date -Format "HH:mm:ss.fff"
    Write-Info "[$i] $ts → HTTP $($r.Status)  Body: $($r.Body.Substring(0, [Math]::Min(80, $r.Body.Length)))"
    Start-Sleep -Milliseconds 800
}
Write-Info "若三次结果完全一致，可能是缓存命中（403 也可能被缓存）"

# ============== 结论汇总 ==============
Write-Section "诊断结论与建议"
Write-Host @"
  最可能根因：服务器 IP 触发 GitHub API 未认证速率限制（60 次/小时）
    —— 服务器是共享出口 IP，所有用户每次启动 app 都触发一次服务器→GitHub 调用

  根治方案（按优先级）：
    1. 在服务器侧给 GitHub API 调用配置 GITHUB_TOKEN（fine-grained，public_repo 读权限即可）
       认证后配额从 60/小时提升至 5000/小时，几乎不会再触发 403
    2. 服务器侧对 GitHub 响应做缓存（建议 5-10 分钟），避免每次客户端请求都打 GitHub
    3. 服务器侧遇到 GitHub 403 时，不要返回 500 包装错误，应返回缓存的上次成功结果
       或返回带 error 标志的 200，让客户端能区分"检查失败"与"已是最新"

  次生问题（客户端侧，可后续修）：
    lib/update-check.ts 把服务器 5xx 静默当作"无更新"，导致用户看到假的"已是最新"
    建议改为返回 error 标志，复用 UpdateDialog 的 error 变体显示"检查失败 + 重试"
"@ -ForegroundColor White

Write-Host ""
Write-Host "  诊断完成。" -ForegroundColor Cyan
Write-Host ""
