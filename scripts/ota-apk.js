// OTA 热更新 + APK 整包更新服务端模块（含 GitHub 镜像 fallback）
// 部署：将此文件复制到 deepseek-chat-local/ 目录，然后在 server.js 中注册路由
// 路由注册：运行 node scripts/patch-server.js（在 yunoseek-rn 目录下）
//
// 环境变量：
//   OTA_DIR        OTA 资源根目录（manifests/ 和 bundles/ 的父目录）
//   GITHUB_REPO    仓库标识（owner/repo，如 ToyamaKasumi/yunoseek-rn）
//   GITHUB_TOKEN   可选，GitHub PAT（提高 API 限额到 5000/h）
//   GITHUB_MIRRORS 可选，自定义镜像列表（逗号分隔，空字符串表示直连）
//                  默认：https://ghproxy.com,https://ghproxy.net,https://gh-proxy.com,https://ghproxy.homeboyc.cn
//
// 4 个端点：
//   GET /api/ota/manifest    expo-updates 协议 manifest
//   GET /api/ota/assets      OTA 资源文件分发
//   GET /api/apk/version     APK 版本检查（查询 GitHub Releases API，5 分钟缓存）
//   GET /api/apk/download    APK 代理下载（磁盘缓存，按 ABI + publishedAt 命名）
//
// 镜像 fallback 机制：
//   GitHub API 查询和 Asset 下载都通过镜像列表按优先级尝试
//   第一个成功的镜像会被缓存，后续请求优先使用
//   镜像失败时自动切换到下一个，所有镜像失败后回退到直连 GitHub

import https from "node:https";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

// ── 配置 ──────────────────────────────────────────────────
const OTA_DIR = process.env.OTA_DIR || path.join(process.cwd(), "ota");
const GITHUB_REPO = process.env.GITHUB_REPO || "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";

// 镜像列表（前缀代理型，空字符串 = 直连 GitHub，始终作为最后 fallback）
const DEFAULT_MIRRORS = [
  "https://ghproxy.com",
  "https://ghproxy.net",
  "https://gh-proxy.com",
  "https://ghproxy.homeboyc.cn",
];
const MIRRORS = (process.env.GITHUB_MIRRORS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const FALLBACK_ORDER = MIRRORS.length > 0 ? [...MIRRORS, ""] : [...DEFAULT_MIRRORS, ""];

// 缓存最近成功的镜像（优先复用，减少探测开销）
let preferredMirror = null;

// GitHub API 查询结果缓存（5 分钟）
let releaseCache = null; // { data, ts }
const RELEASE_CACHE_TTL = 5 * 60 * 1000;

// APK 磁盘缓存目录
const APK_CACHE_DIR = path.join(OTA_DIR, "apk-cache");

// ── 工具函数 ──────────────────────────────────────────────

/**
 * 构造镜像 URL
 * @param {string} originalUrl 原始 GitHub URL（含 https://）
 * @param {string} mirror 镜像前缀（空字符串 = 直连）
 */
function buildMirrorUrl(originalUrl, mirror) {
  if (!mirror) return originalUrl;
  return `${mirror}/${originalUrl}`;
}

/**
 * 发起 HTTPS GET 请求（自动跟随重定向，最多 5 次）
 * @param {string} targetUrl 完整 URL
 * @param {object} headers 请求头
 * @param {number} maxRedirects 最大重定向次数
 * @returns {Promise<{statusCode: number, headers: object, body: Buffer}>}
 */
function httpsGet(targetUrl, headers = {}, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const options = {
      method: "GET",
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      headers: { "User-Agent": "yunoseek-ota/1.0", ...headers },
    };
    const req = https.request(options, (res) => {
      // 处理重定向
      if (
        (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) &&
        res.headers.location &&
        maxRedirects > 0
      ) {
        const nextUrl = new URL(res.headers.location, targetUrl).href;
        res.resume(); // 丢弃当前响应体
        return resolve(httpsGet(nextUrl, headers, maxRedirects - 1));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error("请求超时"));
    });
    req.end();
  });
}

/**
 * 按镜像优先级尝试请求，第一个成功的返回
 * @param {string} githubUrl 原始 GitHub URL（api.github.com 或 github.com）
 * @param {object} headers 请求头
 * @returns {Promise<{statusCode: number, headers: object, body: Buffer, mirror: string}>}
 */
