// 消息气泡：Markdown + 图片 + 搜索结果 + 复制/重试 + 时间戳 + 出现动画
import React, { memo, useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
  useColorScheme,
  Linking,
} from "react-native";
import { Image } from "expo-image";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withRepeat,
  withDelay,
  runOnJS,
} from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import type { Message, SearchResult } from "../lib/store";
import { useStore } from "../lib/store";
import { getTheme, resolveThemeMode } from "../lib/theme";
import { getProfile } from "../lib/profiles";
import { t } from "../lib/i18n";
import { MarkdownRenderer } from "./MarkdownRenderer";

// ── 流式等待脉冲点（App Store pulse spinner 简化版） ──────────────────────────────────────────
function PulsingDots({ color }: { color: string }) {
  const dot1 = useSharedValue(0.3);
  const dot2 = useSharedValue(0.3);
  const dot3 = useSharedValue(0.3);
  useEffect(() => {
    dot1.value = withRepeat(withTiming(1, { duration: 500 }), -1, true);
    dot2.value = withDelay(150, withRepeat(withTiming(1, { duration: 500 }), -1, true));
    dot3.value = withDelay(300, withRepeat(withTiming(1, { duration: 500 }), -1, true));
  }, []);
  const s1 = useAnimatedStyle(() => ({ opacity: dot1.value }));
  const s2 = useAnimatedStyle(() => ({ opacity: dot2.value }));
  const s3 = useAnimatedStyle(() => ({ opacity: dot3.value }));
  const dotStyle = { width: 7, height: 7, borderRadius: 4, backgroundColor: color };
  return (
    <View style={{ flexDirection: "row", gap: 5, paddingVertical: 6 }}>
      <Animated.View style={[dotStyle, s1]} />
      <Animated.View style={[dotStyle, s2]} />
      <Animated.View style={[dotStyle, s3]} />
    </View>
  );
}

// ── 8-nib 时钟式脉冲指示器（参照 web 端 .pulse-spinner） ──────────────────────────────────────────
// 8 个 nib 绕中心旋转 0/45/90/.../315°，依次脉动 fade 0.08→0.55
function PulseNib({
  color,
  angle,
  delay,
  size,
  nibSize,
  nibHeight,
  radius,
}: {
  color: string;
  angle: number;
  delay: number;
  size: number;
  nibSize: number;
  nibHeight: number;
  radius: number;
}) {
  const opacity = useSharedValue(0.08);
  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(withTiming(0.55, { duration: 400 }), -1, true)
    );
  }, [delay]);
  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          top: size / 2 - nibHeight / 2,
          left: size / 2 - nibSize / 2,
          width: nibSize,
          height: nibHeight,
          borderRadius: Math.max(1, Math.round(nibSize * 0.4)),
          backgroundColor: color,
          transform: [
            { rotate: `${angle}deg` },
            { translateY: -radius },
          ],
        },
        animStyle,
      ]}
    />
  );
}

function PulseSpinner({ color, size = 16 }: { color: string; size?: number }) {
  const nibSize = Math.max(2, Math.round(size * 0.16));
  const nibHeight = Math.max(5, Math.round(size * 0.4));
  const radius = Math.round(size * 0.45);
  return (
    <View style={{ width: size, height: size, position: "relative" }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <PulseNib
          key={i}
          color={color}
          angle={i * 45}
          delay={-i * 100}
          size={size}
          nibSize={nibSize}
          nibHeight={nibHeight}
          radius={radius}
        />
      ))}
    </View>
  );
}

// ── 思考中标签：呼吸辉光动画（参照 web 端 reasoningGlow） ──────────────────────────────────────────
const ReasoningGlowLabel = memo(function ReasoningGlowLabel({
  text,
  color,
}: {
  text: string;
  color: string;
}) {
  // 用 opacity 0.78↔1.0 模拟 brightness 呼吸，搭配静态 textShadow 模拟辉光
  const glow = useSharedValue(0.78);
  useEffect(() => {
    glow.value = withRepeat(withTiming(1.0, { duration: 775 }), -1, true);
  }, []);
  const animStyle = useAnimatedStyle(() => ({ opacity: glow.value }));
  return (
    <Animated.Text
      style={[
        styles.reasoningLabel,
        {
          color: "#f4f7ff",
          textShadowColor: color,
          textShadowRadius: 8,
          textShadowOffset: { width: 0, height: 0 },
        },
        animStyle,
      ]}
    >
      {text}
    </Animated.Text>
  );
});

