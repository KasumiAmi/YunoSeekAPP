// 引继码页：创建/同步/恢复/轮转
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  useColorScheme,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useStore, flushPendingWrites, type Conversation, type Message } from "../lib/store";
import { getTheme, resolveThemeMode } from "../lib/theme";
import { t } from "../lib/i18n";
import { handoffCreate, handoffPull, handoffPush } from "../lib/api";
import { handoffDescriptionForProfile } from "../lib/profiles";

// sanitizeConversations 已移至 lib/store.ts（mergeConversations 内部使用，统一 sanitize + 合并）

export default function HandoffScreen() {
  const router = useRouter();
  const systemScheme = useColorScheme();
  const themeMode = useStore((s) => s.themeMode);
  const profile = useStore((s) => s.getCurrentProfile());
  const currentProfileKey = useStore((s) => s.currentProfileKey);
  const conversations = useStore((s) => s.conversations);
  const handoffToken = useStore((s) => s.handoffToken);
  const setHandoffToken = useStore((s) => s.setHandoffToken);
  const mergeConversations = useStore((s) => s.mergeConversations);
  const mode = resolveThemeMode(themeMode, systemScheme);
  const theme = getTheme(mode, profile.themeColor);

  const [inputToken, setInputToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  // 恢复确认弹窗：用应用内 Modal 替代原生 Alert.alert
  const [confirmRestore, setConfirmRestore] = useState(false);

  const handleRotate = async () => {
    setBusy(true);
    setStatus("");
    try {
      const res = await handoffCreate();
      setHandoffToken(res.token);
      await flushPendingWrites();
      setStatus("引继码已更换");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setStatus(e?.message || t("error"));
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!handoffToken) return;
    await Clipboard.setStringAsync(handoffToken);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStatus(t("copied"));
  };

  const handlePush = async () => {
    if (!handoffToken) return;
    setBusy(true);
    setStatus("");
    try {
      // 剥离 base64 后再推送：内存中的 conversations 包含 base64 图片数据，
      // 如果直接推送，服务端会存储大量 base64，拉回时会让内存暴涨甚至导致写入超限。
      const stripped = conversations.map((c) => ({
        ...c,
        messages: c.messages.map((m) => ({
          ...m,
          attachments: m.attachments?.map(({ base64: _b, ...rest }) => rest),
        })),
      }));
      const data = await handoffPush(handoffToken, {
        conversations: stripped,
        exportedAt: new Date().toISOString(),
      });
      // 服务端可能合并了其他设备 push 的新会话，本地也合并（双向同步）
      if (data?.conversations) {
        mergeConversations(data.conversations);
        await flushPendingWrites();
      }
      setStatus("已同步到云端");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setStatus(e?.message || t("error"));
    } finally {
      setBusy(false);
    }
  };

  // 点击"恢复"按钮：先弹应用内确认 Modal，确认后才真正拉取
  const handlePullClick = () => {
    const tk = inputToken.trim() || handoffToken;
    if (!tk) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setConfirmRestore(true);
  };

  const handlePullConfirm = async () => {
    const tk = inputToken.trim() || handoffToken;
    if (!tk) return;
    setConfirmRestore(false);
    setBusy(true);
    setStatus("");
    try {
      // 带上本地 conversations 让服务端做双向合并（不丢本地独有会话）。
      // 剥离 base64 避免上传大量图片数据。
      const stripped = conversations.map((c) => ({
        ...c,
        messages: c.messages.map((m) => ({
          ...m,
          attachments: m.attachments?.map(({ base64: _b, ...rest }) => rest),
        })),
      }));
      const data = await handoffPull(tk, { conversations: stripped });
      if (data?.conversations) {
        // mergeConversations 内部 sanitize + 按 ID 并集合并（updatedAt 优先）
        mergeConversations(data.conversations);
        // 恢复成功后把本地引继码更新为用户输入的引继码，
        // 后续同步会推送到同一个引继码，而非原先预分配的引继码
        if (tk !== handoffToken) {
          setHandoffToken(tk);
        }
        // 等待持久化写入完成后再显示"恢复成功"：
        // mergeConversations 和 setHandoffToken 各触发一次异步 setItem，
        // 如果用户在写入未完成时退出应用，数据可能未落盘 → 重启后丢失。
        // flushPendingWrites 等待写入队列清空，确保数据安全落盘。
        await flushPendingWrites();
        setStatus("恢复成功");
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setStatus("无数据");
      }
    } catch (e: any) {
      setStatus(e?.message || t("error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.page }]} edges={["top"]}>
      <View style={[styles.header, { borderBottomColor: theme.line }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.text }]}>{t("handoff")}</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* 角色专属说明文案（与 web 端 handoffDialogText 对齐，按当前角色切换） */}
        <Text style={[styles.description, { color: theme.muted }]}>
          {handoffDescriptionForProfile(currentProfileKey)}
        </Text>

        {/* 当前引继码 */}
        <Text style={[styles.label, { color: theme.muted }]}>当前引继码</Text>
        <View style={[styles.tokenBox, { backgroundColor: theme.panel, borderColor: theme.line }]}>
          {handoffToken ? (
            <TouchableOpacity onPress={handleCopy} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={[styles.tokenText, { color: theme.text }]} selectable>
                {handoffToken}
              </Text>
              <Ionicons name="copy-outline" size={16} color={theme.muted} />
            </TouchableOpacity>
          ) : (
            <Text style={{ color: theme.muted, fontSize: 14 }}>正在生成...</Text>
          )}
        </View>

        {/* 操作按钮 */}
        <View style={styles.btnRow}>
          <ActionBtn label={t("handoffRotate")} icon="refresh-outline" onPress={handleRotate} disabled={busy || !handoffToken} theme={theme} />
          <ActionBtn label={t("handoffSync")} icon="cloud-upload-outline" onPress={handlePush} disabled={busy || !handoffToken} theme={theme} />
        </View>

        {/* 恢复 */}
        <Text style={[styles.label, { color: theme.muted, marginTop: 24 }]}>从引继码恢复</Text>
        <TextInput
          style={[styles.input, { backgroundColor: theme.panel, color: theme.text, borderColor: theme.line }]}
          placeholder="输入引继码"
          placeholderTextColor={theme.muted}
          value={inputToken}
          onChangeText={setInputToken}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          style={[styles.restoreBtn, { backgroundColor: theme.brand, opacity: busy ? 0.5 : 1 }]}
          onPress={handlePullClick}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator size="small" color={theme.brandContrast} />
          ) : (
            <Text style={{ color: theme.brandContrast, fontSize: 15, fontWeight: "600" }}>
              {t("handoffRestore")}
            </Text>
          )}
        </TouchableOpacity>

        {/* 状态 */}
        {status ? (
          <Text style={[styles.status, { color: status.includes("成功") || status === t("copied") ? "#4ade80" : theme.muted }]}>
            {status}
          </Text>
        ) : null}
      </ScrollView>

      {/* 恢复确认 Modal：应用内样式，替代原生 Alert.alert */}
      <Modal visible={confirmRestore} transparent animationType="fade" onRequestClose={() => setConfirmRestore(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 }}>
          <View style={{ width: "100%", backgroundColor: theme.panel, borderRadius: 18, padding: 22, alignItems: "center" }}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: theme.text, marginBottom: 8 }}>{t("handoffRestore")}</Text>
            <Text style={{ fontSize: 14, color: theme.muted, textAlign: "center", marginBottom: 20 }}>
              将合并本地与云端的对话（不丢失本地独有会话），确定？
            </Text>
            <View style={{ flexDirection: "row", gap: 12, width: "100%" }}>
              <TouchableOpacity
                onPress={() => setConfirmRestore(false)}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.line, alignItems: "center" }}
              >
                <Text style={{ fontSize: 14, fontWeight: "600", color: theme.text }}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handlePullConfirm}
                style={{ flex: 1, paddingVertical: 12, borderRadius: 12, backgroundColor: "#ff5a65", alignItems: "center" }}
              >
                <Text style={{ fontSize: 14, fontWeight: "700", color: "#fff" }}>{t("handoffRestore")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ActionBtn({
  label,
  icon,
  onPress,
  disabled,
  theme,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
  theme: ReturnType<typeof getTheme>;
}) {
  return (
    <TouchableOpacity
      style={[styles.actionBtn, { backgroundColor: `rgba(${theme.brandRgb},0.12)`, opacity: disabled ? 0.4 : 1 }]}
      onPress={onPress}
      disabled={disabled}
    >
      <Ionicons name={icon} size={18} color={theme.brand} />
      <Text style={{ color: theme.brand, fontSize: 14, fontWeight: "500", marginLeft: 6 }}>{label}</Text>
    </TouchableOpacity>
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
    borderBottomWidth: 1,
  },
  title: { fontSize: 17, fontWeight: "600" },
  content: { padding: 16 },
  description: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  label: { fontSize: 13, fontWeight: "600", marginBottom: 8 },
  tokenBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  tokenText: { fontSize: 20, fontWeight: "700", letterSpacing: 2 },
  btnRow: { flexDirection: "row", gap: 10 },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 12,
  },
  restoreBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  status: { marginTop: 16, fontSize: 14, textAlign: "center" },
});
