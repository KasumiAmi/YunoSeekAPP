// 主聊天页：消息列表 + 流式 SSE + 图片附件 + 联网搜索 + 停止/重试
import React, { useCallback, useEffect, useRef, useState } from "react";

// ── 放送日程倒计时 ──────────────────────────────────────────
// 使用与 web 端对齐的 Asia/Shanghai 时区计算，开播前 1 小时显示气泡提醒
// 直播窗口内（开播后 24 分钟）也显示"正在开播"
import { animeBroadcastState, formatCountdown } from "../lib/anime-schedule-time";

function getStreamStatus(): { show: boolean; live: boolean; minutesLeft: number; remainingMs: number } {
  const state = animeBroadcastState();
  if (state.live) {
    return { show: true, live: true, minutesLeft: 0, remainingMs: 0 };
  }
  const oneHourMs = 60 * 60 * 1000;
  if (state.remainingMs > 0 && state.remainingMs <= oneHourMs) {
    return { show: true, live: false, minutesLeft: Math.floor(state.remainingMs / 60000), remainingMs: state.remainingMs };
  }
  return { show: false, live: false, minutesLeft: 0, remainingMs: 0 };
}
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  useColorScheme,
  useWindowDimensions,
  BackHandler,
  type ImageSourcePropType,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView, BlurTargetView } from "expo-blur";
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSpring, runOnJS } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter, useIsFocused } from "expo-router";

import { useStore, flushPendingWrites, type Message, type Attachment, type SearchResult } from "../lib/store";
import { getTheme, resolveThemeMode } from "../lib/theme";
import { t, setLocale } from "../lib/i18n";
import { welcomeTitleForProfile } from "../lib/profiles";
import { chatStream, getConfig, summarize, handoffCreate, type ChatMessage as ApiChatMessage } from "../lib/api";
import { parseSSEStream } from "../lib/sse";
import { ConversationView, type ConversationViewHandle } from "../components/ConversationView";
import { HamburgerIcon } from "../components/HamburgerIcon";
import { Composer } from "../components/Composer";
import { ConversationSidebar, SIDEBAR_W } from "../components/ConversationSidebar";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { ProfileModal } from "../components/ProfileModal";
import { AnnouncementBanner } from "../components/AnnouncementBanner";
import { useApkDownload } from "../lib/use-apk-download";
import { ApkDownloadOverlay } from "../components/ApkDownloadOverlay";
import { UpdateDialog, type UpdateDialogConfig } from "../components/UpdateDialog";

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 角色立绘本地资源映射（与 AppSplash 共用同一套素材）
// 薇欧拉没有本地立绘，回退到远程 backgroundImage
const characterImage: Record<string, ImageSourcePropType> = {
  miyako: require("../assets/characters/img_full_fuji-miyako_01.webp"),
  yuno: require("../assets/characters/img_full_sengoku-yuno_01.webp"),
  ritsu: require("../assets/characters/img_full_minetsuki-ritsu_01.webp"),
  arale: require("../assets/characters/img_full_nakamachi-arale_01.webp"),
  nonoka: require("../assets/characters/img_full_miyanaga-nonoka_01.webp"),
};

