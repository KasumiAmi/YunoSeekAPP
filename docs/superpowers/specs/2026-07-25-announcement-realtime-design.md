# 公告实时刷新设计

**日期**: 2026-07-25
**状态**: 已批准，待评审
**范围**: YunoSeekAPP（Expo / React Native）客户端公告功能实时化

## 背景

当前 [components/AnnouncementBanner.tsx](file:///c:/Users/Toyama%20Kasumi/Desktop/%20YunoSeekAPP/components/AnnouncementBanner.tsx) 仅在组件 mount 时通过 `useEffect([], [])` 调用一次 [lib/api.ts](file:///c:/Users/Toyama%20Kasumi/Desktop/%20YunoSeekAPP/lib/api.ts) 的 `announcement()`，公告数据只保存在组件局部 `useState`，没有持久化、没有轮询、没有未读追踪。这导致：

1. 应用启动后无法感知服务端新公告，必须 kill 进程重启才能刷新。
2. 用户已读状态不持久化，每次重启 banner 都会重新出现。
3. 没有"未读"概念，所有公告视觉表现一致。

参考 web 项目 `deepseek-chat-local` 的实现：30 秒轮询 + `visibilitychange` 前台刷新 + `localStorage` identity 比对 + FAB 徽标。app 已有的 handoff 同步模式（[app/_layout.tsx](file:///c:/Users/Toyama%20Kasumi/Desktop/%20YunoSeekAPP/app/_layout.tsx) 142-192）也采用相同模式（60s + AppState 前台刷新）。

## 目标

- 公告更新在 40 秒内被客户端感知（用户指定间隔，略低于 web 的 30s 以减负）。
- App 切回前台立即刷新（对齐 web visibilitychange）。
- 未读状态持久化到 AsyncStorage，跨重启保留。
- 视觉上明确标识"有新公告"，符合用户偏好的辉光特效 + 重点阴影风格。
- 符合 app 现有 Zustand + persist 架构，不引入新状态管理库。

## 非目标

- 后端 `/api/announcement` 接口不变（已有 `cache-control: no-store`）。
- 不引入 SSE / WebSocket（web 项目本身也是轮询）。
- 不迁移到 FAB-style UI（保留现有 banner 形态）。
- 不做 per-item 已读追踪（与 web 一致，集合级 identity 比对）。
- 不引入 ETag / If-None-Match / 304 短路（web 也没有）。

## 架构

### 文件结构

| 文件 | 角色 | 改动类型 |
|---|---|---|
| [lib/store.ts](file:///c:/Users/Toyama%20Kasumi/Desktop/%20YunoSeekAPP/lib/store.ts) | 状态层 | 修改：增加 announcement 切片 |
| `lib/use-announcement.ts` | 逻辑层 | 新建：自定义 hook |
| [components/AnnouncementBanner.tsx](file:///c:/Users/Toyama%20Kasumi/Desktop/%20YunoSeekAPP/components/AnnouncementBanner.tsx) | 表现层 | 修改：改为纯消费组件 + 视觉增强 |
| [lib/i18n.ts](file:///c:/Users/Toyama%20Kasumi/Desktop/%20YunoSeekAPP/lib/i18n.ts) | 文案 | 修改：增加 `announcementNew` key |
| [lib/api.ts](file:///c:/Users/Toyama%20Kasumi/Desktop/%20YunoSeekAPP/lib/api.ts) | API | 不变 |

### 数据流

```
use-announcement hook (mount)
  ├─ 立即触发首次拉取（保留现有 mount 即拉的行为）
  ├─ 递归 setTimeout 40s → fetchAndApply()（避免重叠，对齐 handoff 模式）
  └─ AppState "active" → fetchAndApply()
         │
         ├─ 并发去重：inFlightRef（仿 web siteAnnouncementLoadPromise）
         ├─ fetch /api/announcement
         ├─ 规范化：res?.announcements || (res ? [res] : [])
         ├─ 计算 identity = announcementIdentity(list)
         ├─ store.setAnnouncementItems(list)
         └─ unread 派生 = (identity !== store.announcementSeenIdentity)

Banner 组件
  ├─ useAnnouncement() 启动轮询
  ├─ items   = useStore(announcementItems)
  ├─ unread  = useStore(announcementUnread)  // 派生 selector
  ├─ onPress → setDetailVisible(true) → markAnnouncementRead()
  └─ X 按钮 → setDismissed(true)（会话级，独立于 read 状态）
```

## 详细设计

### 1. Zustand 切片（lib/store.ts）

#### State 字段

```ts
interface AnnouncementItem {
  id?: string;
  title?: string;
  content?: string;
  level?: string;
  updatedAt?: number;
}

interface State {
  // ...existing fields...

  // 公告
  announcementItems: AnnouncementItem[];            // 运行时数据，不持久化
  announcementSeenIdentity: string;                 // 持久化：上次已读的 identity
  announcementLastFetchAt: number;                  // 运行时：上次成功 fetch 时间戳，用于调试
  // announcementUnread 为派生值，不存储；通过 selector 计算
}
```

#### Actions

```ts
interface State {
  // ...existing actions...

  setAnnouncementItems: (items: AnnouncementItem[]) => void;
  markAnnouncementRead: (identity: string) => void;
}
```

- `setAnnouncementItems`：写入 `announcementItems` 和 `announcementLastFetchAt = Date.now()`。identity 不作为参数传入——selector 会从 items 直接派生，避免冗余参数。
- `markAnnouncementRead`：写入 `announcementSeenIdentity = identity`。下次 selector 计算时 unread 即为 false。

#### Selector

```ts
// 派生 selector，组件中通过 useStore(selectAnnouncementUnread) 订阅
export const selectAnnouncementUnread = (s: State): boolean =>
  s.announcementItems.length > 0 &&
  announcementIdentity(s.announcementItems) !== s.announcementSeenIdentity;
```

#### partialize 持久化

在 [lib/store.ts](file:///c:/Users/Toyama%20Kasumi/Desktop/%20YunoSeekAPP/lib/store.ts) 544-574 行的 `partialize` 中增加：

```ts
announcementSeenIdentity: state.announcementSeenIdentity,
```

**仅持久化 seenIdentity**，不持久化 `announcementItems`（运行时拉取即可，避免缓存陈旧）和 `announcementLastFetchAt`（无意义）。

#### identity 函数

放在 `lib/use-announcement.ts` 中导出，供 store 的 selector 复用：

```ts
export function announcementIdentity(items: AnnouncementItem[]): string {
  return JSON.stringify(items.map((it) => ({
    id: it.id,
    title: it.title,
    content: it.content,
    level: it.level,
    updatedAt: it.updatedAt,
  })));
}
```

完全对齐 web `siteAnnouncementIdentity` 实现。

### 2. use-announcement hook（lib/use-announcement.ts，新建）

```ts
import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useStore } from "./store";
import { announcement } from "./api";

// AnnouncementItem 接口与 lib/store.ts 中定义一致
export interface AnnouncementItem {
  id?: string;
  title?: string;
  content?: string;
  level?: string;
  updatedAt?: number;
}

export function announcementIdentity(items: AnnouncementItem[]): string {
  return JSON.stringify(items.map((it) => ({
    id: it.id,
    title: it.title,
    content: it.content,
    level: it.level,
    updatedAt: it.updatedAt,
  })));
}

const POLL_INTERVAL_MS = 40_000;  // 用户指定，略低于 web 的 30s

export function useAnnouncement(): void {
  const inFlightRef = useRef<Promise<void> | null>(null);

  const fetchAndApply = async () => {
    // 并发去重：40s 间隔与 AppState 触发可能重叠
    if (inFlightRef.current) return inFlightRef.current;
    const p = (async () => {
      try {
        const res = await announcement();
        const list: AnnouncementItem[] = res?.announcements || (res ? [res] : []);
        if (list.length === 0) return;
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

    const schedule = () => {
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

关键点：
- **结构镜像 handoff 同步**（[app/_layout.tsx](file:///c:/Users/Toyama%20Kasumi/Desktop/%20YunoSeekAPP/app/_layout.tsx) 142-192），但间隔为 40s（用户指定）。
- **inFlightRef 并发去重**：仿 web `siteAnnouncementLoadPromise`。
- **直接读 `useStore.getState()`**：避免在 effect 闭包里订阅 store，effect 只跑一次。
- **不返回数据**：组件通过 `useStore` selector 订阅，hook 只负责启动轮询。
- **不在此处调用 markAnnouncementRead**：read 时机由 UI 交互决定（打开详情 Modal）。

### 3. Banner 组件改造（components/AnnouncementBanner.tsx）

#### 改动点

1. **删除**组件内的 `useEffect(() => { announcement()... }, [])`（109-116 行）。
2. **删除** `const [items, setItems] = useState<AnnouncementItem[]>([])`，改为从 store 订阅：
   ```ts
   const items = useStore((s) => s.announcementItems);
   const unread = useStore(selectAnnouncementUnread);
   ```
3. **调用** `useAnnouncement()` 启动轮询（放在组件顶部，与现有 `useEffect` 同位置）。
4. **markRead**：详情 Modal 打开时调用：
   ```ts
   const openDetail = () => {
     setDetailVisible(true);
     const identity = announcementIdentity(items);
     if (identity) useStore.getState().markAnnouncementRead(identity);
   };
   ```
   替换现有 `onPress={() => setDetailVisible(true)}` 为 `onPress={openDetail}`。
5. **保留** `dismissed` 会话级 state 和 X 按钮行为（不变）。

#### 视觉增强：未读指示

**A. megaphone 图标右上角脉冲圆点**

```tsx
// 新增子组件
function UnreadDot({ color }: { color: string }) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.4, { duration: 800, easing: Easing.bezier(0.4, 0, 0.6, 1) }),
        withTiming(1.0, { duration: 800, easing: Easing.bezier(0.4, 0, 0.6, 1) })
      ),
      -1, // infinite
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
      style={[
        styles.unreadDot,
        { backgroundColor: color },
        style,
      ]}
      pointerEvents="none"
    />
  );
}

// styles
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

放置位置：包裹 megaphone 图标的 `<View>` 加 `position: "relative"`，在图标后渲染 `<UnreadDot color={theme.brand} />`，仅 `unread && !dismissed` 时显示。

**B. banner 边缘辉光**

新增 `unread` 时附加的样式（480ms 过渡，对齐用户偏好的 480ms 过渡时长）。Reanimated 3 的 `useAnimatedStyle` 只在共享值变化时重跑 worklet，不能用 React prop 直接驱动——需用 `useSharedValue` + `useEffect` 监听 `unread` 变化并 `withTiming` 过渡：

```tsx
const glow = useSharedValue(0);  // 0 = 无辉光, 1 = 满辉光
useEffect(() => {
  glow.value = withTiming(unread ? 1 : 0, { duration: 480, easing: Easing.bezier(0.22, 1, 0.36, 1) });
}, [unread]);

const glowStyle = useAnimatedStyle(() => ({
  shadowColor: theme.brand,
  shadowRadius: glow.value * 8,
  shadowOpacity: glow.value * 0.4,
  shadowOffset: { width: 0, height: 0 },
  borderColor: theme.brand,
  borderWidth: glow.value,  // 0 → 1
}));

<Animated.View style={[styles.banner, glowStyle]}>
  <TouchableOpacity ...>...</TouchableOpacity>
</Animated.View>
```

采用外层 `Animated.View` 包裹的方式（不破坏现有 TouchableOpacity 行为，避免 `Animated.createAnimatedComponent` 包装）。

**C. dismissed 但有新公告时的紧凑模式**

当 `dismissed && unread && items.length > 0` 时，banner 不完全隐藏，而是渲染为紧凑模式：
- 仅显示 megaphone 图标 + 脉冲圆点（无文字、无圆点指示器、无 X 按钮）。
- 宽度自适应内容，点击重新打开详情 Modal 并 markRead。
- markRead 后 unread 变 false，紧凑模式消失，banner 完全隐藏。

```tsx
if (items.length === 0) return null;
if (dismissed && !unread) return null;

if (dismissed && unread) {
  // 紧凑模式
  return (
    <TouchableOpacity onPress={openDetail} style={styles.compactBanner}>
      <View style={{ position: "relative" }}>
        <Ionicons name="megaphone-outline" size={15} color={theme.brand} />
        <UnreadDot color={theme.brand} />
      </View>
    </TouchableOpacity>
  );
}
// 正常 banner 渲染（带辉光 + 脉冲圆点）
```

**D. 无障碍**

megaphone 图标的 `accessibilityLabel` 在 unread 时附加 `· ${t("announcementNew")}`：

```tsx
<Ionicons
  name="megaphone-outline"
  size={15}
  color={theme.brand}
  accessible
  accessibilityLabel={unread ? `${t("announcement")} · ${t("announcementNew")}` : t("announcement")}
/>
```

### 4. i18n 文案（lib/i18n.ts）

在 `announcement` / `announcementUpdated` 后增加：

```ts
announcementNew: {
  "zh-CN": "新公告",
  "zh-HK": "新公告",
  "zh-TW": "新公告",
  "ja-JP": "新着",
},
```

## 错误处理

| 场景 | 处理 |
|---|---|
| fetch 网络失败 | 静默 catch，保留旧 `announcementItems`，下次轮询重试 |
| fetch 返回非 ok | `announcement()` 已返回 `null`，list 为空，跳过 setAnnouncementItems |
| fetch 返回空 announcements 数组 | list.length === 0，跳过（不覆盖已有公告） |
| AsyncStorage 写入失败 | persist 中间件已有 try/catch（[lib/store.ts](file:///c:/Users/Toyama%20Kasumi/Desktop/%20YunoSeekAPP/lib/store.ts) 540-543），不影响运行时 |
| identity 计算异常 | JSON.stringify 不会抛出（输入为基本类型），无需额外保护 |

## 边界情况

- **App 启动时 hydration 未完成**：`AnnouncementBanner` 是 `app/index.tsx` 的子组件，而 `index.tsx` 在 `app/_layout.tsx` hydration 完成后才 mount（[app/_layout.tsx](file:///c:/Users/Toyama%20Kasumi/Desktop/%20YunoSeekAPP/app/_layout.tsx) 196-198 行 `if (!hydrated) return null`）。因此 hook 启动时 `announcementSeenIdentity` 已是持久化值，不会误判为 unread。
- **服务端公告被清空**：list.length === 0 时跳过 setAnnouncementItems，banner 保持上次的内容。这是有意的——避免服务端临时故障导致用户看到空 banner。下次服务端恢复后会自动更新。
- **40s 间隔与 AppState 同时触发**：inFlightRef 去重，只发一次请求。
- **用户在详情 Modal 打开期间服务端更新公告**：轮询继续运行，新公告进入 items，Modal 内 ScrollView 会因 items 变化重新渲染。markRead 已在打开时触发，所以 unread 仍为 false。用户关闭再打开不会重新触发 unread（identity 已记录）。**注意**：如果用户在 Modal 打开期间服务端更新，identity 变化但 seenIdentity 是旧的，unread 会变 true——这是合理行为，用户关闭 Modal 后再次打开会 markRead 新 identity。
- **App 长期后台**：递归 setTimeout 仍在跑，但回调内检查 `AppState.currentState === "active"`，非活跃时跳过 fetch（仿 web visibilitychange 守卫）。回前台时由 AppState "active" 监听立即触发一次 fetch，无需等下一个 40s。

## 测试

### 单元测试

1. **announcementIdentity**：
   - 相同输入 → 相同字符串
   - id / title / content / level / updatedAt 任一变化 → 不同字符串
   - 顺序变化 → 不同字符串（对齐 web）
   - 空数组 → `"[]"`

2. **selectAnnouncementUnread**：
   - items 为空 → false
   - items 非空且 identity !== seenIdentity → true
   - items 非空且 identity === seenIdentity → false

### 集成测试（手动）

1. 启动 app，观察 banner 首次拉取（应立即显示，无延迟）。
2. 服务端修改公告内容，40s 内 banner 出现脉冲圆点 + 辉光。
3. App 切后台 10s，服务端修改公告，App 切回前台，banner 立即出现未读指示。
4. 打开详情 Modal，脉冲圆点 + 辉光立即消失（unread → false）。
5. Kill app 重启，banner 不再显示未读指示（seenIdentity 已持久化）。
6. 服务端再次修改公告，banner 重新出现未读指示。
7. 点击 X 关闭 banner，40s 后服务端更新公告 → banner 以紧凑模式重新出现。
8. 网络断开时，banner 保持上次内容，无报错。

## 性能影响

- 40s 一次 `GET /api/announcement`，响应体通常 < 5KB，对流量/电量影响可忽略。
- inFlightRef 去重避免重复请求。
- AppState 非 active 时跳过轮询，省电。
- 派生 selector `selectAnnouncementUnread` 仅在 items 或 seenIdentity 变化时重算，O(n) where n = 公告数（通常 < 10）。
- 脉冲动画用 reanimated worklet，在 UI 线程运行，不阻塞 JS。

## 兼容性

- 不修改后端 API，与 web 端共用同一 `/api/announcement` 端点。
- 不修改 `app.json` / `build.gradle`（无版本号变化）。
- 已持久化的 Zustand state 在升级后自动合并：新字段 `announcementSeenIdentity` 初始为 `""`，首次启动时所有公告视为 unread（合理行为，用户首次看到未读指示是正常的）。
