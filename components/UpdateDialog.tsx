// 更新弹窗：替代 Android 原生 Alert，统一应用内更新提示视觉风格
// 支持四种 variant：info（发现新版本）/ force（必须更新）/ ready（更新就绪）/ latest（已是最新）/ error（检查失败）
// 由 app/index.tsx（启动自动弹）和 app/settings.tsx（手动检查）共用
import React, { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  useColorScheme,
  Pressable,
} from "react-native";
import { BlurView } from "expo-blur";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
  runOnJS,
} from "react-native-reanimated";
import { useStore } from "../lib/store";
import { getTheme, resolveThemeMode } from "../lib/theme";
import {
  SparkleIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  DownloadIcon,
  CloseIcon,
} from "./icons";

export type UpdateDialogVariant = "info" | "force" | "ready" | "latest" | "error";

export interface UpdateDialogConfig {
  variant: UpdateDialogVariant;
  title: string;
  message?: string;
  changelog?: string;
  latestVersion?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  // error 变体可选的重试按钮（与 cancel/confirm 并列）
  retryText?: string;
  onRetry?: () => void;
}

interface Props {
  visible: boolean;
  config: UpdateDialogConfig | null;
  // 关闭回调（force 变体下会被忽略）
  onRequestClose?: () => void;
}

const ANIM_IN = 480;
const ANIM_IN_DELAY = 80;
const ANIM_OUT = 280;

