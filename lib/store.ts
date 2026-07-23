// Zustand store：替代现有 app.js state + localStorage
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { profiles, randomProfile, type Profile } from "./profiles";

// ============================================================================
// AsyncStorage 分块存储 + 安全包装
// ============================================================================
//
// 根因：Android SQLite CursorWindow 默认 ~2MB 限制。
// 整个 zustand store 作为单个 AsyncStorage key 存储，引继码同步后
// conversations JSON 容易超过 2MB。此时 WRITE 成功（SQLite 接受大值），
// 但 READ 失败（CursorWindowAllocationException）→ hydration reject →
// 默认空状态 → checkHandoff 重新申请引继码 → 数据看起来"被重置"。
//
// 修复：值 > 512KB 时自动分块为多个 AsyncStorage key（每块 ≤512KB），
// 远低于 2MB CursorWindow 限制。读取时按 metadata 找到所有分块拼接。
// 旧的单键值通过 fallback 路径读取（迁移期）；读取失败返回 null（降级）。
//
// 安全包装（保留）：
// 1. hydration 成功后才放行 setItem：避免默认空状态覆盖磁盘残留数据
// 2. 写入队列串行化：setConversations + setHandoffToken 连续调用产生并发 setItem
// 3. 捕获 setItem 写入错误：zustand persist 不 await 不 catch storage.setItem() Promise

const CHUNK_THRESHOLD = 512 * 1024; // 512KB - 超过此大小触发分块
const CHUNK_SIZE = 512 * 1024;      // 512KB - 每块大小（远低于 2MB CursorWindow 限制）
const META_SUFFIX = ":chunkmeta";   // 分块元数据 key 后缀（commit marker）

// 清理指定 key 的旧分块（从 fromIndex 开始到 count-1）
async function cleanupChunks(key: string, count: number, fromIndex = 0): Promise<void> {
  for (let i = fromIndex; i < count; i++) {
    try {
      await AsyncStorage.removeItem(`${key}:chunk:${i}`);
    } catch {}
  }
}

// 分块读取：先读 metadata 判断是否分块，是则按序读所有分块拼接；否则 fallback 到旧单键
async function chunkedGetItem(key: string): Promise<string | null> {
  // 1. 尝试读取 metadata（commit marker）
  let prevChunkCount = 0;
  let hasMeta = false;
  try {
    const metaRaw = await AsyncStorage.getItem(key + META_SUFFIX);
    if (metaRaw) {
      const meta = JSON.parse(metaRaw);
      if (meta && meta.chunked && typeof meta.chunks === "number" && meta.chunks > 0) {
        prevChunkCount = meta.chunks;
        hasMeta = true;
      }
    }
  } catch (e) {
    // metadata 读取失败（可能旧单键值超 2MB 触发 CursorWindow 异常）
    // 落到下面 fallback 路径，再次尝试读取旧单键
    console.warn(`[persist] 读取 chunk metadata 失败 (${key}):`, e);
  }

  if (hasMeta && prevChunkCount > 0) {
    // 2. 分块模式：按序读所有分块拼接
    const parts: string[] = [];
    for (let i = 0; i < prevChunkCount; i++) {
      try {
        const chunk = await AsyncStorage.getItem(`${key}:chunk:${i}`);
        if (chunk === null) {
          // 分块缺失 - 数据损坏，返回 null 触发默认状态
          console.error(`[persist] 分块 ${i}/${prevChunkCount} 缺失 (${key})`);
          return null;
        }
        parts.push(chunk);
      } catch (e) {
        console.error(`[persist] 读取分块 ${i}/${prevChunkCount} 失败 (${key}):`, e);
        return null;
      }
    }
    const assembled = parts.join("");
    console.log(`[persist] 分块读取成功：${prevChunkCount} 块拼接，总大小 ${assembled.length} 字节 (${key})`);
    return assembled;
  }

  // 3. Fallback：旧单键格式（迁移期或小值）
  try {
    return await AsyncStorage.getItem(key);
  } catch (e) {
    // 旧单键值超 2MB 触发 CursorWindow 异常 - 数据无法读取
    // 返回 null 触发默认状态（zustand persist 把 null 视为无数据，hydration "成功"）
    console.warn(`[persist] 读取旧单键值失败 (${key})，可能是 CursorWindow 2MB 限制:`, e);
    return null;
  }
}

