// 关于页：版本信息 / 构建时间 / 开源许可 / B 站主页
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useColorScheme,
  ScrollView,
  Linking,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { useStore } from "../lib/store";
import { getTheme, resolveThemeMode } from "../lib/theme";
import { BUILD_TIME } from "../lib/build-info";
import {
  InfoIcon,
  ClockIcon,
  ScaleIcon,
  BilibiliIcon,
  ArrowLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
} from "../components/icons";

// B 站主页 URL
const BILIBILI_SPACE_URL = "https://space.bilibili.com/3546872008412039";
// B 站品牌粉
const BILIBILI_PINK = "#FB7299";

export default function AboutScreen() {
  const router = useRouter();
  const systemScheme = useColorScheme();
  const themeMode = useStore((s) => s.themeMode);
  const profile = useStore((s) => s.getCurrentProfile());

  const mode = resolveThemeMode(themeMode, systemScheme);
  const theme = getTheme(mode, profile.themeColor);

  // 版本号：app.json 中的 version
  const appVersion = Constants.expoConfig?.version ?? "1.0.1_0722";
  // 构建时间：由 scripts/gen-build-info.js 在构建前写入 lib/build-info.ts
  // 直接内联到 bundle，不依赖环境变量或 expo-updates（release 模式下不可靠）
  const buildTimeStr = BUILD_TIME > 0
    ? new Date(BUILD_TIME).toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "未知";

  // 打开 B 站主页：Linking.openURL 会触发系统选择面板，
  // 已注册 space.bilibili.com scheme 的哔哩哔哩客户端会出现在选择列表中
  const openBilibili = async () => {
    try {
      await Linking.openURL(BILIBILI_SPACE_URL);
    } catch {
      // 兜底：尝试用 https 打开浏览器
      try { await Linking.openURL(BILIBILI_SPACE_URL); } catch {}
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.page }]} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <ArrowLeftIcon size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.text }]}>关于</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* 顶部 logo + 应用名 */}
        <View style={styles.logoSection}>
          <Image
            source={require("../assets/about-logo.png")}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={[styles.appName, { color: theme.text }]}>
            <Text style={{ color: theme.text }}>Yuno</Text>
            <Text style={{ color: theme.brand }}>Seek</Text>
          </Text>
          <Text style={[styles.appTagline, { color: theme.muted }]}>不止由乃</Text>
        </View>

        {/* 信息卡片 */}
        <View style={[styles.card, { backgroundColor: theme.panel }]}>
          {/* 版本信息 */}
          <View style={[styles.row, styles.rowBorder, { borderBottomColor: theme.line }]}>
            <View style={styles.rowLeft}>
              <InfoIcon size={20} color={theme.brand} />
              <Text style={[styles.rowText, { color: theme.text }]}>版本</Text>
            </View>
            <Text style={[styles.rowValue, { color: theme.muted }]}>v{appVersion}</Text>
          </View>

          {/* 构建时间 */}
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <ClockIcon size={20} color={theme.brand} />
              <Text style={[styles.rowText, { color: theme.text }]}>构建时间</Text>
            </View>
            <Text style={[styles.rowValue, { color: theme.muted }]}>{buildTimeStr}</Text>
          </View>
        </View>

        {/* 跳转类项 */}
        <View style={[styles.card, { backgroundColor: theme.panel, marginTop: 12 }]}>
          {/* 开源许可 */}
          <TouchableOpacity
            style={[styles.row, styles.rowBorder, { borderBottomColor: theme.line }]}
            onPress={() => router.push("/licenses")}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <ScaleIcon size={20} color={theme.brand} />
              <Text style={[styles.rowText, { color: theme.text }]}>开放源代码许可</Text>
            </View>
            <ChevronRightIcon size={18} color={theme.muted} />
          </TouchableOpacity>

          {/* B 站主页 */}
          <TouchableOpacity style={styles.row} onPress={openBilibili} activeOpacity={0.7}>
            <View style={styles.rowLeft}>
              {/* B 站真实 logo（来自 Simple Icons），颜色用 B 站品牌粉 */}
              <BilibiliIcon size={20} color={BILIBILI_PINK} />
              <Text style={[styles.rowText, { color: theme.text }]}>我的哔哩哔哩主页</Text>
            </View>
            <ExternalLinkIcon size={16} color={theme.muted} style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>

        {/* 版权声明 */}
        <Text style={[styles.copyright, { color: theme.muted }]}>
          © 2026 YunoSeek{"\n"}Made with 滴椎Yuno酱
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
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
  content: { padding: 16, paddingBottom: 40 },
  logoSection: {
    alignItems: "center",
    paddingVertical: 24,
  },
  logo: {
    width: 96,
    height: 96,
    borderRadius: 24,
    marginBottom: 12,
  },
  appName: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 4,
  },
  appTagline: { fontSize: 13 },
  card: {
    borderRadius: 14,
    overflow: "hidden",
    marginTop: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  rowText: { fontSize: 15 },
  rowValue: { fontSize: 13, maxWidth: 160 },
  copyright: {
    fontSize: 12,
    textAlign: "center",
    marginTop: 24,
    lineHeight: 18,
  },
});