// ── 搜索结果折叠徽章 ──────────────────────────────────────────
function SearchBadge({
  results,
  expanded,
  onToggle,
  theme,
}: {
  results: SearchResult[];
  expanded: boolean;
  onToggle: () => void;
  theme: ReturnType<typeof getTheme>;
}) {
  return (
    <View style={{ marginTop: 6 }}>
      <TouchableOpacity
        onPress={onToggle}
        activeOpacity={0.7}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 14,
          backgroundColor: `rgba(${theme.brandRgb},0.08)`,
          alignSelf: "flex-start",
        }}
      >
        <Ionicons name="globe-outline" size={13} color={theme.brand} />
        <Text style={{ fontSize: 12, fontWeight: "500", color: theme.brand }}>
          已搜索到 {results.length} 个网页
        </Text>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={12} color={theme.brand} />
      </TouchableOpacity>
      {expanded && (
        <View style={{ marginTop: 6, gap: 6 }}>
          {results.map((r, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => Linking.openURL(r.url).catch(() => {})}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 8,
                borderRadius: 10,
                backgroundColor: `rgba(${theme.brandRgb},0.05)`,
                borderLeftWidth: 2,
                borderLeftColor: theme.brand,
              }}
            >
              <Text style={{ fontSize: 13, fontWeight: "500", color: theme.text }} numberOfLines={1}>
                {r.title}
              </Text>
              {r.snippet ? (
                <Text style={{ fontSize: 11, color: theme.muted, marginTop: 2, lineHeight: 15 }} numberOfLines={2}>
                  {r.snippet}
                </Text>
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

interface Props {
  message: Message;
  onRetry?: (msgId: string) => void;
}

export const ChatMessage = memo(function ChatMessage({ message, onRetry }: Props) {
  const systemScheme = useColorScheme();
  const themeMode = useStore((s) => s.themeMode);
  const profile = useStore((s) => s.getCurrentProfile());
  const mode = resolveThemeMode(themeMode, systemScheme);
  const theme = getTheme(mode, profile.themeColor);
  const { width } = useWindowDimensions();
  const [copied, setCopied] = useState(false);
  const [reasoningExpanded, setReasoningExpanded] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);

  const isUser = message.role === "user";
  const maxWidth = width * 0.78;

  // 消息对应角色（用 message.profileKey 查找，找不到时回退到当前角色）
  const messageProfile = (message.profileKey && getProfile(message.profileKey)) || profile;

  // 出现动画：从下方 16px 滑入 + 淡入
  const translateY = useSharedValue(16);
  const opacity = useSharedValue(0);
  useEffect(() => {
    translateY.value = withSpring(0, { damping: 18, stiffness: 200 });
    opacity.value = withTiming(1, { duration: 250 });
  }, []);
  const animatedBubble = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  const handleCopy = async () => {
    await Clipboard.setStringAsync(message.content);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // 引继码同步过来的消息可能没有 timestamp 或为无效日期，此时不显示时间
  const ts = message.timestamp ? new Date(message.timestamp).getTime() : NaN;
  const timeStr = isNaN(ts)
    ? ""
    : new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      {/* assistant 消息左侧头像（常规 IM 风格） */}
      {!isUser && (
        <View style={styles.avatarCol}>
          <Image
            source={{ uri: messageProfile.avatar }}
            style={styles.avatar}
            contentFit="cover"
          />
        </View>
      )}
      <Animated.View
        style={[
          isUser
            ? {
                backgroundColor: `rgba(${theme.brandRgb},0.14)`,
                borderRadius: 18,
                paddingHorizontal: 14,
                paddingVertical: 10,
                alignSelf: "flex-end",
                borderBottomRightRadius: 6,
                maxWidth,
              }
            : {
                flex: 1,
                paddingHorizontal: 2,
                paddingVertical: 4,
              },
          animatedBubble,
        ]}
      >
        {/* 图片附件 */}
        {message.attachments && message.attachments.length > 0 && (
          <View style={styles.attachRow}>
            {message.attachments.map((a) => (
              <Image
                key={a.id}
                source={{ uri: a.uri }}
                style={[
                  styles.attachImage,
                  message.attachments!.length === 1 && { width: maxWidth - 28, height: 180 },
                ]}
                contentFit="cover"
                transition={300}
              />
            ))}
          </View>
        )}

        {/* Reasoning 折叠区（仅当该消息发送时开启了深度思考才显示） */}
        {message.reasoningContent && message.reasoningEnabled ? (
          <View style={[styles.reasoningBox, { borderLeftColor: mode === "dark" ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)" }]}>
            <TouchableOpacity
              style={styles.reasoningHeader}
              onPress={() => !message.streaming && setReasoningExpanded(!reasoningExpanded)}
              activeOpacity={0.7}
            >
              {message.streaming ? (
                <>
                  <PulseSpinner color={theme.brand} size={14} />
                  <ReasoningGlowLabel text={t("thinking") + "..."} color={theme.brand} />
                </>
              ) : (
                <>
                  <Text style={[styles.reasoningLabel, { color: theme.muted }]}>
                    {t("deepThought")}
                  </Text>
                  <Ionicons
                    name={reasoningExpanded ? "chevron-up" : "chevron-down"}
                    size={14}
                    color={theme.muted}
                  />
                </>
              )}
            </TouchableOpacity>
            {/* 默认完全隐藏：仅在非 streaming 且展开时渲染内容（参照 web 端 grid-template-rows: 0fr → 1fr） */}
            {!message.streaming && reasoningExpanded ? (
              <Text style={[styles.reasoningText, { color: theme.muted }]}>
                {message.reasoningContent}
              </Text>
            ) : null}
            {/* 深度思考开启时，搜索结果放在思考链内 */}
            {message.searchResults && message.searchResults.length > 0 && (
              <SearchBadge
                results={message.searchResults}
                expanded={searchExpanded}
                onToggle={() => setSearchExpanded(!searchExpanded)}
                theme={theme}
              />
            )}
          </View>
        ) : null}

        {/* 搜索结果（深度思考关闭时独立显示） */}
        {!message.reasoningEnabled && message.searchResults && message.searchResults.length > 0 && (
          <SearchBadge
            results={message.searchResults}
            expanded={searchExpanded}
            onToggle={() => setSearchExpanded(!searchExpanded)}
            theme={theme}
          />
        )}

        {/* 正文 */}
        {isUser ? (
          <Text style={[styles.content, { color: theme.text }]} selectable>
            {message.content}
          </Text>
        ) : message.content ? (
          <MarkdownRenderer content={message.content} />
        ) : message.streaming ? (
          <PulsingDots color={theme.muted} />
        ) : null}

        {/* 错误 */}
        {message.error ? (
          <View style={styles.errorRow}>
            <Text style={styles.errorText}>{message.error}</Text>
            {onRetry && (
              <TouchableOpacity
                onPress={() => onRetry(message.id)}
                style={[styles.retryBtn, { backgroundColor: `rgba(${theme.brandRgb},0.15)` }]}
              >
                <Ionicons name="refresh" size={13} color={theme.brand} />
                <Text style={[styles.retryText, { color: theme.brand }]}>{t("retry")}</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}

        {/* 底部：时间戳 + 操作按钮 */}
        <View style={styles.footer}>
          {timeStr ? <Text style={[styles.timestamp, { color: theme.muted }]}>{timeStr}</Text> : <View />}
          {!isUser && !message.streaming && message.content ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
              <TouchableOpacity onPress={() => onRetry?.(message.id)} hitSlop={8} style={styles.copyBtn}>
                <Ionicons name="refresh-outline" size={14} color={theme.muted} />
              </TouchableOpacity>
              <TouchableOpacity onPress={handleCopy} hitSlop={8} style={styles.copyBtn}>
                <Ionicons
                  name={copied ? "checkmark" : "copy-outline"}
                  size={14}
                  color={copied ? "#4ade80" : theme.muted}
                />
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 14,
    marginVertical: 4,
  },
  rowUser: { alignItems: "flex-end" },
  rowAssistant: { alignItems: "flex-start", flexDirection: "row", gap: 8 },
  avatarCol: { paddingTop: 4 },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(120,120,120,0.08)",
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  attachRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 6,
  },
  attachImage: {
    width: 100,
    height: 100,
    borderRadius: 10,
  },
  reasoningBox: {
    borderLeftWidth: 2,
    paddingLeft: 8,
    marginBottom: 6,
  },
  reasoningHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    alignSelf: "flex-start",
    marginBottom: 2,
  },
  reasoningLabel: { fontSize: 11, fontWeight: "600" },
  reasoningText: { fontSize: 12, lineHeight: 17 },
  content: { fontSize: 15, lineHeight: 22 },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  errorText: { color: "#ef4444", fontSize: 13, flex: 1 },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginLeft: 8,
  },
  retryText: { fontSize: 12, fontWeight: "600" },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  timestamp: { fontSize: 10 },
  copyBtn: { padding: 2 },
});
