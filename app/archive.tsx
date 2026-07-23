// 知识库归档页：分类 tab + 列表 + 详情 + 分页
import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  useColorScheme,
  ScrollView,
  StyleSheet,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useStore } from "../lib/store";
import { getTheme, resolveThemeMode } from "../lib/theme";
import { t } from "../lib/i18n";
import { archiveCatalog, archiveEntry } from "../lib/api";

const API_BASE = "https://yunoseek.ownbangdream.asia";

/** 相对路径图片加服务器前缀；处理 ./ico/... 和 /ico/... 两种格式 */
function resolveMediaUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  const clean = url.replace(/^\.\//, "/"); // ./ico/x.png → /ico/x.png
  return API_BASE + (clean.startsWith("/") ? clean : `/${clean}`);
}

interface ArchiveItem {
  id: string;
  title: string;
  type: string;
  spoilerLevel?: string;
  image?: string;
  excerpt?: string;
}

const FALLBACK_TYPES = ["character", "team", "world", "location", "plot"] as const;

export default function ArchiveScreen() {
  const router = useRouter();
  const systemScheme = useColorScheme();
  const themeMode = useStore((s) => s.themeMode);
  const locale = useStore((s) => s.locale);
  const profile = useStore((s) => s.getCurrentProfile());
  const mode = resolveThemeMode(themeMode, systemScheme);
  const theme = getTheme(mode, profile.themeColor);

  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [serverTypes, setServerTypes] = useState<string[] | null>(null);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

  // tab 列表：优先使用服务端返回的 types，否则 fallback 到硬编码
  const TABS: string[] = ["all", ...(serverTypes || FALLBACK_TYPES)];

  const fetchPage = useCallback(
    async (p: number, reset = false) => {
      setLoading(true);
      try {
        const res = await archiveCatalog({
          locale,
          type: typeFilter === "all" ? undefined : typeFilter,
          page: p,
        });
        if (Array.isArray(res?.types)) setServerTypes(res.types as string[]);
        const newItems: ArchiveItem[] = (res?.items || res?.entries || []).map((e: any) => ({
          id: e.id,
          title: e.title || e.name || "",
          type: e.type || "",
          spoilerLevel: e.spoilerLevel,
          image: resolveMediaUrl(e.image),
          excerpt: e.excerpt || e.summary || "",
        }));
        setItems((prev) => (reset ? newItems : [...prev, ...newItems]));
        setHasMore(newItems.length >= 24);
        setPage(p);
      } catch {
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    },
    [locale, typeFilter]
  );

  useEffect(() => {
    fetchPage(1, true);
  }, [fetchPage]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const entry = await archiveEntry(id, locale);
      setDetail(entry);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  // ── 详情视图 ──────────────────────────────────────────
  if (detail) {
    const contentStr: string = detail.content || detail.body || "";
    const paragraphs = contentStr
      ? contentStr
          .split(/\r?\n/)
          .map((p: string) => p.trim())
          .filter(Boolean)
      : detail.paragraphs || [];
    const detailImage = resolveMediaUrl(detail.image);
    const detailImgFailed = detail.id ? !!imgErrors[`detail:${detail.id}`] : false;
    const localeForDate = locale === "ja-JP" ? "ja-JP" : "zh-CN";
    const relatedItems: any[] = Array.isArray(detail.related) ? detail.related : [];

    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.page }} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setDetail(null)} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>
            {detail.title || detail.name}
          </Text>
          <View style={{ width: 22 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {/* 重度剧透警告横幅 */}
          {detail.spoilerLevel === "major" && (
            <View
              style={{
                backgroundColor: "rgba(239,68,68,0.12)",
                borderWidth: 1,
                borderColor: "rgba(239,68,68,0.3)",
                borderRadius: 10,
                padding: 10,
                marginBottom: 12,
                flexDirection: "row",
                alignItems: "center",
              }}
            >
              <Ionicons name="warning-outline" size={16} color="#ef4444" />
              <Text style={{ fontSize: 12, color: "#ef4444", marginLeft: 8, flex: 1 }}>
                {t("spoilerMajorWarn")}
              </Text>
            </View>
          )}

          {/* 详情大图（自然 16:9 容器 + contain 完整展示） */}
          {detailImage && !detailImgFailed ? (
            <Image
              source={{ uri: detailImage }}
              style={{
                width: "100%",
                aspectRatio: 16 / 9,
                borderRadius: 14,
                marginBottom: 12,
                backgroundColor: theme.panel,
              }}
              contentFit="contain"
              transition={300}
              cachePolicy="memory-disk"
              onError={() =>
                setImgErrors((prev) => ({ ...prev, [`detail:${detail.id}`]: true }))
              }
            />
          ) : (
            <View
              style={{
                width: "100%",
                aspectRatio: 16 / 9,
                borderRadius: 14,
                marginBottom: 12,
                backgroundColor:
                  mode === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Ionicons name="book-outline" size={40} color={theme.muted} />
            </View>
          )}

          {/* 标题 + 类型 + 剧透徽章 */}
          <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
            {detail.type && (
              <View
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderRadius: 6,
                  backgroundColor: `rgba(${theme.brandRgb},0.14)`,
                }}
              >
                <Text style={{ fontSize: 11, color: theme.brandReadable, fontWeight: "600" }}>
                  {t(detail.type) || detail.type}
                </Text>
              </View>
            )}
            {detail.spoilerLevel && detail.spoilerLevel !== "none" && (
              <View
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: 4,
                  backgroundColor:
                    detail.spoilerLevel === "major"
                      ? "rgba(239,68,68,0.18)"
                      : "rgba(245,158,11,0.18)",
                }}
              >
                <Text
                  style={{
                    color: detail.spoilerLevel === "major" ? "#ef4444" : "#f59e0b",
                    fontSize: 10,
                    fontWeight: "700",
                  }}
                >
                  {t("spoiler")}
                  {detail.spoilerLevel === "major" ? ` · ${t("spoilerMajor")}` : ""}
                </Text>
              </View>
            )}
          </View>

          {/* aliases 多语言别名 */}
          {Array.isArray(detail.aliases) && detail.aliases.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {detail.aliases.map((a: string, i: number) => (
                <View
                  key={i}
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 8,
                    backgroundColor: `rgba(${theme.brandRgb},0.10)`,
                    borderWidth: 1,
                    borderColor: `rgba(${theme.brandRgb},0.18)`,
                  }}
                >
                  <Text style={{ fontSize: 12, color: theme.brandReadable }}>{a}</Text>
                </View>
              ))}
            </View>
          )}

          {/* 最后更新时间 */}
          {typeof detail.updatedAt === "number" && (
            <Text style={{ fontSize: 12, color: theme.muted, marginBottom: 12 }}>
              {t("lastUpdated")}: {new Date(detail.updatedAt).toLocaleDateString(localeForDate)}
            </Text>
          )}

          {/* meta（保留兼容旧字段） */}
          {detail.meta && (
            <Text style={{ fontSize: 13, color: theme.muted, marginBottom: 12, lineHeight: 18 }}>
              {detail.meta}
            </Text>
          )}

          {/* 正文段落 */}
          {paragraphs.map((p: string, i: number) => (
            <Text
              key={i}
              style={{ fontSize: 15, lineHeight: 24, color: theme.text, marginBottom: 10 }}
            >
              {p}
            </Text>
          ))}

          {/* 相关条目水平滚动卡片 */}
          {relatedItems.length > 0 && (
            <View style={{ marginTop: 16 }}>
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "600",
                  color: theme.text,
                  marginBottom: 10,
                }}
              >
                {t("related")}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingRight: 16 }}
              >
                {relatedItems.map((r: any) => {
                  const rImg = resolveMediaUrl(r.image);
                  const rFailed = !!imgErrors[`list:${r.id}`];
                  return (
                    <TouchableOpacity
                      key={r.id}
                      style={{
                        width: 120,
                        marginRight: 10,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: theme.line,
                        backgroundColor: theme.panel,
                        overflow: "hidden",
                      }}
                      onPress={() => openDetail(r.id)}
                      activeOpacity={0.7}
                    >
                      {rImg && !rFailed ? (
                        <Image
                          source={{ uri: rImg }}
                          style={{
                            width: "100%",
                            height: 90,
                            backgroundColor:
                              mode === "dark"
                                ? "rgba(255,255,255,0.05)"
                                : "rgba(0,0,0,0.04)",
                          }}
                          contentFit="contain"
                          transition={200}
                          cachePolicy="memory-disk"
                          onError={() =>
                            setImgErrors((prev) => ({ ...prev, [`list:${r.id}`]: true }))
                          }
                        />
                      ) : (
                        <View
                          style={{
                            width: "100%",
                            height: 90,
                            backgroundColor:
                              mode === "dark"
                                ? "rgba(255,255,255,0.05)"
                                : "rgba(0,0,0,0.04)",
                            justifyContent: "center",
                            alignItems: "center",
                          }}
                        >
                          <Ionicons name="image-outline" size={22} color={theme.muted} />
                        </View>
                      )}
                      <View style={{ padding: 8 }}>
                        <Text
                          style={{ fontSize: 12, fontWeight: "500", color: theme.text }}
                          numberOfLines={2}
                        >
                          {r.title || r.name}
                        </Text>
                        {r.type && (
                          <Text style={{ fontSize: 10, color: theme.brand, marginTop: 2 }}>
                            {t(r.type) || r.type}
                          </Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── 列表视图 ──────────────────────────────────────────
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.page }} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>{t("archive")}</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* 分类 tab：外层固定高度容器，避免 ScrollView 高度被内容抖动 */}
      <View style={{ height: 56 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: 12,
            paddingVertical: 10,
            alignItems: "center",
          }}
        >
          {TABS.map((tp) => {
            const active = typeFilter === tp;
            return (
              <TouchableOpacity
                key={tp}
                style={{
                  paddingHorizontal: 18,
                  height: 36,
                  borderRadius: 18,
                  borderWidth: 1.5,
                  marginRight: 8,
                  backgroundColor: active ? `rgba(${theme.brandRgb},0.18)` : "transparent",
                  borderColor: active ? theme.brand : theme.line,
                  flexShrink: 0,
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onPress={() => setTypeFilter(tp)}
                activeOpacity={0.7}
              >
                <Text
                  style={{
                    color: active ? theme.brand : theme.muted,
                    fontSize: 14,
                    fontWeight: active ? "600" : "400",
                    lineHeight: 20,
                    textAlign: "center",
                    includeFontPadding: false,
                  }}
                  numberOfLines={1}
                >
                  {tp === "all" ? t("all") : t(tp)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* 列表 */}
      {loading && items.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" color={theme.brand} />
        </View>
      ) : items.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Text style={{ color: theme.muted }}>—</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }}
          renderItem={({ item }) => {
            const imgFailed = !!imgErrors[`list:${item.id}`];
            return (
              <TouchableOpacity
                style={{
                  flexDirection: "row",
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: theme.line,
                  backgroundColor: theme.panel,
                  marginBottom: 10,
                  overflow: "hidden",
                }}
                onPress={() => openDetail(item.id)}
                activeOpacity={0.7}
              >
                {item.image && !imgFailed ? (
                  <Image
                    source={{ uri: item.image }}
                    style={{
                      width: 64,
                      height: 64,
                      margin: 8,
                      borderRadius: 10,
                      backgroundColor:
                        mode === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
                    }}
                    contentFit="contain"
                    transition={200}
                    cachePolicy="memory-disk"
                    onError={() =>
                      setImgErrors((prev) => ({ ...prev, [`list:${item.id}`]: true }))
                    }
                  />
                ) : (
                  <View
                    style={{
                      width: 64,
                      height: 64,
                      margin: 8,
                      borderRadius: 10,
                      backgroundColor:
                        mode === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
                      justifyContent: "center",
                      alignItems: "center",
                    }}
                  >
                    <Ionicons name="image-outline" size={24} color={theme.muted} />
                  </View>
                )}
                <View style={{ flex: 1, paddingVertical: 10, paddingRight: 10, justifyContent: "center" }}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Text
                      style={{ fontSize: 15, fontWeight: "600", color: theme.text, flex: 1 }}
                      numberOfLines={2}
                    >
                      {item.title}
                    </Text>
                    {item.spoilerLevel && item.spoilerLevel !== "none" && (
                      <View
                        style={{
                          paddingHorizontal: 6,
                          paddingVertical: 2,
                          borderRadius: 4,
                          backgroundColor:
                            item.spoilerLevel === "major"
                              ? "rgba(239,68,68,0.18)"
                              : "rgba(245,158,11,0.18)",
                          marginLeft: 6,
                        }}
                      >
                        <Text
                          style={{
                            color: item.spoilerLevel === "major" ? "#ef4444" : "#f59e0b",
                            fontSize: 10,
                            fontWeight: "700",
                          }}
                        >
                          {t("spoiler")}
                          {item.spoilerLevel === "major" ? ` · ${t("spoilerMajor")}` : ""}
                        </Text>
                      </View>
                    )}
                  </View>
                  {item.excerpt ? (
                    <Text
                      style={{ fontSize: 12, color: theme.muted, marginTop: 3, lineHeight: 17 }}
                      numberOfLines={2}
                    >
                      {item.excerpt}
                    </Text>
                  ) : null}
                  <Text style={{ fontSize: 11, color: theme.brand, marginTop: 4, fontWeight: "500" }}>
                    {t(item.type) || item.type}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
          onEndReached={() => {
            if (hasMore && !loading) fetchPage(page + 1);
          }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            loading && items.length > 0 ? (
              <ActivityIndicator size="small" color={theme.brand} style={{ marginVertical: 16 }} />
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: { fontSize: 17, fontWeight: "600", flex: 1, textAlign: "center" },
});
