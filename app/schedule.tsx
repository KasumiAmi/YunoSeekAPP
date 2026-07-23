// 放送日程页
import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  useColorScheme,
  ActivityIndicator,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useStore } from "../lib/store";
import { getTheme, resolveThemeMode } from "../lib/theme";
import { t } from "../lib/i18n";
import { animeSchedule } from "../lib/api";
import { animeBroadcastState, nextScheduleEpisode, formatCountdown } from "../lib/anime-schedule-time";

interface Episode {
  number: number;
  titleZh?: string;
  titleJa?: string;
  airDate?: string;
  status?: string;
  staff?: string;
}

// 倒计时组件：每秒更新，格式与 web 端对齐 HH:MM:SS 或 Xd HH:MM:SS
function CountdownTimer({ targetMs, color }: { targetMs: number; color: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = targetMs - now;
  if (diff <= 0) return <Text style={[styles.countdownText, { color }]}>{t("aired")}</Text>;
  return <Text style={[styles.countdownText, { color }]}>{formatCountdown(diff)}</Text>;
}

export default function ScheduleScreen() {
  const router = useRouter();
  const systemScheme = useColorScheme();
  const themeMode = useStore((s) => s.themeMode);
  const locale = useStore((s) => s.locale);
  const profile = useStore((s) => s.getCurrentProfile());
  const mode = resolveThemeMode(themeMode, systemScheme);
  const theme = getTheme(mode, profile.themeColor);

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    animeSchedule()
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const episodes: Episode[] = data?.episodes || [];
  const now = new Date();

  // 使用与 web 端对齐的播出状态计算：基于首播日期 + 周数推算集数
  // 而非依赖 airDate（未来集数的 airDate 可能为空）
  const broadcastState = animeBroadcastState(now);
  const nextEp = nextScheduleEpisode(data, broadcastState);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.page }]} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.text }]}>{t("schedule")}</Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.brand} />
        </View>
      ) : !data ? (
        <View style={styles.center}>
          <Text style={{ color: theme.muted }}>—</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {/* 标题 */}
          <Text style={[styles.showTitle, { color: theme.text }]}>
            {data.title || data.originalTitle || "BanG Dream!"}
          </Text>
          {data.originalTitle && data.originalTitle !== data.title && (
            <Text style={[styles.showSub, { color: theme.muted }]}>{data.originalTitle}</Text>
          )}

          {/* 下一集倒计时 */}
          {nextEp && (
            <View style={[styles.nextCard, { backgroundColor: `rgba(${theme.brandRgb},0.1)`, borderColor: theme.brand }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.nextLabel, { color: theme.brand }]}>
                  {t("schedule")}: EP{nextEp.number}
                </Text>
                <Text style={[styles.nextTitle, { color: theme.text }]}>
                  {locale === "ja-JP" ? nextEp.titleJa : nextEp.titleZh || nextEp.titleJa}
                </Text>
                {nextEp.airDate ? (
                  <Text style={[styles.nextDate, { color: theme.muted }]}>
                    {new Date(nextEp.airDate).toLocaleDateString(locale === "ja-JP" ? "ja-JP" : "zh-CN", {
                      month: "long",
                      day: "numeric",
                      weekday: "short",
                    })}
                  </Text>
                ) : (
                  <Text style={[styles.nextDate, { color: theme.muted }]}>
                    {new Date(broadcastState.targetAt).toLocaleDateString(locale === "ja-JP" ? "ja-JP" : "zh-CN", {
                      month: "long",
                      day: "numeric",
                      weekday: "short",
                    })}
                  </Text>
                )}
              </View>
              <View style={styles.countdownWrap}>
                <Text style={[styles.countdownLabel, { color: theme.muted }]}>
                  {broadcastState.live ? "正在开播" : "开播倒计时"}
                </Text>
                {broadcastState.live ? (
                  <Text style={[styles.countdownText, { color: theme.brand }]}>ON AIR</Text>
                ) : (
                  <CountdownTimer targetMs={broadcastState.targetAt} color={theme.brand} />
                )}
              </View>
            </View>
          )}

          {/* 剧集列表 */}
          {episodes.map((ep) => {
            // 有 airDate 的按日期判断；无 airDate 的按集数判断（小于等于当前播出集数视为已播出）
            const aired = ep.airDate
              ? new Date(ep.airDate) <= now
              : nextEp ? ep.number < nextEp.number : false;
            return (
              <View
                key={ep.number}
                style={[styles.epRow, { opacity: aired ? 1 : 0.5 }]}
              >
                <View style={[styles.epNum, { backgroundColor: aired ? theme.brand : theme.line }]}>
                  <Text style={{ color: aired ? theme.brandContrast : theme.muted, fontSize: 12, fontWeight: "700" }}>
                    {ep.number}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.epTitle, { color: theme.text }]} numberOfLines={1}>
                    {locale === "ja-JP" ? ep.titleJa : ep.titleZh || ep.titleJa}
                  </Text>
                  {ep.airDate && (
                    <Text style={[styles.epDate, { color: theme.muted }]}>
                      {new Date(ep.airDate).toLocaleDateString(locale === "ja-JP" ? "ja-JP" : "zh-CN")}
                    </Text>
                  )}
                  {ep.staff && (
                    <Text style={[styles.epStaff, { color: theme.muted }]} numberOfLines={1}>
                      {typeof ep.staff === "string"
                        ? ep.staff
                        : Object.entries(ep.staff)
                            .filter(([, v]) => v)
                            .map(([k, v]) => `${k}: ${v}`)
                            .join(" / ")}
                    </Text>
                  )}
                </View>
                {aired && <Ionicons name="checkmark-circle" size={18} color={theme.brand} />}
              </View>
            );
          })}

          {/* 来源链接 */}
          {data.sourceUrls?.length > 0 && (
            <TouchableOpacity
              style={styles.sourceLink}
              onPress={() => Linking.openURL(data.sourceUrls[0]).catch(() => {})}
            >
              <Ionicons name="link-outline" size={14} color={theme.brand} />
              <Text style={{ color: theme.brand, fontSize: 13, marginLeft: 4 }}>来源</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}
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
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  content: { padding: 16 },
  showTitle: { fontSize: 20, fontWeight: "700" },
  showSub: { fontSize: 14, marginTop: 2 },
  nextCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginTop: 14,
    marginBottom: 14,
  },
  nextLabel: { fontSize: 12, fontWeight: "700", marginBottom: 4 },
  nextTitle: { fontSize: 16, fontWeight: "600" },
  nextDate: { fontSize: 13, marginTop: 4 },
  // 倒计时容器（nextCard 右侧）
  countdownWrap: {
    alignItems: "flex-end",
    marginLeft: 12,
    justifyContent: "center",
  },
  countdownLabel: { fontSize: 10, marginBottom: 2 },
  countdownText: { fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  epRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  epNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  epTitle: { fontSize: 14, fontWeight: "500" },
  epDate: { fontSize: 12, marginTop: 2 },
  epStaff: { fontSize: 11, marginTop: 1 },
  sourceLink: { flexDirection: "row", alignItems: "center", marginTop: 16 },
});
