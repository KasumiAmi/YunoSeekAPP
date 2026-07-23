// 对话历史侧栏：搜索 + 功能区 + 时间分组 + 新建/重命名/置顶/删除 + 预测性返回拦截 + 滑出动画
import React, { useMemo, useRef, useEffect, useState, useCallback, type RefObject } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  useColorScheme,
  TextInput,
  Modal,
  Linking,
  ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { BlurView } from "expo-blur";
import { MotiView } from "moti";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  type SharedValue,
} from "react-native-reanimated";
import { Gesture, GestureDetector, ScrollView } from "react-native-gesture-handler";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useStore, type Conversation, flushPendingWrites } from "../lib/store";
import { getTheme, resolveThemeMode } from "../lib/theme";
import { t } from "../lib/i18n";
import { modelHealth, formatTokenUsage, handoffPush } from "../lib/api";

const { width: SCREEN_W } = Dimensions.get("window");
export const SIDEBAR_W = Math.min(300, SCREEN_W * 0.8);

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * Android 上真实高斯模糊的目标 ref（来自 app/index.tsx 的 BlurTargetView）。
   * iOS 上 BlurView 自动模糊下方内容，此 prop 可选。
   */
  blurTarget?: RefObject<View | null>;
  // 动画状态由父级持有（供手势驱动），传入后侧栏只负责应用
  translateX: SharedValue<number>;
  overlayOpacity: SharedValue<number>;
}

