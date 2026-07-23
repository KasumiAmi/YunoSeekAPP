// API 层：封装 server.js 所有 /api/* 端点
const API_BASE = "https://yunoseek.ownbangdream.asia";

// 从上游错误响应里抽出可读消息，避免把整个 JSON 原文塞给用户
function friendlyError(prefix: string, status: number, body: string): Error {
  // 1. 尝试解析 JSON 抽取 error / message 字段
  let parsed: any = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    // 非 JSON：取前 120 字作为正文（截断长 HTML/stacktrace）
  }
  let msg = "";
  if (parsed && typeof parsed === "object") {
    msg =
      (typeof parsed.error === "string" && parsed.error) ||
      (typeof parsed.message === "string" && parsed.message) ||
      (parsed.error && typeof parsed.error.message === "string" && parsed.error.message) ||
      "";
  }
  if (!msg && typeof body === "string" && body.trim()) {
    msg = body.trim().slice(0, 120);
  }
  // 2. 常见 HTTP 状态码翻译
  if (!msg) {
    if (status === 429) msg = "请求过于频繁，请稍后再试";
    else if (status === 401 || status === 403) msg = "接口鉴权失败，请检查 API Key";
    else if (status === 404) msg = "接口不存在（404）";
    else if (status >= 500) msg = `服务器暂时不可用（${status}）`;
    else msg = `请求失败（HTTP ${status}）`;
  }
  return new Error(msg);
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  reasoning_content?: string;
  profileKey?: string;
  profileName?: string;
  images?: { data: string; mimeType: string }[];
}

export interface ChatOptions {
  reasoning?: boolean;
  reasoningEffort?: string;
  vision?: boolean;
  webSearch?: boolean;
  locale?: string;
  profileKey?: string;
  profileName?: string;
  stream?: boolean;
  customProviderActive?: boolean;
  customProvider?: CustomProviderConfig;
}

// 自定义接口配置：用户在设置页填写的接入信息（与 web 端 state.provider 对齐）
export interface CustomProviderConfig {
  enabled: boolean;
  protocol: "openai" | "anthropic" | "gemini";
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ServerConfig {
  model: string;
  apiProtocol: string;
  providerName: string;
  reasoningEffort: string;
  temperature: number;
  maxTokens: number;
  hasChatConfig: boolean;
  hasSystemPrompt: boolean;
  hasVisionConfig: boolean;
  hasAnySearchApiKey: boolean;
  turnstileEnabled: boolean;
  handoffEnabled: boolean;
  animeScheduleEnabled: boolean;
  worldArchiveEnabled: boolean;
  assetBaseUrl: string;
}

export async function getConfig(): Promise<ServerConfig> {
  const res = await fetch(`${API_BASE}/api/config`, { cache: "no-store" });
  if (!res.ok) throw new Error(`getConfig: HTTP ${res.status}`);
  return res.json();
}

/**
 * 流式聊天：返回 ReadableStream，调用方用 SSE 解析器逐 chunk 读取。
 */
export async function chatStream(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<Response> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...options,
      messages,
      stream: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw friendlyError("chatStream", res.status, text);
  }
  return res;
}

/**
 * 非流式聊天：直接返回完整 JSON 响应。
 */
export async function chatComplete(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<any> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...options,
      messages,
      stream: false,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw friendlyError("chatComplete", res.status, text);
  }
  return res.json();
}

/**
 * 拉取自定义接口的可用模型列表（对应 web 端 /api/provider/models）。
 * 由服务端代理请求用户填入的 baseUrl，避免 CORS / 协议适配问题。
 */
export async function providerModels(provider: CustomProviderConfig): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/provider/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider }),
  });
  const text = await res.text().catch(() => "");
  let payload: any = null;
  try { payload = JSON.parse(text); } catch {}
  if (!res.ok) {
    throw friendlyError("providerModels", res.status, text);
  }
  const models = Array.isArray(payload?.models) ? payload.models.filter(Boolean) : [];
  return models;
}

