// 开源许可页：列出 YunoSeek 使用的开源依赖
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useColorScheme,
  ScrollView,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useStore } from "../lib/store";
import { getTheme, resolveThemeMode } from "../lib/theme";
import { ArrowLeftIcon, ExternalLinkIcon } from "../components/icons";

// 主要开源依赖及其许可信息
// 完整依赖列表见 package.json
interface LicenseItem {
  name: string;
  version: string;
  license: string;
  url: string;
}

const LICENSES: LicenseItem[] = [
  { name: "React Native", version: "0.86.0", license: "MIT", url: "https://github.com/facebook/react-native" },
  { name: "React", version: "19.2.3", license: "MIT", url: "https://github.com/facebook/react" },
  { name: "Expo", version: "57.0.7", license: "MIT", url: "https://github.com/expo/expo" },
  { name: "expo-router", version: "57.0.7", license: "MIT", url: "https://github.com/expo/expo/tree/main/packages/expo-router" },
  { name: "expo-blur", version: "57.0.2", license: "MIT", url: "https://github.com/expo/expo/tree/main/packages/expo-blur" },
  { name: "expo-image", version: "57.0.1", license: "MIT", url: "https://github.com/expo/expo/tree/main/packages/expo-image" },
  { name: "expo-linear-gradient", version: "57.0.1", license: "MIT", url: "https://github.com/expo/expo/tree/main/packages/expo-linear-gradient" },
  { name: "expo-haptics", version: "57.0.1", license: "MIT", url: "https://github.com/expo/expo/tree/main/packages/expo-haptics" },
  { name: "expo-clipboard", version: "57.0.1", license: "MIT", url: "https://github.com/expo/expo/tree/main/packages/expo-clipboard" },
  { name: "expo-file-system", version: "57.0.1", license: "MIT", url: "https://github.com/expo/expo/tree/main/packages/expo-file-system" },
  { name: "expo-image-picker", version: "57.0.5", license: "MIT", url: "https://github.com/expo/expo/tree/main/packages/expo-image-picker" },
  { name: "expo-status-bar", version: "57.0.1", license: "MIT", url: "https://github.com/expo/expo/tree/main/packages/expo-status-bar" },
  { name: "expo-linking", version: "57.0.3", license: "MIT", url: "https://github.com/expo/expo/tree/main/packages/expo-linking" },
  { name: "expo-network", version: "57.0.1", license: "MIT", url: "https://github.com/expo/expo/tree/main/packages/expo-network" },
  { name: "expo-constants", version: "57.0.6", license: "MIT", url: "https://github.com/expo/expo/tree/main/packages/expo-constants" },
  { name: "expo-updates", version: "57.0.8", license: "MIT", url: "https://github.com/expo/expo/tree/main/packages/expo-updates" },
  { name: "@react-native-async-storage/async-storage", version: "2.2.0", license: "MIT", url: "https://github.com/react-native-async-storage/async-storage" },
  { name: "react-native-reanimated", version: "4.5.0", license: "MIT", url: "https://github.com/software-mansion/react-native-reanimated" },
  { name: "react-native-worklets", version: "0.10.0", license: "MIT", url: "https://github.com/software-mansion/react-native-worklets" },
  { name: "react-native-gesture-handler", version: "2.32.0", license: "MIT", url: "https://github.com/software-mansion/react-native-gesture-handler" },
  { name: "react-native-screens", version: "4.25.2", license: "MIT", url: "https://github.com/software-mansion/react-native-screens" },
  { name: "react-native-safe-area-context", version: "5.7.0", license: "MIT", url: "https://github.com/th3rdwave/react-native-safe-area-context" },
  { name: "react-native-webview", version: "13.16.1", license: "MIT", url: "https://github.com/react-native-webview/react-native-webview" },
  { name: "react-native-markdown-display", version: "7.0.2", license: "MIT", url: "https://github.com/iamacup/react-native-markdown-display" },
  { name: "react-native-svg", version: "15.15.4", license: "MIT", url: "https://github.com/software-mansion/react-native-svg" },
  { name: "@expo/vector-icons", version: "15.1.1", license: "MIT", url: "https://github.com/expo/vector-icons" },
  { name: "moti", version: "0.30.0", license: "MIT", url: "https://github.com/nandorojo/moti" },
  { name: "zustand", version: "5.0.14", license: "MIT", url: "https://github.com/pmndrs/zustand" },
  { name: "punycode", version: "2.3.1", license: "MIT", url: "https://github.com/mathiasbynens/punycode.js" },
];

export default function LicensesScreen() {
  const router = useRouter();
  const systemScheme = useColorScheme();
  const themeMode = useStore((s) => s.themeMode);
  const profile = useStore((s) => s.getCurrentProfile());

  const mode = resolveThemeMode(themeMode, systemScheme);
  const theme = getTheme(mode, profile.themeColor);

  const openUrl = async (url: string) => {
    try { await Linking.openURL(url); } catch {}
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.page }]} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <ArrowLeftIcon size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.text }]}>开放源代码许可</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.intro, { color: theme.muted }]}>
          YunoSeek 基于以下开源项目构建，感谢开源社区的贡献。
        </Text>

        {LICENSES.map((item, index) => (
          <TouchableOpacity
            key={`${item.name}-${index}`}
            style={[
              styles.card,
              { backgroundColor: theme.panel },
              index > 0 && { marginTop: 8 },
            ]}
            onPress={() => openUrl(item.url)}
            activeOpacity={0.7}
          >
            <View style={styles.row}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.meta, { color: theme.muted }]} numberOfLines={1}>
                  v{item.version} · {item.license}
                </Text>
              </View>
              <ExternalLinkIcon size={16} color={theme.muted} />
            </View>
          </TouchableOpacity>
        ))}

        <Text style={[styles.footer, { color: theme.muted }]}>
          所有许可均为 MIT 协议。{"\n"}点击卡片可查看项目源码。
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
  intro: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  card: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  name: { fontSize: 14, fontWeight: "600" },
  meta: { fontSize: 12, marginTop: 2 },
  footer: {
    fontSize: 12,
    textAlign: "center",
    marginTop: 20,
    lineHeight: 18,
  },
});