// 分块写入：值 > 阈值时切分为多块写入，写完所有块后再写 metadata（commit marker）
async function chunkedSetItem(key: string, value: string): Promise<void> {
  // 1. 读取旧 metadata 以清理旧分块
  let prevChunkCount = 0;
  try {
    const metaRaw = await AsyncStorage.getItem(key + META_SUFFIX);
    if (metaRaw) {
      const meta = JSON.parse(metaRaw);
      if (meta && meta.chunked && typeof meta.chunks === "number") {
        prevChunkCount = meta.chunks;
      }
    }
  } catch {}

  if (value.length <= CHUNK_THRESHOLD) {
    // 2. 小值：直接写单键，清理可能存在的旧分块
    await AsyncStorage.setItem(key, value);
    if (prevChunkCount > 0) {
      await cleanupChunks(key, prevChunkCount);
      try { await AsyncStorage.removeItem(key + META_SUFFIX); } catch {}
    }
    return;
  }

  // 3. 大值：切分写入
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) {
    chunks.push(value.slice(i, i + CHUNK_SIZE));
  }

  // 写入所有分块（每块 ≤512KB，远低于 2MB CursorWindow 限制）
  for (let i = 0; i < chunks.length; i++) {
    await AsyncStorage.setItem(`${key}:chunk:${i}`, chunks[i]);
  }

  // 写入 metadata 作为 commit marker（所有分块写完后再写，确保读取时不会看到部分分块）
  await AsyncStorage.setItem(key + META_SUFFIX, JSON.stringify({ chunked: true, chunks: chunks.length }));

  // 清理多余的旧分块（新块数 < 旧块数时）
  if (prevChunkCount > chunks.length) {
    await cleanupChunks(key, prevChunkCount, chunks.length);
  }
  // 清理旧的单键值
  try { await AsyncStorage.removeItem(key); } catch {}

  console.log(`[persist] 分块写入成功：${chunks.length} 块，总大小 ${value.length} 字节 (${key})`);
}

// 分块删除：清理所有分块、metadata 和旧单键
async function chunkedRemoveItem(key: string): Promise<void> {
  // 读取 metadata 获取分块数
  let chunkCount = 0;
  try {
    const metaRaw = await AsyncStorage.getItem(key + META_SUFFIX);
    if (metaRaw) {
      const meta = JSON.parse(metaRaw);
      if (meta && meta.chunked && typeof meta.chunks === "number") {
        chunkCount = meta.chunks;
      }
    }
  } catch {}

  // 清理所有分块
  if (chunkCount > 0) {
    await cleanupChunks(key, chunkCount);
  }
  // 清理 metadata 和旧单键
  try { await AsyncStorage.removeItem(key + META_SUFFIX); } catch {}
  try { await AsyncStorage.removeItem(key); } catch {}
}

let _hydrationSuccess = false;
let _writeQueue: Promise<void> = Promise.resolve();

const safeAsyncStorage = {
  getItem: (key: string) => chunkedGetItem(key),
  setItem: async (key: string, value: string) => {
    if (!_hydrationSuccess) {
      console.warn("[persist] 跳过 setItem：hydration 未成功完成，避免默认状态覆盖持久化数据");
      return;
    }
    // 串行化写入：每次 setItem 排队等待前一次完成
    _writeQueue = _writeQueue.then(async () => {
      try {
        await chunkedSetItem(key, value);
      } catch (e) {
        console.error(`[persist] chunkedSetItem 失败 (size=${value.length}):`, e);
      }
    });
    return _writeQueue;
  },
  removeItem: (key: string) => chunkedRemoveItem(key),
};

// 等待所有排队的写入操作完成。
// 引继码同步（setConversations + setHandoffToken）后调用，
// 确保数据落盘后再向用户显示"恢复成功"，避免用户在写入未完成时退出导致数据丢失。
export function flushPendingWrites(): Promise<void> {
  return _writeQueue;
}

