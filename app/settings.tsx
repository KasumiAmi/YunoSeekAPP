// 设置页：主题/语言/角色/AI 模式/服务状态
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useColorScheme,
  ScrollView,
  ActivityIndicator,
  Switch,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import * as Updates from "expo-updates";
import Constants from "expo-constants";
import { useStore } from "../lib/store";
import { getTheme, resolveThemeMode } from "../lib/theme";
import { t, setLocale } from "../lib/i18n";
import { profiles } from "../lib/profiles";
import { connectionPing, providerModels, type ConnectionPingResult } from "../lib/api";
import { checkAppVersion } from "../lib/update-check";
import { useApkDownload } from "../lib/use-apk-download";
import { ApkDownloadOverlay } from "../components/ApkDownloadOverlay";
import { InfoIcon, ChevronRightIcon, RefreshIcon } from "../components/icons";

export default function SettingsScreen() {
  const router = useRouter();
  const systemScheme = useColorScheme();
  const themeMode = useStore((s) => s.themeMode);
  const setThemeMode = useStore((s) => s.setThemeMode);
  const locale = useStore((s) => s.locale);
  const setLocaleStore = useStore((s) => s.setLocale);
  const currentProfileKey = useStore((s) => s.currentProfileKey);
  const setCurrentProfile = useStore((s) => s.setCurrentProfile);
  const serverConfig = useStore((s) => s.serverConfig);
  const customProvider = useStore((s) => s.customProvider);
  const setCustomProvider = useStore((s) => s.setCustomProvider);
  const profile = useStore((s) => s.getCurrentProfile());
  const otaUpdateReady = useStore((s) => s.otaUpdateReady);
  const apkUpdateAvailable = useStore((s) => s.apkUpdateAvailable);
  const setApkUpdateAvailable = useStore((s) => s.setApkUpdateAvailable);
  const setOtaUpdateReady = useStore((s) => s.setOtaUpdateReady);

  const [ping, setPing] = useState<ConnectionPingResult | null>(null);
  // 拉取自定义接口模型列表时的 loading 状态
  const [fetchingModels, setFetchingModels] = useState(false);
  // 手动检查更新时的 loading 状态
  const [checking, setChecking] = useState(false);

  // APK 应用内下载（替代浏览器 Linking.openURL）
  const { downloading, progress, download } = useApkDownload();

  const mode = resolveThemeMode(themeMode, systemScheme);
  const theme = getTheme(mode, profile.themeColor);

  useEffect(() => {
    connectionPing().then(setPing);
  }, []);

  // 获取自定义接口可用模型列表（对应 web 端「获取可用模型」按钮）
  // 调用服务端代理 /api/provider/models，由服务端处理协议差异
  const handleFetchModels = async () => {
    if (!customProvider.baseUrl || !customProvider.apiKey) {
      Alert.alert("提示", "请先填写 Base URL 和 API Key");
      return;
    }
    setFetchingModels(true);
    try {
      const models = await providerModels(customProvider);
      if (models.length === 0) {
        Alert.alert("提示", "未获取到可用模型，请检查 Base URL 和 API Key 是否正确");
        return;
      }
      Alert.alert(
        "可用模型",
        `共 ${models.length} 个模型：\n${models.slice(0, 20).join("\n")}${models.length > 20 ? `\n... 等 ${models.length} 个` : ""}`,
        models.length > 0
          ? [
              { text: "取消", style: "cancel" },
              ...models.slice(0, 5).map((m) => ({
                text: `使用: ${m.length > 18 ? m.slice(0, 15) + "..." : m}`,
                onPress: () => setCustomProvider({ model: m }),
              })),
            ]
          : [{ text: "好的" }]
      );
    } catch (err: any) {
      Alert.alert("获取失败", err?.message || "请稍后重试");
    } finally {
      setFetchingModels(false);
    }
  };

  // 手动检查更新：同时触发 OTA 热更新和 APK 整包更新检查
  // - OTA 有更新 → 下载 → 显示"重启生效"按钮 → 点击 reloadAsync
  // - APK 有更新 → Alert 弹窗显示 changelog + 立即下载 → 浏览器打开服务器代理 URL
  // - 都没有 → 提示"已是最新版本"
  const handleCheckUpdate = async () => {
    setChecking(true);
    try {
      const currentVersionCode = Constants.expoConfig?.android?.versionCode ?? 1;

      // 并行检查 OTA 与 APK
      const [otaUpdated, apkResult] = await Promise.all([
        (async () => {
          if (__DEV__) return false;
          try {
            const u = await Updates.checkForUpdateAsync();
            if (u.isAvailable) {
              await Updates.fetchUpdateAsync();
              setOtaUpdateReady(true);
              return true;
            }
          } catch {
            // __DEV__ 或无 expo-updates 配置时会抛错，忽略
          }
          return false;
        })(),
        checkAppVersion(currentVersionCode),
      ]);

      if (apkResult.hasUpdate && apkResult.apkDownloadUrl) {
        setApkUpdateAvailable(apkResult);
        // APK 优先（原生变更必须整包更新）：弹窗显示 changelog
        Alert.alert(
          apkResult.forceUpdate ? "必须更新" : "发现新版本",
          apkResult.changelog || `新版本 ${apkResult.latestVersion} 可用`,
          apkResult.forceUpdate
            ? [
                {
                  text: "立即下载",
                  onPress: () => download(apkResult.apkDownloadUrl!),
                },
              ]
            : [
                { text: "稍后", style: "cancel" },
                {
                  text: "立即下载",
                  onPress: () => download(apkResult.apkDownloadUrl!),
                },
              ]
        );
      } else if (otaUpdated) {
        // OTA 已下载：UI 会自动显示"重启生效"按钮，无需额外弹窗
        Alert.alert("更新已就绪", "热更新已下载，点击「重启生效」立即应用");
      } else {
        Alert.alert("已是最新", "当前已是最新版本");
      }
    } catch (err: any) {
      Alert.alert("检查失败", err?.message || "请稍后重试");
    } finally {
      setChecking(false);
    }
  };

  const locales = [
    { key: "zh-CN", label: "简体中文" },
    { key: "zh-HK", label: "繁體中文（港）" },
    { key: "zh-TW", label: "繁體中文（台）" },
  ];

  // 根据连通性结果派生展示信息：标签、徽标颜色、文字颜色
  const routeDisplay = deriveRouteDisplay(ping);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.page }]} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.text }]}>{t("settings")}</Text>
        <View style={{ width: 22 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={80}
      >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* ── 主题 ── */}
        <SectionLabel text="主题" theme={theme} />
        <View style={[styles.card, { backgroundColor: theme.panel }]}>
          {(["dark", "light", "system"] as const).map((m) => (
            <RadioRow
              key={m}
              label={m === "dark" ? "深色" : m === "light" ? "浅色" : "跟随系统"}
              selected={themeMode === m}
              onPress={() => setThemeMode(m)}
              theme={theme}
            />
          ))}
        </View>

        {/* ── 语言 ── */}
        <SectionLabel text="语言" theme={theme} />
        <View style={[styles.card, { backgroundColor: theme.panel }]}>
          {locales.map((l) => (
            <RadioRow
              key={l.key}
              label={l.label}
              selected={locale === l.key}
              onPress={() => { setLocaleStore(l.key); setLocale(l.key); }}
              theme={theme}
            />
          ))}
        </View>

        {/* ── 角色 ── */}
        <SectionLabel text={t("character")} theme={theme} />
        <View style={[styles.card, { backgroundColor: theme.panel }]}>
          {profiles.map((p) => (
            <TouchableOpacity
              key={p.key}
              style={styles.row}
              onPress={() => setCurrentProfile(p.key)}
            >
              <View style={styles.profileRow}>
                <Image
                  source={{ uri: p.avatar }}
                  style={styles.avatar}
                  contentFit="cover"
                  transition={200}
                  cachePolicy="memory-disk"
                />
                <Text style={[styles.rowText, { color: theme.text }]}>{p.name}</Text>
              </View>
              {currentProfileKey === p.key && <Ionicons name="checkmark" size={20} color={theme.brand} />}
            </TouchableOpacity>
          ))}
        </View>

        {/* ── 服务状态 ── */}
        <SectionLabel text={t("serviceStatus")} theme={theme} />
        <View style={[styles.card, { backgroundColor: theme.panel }]}>
          <View style={styles.row}>
            <Text style={[styles.rowText, { color: theme.text }]}>连通性</Text>
            {ping === null ? (
              <View style={[styles.statusBadge, { backgroundColor: "rgba(120,120,120,0.12)" }]}>
                <ActivityIndicator size="small" color={theme.muted} />
                <Text style={{ color: theme.muted, fontSize: 12, fontWeight: "600", marginLeft: 6 }}>
                  {t("routeChecking")}
                </Text>
              </View>
            ) : (
              <View style={[styles.statusBadge, { backgroundColor: routeDisplay.badgeBg }]}>
                <View style={[styles.statusDot, { backgroundColor: routeDisplay.dotColor }]} />
                <Text style={{ color: routeDisplay.textColor, fontSize: 12, fontWeight: "600", marginLeft: 6 }}>
                  {routeDisplay.label}
                </Text>
              </View>
            )}
          </View>
          {ping?.latencyMs != null && ping.reachable && (
            <View style={styles.row}>
              <Text style={[styles.rowText, { color: theme.text }]}>延迟</Text>
              <Text style={[styles.rowValue, { color: theme.muted }]}>{ping.latencyMs} ms</Text>
            </View>
          )}
        </View>

        {/* ── 关于（点击跳转到关于页面） ── */}
        <SectionLabel text="关于" theme={theme} />
        <TouchableOpacity
          style={[styles.card, { backgroundColor: theme.panel }]}
          onPress={() => router.push("/about")}
          activeOpacity={0.7}
        >
          <View style={styles.row}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <InfoIcon size={22} color={theme.brand} />
              <Text style={[styles.rowText, { color: theme.text }]}>YunoSeek</Text>
            </View>
            <ChevronRightIcon size={18} color={theme.muted} />
          </View>
        </TouchableOpacity>

        {/* 检查更新：OTA 热更新 + APK 整包更新 */}
        <TouchableOpacity
          style={[styles.card, { backgroundColor: theme.panel, marginTop: 8 }]}
          onPress={otaUpdateReady ? () => Updates.reloadAsync().catch(() => {}) : handleCheckUpdate}
          disabled={checking}
          activeOpacity={0.7}
        >
          <View style={styles.row}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <RefreshIcon size={22} color={theme.brand} />
              <Text style={[styles.rowText, { color: theme.text }]}>检查更新</Text>
            </View>
            {checking ? (
              <ActivityIndicator size="small" color={theme.muted} />
            ) : otaUpdateReady ? (
              <Text style={{ fontSize: 12, color: theme.brand, fontWeight: "600" }}>重启生效 →</Text>
            ) : apkUpdateAvailable?.hasUpdate ? (
              <Text style={{ fontSize: 12, color: theme.brand, fontWeight: "600" }}>新版本可用</Text>
            ) : (
              <Text style={{ fontSize: 12, color: theme.muted }}>已是最新</Text>
            )}
          </View>
        </TouchableOpacity>

        {/* ── 自定义 API ── */}
        <SectionLabel text="自定义 API" theme={theme} />
        <View style={[styles.card, { backgroundColor: theme.panel }]}>
          {/* 启用开关 */}
          <View style={styles.row}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[styles.rowText, { color: theme.text }]}>启用自定义接口</Text>
              <Text style={{ fontSize: 12, color: theme.muted, marginTop: 4, lineHeight: 16, flexWrap: "wrap" }}>
                启用后聊天请求将通过服务端代理转发到你配置的接口，绕过内置模型
              </Text>
            </View>
            <Switch
              value={customProvider.enabled}
              onValueChange={(v) => setCustomProvider({ enabled: v })}
              trackColor={{ false: "rgba(120,120,120,0.25)", true: `rgba(${theme.brandRgb},0.6)` }}
              thumbColor={customProvider.enabled ? theme.brand : "#f4f4f5"}
            />
          </View>

          {/* 协议选择 */}
          <View style={[styles.row, { justifyContent: "space-between" }]}>
            <Text style={[styles.rowText, { color: theme.text }]}>接口格式</Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {([
                { key: "openai", label: "OpenAI" },
                { key: "anthropic", label: "Anthropic" },
                { key: "gemini", label: "Gemini" },
              ] as const).map((p) => (
                <TouchableOpacity
                  key={p.key}
                  onPress={() => setCustomProvider({ protocol: p.key })}
                  style={[
                    styles.chip,
                    {
                      backgroundColor:
                        customProvider.protocol === p.key
                          ? `rgba(${theme.brandRgb},0.18)`
                          : "rgba(120,120,120,0.08)",
                      borderColor:
                        customProvider.protocol === p.key ? theme.brand : "transparent",
                    },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: "600",
                      color: customProvider.protocol === p.key ? theme.brand : theme.muted,
                    }}
                  >
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Base URL */}
          <View style={styles.fieldRow}>
            <Text style={[styles.fieldLabel, { color: theme.muted }]}>Base URL</Text>
            <TextInput
              style={[styles.fieldInput, { color: theme.text, borderColor: theme.line }]}
              value={customProvider.baseUrl}
              onChangeText={(v) => setCustomProvider({ baseUrl: v })}
              placeholder="https://api.example.com/v1"
              placeholderTextColor={theme.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              textContentType="URL"
            />
          </View>

          {/* API Key */}
          <View style={styles.fieldRow}>
            <Text style={[styles.fieldLabel, { color: theme.muted }]}>API Key</Text>
            <TextInput
              style={[styles.fieldInput, { color: theme.text, borderColor: theme.line }]}
              value={customProvider.apiKey}
              onChangeText={(v) => setCustomProvider({ apiKey: v })}
              placeholder="sk-..."
              placeholderTextColor={theme.muted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              textContentType="password"
            />
          </View>

          {/* 模型 + 获取可用模型按钮 */}
          <View style={styles.fieldRow}>
            <Text style={[styles.fieldLabel, { color: theme.muted }]}>模型</Text>
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
              <TextInput
                style={[
                  styles.fieldInput,
                  { flex: 1, color: theme.text, borderColor: theme.line },
                ]}
                value={customProvider.model}
                onChangeText={(v) => setCustomProvider({ model: v })}
                placeholder="gpt-4o / claude-3-5-sonnet / gemini-2.0-flash"
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[
                  styles.fetchBtn,
                  {
                    backgroundColor: `rgba(${theme.brandRgb},0.12)`,
                    borderColor: theme.brand,
                  },
                ]}
                onPress={handleFetchModels}
                disabled={fetchingModels}
                hitSlop={4}
              >
                {fetchingModels ? (
                  <ActivityIndicator size="small" color={theme.brand} />
                ) : (
                  <Text style={{ fontSize: 12, fontWeight: "600", color: theme.brand }}>
                    获取模型
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
      </KeyboardAvoidingView>
      <ApkDownloadOverlay visible={downloading} progress={progress} />
    </SafeAreaView>
  );
}

// ── 子组件 ──────────────────────────────────────────────
function SectionLabel({ text, theme }: { text: string; theme: ReturnType<typeof getTheme> }) {
  return <Text style={[styles.sectionLabel, { color: theme.muted }]}>{text}</Text>;
}

function RadioRow({
  label,
  selected,
  onPress,
  theme,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  theme: ReturnType<typeof getTheme>;
}) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <Text style={[styles.rowText, { color: theme.text }]}>{label}</Text>
      {selected && <Ionicons name="checkmark" size={20} color={theme.brand} />}
    </TouchableOpacity>
  );
}

// 把 ConnectionPingResult 转成展示信息：
// - 主路由（绿） / 备用路由（橙） / 通道中断（红，服务可达但路由 outage） / 未连接（灰红，服务不可达）
function deriveRouteDisplay(ping: ConnectionPingResult | null): {
  label: string;
  badgeBg: string;
  textColor: string;
  dotColor: string;
} {
  if (!ping) {
    return { label: t("routeChecking"), badgeBg: "rgba(120,120,120,0.12)", textColor: "#9ca3af", dotColor: "#9ca3af" };
  }
  if (!ping.reachable) {
    // 服务不可达
    if (ping.route === "outage") {
      // 服务可达但路由 outage：算"通道中断"
      return { label: t("routeOutage"), badgeBg: "rgba(239,68,68,0.15)", textColor: "#ef4444", dotColor: "#ef4444" };
    }
    return { label: t("disconnected"), badgeBg: "rgba(239,68,68,0.15)", textColor: "#ef4444", dotColor: "#ef4444" };
  }
  // reachable=true
  if (ping.route === "primary") {
    return { label: t("routePrimary"), badgeBg: "rgba(74,222,128,0.15)", textColor: "#4ade80", dotColor: "#4ade80" };
  }
  if (ping.route === "fallback") {
    return { label: t("routeFallback"), badgeBg: "rgba(251,191,36,0.18)", textColor: "#f59e0b", dotColor: "#f59e0b" };
  }
  if (ping.route === "outage") {
    return { label: t("routeOutage"), badgeBg: "rgba(239,68,68,0.15)", textColor: "#ef4444", dotColor: "#ef4444" };
  }
  // 路由头未返回，但服务可达
  return { label: t("connected"), badgeBg: "rgba(74,222,128,0.15)", textColor: "#4ade80", dotColor: "#4ade80" };
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { fontSize: 17, fontWeight: "600" },
  content: { padding: 16 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 8,
    marginTop: 18,
    textTransform: "uppercase",
  },
  card: { borderRadius: 14, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowText: { fontSize: 15 },
  rowValue: { fontSize: 14, maxWidth: 180 },
  profileRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(120,120,120,0.15)" },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  // 自定义 API 区块样式
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  fieldRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 6,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  fieldInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  fetchBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
});
