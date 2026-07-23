// 角色资料 Modal：头像/声优照切换 + bio 信息 + 右下角立绘
import React, { useState } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  useColorScheme,
  ScrollView,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useStore } from "../lib/store";
import { getTheme, resolveThemeMode } from "../lib/theme";
import type { Profile } from "../lib/profiles";

interface Props {
  profile: Profile;
  visible: boolean;
  onClose: () => void;
}

export function ProfileModal({ profile, visible, onClose }: Props) {
  const systemScheme = useColorScheme();
  const themeMode = useStore((s) => s.themeMode);
  const mode = resolveThemeMode(themeMode, systemScheme);
  const theme = getTheme(mode, profile.themeColor);
  const [showSyu, setShowSyu] = useState(false);

  const imageUri = showSyu && profile.syu ? profile.syu : profile.avatar;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* 外层 View 容器：背景 TouchableOpacity（点击关闭）与卡片为兄弟节点 */}
      <View style={styles.overlay}>
        {/* 背景：点击关闭 */}
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        {/* 卡片：自身是 View，内含 ScrollView 可正常滚动 */}
        <View style={[styles.card, { backgroundColor: theme.panel }]}>
          {/* 右下角角色立绘（装饰） */}
          <Image
            source={{ uri: profile.backgroundImage }}
            style={styles.illustration}
            contentFit="contain"
            transition={300}
          />

          {/* 关闭按钮 */}
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={theme.muted} />
          </TouchableOpacity>

          <ScrollView contentContainerStyle={styles.cardContent} showsVerticalScrollIndicator={false} nestedScrollEnabled>
            {/* 角色图 */}
            <Image source={{ uri: imageUri }} style={[styles.avatar, { borderColor: profile.themeColor }]} />

            {/* 声优照切换 */}
            {profile.syu && (
              <TouchableOpacity
                style={[styles.syuToggle, { backgroundColor: `rgba(${theme.brandRgb},0.12)` }]}
                onPress={() => { setShowSyu(!showSyu); Haptics.selectionAsync(); }}
              >
                <Ionicons name="swap-horizontal-outline" size={14} color={theme.brand} />
                <Text style={{ color: theme.brand, fontSize: 12, marginLeft: 4 }}>
                  {showSyu ? "角色照" : "声优照"}
                </Text>
              </TouchableOpacity>
            )}

            {/* 名字 */}
            <Text style={[styles.name, { color: theme.text }]}>{profile.name}</Text>

            {/* Bio */}
            <BioRow label="定位" value={profile.bio.role} theme={theme} />
            <BioRow label="花语" value={profile.bio.tagline} theme={theme} />
            <BioRow label="简介" value={profile.bio.meta} theme={theme} />
            {profile.bio.likes ? <BioRow label="喜好" value={profile.bio.likes} theme={theme} /> : null}
            {profile.bio.trivia ? <BioRow label="轶事" value={profile.bio.trivia} theme={theme} /> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function BioRow({ label, value, theme }: { label: string; value: string; theme: ReturnType<typeof getTheme> }) {
  if (!value) return null;
  return (
    <View style={styles.bioRow}>
      <Text style={[styles.bioLabel, { color: theme.brand }]}>{label}</Text>
      <Text style={[styles.bioValue, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxHeight: "80%",
    borderRadius: 22,
    overflow: "hidden",
  },
  illustration: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 180,
    height: 260,
    opacity: 0.2,
  },
  closeBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    zIndex: 10,
    padding: 4,
  },
  cardContent: {
    alignItems: "center",
    padding: 24,
    paddingTop: 20,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    marginBottom: 8,
  },
  syuToggle: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    marginBottom: 12,
  },
  name: {
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 16,
  },
  bioRow: {
    width: "100%",
    marginBottom: 10,
    zIndex: 1,
  },
  bioLabel: {
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 2,
  },
  bioValue: {
    fontSize: 14,
    lineHeight: 20,
  },
});