// 自定义接口配置（与 lib/api.ts 的 CustomProviderConfig 对齐）
export interface CustomProviderConfig {
  enabled: boolean;
  protocol: "openai" | "anthropic" | "gemini";
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const DEFAULT_CUSTOM_PROVIDER: CustomProviderConfig = {
  enabled: false,
  protocol: "openai",
  baseUrl: "",
  apiKey: "",
  model: "",
};

// APK 整包更新信息（运行时状态，不持久化，每次启动重新检查）
export interface ApkUpdateInfo {
  hasUpdate: boolean;
  latestVersion?: string;
  latestVersionCode?: number;
  apkDownloadUrl?: string;
  changelog?: string;
  forceUpdate?: boolean;
  abi?: string;
}

export interface Attachment {
  id: string;
  uri: string;        // 本地文件路径（expo-image-picker 返回）
  base64?: string;    // 压缩后 base64（发送用）
  width: number;
  height: number;
  mimeType: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoningContent?: string;
  reasoningEnabled?: boolean; // 发送时是否开启了深度思考（控制显示）
  profileKey?: string;
  profileName?: string;
  timestamp: number;
  streaming?: boolean;
  error?: string;
  attachments?: Attachment[];
  searchResults?: SearchResult[];
  // 重试多版本：versions 存所有版本快照（含当前展示版本），currentVersion 是当前展示版本索引。
  // 顶层 content/reasoningContent 等始终代表当前展示版本（= versions[currentVersion] 的视图）。
  // 切换时交换顶层与 versions[target]，重试时 append 新版本。
  versions?: Message[];
  currentVersion?: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  pinned: boolean;
  profileKey?: string; // 对话绑定的角色（创建时记录，用户切换角色时同步）
  createdAt: number;
  updatedAt: number;
}

interface State {
  // 对话
  conversations: Conversation[];
  activeConversationId: string | null;

  // 角色
  currentProfileKey: string;

  // 设置
  themeMode: "dark" | "light" | "system";
  locale: string;
  reasoning: boolean;
  reasoningEffort: string;
  vision: boolean;
  webSearch: boolean;
  customProvider: CustomProviderConfig;

  // 服务端配置
  serverConfig: Record<string, any> | null;

  // 本地统计
  totalTokensUsed: number;
  handoffToken: string;

  // 更新状态（运行时，不持久化）
  apkUpdateAvailable: ApkUpdateInfo | null;
  otaUpdateReady: boolean;

  // Actions
  setActiveConversation: (id: string | null) => void;
  createConversation: () => string;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  togglePin: (id: string) => void;
  addMessage: (convId: string, msg: Message) => void;
  updateMessage: (convId: string, msgId: string, patch: Partial<Message>) => void;
  /** 截断：删除指定消息及其之后的所有消息 */
  truncateAfterMessage: (convId: string, msgId: string) => void;
  setCurrentProfile: (key: string) => void;
  shuffleProfile: () => void;
  setThemeMode: (mode: "dark" | "light" | "system") => void;
  setLocale: (locale: string) => void;
  toggleReasoning: () => void;
  setReasoningEffort: (effort: string) => void;
  toggleVision: () => void;
  toggleWebSearch: () => void;
  setCustomProvider: (patch: Partial<CustomProviderConfig>) => void;
  setServerConfig: (config: Record<string, any>) => void;
  addTokens: (n: number) => void;
  setHandoffToken: (token: string) => void;
  setConversations: (conversations: Conversation[]) => void;
  // 合并服务端返回的 conversations：按 ID 并集，updatedAt 更新者优先。
  // 内部对服务端数据做 sanitize（确保字段类型正确、剥离 base64）。
  mergeConversations: (rawServerConversations: unknown) => void;
  setApkUpdateAvailable: (info: ApkUpdateInfo | null) => void;
  setOtaUpdateReady: (ready: boolean) => void;
  getActiveConversation: () => Conversation | undefined;
  getCurrentProfile: () => Profile;
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 清理服务端返回的会话数据（供 mergeConversations 使用）：
// - 确保是数组，过滤无效项
// - 剥离 base64（服务端可能存有推送时上传的 base64 图片，拉回后内存暴涨）
// - 确保必要字段存在且类型正确，防止 partialize 或 UI 渲染时崩溃
function sanitizeConversations(raw: unknown): Conversation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && typeof (c as any).id === "string")
    .map((c) => ({
      id: c.id as string,
      title: typeof c.title === "string" ? c.title : "",
      messages: Array.isArray(c.messages)
        ? (c.messages
            .filter((m): m is Record<string, unknown> => !!m && typeof m === "object" && typeof (m as any).id === "string")
            .map((m) => ({
              ...(m as any),
              attachments: Array.isArray((m as any).attachments)
                ? (m as any).attachments.map(({ base64: _b, ...rest }: any) => rest)
                : undefined,
            })) as Message[])
        : [],
      pinned: Boolean(c.pinned),
      profileKey: typeof c.profileKey === "string" ? c.profileKey : undefined,
      createdAt: typeof c.createdAt === "number" ? c.createdAt : Date.now(),
      updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : Date.now(),
    })) as Conversation[];
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeConversationId: null,
      currentProfileKey: "yuno",
      themeMode: "dark",
      locale: "zh-CN",
      reasoning: false,
      reasoningEffort: "high",
      vision: false,
      webSearch: false,
      customProvider: { ...DEFAULT_CUSTOM_PROVIDER },
      serverConfig: null,
      totalTokensUsed: 0,
      handoffToken: "",
      apkUpdateAvailable: null,
      otaUpdateReady: false,