export function ConversationSidebar({ open, onClose, blurTarget, translateX, overlayOpacity }: Props) {
  const router = useRouter();
  const systemScheme = useColorScheme();
  const themeMode = useStore((s) => s.themeMode);
  const profile = useStore((s) => s.getCurrentProfile());
  const conversations = useStore((s) => s.conversations);
  const activeConversationId = useStore((s) => s.activeConversationId);
  const setActiveConversation = useStore((s) => s.setActiveConversation);
  const deleteConversation = useStore((s) => s.deleteConversation);
  const renameConversation = useStore((s) => s.renameConversation);
  const togglePin = useStore((s) => s.togglePin);
  const handoffToken = useStore((s) => s.handoffToken);

  const mode = resolveThemeMode(themeMode, systemScheme);
  const theme = getTheme(mode, profile.themeColor);

  // 返回键处理已上移到 app/index.tsx（统一 BackHandler），此处不再注册。

  // translateX/overlayOpacity 由父级传入（供手势驱动），此处只应用。
  // 侧栏始终挂载（不再用 rendered 状态卸载），手势期间实时跟手。
  const [renamingConv, setRenamingConv] = React.useState<Conversation | null>(null);
  const [renameText, setRenameText] = React.useState("");

  useEffect(() => {
    if (open) {
      // 仅当侧栏仍在关闭位置时才播放入场动画（手势跟手到位后无需重复）
      if (translateX.value < -SIDEBAR_W + 10) {
        translateX.value = withTiming(0, { duration: 280 });
        overlayOpacity.value = withTiming(1, { duration: 280 });
      }
    } else {
      // 仅当侧栏仍在打开位置时才播放退场动画（手势关闭时 spring 已在跑）
      if (translateX.value > -10) {
        translateX.value = withTiming(-SIDEBAR_W, { duration: 240 });
        overlayOpacity.value = withTiming(0, { duration: 240 });
      }
    }
  }, [open]);

  const animatedSidebar = useAnimatedStyle(() => ({
    transform: [{ translateX: Math.min(0, translateX.value) }],
  }));
  const animatedOverlay = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  // 侧栏面板上的左滑关闭手势（与 ScrollView 垂直滚动共存：activeOffsetX 仅水平触发）
  const closePan = Gesture.Pan()
    .activeOffsetX(16)
    .failOffsetY(16)
    .onUpdate((e) => {
      "worklet";
      // 仅处理左滑（负方向），右滑忽略（避免与打开方向冲突）
      if (e.translationX < 0) {
        translateX.value = Math.max(-SIDEBAR_W, e.translationX);
        overlayOpacity.value = (translateX.value + SIDEBAR_W) / SIDEBAR_W;
      }
    })
    .onEnd((e) => {
      "worklet";
      const shouldClose = translateX.value < -SIDEBAR_W / 2 || e.velocityX < -500;
      if (shouldClose) {
        translateX.value = withTiming(-SIDEBAR_W, { duration: 200 });
        overlayOpacity.value = withTiming(0, { duration: 200 });
        runOnJS(onClose)();
      } else {
        translateX.value = withTiming(0, { duration: 200 });
        overlayOpacity.value = withTiming(1, { duration: 200 });
      }
    });

  // 搜索过滤
  const [searchText, setSearchText] = React.useState("");

  // 时间分组
  const grouped = useMemo(() => {
    const now = Date.now();
    const dayMs = 86400000;
    const filtered = conversations.filter((c) => {
      if (!searchText.trim()) return true;
      const q = searchText.trim().toLowerCase();
      // 1) 命中标题
      const firstMsg = c.messages.find((m) => m.role === "user");
      const title = c.title || (firstMsg ? firstMsg.content.slice(0, 20) : "");
      if (title.toLowerCase().includes(q)) return true;
      // 2) 命中会话内任意一条消息内容（user/assistant）
      return c.messages.some((m) => {
        if (typeof m.content !== "string") return false;
        return m.content.toLowerCase().includes(q);
      });
    });
    const sorted = [...filtered].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
    const today: Conversation[] = [];
    const week: Conversation[] = [];
    const month: Conversation[] = [];
    const older: Conversation[] = [];
    for (const c of sorted) {
      const age = now - c.updatedAt;
      if (age < dayMs) today.push(c);
      else if (age < 7 * dayMs) week.push(c);
      else if (age < 30 * dayMs) month.push(c);
      else older.push(c);
    }
    return { today, week, month, older };
  }, [conversations, searchText]);

  const handleOpen = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveConversation(id);
    onClose();
  };

  const handleNew = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveConversation(null);
    onClose();
  };

  const [menuConv, setMenuConv] = React.useState<Conversation | null>(null);
  const [menuPos, setMenuPos] = React.useState({ x: 0, y: 0 });
  const [deletingConv, setDeletingConv] = React.useState<Conversation | null>(null);
  // 角色栏点击后浮动显示当前引继码卡片
  const [showHandoffCard, setShowHandoffCard] = React.useState(false);

  // ── 全站累计 Token：常显在功能区右侧，15s 自动刷新，点按手动刷新 ──
  const [tokenCount, setTokenCount] = useState(0);
  const [tokenLoading, setTokenLoading] = useState(false);
  const tokenRefreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshTokens = useCallback(async () => {
    setTokenLoading(true);
    try {
      const health = await modelHealth();
      setTokenCount(health?.chatQuota?.totalTokens ?? 0);
    } catch {
      // 静默失败，保留上次数值
    } finally {
      setTokenLoading(false);
    }
  }, []);

  // 侧栏打开时启动 15s 定时刷新，关闭时清理
  useEffect(() => {
    if (!open) return;
    refreshTokens();
    tokenRefreshTimer.current = setInterval(refreshTokens, 15000);
    return () => {
      if (tokenRefreshTimer.current) clearInterval(tokenRefreshTimer.current);
      tokenRefreshTimer.current = null;
    };
  }, [open, refreshTokens]);

  // ── 引继码同步：将本地会话推送到服务端 ──
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSync = useCallback(async () => {
    if (!handoffToken || syncing) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSyncing(true);
    setSyncStatus(null);
    try {
      // 剥离 base64 再推送（避免服务端存储大量 base64 图片）
      const stripped = conversations.map((c) => ({
        ...c,
        messages: c.messages.map((m) => ({
          ...m,
          attachments: m.attachments?.map(({ base64: _b, ...rest }) => rest),
        })),
      }));
      await handoffPush(handoffToken, {
        conversations: stripped,
        exportedAt: new Date().toISOString(),
      });
      await flushPendingWrites();
      setSyncStatus({ text: "已同步", ok: true });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setSyncStatus({ text: e?.message || "同步失败", ok: false });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSyncing(false);
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => setSyncStatus(null), 2500);
    }
  }, [handoffToken, conversations, syncing]);

  const handleLongPress = (conv: Conversation, e: { nativeEvent: { pageX: number; pageY: number } }) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setMenuConv(conv);
    setMenuPos({ x: e.nativeEvent.pageX, y: e.nativeEvent.pageY });
  };

  const handleMenuAction = (action: "rename" | "pin" | "delete") => {
    if (!menuConv) return;
    const conv = menuConv;
    setMenuConv(null);
    if (action === "rename") {
      promptRename(conv);
    } else if (action === "pin") {
      togglePin(conv.id);
    } else if (action === "delete") {
      setDeletingConv(conv);
    }
  };

  const promptRename = (conv: Conversation) => {
    setRenamingConv(conv);
    setRenameText(conv.title || "");
  };

  const renderConvItem = (item: Conversation, index: number) => {
    const isActive = item.id === activeConversationId;
    const firstUserMsg = item.messages.find((m) => m.role === "user");
    const displayTitle = item.title || (firstUserMsg ? firstUserMsg.content.slice(0, 20) : t("newChat"));
    // 搜索时在标题下方展示匹配消息的上下文片段（高亮匹配词）
    const snippet = searchText.trim() ? getMatchSnippet(item, searchText) : null;

    return (
      <MotiView
        key={item.id}
        from={{ opacity: 0, translateY: 8 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: "timing", duration: 320, delay: Math.min(index * 40, 320) }}
      >
        <TouchableOpacity
          style={[
            styles.item,
            isActive && { backgroundColor: `rgba(${theme.brandRgb},0.1)` },
          ]}
          onPress={() => handleOpen(item.id)}
          onLongPress={(e) => handleLongPress(item, e)}
          activeOpacity={0.7}
        >
          <View style={styles.itemHeader}>
            {item.pinned && (
              <Ionicons name="pin" size={12} color={theme.brand} style={{ marginRight: 4 }} />
            )}
            <Text
              style={[styles.itemTitle, { color: isActive ? theme.brand : theme.text }]}
              numberOfLines={1}
            >
              {displayTitle}
            </Text>
          </View>
          {snippet && (
            <Text style={[styles.itemPreview, { color: theme.muted }]} numberOfLines={1}>
              {snippet.before}
              <Text style={{ color: theme.brand, fontWeight: "700" }}>{snippet.match}</Text>
              {snippet.after}
            </Text>
          )}
        </TouchableOpacity>
      </MotiView>
    );
  };

  const renderGroup = (label: string, items: Conversation[], startIndex: number) => {
    if (items.length === 0) return null;
    return (
      <View key={label}>
        <Text style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4, fontSize: 12, fontWeight: "600", color: theme.muted }}>
          {label}
        </Text>
        {items.map((item, i) => renderConvItem(item, startIndex + i))}
      </View>
    );
  };

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 50 }]} pointerEvents={open ? "box-none" : "none"}>
      {/* 遮罩（淡入淡出） */}
      <Animated.View style={[styles.overlay, animatedOverlay]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
      </Animated.View>

      {/* 侧栏（滑出）— GestureDetector 处理左滑关闭跟手 */}
      <GestureDetector gesture={closePan}>
      <Animated.View style={[styles.sidebar, { width: SIDEBAR_W }, animatedSidebar]}>
        {/* 高斯模糊背景层：BlurView(dimezisBlurView) + tint 主题适配。
            深色模式用 systemThickMaterialDark（72% alpha #252525）替代 dark（55% alpha #191919），
            获得更高 alpha 的深色 overlay 压住亮色内容模糊透出。
            实色叠加层提高到 0.80 确保侧栏文字可读性，同时透出少量模糊质感。 */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <BlurView
            intensity={80}
            blurMethod="dimezisBlurView"
            blurTarget={blurTarget}
            tint={mode === "dark" ? "systemThickMaterialDark" : "light"}
            style={StyleSheet.absoluteFill}
          />
        </View>
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: `rgba(${theme.pageRgb},${mode === "dark" ? 0.80 : 0.25})` },
          ]}
          pointerEvents="none"
        />

        {/* 头部 */}
        <View style={styles.sidebarHeader}>
          <Text style={[styles.sidebarTitle, { color: theme.text }]}>{t("history")}</Text>
          <TouchableOpacity onPress={handleNew} style={[styles.newBtnCapsule, { backgroundColor: `rgba(${theme.brandRgb},0.15)` }]} hitSlop={8} activeOpacity={0.7}>
            <Ionicons name="add" size={16} color={theme.brand} />
            <Text style={{ color: theme.brand, fontSize: 14, fontWeight: "600", marginLeft: 4 }}>{t("newChat")}</Text>
          </TouchableOpacity>
        </View>

        {/* 搜索栏 */}
        <View style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
          <View style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 9,
            borderRadius: 12,
            backgroundColor: mode === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
          }}>
            <Ionicons name="search" size={16} color={theme.muted} />
            <TextInput
              style={{ flex: 1, fontSize: 14, color: theme.text, padding: 0 }}
              placeholder="搜索对话内容..."
              placeholderTextColor={theme.muted}
              value={searchText}
              onChangeText={setSearchText}
            />
            {searchText.length > 0 && (
              <TouchableOpacity onPress={() => setSearchText("")} hitSlop={6}>
                <Ionicons name="close-circle" size={16} color={theme.muted} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* 功能区：从顶栏右侧搬入的功能（放送日程/Archive/Web版）+ Token 常显 */}
        <View style={styles.functionBar}>
          {/* Archive：从顶栏搬入 */}
          <TouchableOpacity
            style={styles.functionBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onClose();
              router.push("/archive");
            }}
            hitSlop={6}
          >
            <Ionicons name="library-outline" size={18} color={theme.muted} />
            <Text style={[styles.functionBtnText, { color: theme.muted }]} numberOfLines={1}>档案</Text>
          </TouchableOpacity>

          {/* Web 版：跳转浏览器 */}
          <TouchableOpacity
            style={styles.functionBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              Linking.openURL("https://yunoseek.ownbangdream.asia/").catch(() => {});
            }}
            hitSlop={6}
          >
            <Ionicons name="globe-outline" size={18} color={theme.muted} />
            <Text style={[styles.functionBtnText, { color: theme.muted }]} numberOfLines={1}>Web 版</Text>
          </TouchableOpacity>

          {/* 全站 Token：常显在右侧，点按手动刷新 */}
          <TouchableOpacity
            style={[
              styles.tokenDisplay,
              { backgroundColor: mode === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" },
            ]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); refreshTokens(); }}
            disabled={tokenLoading}
            activeOpacity={0.7}
          >
            {tokenLoading ? (
              <ActivityIndicator size={11} color={theme.brand} />
            ) : (
              <Ionicons name="sparkles" size={12} color={theme.brand} />
            )}
            <Text style={[styles.tokenText, { color: theme.brand }]} numberOfLines={1}>
              {formatTokenUsage(tokenCount)}
            </Text>
          </TouchableOpacity>
        </View>

        {/* 对话列表（时间分组） */}
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
          {conversations.length === 0 ? (
            <View style={styles.empty}>
              <Text style={{ color: theme.muted, fontSize: 14 }}>{t("noConversations")}</Text>
            </View>
          ) : (
            <>
              {renderGroup("今天", grouped.today, 0)}
              {renderGroup("7 天内", grouped.week, grouped.today.length)}
              {renderGroup("30 天内", grouped.month, grouped.today.length + grouped.week.length)}
              {renderGroup("更早", grouped.older, grouped.today.length + grouped.week.length + grouped.month.length)}
            </>
          )}
        </ScrollView>

        {/* 底部用户卡片：点击头像/名字区域浮动显示当前引继码，
            点击浮动卡片跳转进引继码页（侧栏的引继码按钮已隐去，合并进角色栏点击行为） */}
        <View style={styles.bottomNav}>
          <TouchableOpacity
            style={{ flexDirection: "row", alignItems: "center", flex: 1 }}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowHandoffCard((v) => !v);
            }}
            activeOpacity={0.7}
          >
            <Image source={{ uri: profile.avatar }} style={{ width: 32, height: 32, borderRadius: 16 }} />
            <Text style={{ flex: 1, fontSize: 14, fontWeight: "600", color: theme.text, marginLeft: 10 }} numberOfLines={1}>
              {profile.name}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { onClose(); router.push("/settings"); }}
            hitSlop={8}
            style={{ padding: 4, marginLeft: 4 }}
          >
            <Ionicons name="settings-outline" size={20} color={theme.muted} />
          </TouchableOpacity>
        </View>

        {/* 角色栏点击后浮动显示的引继码卡片：
            - 点击引继码区域：跳转进引继码管理页
            - 同步按钮：把本地会话推送到服务端（不跳转） */}
        {showHandoffCard && (
          <View
            style={{
              position: "absolute",
              left: 16,
              right: 16,
              bottom: 76,
              backgroundColor: theme.panel,
              borderRadius: 14,
              padding: 14,
              borderWidth: 1,
              borderColor: theme.brand,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.3,
              shadowRadius: 16,
              elevation: 8,
              zIndex: 30,
            }}
          >
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowHandoffCard(false);
                onClose();
                router.push("/handoff");
              }}
            >
              <Text style={{ fontSize: 11, color: theme.muted, marginBottom: 4 }}>当前引继码 · 点击进入管理</Text>
              <Text style={{ fontSize: 16, fontWeight: "700", letterSpacing: 1.5, color: theme.text }} numberOfLines={1}>
                {handoffToken || "正在生成..."}
              </Text>
            </TouchableOpacity>

            {/* 同步按钮 + 状态文本 */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.line }}>
              <TouchableOpacity
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 5,
                  paddingVertical: 5,
                  paddingHorizontal: 10,
                  borderRadius: 8,
                  backgroundColor: `rgba(${theme.brandRgb},0.15)`,
                  opacity: syncing ? 0.5 : 1,
                }}
                onPress={handleSync}
                disabled={syncing || !handoffToken}
                activeOpacity={0.7}
              >
                <Ionicons name="cloud-upload-outline" size={14} color={theme.brand} />
                <Text style={{ fontSize: 12, fontWeight: "600", color: theme.brand }}>
                  {syncing ? "同步中..." : "同步会话"}
                </Text>
              </TouchableOpacity>
              {syncStatus && (
                <Text style={{ fontSize: 11, fontWeight: "600", color: syncStatus.ok ? "#34c759" : "#ff6969" }}>
                  {syncStatus.text}
                </Text>
              )}
            </View>
          </View>
        )}
      </Animated.View>
      </GestureDetector>

      {/* 重命名 Modal（替代 Alert.prompt，Android 兼容） */}
      <Modal visible={!!renamingConv} transparent animationType="fade" onRequestClose={() => setRenamingConv(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 }}>
          <MotiView
            from={{ opacity: 0, scale: 0.92, translateY: 8 }}
            animate={{ opacity: 1, scale: 1, translateY: 0 }}
            transition={{ type: "spring", damping: 24, stiffness: 280, mass: 0.8 }}
            style={{ width: "100%" }}
          >
            <View style={{ width: "100%", backgroundColor: theme.panel, borderRadius: 16, padding: 20 }}>
              <Text style={{ fontSize: 16, fontWeight: "600", color: theme.text, marginBottom: 12 }}>{t("rename")}</Text>
              <TextInput
                style={{ borderWidth: 1, borderColor: theme.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: theme.text, marginBottom: 16 }}
                value={renameText}
                onChangeText={setRenameText}
                autoFocus
                selectTextOnFocus
              />
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 12 }}>
                <TouchableOpacity onPress={() => setRenamingConv(null)} style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
                  <Text style={{ color: theme.muted, fontSize: 14 }}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    if (renameText.trim() && renamingConv) renameConversation(renamingConv.id, renameText.trim());
                    setRenamingConv(null);
                  }}
                  style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: `rgba(${theme.brandRgb},0.15)`, borderRadius: 8 }}
                >
                  <Text style={{ color: theme.brand, fontSize: 14, fontWeight: "600" }}>确定</Text>
                </TouchableOpacity>
              </View>
            </View>
          </MotiView>
        </View>
      </Modal>

      {/* 长按操作菜单（从按压位置弹出，小尺寸） */}
      <Modal visible={!!menuConv} transparent animationType="fade" onRequestClose={() => setMenuConv(null)}>
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.3)" }}
          activeOpacity={1}
          onPress={() => setMenuConv(null)}
        >
          <View
            style={{
              position: "absolute",
              left: Math.min(menuPos.x, 320 - 170),
              top: Math.min(menuPos.y, 600),
              width: 160,
              backgroundColor: mode === "dark" ? "rgba(58,59,64,0.97)" : "rgba(255,255,255,0.98)",
              borderRadius: 12,
              padding: 4,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.3,
              shadowRadius: 16,
              elevation: 8,
            }}
          >
            <TouchableOpacity
              style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 8 }}
              onPress={() => handleMenuAction("rename")}
            >
              <Ionicons name="pencil-outline" size={15} color={theme.text} />
              <Text style={{ fontSize: 13, fontWeight: "600", color: theme.text }}>{t("rename")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 8 }}
              onPress={() => handleMenuAction("pin")}
            >
              <Ionicons name={menuConv?.pinned ? "pin" : "pin-outline"} size={15} color={theme.text} />
              <Text style={{ fontSize: 13, fontWeight: "600", color: theme.text }}>{menuConv?.pinned ? t("unpin") : t("pin")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 8 }}
              onPress={() => handleMenuAction("delete")}
            >
              <Ionicons name="trash-outline" size={15} color="#ff6969" />
              <Text style={{ fontSize: 13, fontWeight: "600", color: "#ff6969" }}>{t("delete")}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 删除确认 Modal */}
      <Modal visible={!!deletingConv} transparent animationType="fade" onRequestClose={() => setDeletingConv(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 }}>
          <View style={{ width: "100%", backgroundColor: theme.panel, borderRadius: 18, padding: 22, alignItems: "center" }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: theme.text, marginBottom: 8 }}>{t("delete")}</Text>
            <Text style={{ fontSize: 14, color: theme.muted, textAlign: "center", marginBottom: 20 }}>
              确定删除此对话？此操作不可撤销。
            </Text>
            <View style={{ flexDirection: "row", gap: 12, width: "100%" }}>
              <TouchableOpacity
                onPress={() => setDeletingConv(null)}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.line, alignItems: "center" }}
              >
                <Text style={{ fontSize: 14, fontWeight: "600", color: theme.text }}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  if (deletingConv) deleteConversation(deletingConv.id);
                  setDeletingConv(null);
                }}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: "#ff5a65", alignItems: "center" }}
              >
                <Text style={{ fontSize: 14, fontWeight: "700", color: "#fff" }}>{t("delete")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 提取会话中第一条匹配消息的上下文片段（前 25 字 + 匹配词 + 后 25 字）。
 * 用于在搜索结果列表的标题下方显示挑重点式的内容片段。
 * 优先匹配 user 消息，找不到再匹配 assistant。
 */
function getMatchSnippet(
  conv: Conversation,
  query: string
): { before: string; match: string; after: string } | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const searchIn = (pred: (m: { role: string; content?: string }) => boolean) => {
    for (const m of conv.messages) {
      if (!pred(m)) continue;
      const content = typeof m.content === "string" ? m.content : "";
      const idx = content.toLowerCase().indexOf(q);
      if (idx < 0) continue;
      const start = Math.max(0, idx - 25);
      const end = Math.min(content.length, idx + q.length + 25);
      return {
        before: (start > 0 ? "…" : "") + content.slice(start, idx),
        match: content.slice(idx, idx + q.length),
        after: content.slice(idx + q.length, end) + (end < content.length ? "…" : ""),
      };
    }
    return null;
  };
  // 先扫用户消息（更符合"挑重点"），再扫助手消息
  return searchIn((m) => m.role === "user") || searchIn(() => true);
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.4)",
    zIndex: 10,
  },
  sidebar: {
    position: "absolute",
    top: 0,
    left: 0,
    bottom: 0,
    zIndex: 11,
    paddingTop: 48, // 状态栏高度
    overflow: "hidden", // 裁剪 BlurView，防止溢出
  },
  sidebarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  sidebarTitle: {
    fontSize: 17,
    fontWeight: "700",
  },
  newBtnCapsule: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  item: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 8,
    borderRadius: 12,
    marginVertical: 2,
  },
  itemHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  itemTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
  },
  itemTime: {
    fontSize: 11,
    marginLeft: 8,
  },
  itemPreview: {
    fontSize: 13,
    marginTop: 3,
    lineHeight: 18,
  },
  bottomNav: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  navItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
  },
  navText: {
    fontSize: 13,
    fontWeight: "500",
  },
  // 功能区：搜索框下方的快捷入口行（Archive / Web版 / Token 常显）
  functionBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  functionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  functionBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
  // Token 常显：靠右对齐，sparkles 图标 + 数值
  tokenDisplay: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: "auto",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  tokenText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
});