async function githubGetWithMirrors(githubUrl, headers = {}) {
  // 构造尝试顺序：优先使用缓存的镜像
  const order = [];
  if (preferredMirror !== null) order.push(preferredMirror);
  for (const m of FALLBACK_ORDER) {
    if (!order.includes(m)) order.push(m);
  }

  let lastErr;
  for (const mirror of order) {
    const tryUrl = buildMirrorUrl(githubUrl, mirror);
    try {
      const result = await httpsGet(tryUrl, headers);
      if (result.statusCode >= 200 && result.statusCode < 400) {
        // 成功：缓存此镜像
        if (preferredMirror !== mirror) {
          console.log(`[ota-apk] 使用镜像: ${mirror || "直连"} (${githubUrl.substring(0, 60)}...)`);
          preferredMirror = mirror;
        }
        return { ...result, mirror };
      }
      // 404 等客户端错误：不需要尝试其他镜像，直接返回
      if (result.statusCode === 404 || result.statusCode === 401 || result.statusCode === 403) {
        return { ...result, mirror };
      }
      // 5xx 等：继续尝试下一个镜像
      lastErr = new Error(`HTTP ${result.statusCode} via ${mirror || "直连"}`);
    } catch (e) {
      lastErr = e;
      // 网络错误/超时：继续尝试下一个镜像
    }
  }
  throw lastErr || new Error("所有镜像均失败");
}

/**
 * 流式下载文件到磁盘（支持镜像 fallback + 重定向 + 健壮的超时）
 * @param {string} githubUrl 原始 GitHub URL
 * @param {string} destPath 目标文件路径
 * @param {object} headers 请求头
 *
 * 关键修复：
 *   - 流式响应中途停滞/断开时，旧代码依赖 req.on('error') 但 error 实际走 res.on('error')，
 *     导致 Promise 永不 reject、镜像 fallback 永不触发（表现为"卡住不动"）。
 *   - 现在 req / res / ws 三个 error 通道都 reject，且数据停滞有独立 watchdog。
 */
async function downloadToFileWithMirrors(githubUrl, destPath, headers = {}) {
  const order = [];
  if (preferredMirror !== null) order.push(preferredMirror);
  for (const m of FALLBACK_ORDER) {
    if (!order.includes(m)) order.push(m);
  }

  let lastErr;
  for (const mirror of order) {
    const tryUrl = buildMirrorUrl(githubUrl, mirror);
    try {
      await downloadToFile(tryUrl, destPath, headers);
      if (preferredMirror !== mirror) {
        console.log(`[ota-apk] 下载镜像: ${mirror || "直连"}`);
        preferredMirror = mirror;
      }
      return;
    } catch (e) {
      lastErr = e;
      console.warn(`[ota-apk] 镜像 ${mirror || "直连"} 失败: ${e.message}`);
      // 失败后清除该镜像的"首选"缓存，强制下次重新探测
      if (preferredMirror === mirror) preferredMirror = null;
      // 删除可能的部分文件
      try { fs.unlinkSync(destPath); } catch {}
    }
  }
  throw lastErr || new Error("所有镜像下载均失败");
}

/**
 * 单次流式下载（自动跟随重定向）
 *
 * 超时策略：
 *   - 建连/响应头超时 30s（ghproxy 偶发卡在 TCP/TLS 握手）
 *   - 数据流停滞超时 30s（响应头已到但数据中途断流——ghproxy 最常见的卡死形态）
 *   - 这两个超时触发后都保证 reject，让上层能 fallback 到下一个镜像
 */
function downloadToFile(targetUrl, destPath, headers = {}, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;
    const options = {
      method: "GET",
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: { "User-Agent": "yunoseek-ota/1.0", ...headers },
    };

    // 统一的清理 + reject 通道，保证 Promise 一定有结果
    let settled = false;
    let stallTimer = null;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      if (stallTimer) clearTimeout(stallTimer);
      try { req.destroy(); } catch {}
      try { fs.unlinkSync(destPath); } catch {}
      reject(err);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      if (stallTimer) clearTimeout(stallTimer);
      resolve();
    };
    // 数据停滞 watchdog：每次收到数据重置 30s 计时
    const resetStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => fail(new Error("数据流停滞超时 (30s)")), 30000);
    };

    const req = lib.request(options, (res) => {
      // 重定向
      if (
        (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) &&
        res.headers.location &&
        maxRedirects > 0
      ) {
        if (stallTimer) clearTimeout(stallTimer);
        res.resume();
        return resolve(downloadToFile(new URL(res.headers.location, targetUrl).href, destPath, headers, maxRedirects - 1));
      }
      if (res.statusCode !== 200) {
        if (stallTimer) clearTimeout(stallTimer);
        res.resume();
        return fail(new Error(`下载失败: HTTP ${res.statusCode}`));
      }
      // 响应头到了，开始监控数据流
      resetStall();
      res.on("data", () => resetStall());
      res.on("error", (e) => fail(e));
      res.on("aborted", () => fail(new Error("响应被中止")));

      const ws = fs.createWriteStream(destPath);
      res.pipe(ws);
      ws.on("finish", () => ws.close(succeed));
      ws.on("error", (e) => fail(e));
    });
    req.on("error", (e) => fail(e));
    // 建连/响应头阶段超时（30s）
    req.setTimeout(30000, () => fail(new Error("建连/响应头超时 (30s)")));
    req.end();
  });
}

