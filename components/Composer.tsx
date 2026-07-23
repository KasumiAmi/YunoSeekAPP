// 输入框组件：切换 pill + 图片预览 + 文本输入 + 发送/停止
import React, { useState, useRef, useEffect, type RefObject } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { readAsStringAsync, EncodingType } from "expo-file-system/legacy";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from "react-native-reanimated";
import { useStore, type Attachment } from "../lib/store";
import { getTheme, resolveThemeMode } from "../lib/theme";
import { t } from "../lib/i18n";

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

interface Props {
  onSend: (text: string, attachments?: Attachment[]) => void;
  onStop?: () => void;
  busy?: boolean;
  bottomInset?: number;
  /** 外部注入草稿文本（编辑用户消息时填充输入框），消费后由父级清空 */
  draftText?: string;
  /**
   * Android 上真实高斯模糊的目标 ref（来自 app/index.tsx 的 BlurTargetView）。
   * iOS 上 BlurView 自动模糊下方内容，此 prop 可选。
   */
  blurTarget?: RefObject<View | null>;
}

export function Composer({ onSend, onStop, busy, bottomInset = 0, draftText, blurTarget }: Props) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const inputRef = useRef<TextInput>(null);
  const systemScheme = useColorScheme();
  const { width: screenWidth } = useWindowDimensions();

  // 外部注入草稿（编辑用户消息）：draftText 非空时填充输入框并聚焦
  useEffect(() => {
    if (draftText) {
      setText(draftText);
      inputRef.current?.focus();
    }
  }, [draftText]);
  const themeMode = useStore((s) => s.themeMode);
  const profile = useStore((s) => s.getCurrentProfile());
  const reasoning = useStore((s) => s.reasoning);
  const webSearch = useStore((s) => s.webSearch);
  const toggleReasoning = useStore((s) => s.toggleReasoning);
  const toggleWebSearch = useStore((s) => s.toggleWebSearch);

  const mode = resolveThemeMode(themeMode, systemScheme);
  const theme = getTheme(mode, profile.themeColor);

  // 设备自适应缩放：以 375 为基准宽度，最大放大到 1.15，最小不缩小到 0.9 以下
  const scale = Math.max(0.9, Math.min(screenWidth / 375, 1.15));
  const s = (n: number) => Math.round(n * scale);

  const handleSend = () => {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSend(trimmed, attachments.length > 0 ? attachments : undefined);
    setText("");
    setAttachments([]);
  };

  const handleStop = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onStop?.();
  };

  const [attachSheetVisible, setAttachSheetVisible] = useState(false);

  // + 号 crossfade 动画：add ↔ close
  const addIconOpacity = useSharedValue(1);
  const closeIconOpacity = useSharedValue(0);
  // 附件面板淡入 + 上滑动画
  const sheetOpacity = useSharedValue(0);
  const sheetTranslateY = useSharedValue(8);

  useEffect(() => {
    // 动画时长与缓动：240ms easeOut，符合 web 端过渡手感
    const duration = 240;
    const easing = Easing.out(Easing.cubic);
    if (attachSheetVisible) {
      // 展开：先归零再渐入，避免从 1 跳变
      sheetOpacity.value = 0;
      sheetTranslateY.value = 8;
      sheetOpacity.value = withTiming(1, { duration, easing });
      sheetTranslateY.value = withTiming(0, { duration, easing });
      addIconOpacity.value = withTiming(0, { duration: 200, easing });
      closeIconOpacity.value = withTiming(1, { duration: 200, easing });
    } else {
      sheetOpacity.value = withTiming(0, { duration: 180, easing });
      sheetTranslateY.value = withTiming(8, { duration: 180, easing });
      addIconOpacity.value = withTiming(1, { duration: 200, easing });
      closeIconOpacity.value = withTiming(0, { duration: 200, easing });
    }
  }, [attachSheetVisible]);

  const addIconStyle = useAnimatedStyle(() => ({ opacity: addIconOpacity.value }));
  const closeIconStyle = useAnimatedStyle(() => ({ opacity: closeIconOpacity.value }));
  const sheetAnimStyle = useAnimatedStyle(() => ({
    opacity: sheetOpacity.value,
    transform: [{ translateY: sheetTranslateY.value }],
  }));

  const handleAttach = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAttachSheetVisible((prev) => !prev);
  };

  const handleAttachAction = (action: "camera" | "library") => {
    setAttachSheetVisible(false);
    if (action === "camera") pickImage("camera");
    else if (action === "library") pickImage("library");
  };

  const pickImage = async (source: "camera" | "library") => {
    try {
      let result: ImagePicker.ImagePickerResult;
      if (source === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("权限不足", "需要相机权限才能拍照");
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          quality: 0.8,
          allowsEditing: false,
        });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("权限不足", "需要相册权限才能选择图片");
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsMultipleSelection: true,
          quality: 0.8,
        });
      }

      if (result.canceled || result.assets.length === 0) return;

      const newAttachments: Attachment[] = [];
      for (const asset of result.assets) {
        // 读取 base64（压缩后）
        const base64 = await readAsStringAsync(asset.uri, {
          encoding: EncodingType.Base64,
        });
        newAttachments.push({
          id: genId(),
          uri: asset.uri,
          base64,
          width: asset.width,
          height: asset.height,
          mimeType: asset.mimeType || "image/jpeg",
        });
      }
      setAttachments((prev) => [...prev, ...newAttachments]);
    } catch (e) {
      console.warn("[Composer] pickImage error:", e);
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !busy;

  return (
    <View style={[styles.container, {
      paddingHorizontal: s(12),
      paddingTop: s(8),
      paddingBottom: bottomInset + s(4),
    }]}>
      {/* 图片预览 */}
      {attachments.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: s(8), paddingBottom: s(6), paddingHorizontal: s(2) }}
        >
          {attachments.map((a) => (
            <View key={a.id} style={{ position: "relative" }}>
              <Image source={{ uri: a.uri }} style={{ width: s(64), height: s(64), borderRadius: s(10) }} />
              <TouchableOpacity
                style={{ position: "absolute", top: -s(6), right: -s(6) }}
                onPress={() => removeAttachment(a.id)}
                hitSlop={6}
              >
                <Ionicons name="close-circle" size={s(20)} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* 统一圆角输入卡片（DeepSeek 风格）：恢复半透明背景 */}
      <View style={{
        borderRadius: s(20),
        paddingHorizontal: s(20),
        paddingTop: s(18),
        paddingBottom: s(14),
        borderWidth: 1,
        backgroundColor: mode === "dark" ? "rgba(28,30,36,0.95)" : "rgba(255,255,255,0.95)",
        borderColor: mode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: s(2) },
        shadowOpacity: mode === "dark" ? 0.2 : 0.06,
        shadowRadius: s(8),
        elevation: 4,
      }}>
        {/* 文本输入 */}
        <TextInput
          ref={inputRef}
          style={{
            fontSize: s(16),
            lineHeight: s(22),
            maxHeight: s(120),
            paddingVertical: s(2),
            color: theme.text,
          }}
          placeholder={t("inputPlaceholder")}
          placeholderTextColor={theme.muted}
          value={text}
          onChangeText={setText}
          onFocus={() => {
            if (attachSheetVisible) {
              setAttachSheetVisible(false);
            }
          }}
          multiline
          maxLength={8000}
          editable={!busy}
        />

        {/* 底部行：pill 按钮 + 操作按钮 */}
        <View style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: s(12),
          gap: s(12),
        }}>
          <View style={{ flexDirection: "row", gap: s(8), flexShrink: 1 }}>
            <Pill
              label={t("deepThought")}
              icon="bulb-outline"
              active={reasoning}
              onPress={() => { toggleReasoning(); Haptics.selectionAsync(); }}
              theme={theme}
              mode={mode}
              scale={scale}
            />
            <Pill
              label={t("webSearch")}
              icon="globe-outline"
              active={webSearch}
              onPress={() => { toggleWebSearch(); Haptics.selectionAsync(); }}
              theme={theme}
              mode={mode}
              scale={scale}
            />
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: s(6) }}>
            {/* 附件按钮：点击切换展开/收起 */}
            <TouchableOpacity
              onPress={handleAttach}
              style={{
                width: s(30),
                height: s(30),
                borderRadius: s(15),
                borderWidth: 1.5,
                justifyContent: "center",
                alignItems: "center",
                backgroundColor: attachSheetVisible
                  ? `rgba(${theme.brandRgb},0.14)`
                  : "transparent",
                borderColor: busy
                  ? theme.muted
                  : attachSheetVisible
                    ? theme.brand
                    : (mode === "dark" ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)"),
              }}
              hitSlop={8}
              disabled={busy}
            >
              {/* + 号 ↔ close 图标 crossfade */}
              <View style={{ width: s(17), height: s(17), justifyContent: "center", alignItems: "center" }}>
                <Animated.View style={[StyleSheet.absoluteFill, { justifyContent: "center", alignItems: "center" }, addIconStyle]}>
                  <Ionicons
                    name="add"
                    size={s(17)}
                    color={busy ? theme.muted : (mode === "dark" ? "#e8e8e8" : "#1a1a1a")}
                  />
                </Animated.View>
                <Animated.View style={[StyleSheet.absoluteFill, { justifyContent: "center", alignItems: "center" }, closeIconStyle]}>
                  <Ionicons name="close" size={s(17)} color={theme.brand} />
                </Animated.View>
              </View>
            </TouchableOpacity>
            {/* 发送 / 停止 */}
            {busy ? (
              <TouchableOpacity
                onPress={handleStop}
                style={{
                  width: s(30),
                  height: s(30),
                  borderRadius: s(15),
                  justifyContent: "center",
                  alignItems: "center",
                  backgroundColor: "#ef4444",
                }}
                hitSlop={8}
              >
                <Ionicons name="stop" size={s(15)} color="#fff" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={handleSend}
                disabled={!canSend}
                style={{
                  width: s(30),
                  height: s(30),
                  borderRadius: s(15),
                  justifyContent: "center",
                  alignItems: "center",
                  backgroundColor: canSend ? theme.brand : "transparent",
                  borderColor: canSend ? "transparent" : (mode === "dark" ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)"),
                  borderWidth: canSend ? 0 : 1.5,
                }}
                hitSlop={8}
              >
                <Ionicons name="arrow-up" size={s(17)} color={canSend ? theme.brandContrast : (mode === "dark" ? "#e8e8e8" : "#1a1a1a")} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {/* 附件展开行：内嵌在 Composer 容器底部，淡入 + 上滑过渡 */}
      {attachSheetVisible && (
        <Animated.View
          style={[
            sheetAnimStyle,
            {
              flexDirection: "row",
              gap: s(10),
              marginTop: s(8),
              paddingVertical: s(10),
              paddingHorizontal: s(12),
              borderRadius: s(16),
              backgroundColor: mode === "dark" ? "rgba(28,30,36,0.92)" : "rgba(255,255,255,0.92)",
              borderWidth: 1,
              borderColor: mode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
              shadowColor: "#000",
              shadowOffset: { width: 0, height: s(2) },
              shadowOpacity: mode === "dark" ? 0.18 : 0.05,
              shadowRadius: s(6),
              elevation: 3,
            },
          ]}
        >
          <AttachOption icon="camera-outline" label="拍照" onPress={() => handleAttachAction("camera")} theme={theme} mode={mode} scale={scale} />
          <AttachOption icon="image-outline" label="相册" onPress={() => handleAttachAction("library")} theme={theme} mode={mode} scale={scale} />
        </Animated.View>
      )}
    </View>
  );
}

