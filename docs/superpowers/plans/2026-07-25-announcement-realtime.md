# 公告实时刷新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 YunoSeekAPP 的公告功能支持 40s 轮询 + 前台刷新 + 持久化未读状态，无需重启即可感知新公告。

**Architecture:** 在 Zustand store 增加 announcement 切片（items + seenIdentity，仅 seenIdentity 持久化）；新建 `use-announcement` hook 封装轮询逻辑（镜像 handoff 同步模式）；重构 `AnnouncementBanner` 为纯消费组件，增加脉冲圆点 + 边缘辉光 + 紧凑模式视觉。

**Tech Stack:** Expo SDK 57, React Native 0.86, react-native-reanimated 3, zustand + persist (AsyncStorage), TypeScript。

**Spec:** [docs/superpowers/specs/2026-07-25-announcement-realtime-design.md](file:///c:/Users/Toyama%20Kasumi/Desktop/%20YunoSeekAPP/docs/superpowers/specs/2026-07-25-announcement-realtime-design.md)

**Backups:** `backup/2026-07-25-announcement-realtime/` (已 gitignore)

**Deviation from spec:** spec 说 `announcementIdentity` 放在 `lib/use-announcement.ts`，但 store 的 selector 也需要它——这会造成 store ↔ use-announcement 循环依赖。改为将 `AnnouncementItem` 接口 + `announcementIdentity` 函数定义在 `lib/store.ts`，`use-announcement.ts` 从 store 导入。无循环依赖，类型与 store 同位。

**Test infrastructure:** 项目无测试框架（无 jest/vitest，无 test 脚本）。验证方式：`npx tsc --noEmit` 类型检查 + `npx expo start` 手动验证。

---

## Task 1: 在 lib/store.ts 增加 announcement 切片

**Files:**
- Modify: `lib/store.ts` (多处插入)

本任务在 store 中增加：`AnnouncementItem` 接口、`announcementIdentity` 纯函数、3 个 state 字段、2 个 action、1 个派生 selector、partialize 持久化条目。

- [ ] **Step 1: 在 `interface State` 之前插入 `AnnouncementItem` 接口和 `announcementIdentity` 函数**

在 `lib/store.ts` 中找到 `interface State {`（约 266 行），在其**之前**插入：

```ts
// 公告条目（与服务端 /api/announcement 返回结构一致）
export interface AnnouncementItem {
  id?: string;
  title?: string;
  content?: string;
  level?: string;
  updatedAt?: number;
}

/**
 * 计算公告集合的 identity 字符串，用于未读比对。
 * 对齐 web 端 siteAnnouncementIdentity：任一条目的 id/title/content/level/updatedAt
 * 变化，或条目数量/顺序变化，都会产生不同的 identity。
 */
export function announcementIdentity(items: AnnouncementItem[]): string {
  return JSON.stringify(
    items.map((it) => ({
      id: it.id,
      title: it.title,
      content: it.content,
      level: it.level,
      updatedAt: it.updatedAt,
    }))
  );
}

```

- [ ] **Step 2: 在 `interface State` 中增加 announcement 字段**

找到 `interface State {` 内的 `handoffToken: string;`（约 288 行），在其**之后**插入：

```ts
  // 公告
  announcementItems: AnnouncementItem[];            // 运行时数据，不持久化
  announcementSeenIdentity: string;                 // 持久化：上次已读的 identity
  announcementLastFetchAt: number;                  // 运行时：上次成功 fetch 时间戳
```

- [ ] **Step 3: 在 `interface State` 中增加 action 签名**

找到 `setOtaUpdateReady: (ready: boolean) => void;`（约 321 行），在其**之后**插入：

```ts
  setAnnouncementItems: (items: AnnouncementItem[]) => void;
  markAnnouncementRead: (identity: string) => void;
```

- [ ] **Step 4: 在 create() 初始 state 中增加默认值**

找到 `otaUpdateReady: false,`（约 375 行），在其**之后**插入：

```ts
      announcementItems: [],
      announcementSeenIdentity: "",
      announcementLastFetchAt: 0,
```

- [ ] **Step 5: 在 create() 中增加 action 实现**

找到 `getCurrentProfile` 实现的结束（约 529 行）：

```ts
      getCurrentProfile: () => {
        const s = get();
        return profiles.find((p) => p.key === s.currentProfileKey) || profiles[0];
      },
```

在其**之后**、`})` 闭合之前插入：

```ts

      setAnnouncementItems: (items) =>
        set({
          announcementItems: items,
          announcementLastFetchAt: Date.now(),
        }),

      markAnnouncementRead: (identity) => {
        if (!identity) return;
        set({ announcementSeenIdentity: identity });
      },
```

- [ ] **Step 6: 在 partialize 中增加持久化条目**

找到 partialize 中的 `handoffToken: state.handoffToken,`（约 573 行），在其**之后**插入：

```ts
        announcementSeenIdentity: state.announcementSeenIdentity,
```

注意：仅持久化 `announcementSeenIdentity`，不持久化 `announcementItems`（避免缓存陈旧）和 `announcementLastFetchAt`（无意义）。

- [ ] **Step 7: 在文件末尾增加派生 selector**

找到文件末尾（约 577 行 `);`），在其**之后**追加：

```ts

// 派生 selector：公告是否有未读。
// items 为空时恒为 false；否则比对当前 identity 与已记录的 seenIdentity。
export const selectAnnouncementUnread = (s: State): boolean =>
  s.announcementItems.length > 0 &&
  announcementIdentity(s.announcementItems) !== s.announcementSeenIdentity;
```

- [ ] **Step 8: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误（如有，检查插入位置和逗号/分号）。

- [ ] **Step 9: 提交**

```bash
git add lib/store.ts
git commit -m "feat(store): add announcement slice with persisted seenIdentity"
```

---

## Task 2: 创建 lib/use-announcement.ts hook

**Files:**
- Create: `lib/use-announcement.ts`

新建 hook，封装 40s 递归轮询 + AppState 前台刷新 + inFlightRef 并发去重。结构镜像 `app/_layout.tsx` 的 handoff 同步（142-192 行）。

- [ ] **Step 1: 创建 lib/use-announcement.ts**

创建文件 `lib/use-announcement.ts`，完整内容：

```ts
// 公告实时刷新 hook：40s 递归轮询 + AppState 前台刷新 + inFlightRef 并发去重。
// 结构镜像 app/_layout.tsx 的 handoff 同步（142-192 行），但间隔为 40s（用户指定）。
// 组件通过 useStore selector 订阅 items/unread，本 hook 只负责启动轮询。
import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useStore, type AnnouncementItem } from "./store";
import { announcement } from "./api";

const POLL_INTERVAL_MS = 40_000; // 用户指定，略低于 web 的 30s

export function useAnnouncement(): void {
  const inFlightRef = useRef<Promise<void> | null>(null);

  const fetchAndApply = async (): Promise<void> => {
    // 并发去重：40s 间隔与 AppState 触发可能重叠
    if (inFlightRef.current) return inFlightRef.current;
    const p = (async () => {
      try {
        const res = await announcement();
        const list: AnnouncementItem[] = res?.announcements || (res ? [res] : []);
        if (list.length === 0) return; // 空响应不覆盖已有公告
        useStore.getState().setAnnouncementItems(list);
      } catch {
        // 静默失败，保留旧 items（与现有 .catch(() => {}) 一致）
      } finally {
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = p;
    return p;
  };

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    const schedule = (): void => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!active) return;
        // 仿 web visibilitychange 守卫：后台时不发请求
        if (AppState.currentState === "active") void fetchAndApply();
        schedule();
      }, POLL_INTERVAL_MS);
    };

    const sub = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (nextState === "active") void fetchAndApply();
    });

    // 首次拉取：立即触发（保留现有 mount 即拉的行为）
    void fetchAndApply();
    schedule();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, []);
}
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add lib/use-announcement.ts
git commit -m "feat(announcement): add useAnnouncement hook with 40s polling"
```

---

## Task 3: 在 lib/i18n.ts 增加 announcementNew 文案

**Files:**
- Modify: `lib/i18n.ts` (约 37 行后插入)

- [ ] **Step 1: 在 announcementUpdated 之后增加 announcementNew**

找到 `lib/i18n.ts` 中的 `announcementUpdated` 行（约 37 行）：

```ts
  announcementUpdated: { "zh-CN": "更新于 {time}", "zh-HK": "更新於 {time}", "zh-TW": "更新於 {time}", "ja-JP": "更新: {time}" },
```

在其**之后**插入：

```ts
  announcementNew: { "zh-CN": "新公告", "zh-HK": "新公告", "zh-TW": "新公告", "ja-JP": "新着" },
```

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add lib/i18n.ts
git commit -m "feat(i18n): add announcementNew key"
```

---

## Task 4: 重构 AnnouncementBanner 数据层

**Files:**
- Modify: `components/AnnouncementBanner.tsx`

本任务把组件从"自管 state + mount 即拉"改为"从 store 订阅 + hook 启动轮询 + 打开详情时 markRead"。视觉增强（脉冲圆点/辉光/紧凑模式）放在 Task 5。

- [ ] **Step 1: 更新 imports**

找到文件顶部的 imports（约 4-29 行），将：

```ts
import { useStore } from "../lib/store";
import { getTheme, resolveThemeMode } from "../lib/theme";
import { t } from "../lib/i18n";
import { announcement } from "../lib/api";
import { HtmlRenderer } from "./HtmlRenderer";
```

替换为（移除 `announcement` 导入，增加 `useAnnouncement`、`selectAnnouncementUnread`、`announcementIdentity`）：

```ts
import { useStore, selectAnnouncementUnread, announcementIdentity, type AnnouncementItem } from "../lib/store";
import { getTheme, resolveThemeMode } from "../lib/theme";
import { t } from "../lib/i18n";
import { useAnnouncement } from "../lib/use-announcement";
import { HtmlRenderer } from "./HtmlRenderer";
```

- [ ] **Step 2: 删除组件内 AnnouncementItem 接口定义**

找到组件内定义的（约 31-37 行）：

```ts
interface AnnouncementItem {
  id?: string;
  title?: string;
  content?: string;
  level?: string;
  updatedAt?: number;
}
```

整段删除（已从 store 导入）。

- [ ] **Step 3: 替换组件内的 items useState 和 fetch useEffect**

找到（约 99-116 行）：

```ts
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [appActive, setAppActive] = useState(true);
  const locale = useStore((s) => s.locale);

  // 轮播连续浮点索引（始终向前递增，避免 wrap-around 反向动画）
  const animatedIndex = useSharedValue(0);

  useEffect(() => {
    announcement()
      .then((res) => {
        const list = res?.announcements || (res ? [res] : []);
        if (list.length > 0) setItems(list);
      })
      .catch(() => {});
  }, []);
```

替换为（移除 items useState 和 fetch effect，增加 useAnnouncement 调用 + store 订阅 + unread）：

```ts
  const [dismissed, setDismissed] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [appActive, setAppActive] = useState(true);
  const locale = useStore((s) => s.locale);

  // 公告数据从 store 订阅；useAnnouncement 启动 40s 轮询 + 前台刷新
  const items = useStore((s) => s.announcementItems);
  const unread = useStore(selectAnnouncementUnread);
  useAnnouncement();

  // 轮播连续浮点索引（始终向前递增，避免 wrap-around 反向动画）
  const animatedIndex = useSharedValue(0);

  // 打开详情 Modal 时立即标记已读（对齐 web openAnnouncementDialog → markSiteAnnouncementRead）
  const openDetail = () => {
    setDetailVisible(true);
    const identity = announcementIdentity(items);
    if (identity) useStore.getState().markAnnouncementRead(identity);
  };
```

- [ ] **Step 4: 更新 banner 的 onPress 使用 openDetail**

找到 banner TouchableOpacity（约 154-157 行）：

```tsx
      <TouchableOpacity
        style={styles.banner}
        onPress={() => setDetailVisible(true)}
        activeOpacity={0.7}
      >
```

替换为：

```tsx
      <TouchableOpacity
        style={styles.banner}
        onPress={openDetail}
        activeOpacity={0.7}
      >
```

- [ ] **Step 5: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。如有 `useState` 未使用警告，保留 import（dismissed/detailVisible/activeIndex/appActive 仍用 useState）。

- [ ] **Step 6: 提交**

```bash
git add components/AnnouncementBanner.tsx
git commit -m "refactor(announcement): banner consumes store + useAnnouncement hook"
```

---

## Task 5: 为 Banner 增加未读视觉（脉冲圆点 + 辉光 + 紧凑模式）

**Files:**
- Modify: `components/AnnouncementBanner.tsx`

- [ ] **Step 1: 在 imports 中增加 withRepeat, withSequence**

找到 reanimated 的 import（约 17-24 行）：

```ts
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
  type SharedValue,
} from "react-native-reanimated";
```

替换为（增加 `withRepeat`、`withSequence`）：

```ts
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
  runOnJS,
  type SharedValue,
} from "react-native-reanimated";
```

- [ ] **Step 2: 在 RotatingItem 之前增加 UnreadDot 组件**

找到 `function RotatingItem({`（约 66 行），在其**之前**插入：

```tsx
// 未读脉冲圆点：megaphone 图标右上角，scale 1→1.4→1 + opacity 1→0.6→1 无限循环
function UnreadDot({ color }: { color: string }) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.4, { duration: 800, easing: Easing.bezier(0.4, 0, 0.6, 1) }),
        withTiming(1.0, { duration: 800, easing: Easing.bezier(0.4, 0, 0.6, 1) })
      ),
      -1,
      false
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.6, { duration: 800 }),
        withTiming(1.0, { duration: 800 })
      ),
      -1,
      false
    );
  }, []);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));
  return (
    <Animated.View
      style={[styles.unreadDot, { backgroundColor: color }, style]}
      pointerEvents="none"
    />
  );
}