/**
 * 路径安全检查（防止目录穿越）
 */
function safeJoin(base, target) {
  const resolved = path.resolve(base, target);
  if (!resolved.startsWith(path.resolve(base))) {
    throw new Error("路径穿越检测");
  }
  return resolved;
}

/**
 * 从 GitHub Release body 解析 versionCode
 * 格式：<!-- versionCode: N -->
 */
function parseVersionCode(body) {
  if (!body) return undefined;
  const match = body.match(/<!--\s*versionCode:\s*(\d+)\s*-->/);
  if (match) return parseInt(match[1], 10);
  return undefined;
}

/**
 * 从 Release assets 中找到对应 ABI 的 APK
 */
function findAssetForAbi(assets, abi) {
  // 文件名格式：app-{abi}-release.apk
  const targetName = `app-${abi}-release.apk`;
  let asset = assets.find((a) => a.name === targetName);
  if (asset) return asset;
  // 兜底：模糊匹配
  asset = assets.find((a) => a.name.endsWith(".apk") && a.name.includes(abi));
  return asset || null;
}

/**
 * 查询 GitHub Releases latest（带 5 分钟缓存）
 *
 * 认证策略：
 *   - 有 GITHUB_TOKEN 时直连 api.github.com（5000/h 配额，镜像会丢失 Authorization 头导致回到 60/h）
 *   - 无 token 时走镜像 fallback（借用镜像 IP 池规避单 IP 限流，但仍受镜像自身配额限制）
 *
 * 注意：镜像只用于 asset 下载（公开文件），不用于需要认证的 API 查询。
 */
async function fetchLatestRelease() {
  // 缓存检查
  if (releaseCache && Date.now() - releaseCache.ts < RELEASE_CACHE_TTL) {
    return releaseCache.data;
  }

  if (!GITHUB_REPO) {
    throw new Error("未配置 GITHUB_REPO 环境变量");
  }

  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }

  // 有 token：直连 GitHub（镜像不转发 Authorization 头，且镜像共享 IP 易被限流）
  // 无 token：走镜像 fallback（最后会回落到直连）
  const result = GITHUB_TOKEN
    ? await httpsGet(apiUrl, headers)
    : await githubGetWithMirrors(apiUrl, headers);

  if (result.statusCode !== 200) {
    throw new Error(`GitHub API 返回 ${result.statusCode}`);
  }

  const data = JSON.parse(result.body.toString("utf-8"));
  releaseCache = { data, ts: Date.now() };
  return data;
}

// ── 端点处理函数 ──────────────────────────────────────────

/**
 * GET /api/ota/manifest — expo-updates 协议 manifest
 */
