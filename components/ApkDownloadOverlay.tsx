// APK 下载进度遮罩：全屏 Modal + 进度条
// 由 useApkDownload hook 驱动，在 index.tsx 和 settings.tsx 中复用
import React from "react";
import { Modal, View, Text, ActivityIndicator, StyleSheet, useColorScheme } from "react-native";
import { useStore } from "../lib/store";
import { getTheme, resolveThemeMode } from "../lib/theme";

interface Props {
  visible: boolean;
  progress: number; // 0-1
}

export function ApkDownloadOverlay({ visible, progress }: Props) {
  const systemScheme = useColorScheme();
  const themeMode = useStore((s) => s.themeMode);
  const profile = useStore((s) => s.getCurrentProfile());
  const mode = resolveThemeMode(themeMode, systemScheme);
  const theme = getTheme(mode, profile.themeColor);
  const pct = Math.round(progress * 100);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: theme.panel }]}>
          <Text style={[styles.title, { color: theme.text }]}>正在下载更新</Text>
          <Text style={[styles.pct, { color: theme.brand }]}>{pct}%</Text>
          <View style={[styles.bar, { backgroundColor: "rgba(120,120,120,0.15)" }]}>
            <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: theme.brand }]} />
          </View>
          <ActivityIndicator size="small" color={theme.muted} style={{ marginTop: 14 }} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  card: {
    borderRadius: 16,
    padding: 24,
    width: 280,
    alignItems: "center",
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 16,
  },
  pct: {
    fontSize: 30,
    fontWeight: "700",
    marginBottom: 14,
  },
  bar: {
    width: "100%",
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  barFill: {
    height: 6,
    borderRadius: 3,
  },
});