export async function summarize(messages: ChatMessage[]): Promise<string> {
  const res = await fetch(`${API_BASE}/api/summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) return "";
  const data = await res.json();
  return data?.title || "";
}

export async function search(query: string): Promise<any[]> {
  const res = await fetch(`${API_BASE}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data?.results || [];
}

export type ChatRouteState = "primary" | "fallback" | "outage" | "unknown";

export interface ConnectionPingResult {
  reachable: boolean;
  route: ChatRouteState;
  changedAt: number;
  latencyMs: number | null;
}

export async function connectionPing(): Promise<ConnectionPingResult> {
  try {
    const start = Date.now();
    const res = await fetch(`${API_BASE}/api/connection-ping`, { cache: "no-store" });
    const latencyMs = Date.now() - start;
    const routeHeader = res.headers.get("x-yunoseek-chat-route") || "";
    const changedAtHeader = Number(res.headers.get("x-yunoseek-chat-route-changed-at")) || 0;
    // 服务端约定：204 = 通；503 = 不通或 outage。
    // 路由细分由响应头 x-yunoseek-chat-route 提供：primary / fallback / outage
    let route: ChatRouteState = "unknown";
    if (routeHeader === "primary" || routeHeader === "fallback" || routeHeader === "outage") {
      route = routeHeader;
    }
    const reachable = res.ok || res.status === 204;
    // 若服务端返回 503 但路由是 outage，说明服务器可达但聊天通道不可用；
    // 若返回 503 且路由不是 outage，说明主备都探不通；
    // 若网络异常，则 catch 分支返回 unreachable + unknown。
    return { reachable, route, changedAt: changedAtHeader, latencyMs: reachable ? latencyMs : null };
  } catch {
    return { reachable: false, route: "unknown", changedAt: 0, latencyMs: null };
  }
}

export interface ModelHealthResult {
  chatQuota: {
    totalTokens: number;
    updatedAt: number;
  };
  chatRoute: ChatRouteState;
}

export async function modelHealth(): Promise<ModelHealthResult | null> {
  try {
    const res = await fetch(`${API_BASE}/api/model-health`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/**
 * 格式化 Token 用量展示（与 web 端 formatTokenUsage 对齐）
 * < 1000 → 原数；< 1_000_000 → 1.2k；≥ 1_000_000 → 1.23M
 */
export function formatTokenUsage(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0";
  if (tokens < 1000) return String(Math.floor(tokens));
  if (tokens < 1_000_000) return (tokens / 1000).toFixed(1) + "k";
  if (tokens < 1_000_000_000) return (tokens / 1_000_000).toFixed(2) + "M";
  return (tokens / 1_000_000_000).toFixed(2) + "B";
}

// Handoff
export async function handoffCreate(): Promise<{ token: string }> {
  const res = await fetch(`${API_BASE}/api/handoff/create`, { method: "POST" });
  if (!res.ok) throw new Error(`handoffCreate: HTTP ${res.status}`);
  return res.json();
}

// snapshot：带上本地 conversations，让服务端做双向合并（与 web 端对齐）。
// 不传时服务端 sanitizeHandoffSnapshot 得到空对象，直接返回 server 现有数据（向后兼容）。
export async function handoffPull(token: string, snapshot?: Record<string, any>): Promise<any> {
  const res = await fetch(`${API_BASE}/api/handoff/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot ? { token, snapshot } : { token }),
  });
  if (!res.ok) throw new Error(`handoffPull: HTTP ${res.status}`);
  return res.json();
}

// 返回服务端响应：可能含合并后的 conversations（其他设备 push 的新会话）。
// 调用方可检查 data.conversations 并本地合并（向后兼容：旧调用方忽略返回值无影响）。
export async function handoffPush(token: string, payload: any): Promise<any> {
  // 服务端 handleHandoff 读取 body.snapshot || body.state 作为快照，
  // 因此这里把 payload 包成 snapshot 字段发送（与 web 端 requestHandoff 对齐）
  const res = await fetch(`${API_BASE}/api/handoff/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, snapshot: payload }),
  });
  if (!res.ok) throw new Error(`handoffPush: HTTP ${res.status}`);
  return res.json().catch(() => ({}));
}

// Archive
export async function archiveCatalog(params: {
  locale?: string;
  type?: string;
  q?: string;
  page?: number;
}): Promise<any> {
  const qs = new URLSearchParams();
  if (params.locale) qs.set("locale", params.locale);
  if (params.type) qs.set("type", params.type);
  if (params.q) qs.set("q", params.q);
  if (params.page) qs.set("page", String(params.page));
  const res = await fetch(`${API_BASE}/api/archive/catalog?${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`archiveCatalog: HTTP ${res.status}`);
  return res.json();
}

export async function archiveEntry(id: string, locale?: string): Promise<any> {
  const qs = new URLSearchParams({ id });
  if (locale) qs.set("locale", locale);
  const res = await fetch(`${API_BASE}/api/archive/entry?${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`archiveEntry: HTTP ${res.status}`);
  return res.json();
}

// Anime Schedule
export async function animeSchedule(): Promise<any> {
  const res = await fetch(`${API_BASE}/api/anime-schedule`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

// Announcement
export async function announcement(): Promise<any> {
  const res = await fetch(`${API_BASE}/api/announcement`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

// Viola Override
export async function violaOverride(): Promise<{ enabled: boolean; deadline: string }> {
  const res = await fetch(`${API_BASE}/api/viola-override`, { cache: "no-store" });
  if (!res.ok) return { enabled: false, deadline: "" };
  return res.json();
}