      setActiveConversation: (id) => {
        if (id === null) {
          set({ activeConversationId: null });
          return;
        }
        // 切换对话时，把当前角色同步为该对话绑定的角色
        // 老对话没有 profileKey 字段时，从最后一条带 profileKey 的消息推断
        const conv = get().conversations.find((c) => c.id === id);
        let boundKey = conv?.profileKey;
        if (!boundKey && conv) {
          const lastWithKey = [...conv.messages].reverse().find((m) => m.profileKey);
          boundKey = lastWithKey?.profileKey;
        }
        set((s) => ({
          activeConversationId: id,
          currentProfileKey: boundKey || s.currentProfileKey,
        }));
      },

      createConversation: () => {
        const id = genId();
        const conv: Conversation = {
          id,
          title: "",
          messages: [],
          pinned: false,
          profileKey: get().currentProfileKey, // 绑定当前角色
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((s) => ({
          conversations: [conv, ...s.conversations],
          activeConversationId: id,
        }));
        return id;
      },

      deleteConversation: (id) =>
        set((s) => ({
          conversations: s.conversations.filter((c) => c.id !== id),
          activeConversationId: s.activeConversationId === id ? null : s.activeConversationId,
        })),

      renameConversation: (id, title) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, title, updatedAt: Date.now() } : c
          ),
        })),

      togglePin: (id) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, pinned: !c.pinned } : c
          ),
        })),

      addMessage: (convId, msg) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId
              ? { ...c, messages: [...c.messages, msg], updatedAt: Date.now() }
              : c
          ),
        })),

      updateMessage: (convId, msgId, patch) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === msgId ? { ...m, ...patch } : m
                  ),
                }
              : c
          ),
        })),

      truncateAfterMessage: (convId, msgId) =>
        set((s) => ({
          conversations: s.conversations.map((c) => {
            if (c.id !== convId) return c;
            const idx = c.messages.findIndex((m) => m.id === msgId);
            if (idx === -1) return c;
            return { ...c, messages: c.messages.slice(0, idx), updatedAt: Date.now() };
          }),
        })),

      setCurrentProfile: (key) => {
        // 仅切换当前角色，不再改写已有对话的 profileKey。
        // 对话绑定的角色在创建时固定（见 createConversation），
        // 切换角色只影响「下次新建对话」使用哪个角色，避免历史对话的角色标签被改写、
        // 也避免 setActiveConversation 回填时把 currentProfileKey 覆盖回旧值导致消息看起来"被吞"。
        set({ currentProfileKey: key });
      },

      shuffleProfile: () => {
        // 随机切换角色，不改写已有对话绑定（同 setCurrentProfile）
        const current = get().currentProfileKey;
        const next = randomProfile(current);
        set({ currentProfileKey: next.key });
      },

      setThemeMode: (mode) => set({ themeMode: mode }),
      setLocale: (locale) => set({ locale }),
      toggleReasoning: () => set((s) => ({ reasoning: !s.reasoning })),
      setReasoningEffort: (effort) => set({ reasoningEffort: effort }),
      toggleVision: () => set((s) => ({ vision: !s.vision })),
      toggleWebSearch: () => set((s) => ({ webSearch: !s.webSearch })),
      setCustomProvider: (patch) =>
        set((s) => ({ customProvider: { ...s.customProvider, ...patch } })),
      setServerConfig: (config) => set({ serverConfig: config }),
      addTokens: (n) => set((s) => ({ totalTokensUsed: s.totalTokensUsed + n })),
      setHandoffToken: (token) => set({ handoffToken: token }),
      setConversations: (conversations) => set({ conversations }),
      mergeConversations: (rawServer) =>
        set((s) => {
          const serverConvs = sanitizeConversations(rawServer);
          const localById = new Map(s.conversations.map((c) => [c.id, c]));
          const serverById = new Map(serverConvs.map((c) => [c.id, c]));
          const merged: Conversation[] = [];
          // server 为主：updatedAt 更新的优先
          for (const [id, conv] of serverById) {
            const local = localById.get(id);
            if (!local || (conv.updatedAt || 0) > (local.updatedAt || 0)) {
              merged.push(conv);
            } else {
              merged.push(local);
            }
          }
          // local 独有的追加（不丢失本地独有会话）
          for (const [id, conv] of localById) {
            if (!serverById.has(id)) merged.push(conv);
          }
          // 仅当有变化时才更新 state（避免无谓 setState 触发持久化写入）
          const sameLength = merged.length === s.conversations.length;
          const noChange = sameLength && merged.every((c, i) => c.id === s.conversations[i]?.id && c.updatedAt === s.conversations[i]?.updatedAt);
          return noChange ? {} : { conversations: merged };
        }),
      setApkUpdateAvailable: (info) => set({ apkUpdateAvailable: info }),
      setOtaUpdateReady: (ready) => set({ otaUpdateReady: ready }),

      getActiveConversation: () => {
        const s = get();
        return s.conversations.find((c) => c.id === s.activeConversationId);
      },

      getCurrentProfile: () => {
        const s = get();
        return profiles.find((p) => p.key === s.currentProfileKey) || profiles[0];
      },
    }),
    {
      name: "yunoseek-store",
      storage: createJSONStorage(() => safeAsyncStorage),
      onRehydrateStorage: () => (state, error) => {
        // 仅在 hydration 成功时放行 setItem。
        // 失败时（error 非空）_hydrationSuccess 保持 false，本会话所有写入被跳过，
        // 避免内存中的默认空状态覆盖磁盘上可能仍残留的持久化数据。
        if (!error) {
          _hydrationSuccess = true;
        } else {
          console.error("[persist] hydration 失败，AsyncStorage 可能不可用，本会话写入已阻断:", error);
        }
      },
      partialize: (state) => ({
        // 防御性处理：引继码恢复时服务端返回的 conversations 结构可能与本地类型不完全匹配，
        // 如果 conversations 不是数组或 messages 缺失，partialize 抛出异常会导致
        // zustand persist 的 setItem 永远不被调用，后续所有写入都被阻断。
        // 此处用 Array.isArray 守卫 + 空数组回退，确保 partialize 不会抛出。
        conversations: Array.isArray(state.conversations)
          ? state.conversations.map((c) => ({
              ...c,
              messages: Array.isArray(c?.messages)
                ? c.messages.map((m) => ({
                    ...m,
                    // 剥离 base64 数据避免超 AsyncStorage 6MB 限制（仅保留 uri 用于本地显示）
                    attachments: Array.isArray(m?.attachments)
                      ? m.attachments.map(({ base64, ...rest }) => rest)
                      : undefined,
                  }))
                : [],
            }))
          : [],
        activeConversationId: state.activeConversationId,
        currentProfileKey: state.currentProfileKey,
        themeMode: state.themeMode,
        locale: state.locale,
        reasoning: state.reasoning,
        reasoningEffort: state.reasoningEffort,
        vision: state.vision,
        webSearch: state.webSearch,
        customProvider: state.customProvider,
        totalTokensUsed: state.totalTokensUsed,
        handoffToken: state.handoffToken,
      }),
    }
  )
);
