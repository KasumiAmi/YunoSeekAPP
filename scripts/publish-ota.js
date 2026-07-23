// OTA 热更新发布脚本
// 用法：node scripts/publish-ota.js
//
// 流程：
// 1. npx expo export --platform android → 生成 dist/ 目录（JS bundle + assets）
// 2. 读取 app.json 的 runtimeVersion，计算 bundle hash 作为 update id
// 3. 生成 expo-updates 协议 manifest JSON
// 4. 上传 bundle + assets + manifest 到服务器静态目录
//    - 优先：HTTPS POST 到 OTA_UPLOAD_URL（需 OTA_UPLOAD_TOKEN）
//    - 回退：调用系统 scp 上传（需 DEPLOY_HOST/USER/PATH）
//
// 环境变量：
//   OTA_UPLOAD_URL    服务器上传端点（如 https://yunoseek.ownbangdream.asia/api/ota/upload）
//   OTA_UPLOAD_TOKEN  上传鉴权 token
//   DEPLOY_HOST       SCP 主机（回退方式）
//   DEPLOY_USER       SCP 用户（回退方式）
//   DEPLOY_PATH       服务器静态目录（如 /var/www/ota）
//   RUNTIME_VERSION   runtime 版本（默认读取 app.json 的 runtimeVersion）
//
// 服务器目录结构（最终）：
//   {DEPLOY_PATH}/
//     ├── manifests/latest-{runtimeVersion}.json
//     ├── bundles/{bundleId}.js
//     └── assets/...

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const https = require("https");

const ROOT = path.join(__dirname, "..");
const DIST_DIR = path.join(ROOT, "dist");
const APP_JSON = path.join(ROOT, "app.json");

function readRuntimeVersion() {
  if (process.env.RUNTIME_VERSION) return process.env.RUNTIME_VERSION;
  try {
    const cfg = JSON.parse(fs.readFileSync(APP_JSON, "utf-8"));
    const v = cfg?.expo?.runtimeVersion;
    if (typeof v === "string" && v) return v;
  } catch (e) {
    console.warn("[publish-ota] 读取 app.json runtimeVersion 失败:", e.message);
  }
  console.error("[publish-ota] 未找到 runtimeVersion，请在 app.json 设置或通过 RUNTIME_VERSION 环境变量提供");
  process.exit(1);
}

function runExport() {
  console.log("[publish-ota] 运行 npx expo export --platform android ...");
  const r = spawnSync("npx", ["expo", "export", "--platform", "android"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    console.error("[publish-ota] expo export 失败");
    process.exit(1);
  }
}

// 递归收集目录下所有文件（相对路径）
function collectFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full, base));
    } else if (entry.isFile()) {
      out.push(path.relative(base, full).replace(/\\/g, "/"));
    }
  }
  return out;
}

// 找到主 bundle 文件（最大的 .js 文件）
function findMainBundle(files) {
  const jsFiles = files.filter((f) => f.endsWith(".js"));
  if (jsFiles.length === 0) return null;
  let best = jsFiles[0];
  let bestSize = -1;
  for (const f of jsFiles) {
    const size = fs.statSync(path.join(DIST_DIR, f)).size;
    if (size > bestSize) {
      bestSize = size;
      best = f;
    }
  }
  return best;
}

function sha256OfFile(filePath) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(filePath));
  return h.digest("hex");
}

// 生成 expo-updates 协议 manifest
function buildManifest(bundleId, runtimeVersion, bundleRelPath, assetFiles) {
  const API_BASE = "https://yunoseek.ownbangdream.asia";
  return {
    id: bundleId,
    createdAt: new Date().toISOString(),
    runtimeVersion,
    launchAsset: {
      key: path.basename(bundleRelPath),
      contentType: "application/javascript",
      url: `${API_BASE}/api/ota/assets?path=bundles/${bundleId}.js`,
    },
    assets: assetFiles.map((rel) => ({
      key: path.basename(rel),
      contentType: guessContentType(rel),
      url: `${API_BASE}/api/ota/assets?path=assets/${encodeURIComponent(path.basename(rel))}`,
    })),
    metadata: {},
  };
}

function guessContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".ttf") return "application/x-font-ttf";
  if (ext === ".otf") return "application/x-font-otf";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".js") return "application/javascript";
  return "application/octet-stream";
}

