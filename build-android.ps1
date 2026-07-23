# YunoSeek Android Release 构建脚本
# 用法: powershell -ExecutionPolicy Bypass -File build-android.ps1
#
# 自动注入 EXPO_PUBLIC_BUILD_TIME 环境变量（毫秒时间戳），
# 让 about 页能显示真实构建时间（替代"未知"）
# 同时设置 JAVA_HOME 指向 Android Studio 自带 JDK 21，避免系统 Java 25 不兼容

# 设置 JAVA_HOME：优先 Android Studio 自带 JDK 21（RN 0.86 兼容版本）
$androidJdk = "C:\Program Files\Android\Android Studio\jbr"
if (Test-Path $androidJdk) {
    $env:JAVA_HOME = $androidJdk
    Write-Host "[YunoSeek] Using JDK: $androidJdk" -ForegroundColor Cyan
} elseif (-not $env:JAVA_HOME) {
    Write-Host "[YunoSeek] WARNING: JAVA_HOME not set and Android Studio JDK not found" -ForegroundColor Yellow
}

$timestamp = [DateTimeOffset]::Now.ToUnixTimeMilliseconds().ToString()
$env:EXPO_PUBLIC_BUILD_TIME = $timestamp
$displayTime = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$timestamp).ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss')
Write-Host "[YunoSeek] Build time set to: $timestamp ($displayTime)" -ForegroundColor Cyan
Push-Location android
try {
    .\gradlew.bat assembleRelease
} finally {
    Pop-Location
}