// ── Pill 子组件（DeepSeek 风格） ───────────────────────────
function Pill({
  label,
  icon,
  active,
  onPress,
  theme,
  mode,
  scale,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
  theme: ReturnType<typeof getTheme>;
  mode: string;
  scale: number;
}) {
  const s = (n: number) => Math.round(n * scale);
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: s(14),
        paddingVertical: s(8),
        borderRadius: s(20),
        borderWidth: 1,
        backgroundColor: active
          ? `rgba(${theme.brandRgb},0.14)`
          : mode === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)",
        borderColor: active
          ? "transparent"
          : mode === "dark" ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",
      }}
      activeOpacity={0.7}
    >
      <Ionicons
        name={icon}
        size={s(16)}
        color={active ? theme.brand : (mode === "dark" ? "#e8e8e8" : "#1a1a1a")}
        style={{ marginRight: s(6) }}
      />
      <Text
        style={{
          fontSize: s(14),
          fontWeight: "500",
          color: active ? theme.brand : (mode === "dark" ? "#e8e8e8" : "#1a1a1a"),
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ── 附件选项子组件 ──────────────────────────────────────────
function AttachOption({
  icon,
  label,
  onPress,
  theme,
  mode,
  scale,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  theme: ReturnType<typeof getTheme>;
  mode: string;
  scale: number;
}) {
  const s = (n: number) => Math.round(n * scale);
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: s(8),
        paddingVertical: s(12),
        borderRadius: s(14),
        backgroundColor: mode === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
      }}
    >
      <Ionicons name={icon} size={s(22)} color={theme.text} />
      <Text style={{ fontSize: s(14), fontWeight: "600", color: theme.text }}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    // 尺寸由 inline style 动态控制
  },
});