export async function handleOtaManifest(req, res) {
  try {
    const runtimeVersion = req.headers["expo-runtime-version"];
    if (!runtimeVersion) {
      res.writeHead(204, { "Content-Length": "0" });
      res.end();
      return;
    }

    const manifestPath = path.join(OTA_DIR, "manifests", `latest-${runtimeVersion}.json`);
    if (!fs.existsSync(manifestPath)) {
      res.writeHead(204, { "Content-Length": "0" });
      res.end();
      return;
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

    // ETag 检查
    const etag = `"${manifest.id}"`;
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { ETag: etag });
      res.end();
      return;
    }

    const body = JSON.stringify(manifest);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      ETag: etag,
      "Cache-Control": "no-cache",
    });
    res.end(body);
  } catch (err) {
    console.error("[ota-apk] manifest 错误:", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * GET /api/ota/assets?path=xxx — OTA 资源文件分发
 */
export async function handleOtaAssets(req, res) {
  try {
    const parsed = url.parse(req.url, true);
    const relPath = parsed.query.path;
    if (!relPath || typeof relPath !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "缺少 path 参数" }));
      return;
    }

    const filePath = safeJoin(OTA_DIR, relPath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "文件不存在" }));
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      ".js": "application/javascript",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".webp": "image/webp",
      ".ttf": "font/ttf",
      ".otf": "font/otf",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
    };
    const contentType = contentTypes[ext] || "application/octet-stream";

    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error("[ota-apk] assets 错误:", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * GET /api/apk/version?current=N&abi=arm64-v8a — APK 版本检查
 */
export async function handleApkVersion(req, res) {
  try {
    const parsed = url.parse(req.url, true);
    const currentVersionCode = parseInt(parsed.query.current, 10) || 0;
    const abi = parsed.query.abi || "arm64-v8a";

    const release = await fetchLatestRelease();

    // 解析 versionCode（嵌入在 Release body 的 HTML 注释中）
    const latestVersionCode = parseVersionCode(release.body);

    // 版本号从 tag_name 提取（格式：v1.0.2_0723）
    const latestVersion = release.tag_name?.replace(/^v/, "") || release.name || "";

    // changelog：去掉 versionCode 注释行
    let changelog = release.body || "";
    changelog = changelog.replace(/<!--\s*versionCode:\s*\d+\s*-->\n?/, "").trim();

    // 检查对应 ABI 的 asset 是否存在
    const asset = findAssetForAbi(release.assets || [], abi);
    const hasAsset = !!asset;

    // forceUpdate：如果 latestVersionCode 比 current 大很多（例如差 5 个版本），可以强制
    // 目前简单实现：不强制，由客户端判断
    const forceUpdate = false;

    const result = {
      latestVersion,
      latestVersionCode,
      changelog,
      forceUpdate,
      hasAsset,
      abi,
      githubReleaseUrl: release.html_url,
    };

    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    });
    res.end(JSON.stringify(result));
  } catch (err) {
    console.error("[ota-apk] version 错误:", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
}

/**
 * GET /api/apk/download?abi=arm64-v8a — APK 代理下载 + 磁盘缓存
 */
export async function handleApkDownload(req, res) {
  try {
    const parsed = url.parse(req.url, true);
    const abi = parsed.query.abi || "arm64-v8a";

    const release = await fetchLatestRelease();

    // 找到对应 ABI 的 asset
    const asset = findAssetForAbi(release.assets || [], abi);
    if (!asset) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `未找到 ${abi} 的 APK` }));
      return;
    }

    // 磁盘缓存路径：{abi}-{publishedAt}.apk
    // publishedAt 格式：2026-07-23T10:00:00Z → 20260723
    const publishedDate = (release.published_at || "").split("T")[0].replace(/-/g, "");
    const cacheFileName = `${abi}-${publishedDate}.apk`;
    const cacheFilePath = path.join(APK_CACHE_DIR, cacheFileName);

    // 确保缓存目录存在
    if (!fs.existsSync(APK_CACHE_DIR)) {
      fs.mkdirSync(APK_CACHE_DIR, { recursive: true });
    }

    // 缓存命中：直接返回
    if (fs.existsSync(cacheFilePath)) {
      const stat = fs.statSync(cacheFilePath);
      console.log(`[ota-apk] 缓存命中: ${cacheFileName} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
      res.writeHead(200, {
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Length": stat.size,
        "Content-Disposition": `attachment; filename="app-${abi}-release.apk"`,
        "Cache-Control": "public, max-age=3600",
      });
      fs.createReadStream(cacheFilePath).pipe(res);
      return;
    }

    // 缓存未命中：从 GitHub 下载（通过镜像）
    console.log(`[ota-apk] 开始下载: ${asset.name} from ${asset.browser_download_url}`);

    // 先下载到临时文件，完成后重命名（避免下载中断导致缓存损坏）
    const tempPath = `${cacheFilePath}.tmp`;

    await downloadToFileWithMirrors(asset.browser_download_url, tempPath);

    // 下载完成，重命名
    fs.renameSync(tempPath, cacheFilePath);

    // 清理旧版本的缓存文件（只保留当前版本）
    try {
      for (const f of fs.readdirSync(APK_CACHE_DIR)) {
        if (f.startsWith(`${abi}-`) && f.endsWith(".apk") && f !== cacheFileName) {
          fs.unlinkSync(path.join(APK_CACHE_DIR, f));
          console.log(`[ota-apk] 清理旧缓存: ${f}`);
        }
      }
    } catch (e) {
      // 清理失败不影响下载
    }

    // 返回文件
    const stat = fs.statSync(cacheFilePath);
    console.log(`[ota-apk] 下载完成: ${cacheFileName} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
    res.writeHead(200, {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename="app-${abi}-release.apk"`,
      "Cache-Control": "public, max-age=3600",
    });
    fs.createReadStream(cacheFilePath).pipe(res);
  } catch (err) {
    console.error("[ota-apk] download 错误:", err.message);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
}
