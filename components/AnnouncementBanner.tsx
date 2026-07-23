// 公告横幅：显示所有公告，支持 HTML 富媒体，可展开/关闭
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  StyleSheet,
  useColorScheme,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
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

export function AnnouncementBanner() {
  const systemScheme = useColorScheme();
  const themeMode = useStore((s) => s.themeMode);
  const profile = useStore((s) => s.getCurrentProfile());
  const mode = resolveThemeMode(themeMode, systemScheme);
  const theme = getTheme(mode, profile.themeColor);

  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const locale = useStore((s) => s.locale);

  useEffect(() => {
    announcement()
      .then((res) => {
        const list = res?.announcements || (res ? [res] : []);
        if (list.length > 0) setItems(list);
      })
      .catch(() => {});
  }, []);

  if (items.length === 0 || dismissed) return null;

  const latest = items[0];

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
          <Text style={[styles.bannerText, { color: theme.text }]} numberOfLines={1}>
            {latest.title || latest.content || t("announcement")}
          </Text>
          {items.length > 1 && (
            <View style={[styles.countBadge, { backgroundColor: theme.brand }]}>
              <Text style={{ color: theme.brandContrast, fontSize: 10, fontWeight: "700" }}>{items.length}</Text>
            </View>
          )}
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
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18 },
  countBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
    marginLeft: 6,
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
