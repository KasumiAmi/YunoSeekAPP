// 公告横幅：自动轮播最近 3 条公告，支持 HTML 富媒体，可展开/关闭
// 轮播：每 5s 切换下一条，垂直滑动 + 淡入淡出（与 UpdateDialog flyAndBlur 风格一致）
// 暂停：详情 Modal 打开 / App 切到后台 时暂停；恢复时重置定时器
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  StyleSheet,
  useColorScheme,
  AppState,
  type AppStateStatus,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
  type SharedValue,
} from "react-native-reanimated";
import { useStore } from "../lib/store";
import { getTheme, resolveThemeMode } from "../lib/theme";
import { t } from "../lib/i18n";
import { announcement } from "../lib/api";
import { HtmlRenderer } from "./HtmlRenderer";

interface AnnouncementItem {
  id?: string;
  title?: string;
  content?: string;
  level?: string;
  updatedAt?: number;
}

const ROTATION_MS = 5000;
const ANIM_MS = 640;
const MAX_VISIBLE = 3;

/**
 * 格式化公告更新时间：与 web 端对齐，显示日期 + 时分
 * web 端使用 Intl.DateTimeFormat(dateStyle: "medium", timeStyle: "short")
 */
function formatAnnouncementTime(timestamp: number, locale: string): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const lang = locale === "ja-JP" ? "ja-JP" : "zh-CN";
  try {
    return new Intl.DateTimeFormat(lang, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

// 单条轮播项：根据 animatedIndex 与自身 itemIndex 的差值计算 opacity/translateY
// 差值归一化到 [-N/2, N/2]，保证 wrap-around（最后一条 → 第一条）时方向一致
function RotatingItem({
  itemIndex,
  total,
  animatedIndex,
  children,
}: {
  itemIndex: number;
  total: number;
  animatedIndex: SharedValue<number>;
  children: React.ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    "worklet";
    let diff = ((itemIndex - animatedIndex.value) % total + total) % total;
    if (diff > total / 2) diff -= total;
    const adiff = Math.abs(diff);
    // 仅 ±1 范围内可见（当前/上一条/下一条）
    if (adiff > 1) return { opacity: 0, transform: [{ translateY: 0 }] };
    return {
      opacity: 1 - adiff,
      transform: [{ translateY: diff * 10 }],
    };
  });
  return <Animated.View style={[StyleSheet.absoluteFill, style]}>{children}</Animated.View>;
}

export function AnnouncementBanner() {
  const systemScheme = useColorScheme();
  const themeMode = useStore((s) => s.themeMode);
  const profile = useStore((s) => s.getCurrentProfile());
  const mode = resolveThemeMode(themeMode, systemScheme);
  const theme = getTheme(mode, profile.themeColor);

  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [appActive, setAppActive] = useState(true);
  const locale = useStore((s) => s.locale);

  // 轮播连续浮点索引（始终向前递增，避免 wrap-around 反向动画）
  const animatedIndex = useSharedValue(0);

  useEffect(() => {
    announcement()
      .then((res) => {
        const list = res?.announcements || (res ? [res] : []);
        if (list.length > 0) setItems(list);
      })
      .catch(() => {});
  }, []);

  const displayList = items.slice(0, MAX_VISIBLE);
  const showRotation = displayList.length > 1;

  // 轮播定时器：详情打开 / 后台 / 已关闭 / 单条时不启动
  useEffect(() => {
    if (!showRotation || dismissed || detailVisible || !appActive) return;
    const id = setInterval(() => {
      const next = (activeIndex + 1) % displayList.length;
      // shared value 始终向前递增：从当前整数位置过渡到下一个整数位置
      // 用 floor(animatedIndex) 作为基准，确保 wrap 时方向一致（向上滚出 + 从下进入）
      animatedIndex.value = withTiming(
        Math.floor(animatedIndex.value) + 1,
        { duration: ANIM_MS, easing: Easing.bezier(0.22, 1, 0.36, 1) },
        () => {
          // 同步离散索引（用于圆点指示器）
          runOnJS(setActiveIndex)(next);
        }
      );
    }, ROTATION_MS);
    return () => clearInterval(id);
  }, [showRotation, dismissed, detailVisible, activeIndex, displayList.length, appActive]);

  // App 切到后台暂停轮播；回前台恢复（appActive 翻转触发 effect 重置定时器）
  useEffect(() => {
    const handler = (state: AppStateStatus) => {
      setAppActive(state === "active");
    };
    const sub = AppState.addEventListener("change", handler);
    return () => sub.remove();
  }, []);

  if (items.length === 0 || dismissed) return null;

  return (
    <>
      {/* 横幅（透明背景，与顶栏共享模糊/实色层，视觉一体化） */}
      <TouchableOpacity
        style={styles.banner}
        onPress={() => setDetailVisible(true)}
        activeOpacity={0.7}
      >
        <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
          <Ionicons name="megaphone-outline" size={15} color={theme.brand} style={{ marginRight: 8 }} />
          {/* 轮播文本容器：固定高度避免高度跳动 */}
          <View style={styles.rotatingWrap}>
            {displayList.map((item, i) => (
              <RotatingItem
                key={`rot-${i}`}
                itemIndex={i}
                total={displayList.length}
                animatedIndex={animatedIndex}
              >
                <Text style={[styles.bannerText, { color: theme.text }]} numberOfLines={1}>
                  {item.title || item.content || t("announcement")}
                </Text>
              </RotatingItem>
            ))}
          </View>
          {/* 圆点指示器：仅多条时显示 */}
          {showRotation ? (
            <View style={styles.dots}>
              {displayList.map((_, i) => (
                <View
                  key={`dot-${i}`}
                  style={[
                    styles.dot,
                    {
                      backgroundColor: i === activeIndex ? theme.brand : theme.muted,
                      opacity: i === activeIndex ? 1 : 0.4,
                    },
                  ]}
                />
              ))}
            </View>
          ) : null}
          <TouchableOpacity onPress={() => setDismissed(true)} hitSlop={8} style={{ marginLeft: 6 }}>
            <Ionicons name="close" size={16} color={theme.muted} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>

      {/* 公告详情 Modal（支持 HTML 富媒体） */}
      <Modal visible={detailVisible} transparent animationType="fade" onRequestClose={() => setDetailVisible(false)}>
        <View style={styles.overlay}>
          {/* 背景点击关闭 */}
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setDetailVisible(false)} />
          {/* 卡片（View 不拦截滚动手势） */}
          <View style={[styles.modalCard, { backgroundColor: theme.page }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>{t("announcement")}</Text>
              <TouchableOpacity onPress={() => setDetailVisible(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={theme.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.modalContent} bounces>
              {items.map((item, i) => (
                <View key={`ann-${i}`} style={[styles.annItem, { borderBottomColor: theme.line }]}>
                  {item.title && (
                    <Text style={[styles.annTitle, { color: theme.text }]}>{item.title}</Text>
                  )}
                  {item.content && <HtmlRenderer content={item.content} />}
                  {item.updatedAt ? (
                    <Text style={[styles.annDate, { color: theme.muted }]}>
                      {t("announcementUpdated").replace("{time}", formatAnnouncementTime(item.updatedAt, locale))}
                    </Text>
                  ) : null}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  rotatingWrap: {
    flex: 1,
    height: 18,
    position: "relative",
  },
  bannerText: { fontSize: 13, lineHeight: 18 },
  dots: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 8,
    gap: 3,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxHeight: "75%",
    borderRadius: 22,
    overflow: "hidden",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  modalTitle: { fontSize: 17, fontWeight: "700" },
  modalContent: { padding: 18 },
  annItem: {
    paddingBottom: 14,
    marginBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  annTitle: { fontSize: 16, fontWeight: "600", marginBottom: 6 },
  annDate: { fontSize: 11, marginTop: 6 },
});