export function UpdateDialog({ visible, config, onRequestClose }: Props) {
  const systemScheme = useColorScheme();
  const themeMode = useStore((s) => s.themeMode);
  const profile = useStore((s) => s.getCurrentProfile());
  const mode = resolveThemeMode(themeMode, systemScheme);
  const theme = getTheme(mode, profile.themeColor);

  // 入场/退场动画进度（0 = 隐藏，1 = 完全显示）
  const progress = useSharedValue(0);
  // 实际渲染开关：滞后 visible 关闭，等退出动画跑完再卸载
  const [render, setRender] = useState(false);
  useEffect(() => {
    if (visible) {
      setRender(true);
      progress.value = 0;
      progress.value = withDelay(
        ANIM_IN_DELAY,
        withTiming(1, { duration: ANIM_IN, easing: Easing.bezier(0.22, 1, 0.36, 1) })
      );
    } else if (render) {
      // 退出：反向淡出 + 轻微下沉，避免瞬间消失
      progress.value = withTiming(0, {
        duration: ANIM_OUT,
        easing: Easing.in(Easing.ease),
      }, () => {
        runOnJS(setRender)(false);
      });
    }
  }, [visible]);

  // 背景淡入
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));
  // 卡片：缩放 + 上浮 + 透明度，Apple flyAndBlur 风格
  const cardStyle = useAnimatedStyle(() => {
    "worklet";
    const scale = 0.92 + 0.08 * progress.value;
    const translateY = (1 - progress.value) * 16;
    return {
      opacity: progress.value,
      transform: [{ scale }, { translateY }],
    };
  });
  // 图标错落入场（比卡片稍晚）
  const iconStyle = useAnimatedStyle(() => {
    "worklet";
    const scale = 0.4 + 0.6 * progress.value;
    return {
      opacity: progress.value,
      transform: [{ scale }],
    };
  });
  // 按钮组延迟入场
  const buttonsStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      opacity: Math.max(0, (progress.value - 0.4) / 0.6),
      transform: [{ translateY: (1 - Math.max(0, (progress.value - 0.4) / 0.6)) * 8 }],
    };
  });

  if (!render || !config) return null;

  const isForce = config.variant === "force";
  const canDismiss = !isForce;

  // 变体配色
  const variantMeta: Record<
    UpdateDialogVariant,
    { icon: React.ReactNode; accent: string; accentRgb: string }
  > = {
    info: {
      icon: <SparkleIcon size={28} color={theme.brand} />,
      accent: theme.brand,
      accentRgb: theme.brandRgb,
    },
    force: {
      icon: <AlertTriangleIcon size={28} color="#ff5c5c" />,
      accent: "#ff5c5c",
      accentRgb: "255,92,92",
    },
    ready: {
      icon: <CheckCircleIcon size={28} color="#3dd68c" />,
      accent: "#3dd68c",
      accentRgb: "61,214,140",
    },
    latest: {
      icon: <CheckCircleIcon size={28} color={theme.muted} />,
      accent: theme.muted,
      accentRgb: "154,160,166",
    },
    error: {
      icon: <AlertTriangleIcon size={28} color="#ff5c5c" />,
      accent: "#ff5c5c",
      accentRgb: "255,92,92",
    },
  };
  const meta = variantMeta[config.variant];

  const handleCancel = () => {
    if (canDismiss) onRequestClose?.();
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleCancel}>
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleCancel} />
        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: theme.panel,
              borderColor: `rgba(${theme.brandRgb},0.18)`,
              // 重点阴影营造层次（避免模糊效果）
              shadowColor: "#000",
              shadowOpacity: mode === "dark" ? 0.5 : 0.18,
              shadowRadius: 28,
              shadowOffset: { width: 0, height: 12 },
              elevation: 24,
            },
          ]}
        >
          {/* 顶部毛玻璃条带：透出主题色辉光 */}
          <BlurView
            intensity={mode === "dark" ? 30 : 60}
            tint={mode === "dark" ? "dark" : "light"}
            style={[styles.glow, { backgroundColor: `rgba(${meta.accentRgb},0.12)` }]}
          />

          {/* 关闭按钮（非强制） */}
          {canDismiss ? (
            <TouchableOpacity
              onPress={handleCancel}
              hitSlop={12}
              style={styles.closeBtn}
              activeOpacity={0.6}
            >
              <CloseIcon size={18} color={theme.muted} />
            </TouchableOpacity>
          ) : null}

          {/* 图标 */}
          <Animated.View
            style={[
              styles.iconWrap,
              {
                backgroundColor: `rgba(${meta.accentRgb},0.14)`,
                borderColor: `rgba(${meta.accentRgb},0.28)`,
              },
              iconStyle,
            ]}
          >
            {meta.icon}
          </Animated.View>

          {/* 标题 */}
          <Text style={[styles.title, { color: theme.text }]}>{config.title}</Text>

          {/* 版本徽章 */}
          {config.latestVersion ? (
            <View
              style={[
                styles.versionBadge,
                { backgroundColor: `rgba(${meta.accentRgb},0.16)`, borderColor: `rgba(${meta.accentRgb},0.35)` },
              ]}
            >
              <Text style={[styles.versionText, { color: meta.accent }]}>
                v{config.latestVersion}
              </Text>
            </View>
          ) : null}

          {/* 消息 / Changelog（可滚动） */}
          {(config.message || config.changelog) && (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {config.message ? (
                <Text style={[styles.message, { color: theme.text }]}>{config.message}</Text>
              ) : null}
              {config.changelog ? (
                <Text style={[styles.changelog, { color: theme.muted }]}>
                  {config.changelog}
                </Text>
              ) : null}
            </ScrollView>
          )}

          {/* 按钮 */}
          <Animated.View style={[styles.buttons, buttonsStyle]}>
            {canDismiss && (
              <TouchableOpacity
                style={[
                  styles.btn,
                  styles.btnSecondary,
                  {
                    backgroundColor: `rgba(120,120,120,0.12)`,
                    borderColor: `rgba(120,120,120,0.2)`,
                  },
                ]}
                onPress={handleCancel}
                activeOpacity={0.7}
              >
                <Text style={[styles.btnText, { color: theme.text }]}>
                  {config.cancelText ?? "稍后"}
                </Text>
              </TouchableOpacity>
            )}
            {config.onRetry ? (
              <TouchableOpacity
                style={[
                  styles.btn,
                  styles.btnSecondary,
                  {
                    backgroundColor: `rgba(${meta.accentRgb},0.14)`,
                    borderColor: `rgba(${meta.accentRgb},0.35)`,
                  },
                ]}
                onPress={config.onRetry}
                activeOpacity={0.7}
              >
                <Text style={[styles.btnText, { color: meta.accent, fontWeight: "600" }]}>
                  {config.retryText ?? "重试"}
                </Text>
              </TouchableOpacity>
            ) : null}
            {config.onConfirm ? (
              <TouchableOpacity
                style={[
                  styles.btn,
                  styles.btnPrimary,
                  {
                    backgroundColor: meta.accent,
                    borderColor: meta.accent,
                    // 边缘辉光
                    shadowColor: meta.accent,
                    shadowOpacity: 0.4,
                    shadowRadius: 12,
                    shadowOffset: { width: 0, height: 4 },
                    elevation: 6,
                  },
                ]}
                onPress={config.onConfirm}
                activeOpacity={0.85}
              >
                <DownloadIcon size={16} color="#fff" />
                <Text style={[styles.btnText, { color: "#fff", fontWeight: "600", marginLeft: 6 }]}>
                  {config.confirmText ?? "立即下载"}
                </Text>
              </TouchableOpacity>
            ) : null}
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 22,
    borderWidth: 1,
    overflow: "hidden",
    paddingTop: 28,
    paddingBottom: 18,
    paddingHorizontal: 22,
  },
  glow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 96,
  },
  closeBtn: {
    position: "absolute",
    top: 14,
    right: 14,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
  },
  versionBadge: {
    alignSelf: "center",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 14,
  },
  versionText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  scroll: {
    maxHeight: 200,
    marginBottom: 16,
  },
  scrollContent: {
    paddingVertical: 2,
  },
  message: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 8,
  },
  changelog: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: "left",
  },
  buttons: {
    flexDirection: "row",
    gap: 10,
  },
  btn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  btnSecondary: {},
  btnPrimary: {},
  btnText: {
    fontSize: 14,
  },
});