```

- [ ] **Step 3: 在组件内增加辉光共享值和样式**

在 `AnnouncementBanner` 函数内，找到 `openDetail` 定义之后（Task 4 Step 3 插入的位置），插入：

```ts

  // 边缘辉光：unread 变化时 480ms 过渡（对齐用户偏好的 480ms 过渡时长）
  const glow = useSharedValue(0);
  useEffect(() => {
    glow.value = withTiming(unread ? 1 : 0, {
      duration: 480,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
    });
  }, [unread, glow]);
  const glowStyle = useAnimatedStyle(() => ({
    shadowColor: theme.brand,
    shadowRadius: glow.value * 8,
    shadowOpacity: glow.value * 0.4,
    shadowOffset: { width: 0, height: 0 },
    borderColor: theme.brand,
    borderWidth: glow.value, // 0 → 1
    elevation: glow.value * 4, // Android shadow
  }));
```

- [ ] **Step 4: 修改渲染逻辑，增加紧凑模式和辉光包裹**

找到（约 149 行）：

```tsx
  if (items.length === 0 || dismissed) return null;

  return (
    <>
      {/* 横幅（透明背景，与顶栏共享模糊/实色层，视觉一体化） */}
      <TouchableOpacity
        style={styles.banner}
        onPress={openDetail}
        activeOpacity={0.7}
      >
        <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
          <Ionicons name="megaphone-outline" size={15} color={theme.brand} style={{ marginRight: 8 }} />
```

替换为（增加紧凑模式分支 + Animated.View 辉光包裹 + megaphone 外层 View 加 position:relative + UnreadDot + accessibilityLabel）：

```tsx
  if (items.length === 0) return null;
  // dismissed 但有新公告：紧凑模式（仅图标 + 脉冲圆点）
  if (dismissed && !unread) return null;
  if (dismissed && unread) {
    return (
      <TouchableOpacity onPress={openDetail} style={styles.compactBanner} hitSlop={8}>
        <View style={{ position: "relative" }}>
          <Ionicons
            name="megaphone-outline"
            size={15}
            color={theme.brand}
            accessible
            accessibilityLabel={`${t("announcement")} · ${t("announcementNew")}`}
          />
          <UnreadDot color={theme.brand} />
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <>
      {/* 横幅（透明背景，与顶栏共享模糊/实色层，视觉一体化） */}
      <Animated.View style={[styles.banner, glowStyle]}>
        <TouchableOpacity onPress={openDetail} activeOpacity={0.7}>
          <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
            <View style={{ position: "relative", marginRight: 8 }}>
              <Ionicons
                name="megaphone-outline"
                size={15}
                color={theme.brand}
                accessible
                accessibilityLabel={unread ? `${t("announcement")} · ${t("announcementNew")}` : t("announcement")}
              />
              {unread ? <UnreadDot color={theme.brand} /> : null}
            </View>
```

注意：这里把原来的 `<Ionicons ... style={{ marginRight: 8 }} />` 改为用外层 `<View style={{ position: "relative", marginRight: 8 }}>` 包裹（去掉 Ionicons 的 marginRight）。

- [ ] **Step 5: 闭合 Animated.View**

找到 banner TouchableOpacity 的闭合（约 197 行）：

```tsx
        </TouchableOpacity>

      {/* 公告详情 Modal（支持 HTML 富媒体） */}
```

替换为（闭合 Animated.View 而非 TouchableOpacity）：

```tsx
        </TouchableOpacity>
      </Animated.View>

      {/* 公告详情 Modal（支持 HTML 富媒体） */}
```

注意缩进：原来的 `</TouchableOpacity>` 是 banner 的外层闭合，现在改为 `</TouchableOpacity></Animated.View>` 两层闭合。需确保内部 `<View style={{ flexDirection: "row"...}}>` 也正确闭合。完整结构应为：

```tsx
      <Animated.View style={[styles.banner, glowStyle]}>
        <TouchableOpacity onPress={openDetail} activeOpacity={0.7}>
          <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
            {/* ... megaphone + rotating text + dots + close ... */}
          </View>
        </TouchableOpacity>
      </Animated.View>
```

- [ ] **Step 6: 在 styles 中增加 unreadDot 和 compactBanner 样式**

找到 `const styles = StyleSheet.create({` 内的 `banner: {` 之前（约 234 行），插入：

```ts
  compactBanner: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 14,
  },
  unreadDot: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 6,
    height: 6,
    borderRadius: 3,
    zIndex: 2,
  },
```

- [ ] **Step 7: 类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 8: 提交**

```bash
git add components/AnnouncementBanner.tsx
git commit -m "feat(announcement): add pulse dot, edge glow, compact mode for unread"
```

---

## Task 6: 最终验证

- [ ] **Step 1: 全量类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误。

- [ ] **Step 2: 启动 Expo 验证运行时**

Run: `npx expo start`
Expected: 打包成功，无运行时错误。

- [ ] **Step 3: 手动验证清单**

按 spec 的集成测试清单验证（如能在模拟器/真机测试）：

1. 启动 app，banner 首次拉取立即显示。
2. 服务端修改公告，40s 内 banner 出现脉冲圆点 + 辉光。
3. App 切后台 10s，服务端修改公告，切回前台 banner 立即出现未读指示。
4. 打开详情 Modal，脉冲圆点 + 辉光立即消失。
5. Kill 重启，banner 不再显示未读指示（seenIdentity 已持久化）。
6. 服务端再次修改公告，banner 重新出现未读指示。
7. 点击 X 关闭 banner，40s 后服务端更新 → banner 以紧凑模式重新出现。
8. 网络断开时 banner 保持上次内容，无报错。

- [ ] **Step 4: 最终提交（如有遗留改动）**

```bash
git status
# 如有未提交改动：
git add -A
git commit -m "chore(announcement): final verification cleanup"
```

---

## Self-Review

**Spec coverage:**
- ✅ Zustand 切片 (state + actions + selector + partialize) → Task 1
- ✅ announcementIdentity 函数 → Task 1 Step 1 (移至 store.ts 避免循环依赖，已在 plan header 说明)
- ✅ useAnnouncement hook (40s 轮询 + AppState + inFlightRef) → Task 2
- ✅ i18n announcementNew → Task 3
- ✅ Banner 数据层重构 (store 订阅 + hook + markRead) → Task 4
- ✅ 脉冲圆点 UnreadDot → Task 5 Step 2
- ✅ 边缘辉光 (useSharedValue + 480ms) → Task 5 Step 3
- ✅ 紧凑模式 (dismissed && unread) → Task 5 Step 4
- ✅ 无障碍 accessibilityLabel → Task 5 Step 4
- ✅ 40s 间隔 → Task 2 (POLL_INTERVAL_MS = 40_000)
- ✅ 边界情况处理 (后台跳过、空响应不覆盖、并发去重) → Task 2 hook 代码

**Placeholder scan:** 无 TBD/TODO，所有步骤含完整代码。

**Type consistency:**
- `AnnouncementItem` 在 Task 1 定义，Task 2/4 导入 ✓
- `announcementIdentity` 在 Task 1 定义，Task 2/4 导入 ✓
- `selectAnnouncementUnread` 在 Task 1 定义，Task 4 导入 ✓
- `setAnnouncementItems(items: AnnouncementItem[])` Task 1 定义，Task 2 调用 ✓
- `markAnnouncementRead(identity: string)` Task 1 定义，Task 4 调用 ✓
- `useAnnouncement()` Task 2 定义，Task 4 调用 ✓
