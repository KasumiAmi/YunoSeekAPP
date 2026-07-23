// 自动部署 OTA/APK 模块到 deepseek-chat-local
// 1. 复制 scripts/ota-apk.js → deepseek-chat-local/ota-apk.js
// 2. 为 server.js 添加 import 和路由
// 用法：在 yunoseek-rn 目录下运行 node scripts/patch-server.js
// 幂等：重复运行不会重复添加
const fs = require("fs");
const path = require("path");

// deepseek-chat-local 在 yunoseek-rn 的上级目录
const serverDir = path.join(__dirname, "..", "..", "deepseek-chat-local");
const serverPath = path.join(serverDir, "server.js");
const otaSrcPath = path.join(__dirname, "ota-apk.js");
const otaDestPath = path.join(serverDir, "ota-apk.js");
console.log("[patch] 目标目录:", serverDir);

// 0. 复制 ota-apk.js（每次都覆盖，确保最新版）
try {
  fs.copyFileSync(otaSrcPath, otaDestPath);
  console.log("[patch] ota-apk.js 已复制到服务器目录");
} catch (err) {
  console.error("[patch] 复制 ota-apk.js 失败:", err.message);
  console.error("[patch] 请手动复制 scripts/ota-apk.js → deepseek-chat-local/ota-apk.js");
  process.exit(1);
}

let s;
try {
  s = fs.readFileSync(serverPath, "utf-8");
} catch (err) {
  console.error("[patch] 无法读取 server.js:", err.message);
  process.exit(1);
}

// 1. 添加 import（如果尚未添加）
const importMarker = 'from "./ota-apk.js";';
if (!s.includes(importMarker)) {
  const oldImport = `import {
  archiveCatalog,
  archiveEntry,
  normalizeWorldArchiveConfig
} from "./archive.js";`;
  const newImport = oldImport + `\nimport {
  handleOtaManifest,
  handleOtaAssets,
  handleApkVersion,
  handleApkDownload
} from "./ota-apk.js";`;
  if (s.includes(oldImport)) {
    s = s.replace(oldImport, newImport);
    console.log("[patch] import 已添加");
  } else {
    console.error("[patch] 未找到 archive.js import 块，请手动添加 import");
    process.exit(1);
  }
} else {
  console.log("[patch] import 已存在，跳过");
}

// 2. 添加路由（如果尚未添加）
const routeMarker = "handleOtaManifest(req, res)";
if (!s.includes(routeMarker)) {
  const oldRoute = `  if (req.method === "POST" && req.url?.startsWith("/api/summarize")) {
    return summarizeConversation(req, res);
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {`;
  const newRoute = `  if (req.method === "POST" && req.url?.startsWith("/api/summarize")) {
    return summarizeConversation(req, res);
    return;
  }

  // OTA 热更新 + APK 整包更新端点
  if (req.method === "GET" && req.url?.startsWith("/api/ota/manifest")) {
    return handleOtaManifest(req, res);
  }
  if (req.method === "GET" && req.url?.startsWith("/api/ota/assets")) {
    return handleOtaAssets(req, res);
  }
  if (req.method === "GET" && req.url?.startsWith("/api/apk/version")) {
    return handleApkVersion(req, res);
  }
  if (req.method === "GET" && req.url?.startsWith("/api/apk/download")) {
    return handleApkDownload(req, res);
  }

  if (req.method === "GET" || req.method === "HEAD") {`;
  if (s.includes(oldRoute)) {
    s = s.replace(oldRoute, newRoute);
    console.log("[patch] 路由已添加");
  } else {
    console.error("[patch] 未找到 summarize 路由块，请手动添加路由");
    process.exit(1);
  }
} else {
  console.log("[patch] 路由已存在，跳过");
}

try {
  fs.writeFileSync(serverPath, s, "utf-8");
  console.log("[patch] server.js 修改完成");
  console.log("[patch] 请确保服务器已设置环境变量：");
  console.log("  GITHUB_REPO    必填，owner/repo（如 ToyamaKasumi/yunoseek-rn）");
  console.log("  GITHUB_TOKEN   可选，GitHub PAT（提高 API 限额）");
  console.log("  GITHUB_MIRRORS 可选，自定义镜像列表（逗号分隔，默认内置 ghproxy 系列）");
  console.log("  OTA_DIR        可选，OTA 资源目录（默认 ./ota）");
  console.log("[patch] 重启服务器后端点生效");
} catch (err) {
  console.error("[patch] 写入 server.js 失败:", err.message);
  console.error("[patch] 请手动添加以下代码到 server.js：");
  console.error("  1. 在 archive.js import 后添加 ota-apk.js import");
  console.error("  2. 在 /api/summarize 路由后添加 4 个 OTA/APK 路由");
}