// 通过 HTTPS POST 上传（要求服务器实现 /api/ota/upload 端点）
function uploadViaApi(manifestJson, bundleAbsPath, assetAbsPaths, uploadUrl, token) {
  const boundary = "----yunoseek-ota-" + crypto.randomBytes(8).toString("hex");
  const parts = [];

  // manifest
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="manifest"; filename="latest.json"\r\n` +
    `Content-Type: application/json\r\n\r\n`
  ));
  parts.push(Buffer.from(manifestJson));
  parts.push(Buffer.from("\r\n"));

  // bundle
  parts.push(Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="bundle"; filename="${path.basename(bundleAbsPath)}"\r\n` +
    `Content-Type: application/javascript\r\n\r\n`
  ));
  parts.push(fs.readFileSync(bundleAbsPath));
  parts.push(Buffer.from("\r\n"));

  // assets
  for (const ap of assetAbsPaths) {
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="assets"; filename="${path.basename(ap)}"\r\n` +
      `Content-Type: ${guessContentType(ap)}\r\n\r\n`
    ));
    parts.push(fs.readFileSync(ap));
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(parts);

  return new Promise((resolve, reject) => {
    const url = new URL(uploadUrl);
    const req = https.request(
      {
        method: "POST",
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log("[publish-ota] API 上传成功:", res.statusCode, data.slice(0, 200));
            resolve();
          } else {
            reject(new Error(`API 上传失败: ${res.statusCode} ${data.slice(0, 300)}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function uploadViaScp(manifestJson, bundleAbsPath, assetAbsPaths, host, user, remotePath, bundleId) {
  console.log("[publish-ota] 通过 SCP 上传（需要 SSH 免密配置）...");
  const target = `${user}@${host}`;
  // 1. 确保远程目录存在
  spawnSync("ssh", [target, `mkdir -p ${remotePath}/manifests ${remotePath}/bundles ${remotePath}/assets`], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  // 2. 上传 bundle（重命名为 bundleId.js）
  spawnSync("scp", [bundleAbsPath, `${target}:${remotePath}/bundles/${bundleId}.js`], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  // 3. 上传 assets
  for (const ap of assetAbsPaths) {
    spawnSync("scp", [ap, `${target}:${remotePath}/assets/`], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  }
  // 4. 上传 manifest（本地临时写出后 scp）
  const tmpManifest = path.join(DIST_DIR, `latest.json`);
  fs.writeFileSync(tmpManifest, manifestJson, "utf-8");
  spawnSync("scp", [tmpManifest, `${target}:${remotePath}/manifests/latest-${process.env.RUNTIME_VERSION || readRuntimeVersion()}.json`], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

async function main() {
  if (!fs.existsSync(DIST_DIR)) {
    runExport();
  } else {
    console.log("[publish-ota] dist/ 已存在，跳过 export（删除 dist/ 可重新生成）");
  }

  const runtimeVersion = readRuntimeVersion();
  const files = collectFiles(DIST_DIR);
  if (files.length === 0) {
    console.error("[publish-ota] dist/ 为空，请先运行 expo export");
    process.exit(1);
  }

  const bundleRel = findMainBundle(files);
  if (!bundleRel) {
    console.error("[publish-ota] 未在 dist/ 找到 .js bundle 文件");
    process.exit(1);
  }
  const bundleAbs = path.join(DIST_DIR, bundleRel);
  const bundleHash = sha256OfFile(bundleAbs);
  const bundleId = `bundle-${bundleHash.slice(0, 12)}`;

  // assets = 除主 bundle 外的所有文件（字体/图片等）
  const assetRels = files.filter((f) => f !== bundleRel);
  const assetAbs = assetRels.map((f) => path.join(DIST_DIR, f));

  const manifest = buildManifest(bundleId, runtimeVersion, bundleRel, assetRels);
  const manifestJson = JSON.stringify(manifest, null, 2);

  console.log(`[publish-ota] runtimeVersion=${runtimeVersion}`);
  console.log(`[publish-ota] bundleId=${bundleId}`);
  console.log(`[publish-ota] bundle=${bundleRel} (${fs.statSync(bundleAbs).size} bytes)`);
  console.log(`[publish-ota] assets=${assetRels.length} 个`);
  console.log("[publish-ota] manifest 预览:", manifestJson.slice(0, 300) + "...");

  // 选择上传方式
  const uploadUrl = process.env.OTA_UPLOAD_URL;
  const uploadToken = process.env.OTA_UPLOAD_TOKEN;
  const deployHost = process.env.DEPLOY_HOST;
  const deployUser = process.env.DEPLOY_USER;
  const deployPath = process.env.DEPLOY_PATH;

  if (uploadUrl && uploadToken) {
    await uploadViaApi(manifestJson, bundleAbs, assetAbs, uploadUrl, uploadToken);
  } else if (deployHost && deployUser && deployPath) {
    uploadViaScp(manifestJson, bundleAbs, assetAbs, deployHost, deployUser, deployPath, bundleId);
    console.log("[publish-ota] SCP 上传完成");
  } else {
    console.warn("\n[publish-ota] 未配置上传方式，manifest 已生成但未上传。");
    console.warn("[publish-ota] 请配置以下任一方式后重新运行：");
    console.warn("  方式 A（API）: OTA_UPLOAD_URL + OTA_UPLOAD_TOKEN");
    console.warn("  方式 B（SCP）: DEPLOY_HOST + DEPLOY_USER + DEPLOY_PATH");
    console.warn("[publish-ota] manifest JSON 已写入 dist/latest.json");
    fs.writeFileSync(path.join(DIST_DIR, "latest.json"), manifestJson, "utf-8");
  }
}

main().catch((e) => {
  console.error("[publish-ota] 发布失败:", e);
  process.exit(1);
});
