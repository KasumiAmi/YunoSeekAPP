// APK 整包发布脚本：上传 3 个 ABI APK 到 GitHub Releases
// 用法：node scripts/publish-apk.js <version> <changelog>
// 例如：node scripts/publish-apk.js 1.0.2_0723 "修复对话显示问题，优化动画性能"
//
// 流程：
// 1. 读取 android/app/build/outputs/apk/release/ 下的 3 个 ABI APK
// 2. 通过 GitHub API 创建 Release（tag = v<version>）
// 3. 上传 3 个 APK 作为 release assets
// 4. 服务器 /api/apk/version 端点会自动查询 GitHub Releases 获取最新版本
//
// 环境变量：
//   GITHUB_TOKEN  GitHub Personal Access Token（需 repo 权限）
//   GITHUB_REPO   仓库标识（owner/repo，如 ToyamaKasumi/yunoseek-rn）
//
// 注：客户端从不直连 GitHub，服务器 /api/apk/download 会代理 + 缓存下载

const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.join(__dirname, "..");
const APK_DIR = path.join(ROOT, "android", "app", "build", "outputs", "apk", "release");

const ABIS = ["armeabi-v7a", "arm64-v8a", "x86_64"];

function githubRequest(method, hostname, apiPath, body, token, contentType = "application/json") {
  return new Promise((resolve, reject) => {
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    let payload = null;
    if (body !== null && body !== undefined) {
      if (Buffer.isBuffer(body)) {
        payload = body;
        headers["Content-Type"] = contentType;
        headers["Content-Length"] = body.length;
      } else {
        payload = Buffer.from(JSON.stringify(body));
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = payload.length;
      }
    }
    const req = https.request({ method, hostname, path: apiPath, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        let parsed = raw;
        const ct = res.headers["content-type"] || "";
        if (ct.includes("json")) {
          try { parsed = JSON.parse(raw); } catch {}
        }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, data: parsed });
        } else {
          const msg = typeof parsed === "object" && parsed ? (parsed.message || raw) : raw;
          reject(new Error(`GitHub API ${method} ${apiPath} 失败: ${res.statusCode} ${msg}`));
        }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function findApkForAbi(abi) {
  // 文件名格式：app-<abi>-release.apk
  const name = `app-${abi}-release.apk`;
  const p = path.join(APK_DIR, name);
  if (fs.existsSync(p)) return p;
  // 兜底：扫描目录查找包含 abi 的 apk
  if (fs.existsSync(APK_DIR)) {
    for (const f of fs.readdirSync(APK_DIR)) {
      if (f.endsWith(".apk") && f.includes(abi)) return path.join(APK_DIR, f);
    }
  }
  return null;
}

// 从 build.gradle 读取 versionCode
function readVersionCode() {
  const gradlePath = path.join(ROOT, "android", "app", "build.gradle");
  try {
    const content = fs.readFileSync(gradlePath, "utf-8");
    const match = content.match(/versionCode\s+(\d+)/);
    if (match) return parseInt(match[1], 10);
  } catch (e) {
    console.warn("[publish-apk] 读取 build.gradle versionCode 失败:", e.message);
  }
  return 1;
}

async function createRelease(token, repo, version, changelog) {
  const tag = `v${version}`;
  const versionCode = readVersionCode();
  // 在 body 开头嵌入 versionCode（HTML 注释格式，不影响用户可见的 changelog）
  // 服务端 /api/apk/version 会解析此标记获取 latestVersionCode
  const bodyWithVc = `<!-- versionCode: ${versionCode} -->\n${changelog || ""}`;
  const body = {
    tag_name: tag,
    name: `YunoSeek ${version}`,
    body: bodyWithVc,
    draft: false,
    prerelease: false,
  };
  console.log(`[publish-apk] 创建 Release ${tag} ...`);
  const res = await githubRequest(
    "POST",
    "api.github.com",
    `/repos/${repo}/releases`,
    body,
    token
  );
  console.log(`[publish-apk] Release 已创建: id=${res.data.id}, html_url=${res.data.html_url}`);
  return res.data;
}

async function uploadAsset(token, repo, releaseId, apkPath, assetName) {
  const buf = fs.readFileSync(apkPath);
  const apiPath = `/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(assetName)}`;
  console.log(`[publish-apk] 上传 ${assetName} (${(buf.length / 1024 / 1024).toFixed(1)} MB) ...`);
  const res = await githubRequest(
    "POST",
    "uploads.github.com",
    apiPath,
    buf,
    token,
    "application/vnd.android.package-archive"
  );
  console.log(`[publish-apk] 已上传: ${res.data.browser_download_url}`);
  return res.data;
}

async function main() {
  const version = process.argv[2];
  const changelog = process.argv[3] || "";
  if (!version) {
    console.error("用法: node scripts/publish-apk.js <version> <changelog>");
    console.error('例如: node scripts/publish-apk.js 1.0.2_0723 "修复对话显示问题"');
    process.exit(1);
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token) {
    console.error("[publish-apk] 缺少 GITHUB_TOKEN 环境变量");
    process.exit(1);
  }
  if (!repo) {
    console.error("[publish-apk] 缺少 GITHUB_REPO 环境变量（格式: owner/repo）");
    process.exit(1);
  }

  // 收集 3 个 ABI APK
  const apks = [];
  for (const abi of ABIS) {
    const p = findApkForAbi(abi);
    if (!p) {
      console.error(`[publish-apk] 未找到 ${abi} 的 APK（预期路径: ${path.join(APK_DIR, `app-${abi}-release.apk`)}`);
      console.error("[publish-apk] 请先运行 ./gradlew assembleRelease 生成 APK");
      process.exit(1);
    }
    apks.push({ abi, path: p });
  }

  console.log(`[publish-apk] 准备发布 version=${version} repo=${repo}`);
  console.log(`[publish-apk] changelog: ${changelog || "(无)"}`);
  console.log(`[publish-apk] APK 目录: ${APK_DIR}`);

  // 创建 Release
  const release = await createRelease(token, repo, version, changelog);

  // 上传 3 个 APK
  for (const { abi, path: apkPath } of apks) {
    const assetName = `yunoseek-${version}-${abi}.apk`;
    await uploadAsset(token, repo, release.id, apkPath, assetName);
  }

  console.log("\n[publish-apk] 发布完成！");
  console.log(`[publish-apk] Release URL: ${release.html_url}`);
  console.log("[publish-apk] 服务器 /api/apk/version 会自动查询此 Release 获取最新版本。");
  console.log("[publish-apk] 客户端通过 /api/apk/download?abi=<abi> 从服务器代理下载。");
}

main().catch((e) => {
  console.error("[publish-apk] 发布失败:", e);
  process.exit(1);
});