export default function ChatScreen() {
  const router = useRouter();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  // 角色立绘尺寸（参考 web 端移动端 .character-backdrop：width min(82vw,370)，立绘比例约 1:1.55）
  const charW = Math.min(screenWidth * 0.82, 370);
  const charH = charW * 1.55;
  const systemScheme = useColorScheme();
  const convViewRef = useRef<ConversationViewHandle>(null);
  const abortRef = useRef<AbortController | null>(null);
  // 流式节流：100ms 批量更新，避免每 chunk 都 setState
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContentRef = useRef("");
  const pendingReasoningRef = useRef("");

  // Store
  const themeMode = useStore((s) => s.themeMode);
  const locale = useStore((s) => s.locale);
  const reasoning = useStore((s) => s.reasoning);
  const reasoningEffort = useStore((s) => s.reasoningEffort);
  const vision = useStore((s) => s.vision);
  const webSearch = useStore((s) => s.webSearch);
  const conversations = useStore((s) => s.conversations);
  const activeConversationId = useStore((s) => s.activeConversationId);
  const currentProfileKey = useStore((s) => s.currentProfileKey);
  const profile = useStore((s) => s.getCurrentProfile());

  const createConversation = useStore((s) => s.createConversation);
  const addMessage = useStore((s) => s.addMessage);
  const updateMessage = useStore((s) => s.updateMessage);
  const renameConversation = useStore((s) => s.renameConversation);
  const shuffleProfile = useStore((s) => s.shuffleProfile);
  const setServerConfig = useStore((s) => s.setServerConfig);
  const addTokens = useStore((s) => s.addTokens);
  const handoffToken = useStore((s) => s.handoffToken);
  const setHandoffToken = useStore((s) => s.setHandoffToken);
  // 自定义 API 配置：启用后随 chatStream 一起发送给服务端代理
  const customProvider = useStore((s) => s.customProvider);
  // APK 整包更新信息（由 _layout.tsx 启动检查后写入 store）
  const apkUpdateAvailable = useStore((s) => s.apkUpdateAvailable);

  // APK 应用内下载（替代浏览器 Linking.openURL）
  const { downloading, progress, download } = useApkDownload();

  // 启动时的更新提示弹窗（替代 Android 原生 Alert）
  const [updateDialog, setUpdateDialog] = useState<UpdateDialogConfig | null>(null);

  const [busy, setBusy] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileModalVisible, setProfileModalVisible] = useState(false);
  // 顶栏 overlay 高度：通过 onLayout 测量，给背景层（BlurView）明确高度，
  // 避免 absoluteFill 在 box-none 父容器内因尺寸 0 导致 BlurView 不渲染。
  const [overlayHeight, setOverlayHeight] = useState(insets.top + 60);

  // 放送日程气泡：从汉堡菜单按钮弹出，3 秒后自动淡出
  const [scheduleBubbleVisible, setScheduleBubbleVisible] = useState(false);
  const scheduleBubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Android 真实高斯模糊目标：聊天内容层（FlatList / 空状态）
  // 顶栏、公告横幅、侧栏共享同一个 ref（expo-blur 推荐做法，效率更高）
  const chatContentRef = useRef<View>(null);

  // ── 侧栏返回键拦截 ──────────────────────────────────────────
  // 侧栏打开时按返回键关闭侧栏（而非退出应用）。
  // 仅在首页聚焦 + 侧栏打开时注册，避免干扰子页面的返回导航。
  useEffect(() => {
    if (!sidebarOpen || !isFocused) return;
    const handler = () => {
      setSidebarOpen(false);
      return true;
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", handler);
    return () => sub.remove();
  }, [sidebarOpen, isFocused]);

  // 放送日程气泡：开播前 1 小时或直播中显示，用户可关闭
  const [streamBubble, setStreamBubble] = useState<{ show: boolean; live: boolean; minutesLeft: number; remainingMs: number }>({ show: false, live: false, minutesLeft: 0, remainingMs: 0 });
  const [bubbleDismissed, setBubbleDismissed] = useState(false);
  const showScheduleBubble = useCallback(() => {
    const status = getStreamStatus();
    if (!status.show) return;
    setStreamBubble(status);
    setScheduleBubbleVisible(true);
    setBubbleDismissed(false);
    if (scheduleBubbleTimer.current) clearTimeout(scheduleBubbleTimer.current);
    scheduleBubbleTimer.current = setTimeout(() => {
      setScheduleBubbleVisible(false);
    }, 3000);
  }, []);

  useEffect(() => {
    const check = () => {
      const status = getStreamStatus();
      setStreamBubble(status);
      // 跨过开播时刻后重置 dismissed，允许下次开播前再次提醒
      if (!status.show) {
        setBubbleDismissed(false);
        setScheduleBubbleVisible(false);
      }
    };
    check();
    const id = setInterval(check, 30000); // 每 30 秒更新
    return () => clearInterval(id);
  }, []);

  // APK 整包更新启动弹窗：检测到新版本时提示用户下载。
  // 用 ref 防止同一会话内重复弹窗（用户从 settings 返回时不会再次弹出）。
  const apkPromptShownRef = useRef(false);
  useEffect(() => {
    if (!apkUpdateAvailable?.hasUpdate) return;
    if (apkPromptShownRef.current) return;
    apkPromptShownRef.current = true;
    const url = apkUpdateAvailable.apkDownloadUrl;
    const message =
      apkUpdateAvailable.changelog || `新版本 ${apkUpdateAvailable.latestVersion} 可用`;
    if (apkUpdateAvailable.forceUpdate) {
      // 强制更新：不可关闭
      setUpdateDialog({
        variant: "force",
        title: "必须更新",
        message,
        latestVersion: apkUpdateAvailable.latestVersion,
        confirmText: "立即下载",
        onConfirm: url
          ? () => {
              setUpdateDialog(null);
              download(url);
            }
          : undefined,
      });
    } else {
      // 非强制：可忽略
      setUpdateDialog({
        variant: "info",
        title: "发现新版本",
        message,
        latestVersion: apkUpdateAvailable.latestVersion,
        confirmText: "立即下载",
        cancelText: "稍后",
        onConfirm: url
          ? () => {
              setUpdateDialog(null);
              download(url);
            }
          : undefined,
        onCancel: () => setUpdateDialog(null),
      });
    }
  }, [apkUpdateAvailable]);

  const mode = resolveThemeMode(themeMode, systemScheme);
  const theme = getTheme(mode, profile.themeColor);

  // Ambient 呼吸动画（App Store 风格：慢速 opacity 脉动）
  const ambientOpacity = useSharedValue(0.3);
  useEffect(() => {
    ambientOpacity.value = withRepeat(withTiming(0.6, { duration: 6000 }), -1, true);
  }, []);
  const animatedAmbient = useAnimatedStyle(() => ({ opacity: ambientOpacity.value }));

  // 初始化
  useEffect(() => {
    setLocale(locale);
    getConfig()
      .then(setServerConfig)
      .catch(() => {});
    // 引继码自动生成：等待 hydration 完成后再检查
    // 避免在 hydration 完成前读到默认值 "" 就触发请求，覆盖已持久化的引继码
    let called = false;
    const checkHandoff = () => {
      if (called) return;
      called = true;
      const token = useStore.getState().handoffToken;
      if (!token) {
        handoffCreate()
          .then((res) => {
            // 防竞态：如果用户在 handoffCreate 网络请求期间用引继码同步了数据，
            // 此时 store 里已经有同步过来的 token，不能再覆盖为新生成的 token。
            // 否则同步的 token 被覆盖 → 下次启动又触发自动申请 → 看起来像"被重置"。
            const current = useStore.getState().handoffToken;
            if (current) {
              console.log("[handoff] 已存在引继码（可能来自同步），跳过自动生成覆盖");
              return;
            }
            setHandoffToken(res.token);
            // 等待写入完成，确保新生成的引继码落盘
            return flushPendingWrites();
          })
          .catch(() => {});
      }
    };
    let unsub: (() => void) | undefined;
    if (useStore.persist.hasHydrated()) {
      checkHandoff();
    } else {
      unsub = useStore.persist.onFinishHydration(checkHandoff);
      // 防竞态：注册回调后再次检查（如果 hydration 在 hasHydrated 和注册之间完成）
      if (useStore.persist.hasHydrated()) checkHandoff();
    }
    // 卸载时清理：中止流 + 清节流定时器 + 清放送日程气泡定时器
    return () => {
      abortRef.current?.abort();
      if (throttleRef.current) clearTimeout(throttleRef.current);
      if (scheduleBubbleTimer.current) clearTimeout(scheduleBubbleTimer.current);
      unsub?.();
    };
  }, []);

  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const messages = activeConv?.messages ?? [];

  const scrollToBottom = useCallback(() => {
    convViewRef.current?.scrollToBottom();
  }, []);

  // ── 核心发送逻辑 ──────────────────────────────────────────
  // retryOpts：重试时复用已有用户消息，不再添加新 user 消息，仅创建助手占位
  const doSend = useCallback(
    async (text: string, attachments?: Attachment[], retryOpts?: { existingUserMsgId: string; existingAssistantMsgId?: string }) => {
      let convId = activeConversationId;
      if (!convId) convId = createConversation();

      const profileKey = currentProfileKey;
      const profileName = useStore.getState().getCurrentProfile().name;
      const hasImages = (attachments?.length ?? 0) > 0;

      // 用户消息：重试模式下跳过（已有用户消息在历史中）
      if (!retryOpts) {
        const userMsg: Message = {
          id: genId(),
          role: "user",
          content: text,
          profileKey,
          profileName,
          timestamp: Date.now(),
          attachments: hasImages ? attachments : undefined,
        };
        addMessage(convId, userMsg);
        scrollToBottom();
      }

      // 助手占位：重试多版本模式下复用已有助手消息（existingAssistantMsgId），不新建占位。
      // 此时该消息已有 versions（存了旧版本），重置顶层字段重新流式生成。
      const assistantMsgId = retryOpts?.existingAssistantMsgId || genId();
      if (retryOpts?.existingAssistantMsgId) {
        updateMessage(convId, assistantMsgId, {
          content: "",
          reasoningContent: "",
          reasoningEnabled: reasoning,
          streaming: true,
          error: undefined,
          timestamp: Date.now(),
        });
      } else {
        addMessage(convId, {
          id: assistantMsgId,
          role: "assistant",
          content: "",
          reasoningContent: "",
          reasoningEnabled: reasoning, // 记录本次是否开启深度思考
          profileKey,
          profileName,
          timestamp: Date.now(),
          streaming: true,
        });
      }
      scrollToBottom();

      setBusy(true);
      const abort = new AbortController();
      abortRef.current = abort;

      try {
        // 构建 API 消息历史（含图片 → OpenAI content parts 格式）
        const conv = useStore.getState().conversations.find((c) => c.id === convId);
        const history: ApiChatMessage[] = (conv?.messages ?? [])
          .filter((m) => m.id !== assistantMsgId)
          .map((m) => {
            // 有图片附件 → content 改为数组（text + image_url parts）
            if (m.attachments && m.attachments.length > 0) {
              const parts: any[] = [];
              if (m.content) parts.push({ type: "text", text: m.content });
              for (const a of m.attachments) {
                parts.push({
                  type: "image_url",
                  image_url: { url: `data:${a.mimeType};base64,${a.base64 || ""}` },
                });
              }
              return { role: m.role, content: parts, profileKey: m.profileKey, profileName: m.profileName } as any;
            }
            return {
              role: m.role,
              content: m.content,
              profileKey: m.profileKey,
              profileName: m.profileName,
            };
          });

        const response = await chatStream(history, {
          reasoning,
          reasoningEffort,
          vision: vision || hasImages, // 有图片时自动启用 vision
          webSearch,
          locale,
          profileKey,
          profileName,
          // 自定义接口启用时把整份配置发给服务端，由服务端处理协议差异
          // （openai/anthropic/gemini 的 headers、URL 格式不同，见 server.js providerHeaders）
          ...(customProvider.enabled && customProvider.baseUrl && customProvider.apiKey
            ? { customProviderActive: true, customProvider }
            : {}),
        });

        let fullContent = "";
        let fullReasoning = "";
        const searchResults: SearchResult[] = [];
        let lastUsage: any = null;

        // 节流刷新：100ms 内的 chunk 合并为一次 setState
        const flushStream = () => {
          if (throttleRef.current) { clearTimeout(throttleRef.current); throttleRef.current = null; }
          updateMessage(convId!, assistantMsgId, {
            content: pendingContentRef.current,
            reasoningContent: pendingReasoningRef.current || undefined,
            streaming: true,
          });
          scrollToBottom();
        };
        const scheduleFlush = () => {
          if (!throttleRef.current) {
            throttleRef.current = setTimeout(flushStream, 100);
          }
        };

        await parseSSEStream(
          response,
          (delta) => {
            if (delta.content) {
              fullContent += delta.content;
              pendingContentRef.current = fullContent;
              scheduleFlush();
            }
            // 仅在开启深度思考时累加 reasoning（否则忽略模型返回的思考链）
            if (delta.reasoningContent && reasoning) {
              fullReasoning += delta.reasoningContent;
              pendingReasoningRef.current = fullReasoning;
              scheduleFlush();
            }
            if (delta.done) {
              // 流结束：立即刷新最终状态
              if (throttleRef.current) { clearTimeout(throttleRef.current); throttleRef.current = null; }
              updateMessage(convId!, assistantMsgId, {
                content: fullContent,
                reasoningContent: fullReasoning || undefined,
                streaming: false,
              });
            }
            // 捕获 usage（部分 provider 在最终 chunk 返回）
            if ((delta as any).usage) {
              lastUsage = (delta as any).usage;
            }
          },
          (results) => {
            // 联网搜索结果（服务端格式：{status, sources: [{title, url, content}]}）
            if (results?.sources?.length) {
              for (const r of results.sources.slice(0, 5)) {
                searchResults.push({
                  title: r.title || r.url || "",
                  url: r.url || "",
                  snippet: r.content || r.snippet || "",
                });
              }
              updateMessage(convId!, assistantMsgId, { searchResults: [...searchResults] });
            }
          }
        );

        // 自动标题（首条消息时调用 summarize API 生成）
        if (history.length <= 1) {
          summarize([{ role: "user", content: text, profileKey, profileName }])
            .then((title) => { if (title) renameConversation(convId!, title); })
            .catch(() => {});
        }

        // Token 统计：优先用 API 返回的 usage，否则按内容长度估算（~2 字符/token 中文）
        const tokens = lastUsage?.total_tokens
          || Math.ceil((fullContent.length + fullReasoning.length + text.length) / 2);
        addTokens(tokens);
      } catch (err: any) {
        if (err?.name === "AbortError") {
          // 用户主动停止，保留已有内容
          updateMessage(convId!, assistantMsgId, { streaming: false });
        } else {
          updateMessage(convId!, assistantMsgId, {
            streaming: false,
            error: err?.message || t("error"),
          });
        }
      } finally {
        if (throttleRef.current) { clearTimeout(throttleRef.current); throttleRef.current = null; }
        setBusy(false);
        abortRef.current = null;
      }
    },
    [activeConversationId, currentProfileKey, reasoning, reasoningEffort, vision, webSearch, locale, customProvider]
  );

  // 停止生成
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // 重试：保留多个回答版本。把当前顶层快照存入 versions，append 新版本重新生成。
  // 用户可在正文下方切换器查看不同版本（如 2/3）。
  const handleRetry = useCallback(
    (msgId: string) => {
      const conv = useStore.getState().conversations.find((c) => c.id === activeConversationId);
      if (!conv) return;
      const failedMsg = conv.messages.find((m) => m.id === msgId);
      if (!failedMsg) return;
      // 找到失败消息前面的用户消息
      const idx = conv.messages.findIndex((m) => m.id === msgId);
      const prevUserMsg = [...conv.messages.slice(0, idx)].reverse().find((m) => m.role === "user");
      if (!prevUserMsg) return;

      // 当前顶层快照（含 content/reasoningContent/error/searchResults）
      const currentSnapshot: Message = {
        id: failedMsg.id + "-v" + Date.now(),
        role: "assistant",
        content: failedMsg.content,
        reasoningContent: failedMsg.reasoningContent,
        reasoningEnabled: failedMsg.reasoningEnabled,
        profileKey: failedMsg.profileKey,
        profileName: failedMsg.profileName,
        timestamp: failedMsg.timestamp,
        error: failedMsg.error,
        searchResults: failedMsg.searchResults,
      };
      // versions 存所有版本快照（含当前）。首次重试初始化为 [当前快照]；后续把当前存回 versions[currentVersion]
      let versions = failedMsg.versions ? [...failedMsg.versions] : [];
      const curIdx = failedMsg.currentVersion ?? 0;
      if (versions.length === 0) {
        versions = [currentSnapshot];
      } else if (curIdx < versions.length) {
        versions[curIdx] = currentSnapshot;
      } else {
        versions.push(currentSnapshot);
      }
      // append 新版本（空，待流式填充）
      versions.push({
        id: failedMsg.id + "-v" + Date.now() + "-new",
        role: "assistant",
        content: "",
        reasoningContent: "",
        reasoningEnabled: reasoning,
        profileKey: failedMsg.profileKey,
        profileName: failedMsg.profileName,
        timestamp: Date.now(),
      });
      const newVersionIdx = versions.length - 1;

      updateMessage(conv.id, msgId, {
        versions,
        currentVersion: newVersionIdx,
        content: "",
        reasoningContent: "",
        reasoningEnabled: reasoning,
        streaming: true,
        error: undefined,
        timestamp: Date.now(),
      });
      // 重新生成，复用已有助手消息（existingAssistantMsgId），跳过新建占位
      doSend(prevUserMsg.content, prevUserMsg.attachments, {
        existingUserMsgId: prevUserMsg.id,
        existingAssistantMsgId: msgId,
      });
    },
    [activeConversationId, doSend, reasoning]
  );

  // 切换回答版本：把当前顶层存回 versions[currentVersion]，提升 versions[target] 为顶层
  const handleSwitchVersion = useCallback(
    (msgId: string, direction: -1 | 1) => {
      const conv = useStore.getState().conversations.find((c) => c.id === activeConversationId);
      if (!conv) return;
      const msg = conv.messages.find((m) => m.id === msgId);
      if (!msg?.versions || msg.versions.length === 0 || msg.currentVersion == null) return;
      const curIdx = msg.currentVersion;
      const target = Math.max(0, Math.min(msg.versions.length - 1, curIdx + direction));
      if (target === curIdx) return;

      // 当前顶层存回 versions[curIdx]
      const topSnapshot: Message = {
        id: msg.id,
        role: "assistant",
        content: msg.content,
        reasoningContent: msg.reasoningContent,
        reasoningEnabled: msg.reasoningEnabled,
        profileKey: msg.profileKey,
        profileName: msg.profileName,
        timestamp: msg.timestamp,
        error: msg.error,
        searchResults: msg.searchResults,
      };
      const newVersions = [...msg.versions];
      newVersions[curIdx] = topSnapshot;
      const targetSnapshot = newVersions[target];

      updateMessage(conv.id, msgId, {
        versions: newVersions,
        currentVersion: target,
        content: targetSnapshot.content,
        reasoningContent: targetSnapshot.reasoningContent,
        error: targetSnapshot.error,
        searchResults: targetSnapshot.searchResults,
        reasoningEnabled: targetSnapshot.reasoningEnabled,
        streaming: false,
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [activeConversationId]
  );

  // ── 编辑用户消息：回滚助手回复 + 填充输入框 ──
  const [draftText, setDraftText] = useState("");
  const handleEdit = useCallback(
    (msgId: string) => {
      if (!activeConversationId) return;
      const conv = useStore.getState().conversations.find((c) => c.id === activeConversationId);
      if (!conv) return;
      const msg = conv.messages.find((m) => m.id === msgId);
      if (!msg || msg.role !== "user") return;
      // 截断：删除该用户消息之后的所有消息（助手回复等）
      useStore.getState().truncateAfterMessage(activeConversationId, msgId);
      // 填充输入框供用户编辑
      setDraftText(msg.content || "");
      // 下一帧清空（让 Composer useEffect 消费后不再重复触发）
      setTimeout(() => setDraftText(""), 100);
    },
    [activeConversationId]
  );

  // 侧边栏手势动画状态（提升到父级，供 ConversationSidebar 应用 + 手势驱动）
  const sidebarTranslateX = useSharedValue(-SIDEBAR_W);
  const sidebarOverlayOpacity = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panWasOpen = useSharedValue(false);

  // 右滑打开 / 左滑关闭手势（双向，左边缘 24px 内触发打开方向）
  // activeOffsetX(36): 需要非常明确的水平右滑才激活（防止滚动时微偏右误触）
  // failOffsetY(10): 垂直移动超 10px 即判定为滚动、手势立即失败（垂直优先）
  const panGesture = Gesture.Pan()
    .activeOffsetX(36)
    .failOffsetY(10)
    .onBegin((e) => {
      "worklet";
      panStartX.value = e.absoluteX;
      // 记录手势开始时侧栏是否已打开（整个手势期间固定，避免中途切换分支导致跳变）
      panWasOpen.value = sidebarTranslateX.value > -SIDEBAR_W / 2;
    })
    .onUpdate((e) => {
      "worklet";
      if (panWasOpen.value) {
        // 打开态起手：左滑跟随关闭
        sidebarTranslateX.value = Math.max(-SIDEBAR_W, Math.min(0, e.translationX));
      } else if (panStartX.value < 24) {
        // 关闭态起手：仅左边缘 24px 内起点右滑跟随打开
        sidebarTranslateX.value = Math.max(-SIDEBAR_W, Math.min(0, -SIDEBAR_W + e.translationX));
      }
      sidebarOverlayOpacity.value = (sidebarTranslateX.value + SIDEBAR_W) / SIDEBAR_W;
    })
    .onEnd((e) => {
      "worklet";
      const shouldOpen = sidebarTranslateX.value > -SIDEBAR_W / 2 || e.velocityX > 500;
      if (shouldOpen) {
        sidebarTranslateX.value = withSpring(0, { damping: 28, stiffness: 240, overshootClamping: true });
        sidebarOverlayOpacity.value = withSpring(1, { damping: 28, stiffness: 240, overshootClamping: true });
        runOnJS(setSidebarOpen)(true);
      } else {
        sidebarTranslateX.value = withSpring(-SIDEBAR_W, { damping: 28, stiffness: 240, overshootClamping: true });
        sidebarOverlayOpacity.value = withSpring(0, { damping: 28, stiffness: 240, overshootClamping: true });
        runOnJS(setSidebarOpen)(false);
      }
    });

  return (
    <GestureDetector gesture={panGesture}>
    <View style={[styles.safe, { backgroundColor: theme.page }]}>
      {/* 内容层（全屏，延伸到状态栏和底部后方） */}
      {/* BlurTargetView：作为顶栏 / 公告横幅 / 侧栏的高斯模糊目标。
          Android 上 expo-blur 必须用 BlurTargetView 包裹被模糊内容并传入 ref，
          否则 BlurView 会回退为半透明纯色块（这是先前 APK 上模糊失效的原因）。 */}
      <BlurTargetView ref={chatContentRef} style={{ flex: 1 }}>
        {/* 永久渐变背景：作为顶栏 / 侧栏 BlurView 的模糊源。
            即使消息列表为空或滚动到顶部空白区，BlurView 也能模糊到渐变内容，
            避免顶栏看起来像纯色块（之前问题：FlatList paddingTop 区域是空白，BlurView 模糊不到内容） */}
        <LinearGradient
          colors={[
            `rgba(${theme.brandRgb},0.08)`,
            "transparent",
            `rgba(${theme.brandRgb},0.04)`,
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {/* 对话页右下角角色立绘（背景层）：位于消息 WebView 之下，WebView 透明背景透出。
            消息气泡不透明会自然遮挡立绘，消息稀疏处/列表空白可见，作为沉浸式背景装饰。
            这样立绘可放大且完全不挤占消息空间（bottomInset 不变，消息不上移）。
            薇欧拉无本地立绘，回退远程 backgroundImage。 */}
        {messages.length > 0 && (
          <Image
            source={characterImage[profile.key] || { uri: profile.backgroundImage }}
            style={[styles.cornerCharacter, {
              width: charW,
              height: charH,
              bottom: insets.bottom + 142,
              opacity: mode === "dark" ? 0.22 : 0.18,
            }]}
            resizeMode="contain"
            cachePolicy="memory-disk"
            pointerEvents="none"
          />
        )}
        {messages.length === 0 ? (
          <View style={styles.emptyState}>
            {/* Ambient 渐变背景（角色主题色呼吸光斑） */}
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: 0.4 }, animatedAmbient]}>
              <LinearGradient
                colors={[
                  `rgba(${theme.brandRgb},0.3)`,
                  "transparent",
                  `rgba(${theme.brandRgb},0.15)`,
                ]}
                start={{ x: 0.2, y: 0 }}
                end={{ x: 0.8, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
            {/* 新会话页右下角角色立绘（参考 web 端 .character-backdrop 移动端）：
                DOM 在中央内容之前（z 层在后），避免盖住头像/问候语；
                right 负值溢出右边缘，立绘主体偏右不挡中央；低透明度作背景装饰。 */}
            <Image
              source={characterImage[profile.key] || { uri: profile.backgroundImage }}
              style={[styles.cornerCharacter, {
                width: charW,
                height: charH,
                bottom: insets.bottom + 142,
                opacity: mode === "dark" ? 0.22 : 0.18,
              }]}
              resizeMode="contain"
              cachePolicy="memory-disk"
              pointerEvents="none"
            />
            {/* 角色圆形头像（点击打开角色档案；参照 web 端 .welcome-logo-circle） */}
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setProfileModalVisible(true); }}
            >
              <View style={{ alignItems: "center", marginBottom: 8, marginTop: insets.top + 24 }}>
                <Image
                  source={{ uri: profile.avatar }}
                  style={[
                    styles.emptyAvatar,
                    {
                      borderColor: `rgba(${theme.brandRgb},0.25)`,
                      shadowColor: theme.brand,
                    },
                  ]}
                  contentFit="cover"
                  transition={400}
                  cachePolicy="memory-disk"
                />
              </View>
              <Text style={[styles.emptyTitle, { color: theme.text }]}>{welcomeTitleForProfile(profile)}</Text>
              <Text style={[styles.emptySubtitle, { color: theme.muted }]}>{profile.bio.tagline}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ConversationView
            ref={convViewRef}
            messages={messages}
            profile={profile}
            theme={theme}
            topInset={insets.top + 116}
            bottomInset={insets.bottom + 200}
            onRetry={handleRetry}
            onSwitchVersion={handleSwitchVersion}
            onEdit={handleEdit}
          />
        )}
      </BlurTargetView>

      {/* 顶栏 + 公告横幅 overlay（一体化背景：共享同一个模糊层） */}
      <View
        style={{ position: "absolute", left: 0, right: 0, top: 0 }}
        pointerEvents="box-none"
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (h > 0 && Math.abs(h - overlayHeight) > 1) setOverlayHeight(h);
        }}
      >
        {/* 背景层：BlurView(dimezisBlurView) + tint 主题适配 + 渐变遮罩。
            dimezisBlurView + blurTarget 是 Android APK 上唯一生效的模糊路径。
            tint overlay alpha 由 TintStyle.kt 决定：
              dark: 255 * (intensity/100) * 0.69 → intensity=80 时仅 55% alpha #191919
              systemThickMaterialDark: 255 * (intensity/100) * 0.9 → intensity=80 时 72% alpha #252525
            深色模式用 systemThickMaterialDark 获得更高 alpha 的深色 overlay，
            压住亮色消息卡片模糊透出造成的发白。
            渐变遮罩底部 alpha 不能为 0（否则底部只有 tint overlay 盖不住），
            深色模式全程保持 0.60+ 确保不发白。 */}
        <View
          style={{ position: "absolute", top: 0, left: 0, right: 0, height: overlayHeight }}
          pointerEvents="none"
        >
          {messages.length > 0 ? (
            <>
              <BlurView
                intensity={80}
                blurMethod="dimezisBlurView"
                blurTarget={chatContentRef}
                tint={mode === "dark" ? "systemThickMaterialDark" : "light"}
                style={StyleSheet.absoluteFill}
              />
              <LinearGradient
                colors={
                  mode === "dark"
                    ? [`rgba(${theme.pageRgb},0.75)`, `rgba(${theme.pageRgb},0.68)`, `rgba(${theme.pageRgb},0.60)`]
                    : [`rgba(${theme.pageRgb},0.20)`, `rgba(${theme.pageRgb},0.10)`, `rgba(${theme.pageRgb},0)`]
                }
                locations={[0, 0.6, 1]}
                style={StyleSheet.absoluteFill}
              />
            </>
          ) : null}
        </View>
        {/* 顶栏内容 */}
        <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
          <TouchableOpacity
            style={styles.headerIcon}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              if (sidebarOpen) {
                setSidebarOpen(false);
              } else {
                setSidebarOpen(true);
                showScheduleBubble();
              }
            }}
            hitSlop={8}
          >
            <HamburgerIcon open={sidebarOpen} color={theme.text} />
            {/* 放送日程气泡：从汉堡菜单按钮弹出，3 秒后自动淡出 */}
            {scheduleBubbleVisible && streamBubble.show && !bubbleDismissed && (
              <View
                style={[
                  styles.streamBubble,
                  {
                    backgroundColor: theme.panel,
                    borderColor: theme.brand,
                    right: undefined,
                    left: 0,
                  },
                ]}
              >
                <Text style={[styles.streamBubbleText, { color: theme.brand }]}>
                  {streamBubble.live
                    ? "📺 正在开播"
                    : `⏰ ${formatCountdown(streamBubble.remainingMs)} 后开播`}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          {messages.length > 0 ? (
            <TouchableOpacity
              style={[styles.profileBtn, { flex: 1 }]}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setProfileModalVisible(true); }}
            >
              <Image source={{ uri: profile.avatar }} style={styles.avatar} />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={[styles.profileName, { color: theme.text }]} numberOfLines={1}>
                  {profile.name}
                </Text>
                {reasoning && (
                  <Text style={[styles.profileSub, { color: theme.brand }]} numberOfLines={1}>
                    🤔 {t("deepThought")}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          ) : (
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={styles.brandTitle} numberOfLines={1}>
                <Text style={{ color: theme.text }}>Yuno</Text>
                <Text style={{ color: theme.brand }}>Seek</Text>
              </Text>
            </View>
          )}

          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.headerIcon}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); shuffleProfile(); }}
              hitSlop={8}
            >
              <Ionicons name="shuffle-outline" size={18} color={theme.muted} />
            </TouchableOpacity>
          </View>
        </View>
        {/* 公告横幅（透明背景，显示在共享模糊/实色层之上，与顶栏视觉一体） */}
        <AnnouncementBanner />
      </View>

      {/* 底部输入框 overlay（KAV 处理键盘抬起） */}
      <KeyboardAvoidingView
        style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}
        behavior="padding"
        keyboardVerticalOffset={0}
        pointerEvents="box-none"
      >
        <Composer onSend={doSend} onStop={handleStop} busy={busy} bottomInset={insets.bottom} draftText={draftText} blurTarget={chatContentRef} />
      </KeyboardAvoidingView>

      {/* 对话历史侧栏 */}
      <ConversationSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        blurTarget={chatContentRef}
        translateX={sidebarTranslateX}
        overlayOpacity={sidebarOverlayOpacity}
      />

      {/* 角色资料 Modal */}
      <ProfileModal
        profile={profile}
        visible={profileModalVisible}
        onClose={() => setProfileModalVisible(false)}
      />

      {/* APK 下载进度遮罩 */}
      <ApkDownloadOverlay visible={downloading} progress={progress} />

      {/* 启动时的更新提示弹窗 */}
      <UpdateDialog
        visible={updateDialog !== null}
        config={updateDialog}
        onRequestClose={() => setUpdateDialog(null)}
      />
    </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingBottom: 10,
    // zIndex 让 header 整体浮在 AnnouncementBanner 之上：
    // streamBubble 是 headerIcon 的子元素，其 zIndex 无法跨越到兄弟元素
    // AnnouncementBanner 之上。给 header 设置 zIndex 后，header 内的所有内容
    // （包括下浮的 tokenBubble）都会浮在 AnnouncementBanner 之上，避免被遮挡。
    zIndex: 10,
  },
  profileBtn: { flexDirection: "row", alignItems: "center" },
  avatar: { width: 32, height: 32, borderRadius: 16 },
  profileName: { fontSize: 15, fontWeight: "600" },
  profileSub: { fontSize: 11, fontWeight: "500", marginTop: 1, opacity: 0.85 },
  headerActions: { flexDirection: "row", gap: 8 },
  headerIcon: { padding: 4 },
  emptyState: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 32 },
  emptyAvatar: {
    width: 154,
    height: 154,
    borderRadius: 77,
    borderWidth: 2,
    marginBottom: 16,
    backgroundColor: "rgba(120,120,120,0.08)",
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.18,
    shadowRadius: 40,
    elevation: 8,
  },
  emptyTitle: { fontSize: 22, fontWeight: "700", marginBottom: 6, textAlign: "center" },
  emptySubtitle: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  // 撞色品牌名（参照 web 端 .brand span 渐变；RN 用两段 Text 模拟）
  brandTitle: { fontSize: 18, fontWeight: "700", letterSpacing: 0.2 },
  // 顶栏图标气泡（Token / 放送倒计时）：绝对定位在图标下方，避免遮挡系统状态栏
  streamBubble: {
    position: "absolute",
    top: 34,
    right: -8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    minWidth: 80,
    // maxWidth 防止内容过长导致气泡超出屏幕；numberOfLines={1} 会在宽度不足时截断
    maxWidth: 260,
    zIndex: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  // flexShrink:0 防止文字在 row 容器内被挤压截断
  streamBubbleText: { fontSize: 11, fontWeight: "700", flexShrink: 0 },
  // 右下角角色立绘装饰（参考 web 端 .character-backdrop 移动端实现）：
  // - right 负值溢出屏幕右边缘，立绘主体偏右，不占据中央内容区
  // - 低透明度（暗 0.22 / 亮 0.18，与 web 端 is-active 一致）作背景装饰
  // - width/height/bottom/opacity 由内联动态设置（依赖 screenWidth/insets/mode）
  // - zIndex 0：对话页位于消息 WebView（DOM 在后）之下；新会话页 DOM 在中央内容之前
  cornerCharacter: {
    position: "absolute",
    right: -34,
    zIndex: 0,
  },
});
