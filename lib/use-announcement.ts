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
