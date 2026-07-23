// 根布局：expo-router Stack + 主题 + 安全区 + OTA 更新检查 + JS splash 过渡
import { useEffect, useState, Component, type ReactNode } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useColorScheme, Platform, AppState } from "react-native";
import * as Updates from "expo-updates";
import * as SplashScreen from "expo-splash-screen";
import Constants from "expo-constants";
import { useStore } from "../lib/store";
import { getTheme, resolveThemeMode } from "../lib/theme";
import { checkAppVersion } from "../lib/update-check";
import { handoffPull } from "../lib/api";
import { AppSplash } from "../components/AppSplash";

// 错误边界：AppSplash 渲染失败时降级为空，避免整个根布局白屏
class SplashErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    // 故意 console.warn 而不是 throw，让用户能看到根因
    console.warn("AppSplash render error:", error?.message ?? error);
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

export default function RootLayout() {
  const systemScheme = useColorScheme();
  const themeMode = useStore((s) => s.themeMode);
  const profile = useStore((s) => s.getCurrentProfile());

  const mode = resolveThemeMode(themeMode, systemScheme);
  const theme = getTheme(mode, profile.themeColor);

  // JS splash 控制位：原生 splash 隐藏后用 AppSplash 衔接一段过渡动画
  const [showSplash, setShowSplash] = useState(true);
  // hydration 状态：在 hydration 完成前不渲染 Stack，
  // 避免 index.tsx 的 useEffect 在 hydration 前执行导致数据被默认值覆盖
  const [hydrated, setHydrated] = useState(useStore.persist.hasHydrated());

  useEffect(() => {
    if (hydrated) {
      SplashScreen.hideAsync().catch(() => {});
      return;
    }
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    let unsub: (() => void) | undefined;

    const finish = () => {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(timeoutId);
      if (unsub) unsub();
      setHydrated(true);
      SplashScreen.hideAsync().catch(() => {});
    };

    // 超时保护：5 秒后强制隐藏原生 splash（即使 hydration 失败也不卡死）。
    // 从 3s→5s：增大数据库到 50MB 后，首次 hydration 读取可能略慢。
    // 注：超时触发时 finish() 只设置 React 的 hydrated 状态（允许渲染 UI），
    // 不设置 store.ts 的 _hydrationSuccess 标志。因此即使超时后 UI 渲染了
    // 默认状态，safeAsyncStorage 仍会跳过所有 setItem，避免默认状态覆盖
    // 磁盘上可能残留的持久化数据。若 hydration 随后成功完成，
    // onRehydrateStorage 回调会设置 _hydrationSuccess=true 并更新 store 状态。
    timeoutId = setTimeout(() => {
      if (!useStore.persist.hasHydrated()) {
        console.warn("[hydration] 5s 超时，AsyncStorage hydration 仍未完成（写入保持阻断）");
      }
      finish();
    }, 5000);

    unsub = useStore.persist.onFinishHydration(finish);
    // 防竞态：注册回调后再次检查（如果 hydration 在 hasHydrated 和注册之间完成）
    if (useStore.persist.hasHydrated()) finish();

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      if (unsub) unsub();
    };
  }, [hydrated]);

  // 阻止原生 splash 自动隐藏（必须在模块顶层调用一次，但放在 useEffect 里也行）
  // 这里用 try/catch 防止 native module 未就绪时 reject
  useEffect(() => {
    SplashScreen.preventAutoHideAsync().catch(() => {});
  }, []);

  // OTA 热更新：启动后延迟 3s 静默检查
  // 延迟是为了避免与 AsyncStorage hydration 竞争 CPU；下载后不立即重启，
  // 标记 otaUpdateReady，下次启动 expo-updates 自动加载新 bundle，设置页提供手动重启
  useEffect(() => {
    if (__DEV__ || Platform.OS !== "android") return;
    const timer = setTimeout(async () => {
      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          await Updates.fetchUpdateAsync();
          useStore.getState().setOtaUpdateReady(true);
        }
      } catch {
        // 更新检查失败不影响正常使用
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  // APK 整包更新检查：延迟 5s 检查（比 OTA 更晚，优先级更低）
  useEffect(() => {
    if (__DEV__ || Platform.OS !== "android") return;
    const currentVersionCode = Constants.expoConfig?.android?.versionCode ?? 1;
    const timer = setTimeout(async () => {
      try {
        const result = await checkAppVersion(currentVersionCode);
        if (result.hasUpdate && result.apkDownloadUrl) {
          useStore.getState().setApkUpdateAvailable(result);
        }
      } catch {
        // 版本检查失败不影响正常使用
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  // 引继码自动同步：前台切换时立即拉取 + 60s 轮询。
  // pull 带上本地 conversations 让服务端做双向合并，mergeConversations 应用合并结果。
  // 与 web 端 visibilitychange + 定时轮询对齐。
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let initialTimer: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    const autoPull = async () => {
      const state = useStore.getState();
      const token = state.handoffToken;
      if (!token) return;
      // 剥离 base64 后发送本地 conversations（与 handoff.tsx handlePush 一致）
      const stripped = state.conversations.map((c) => ({
        ...c,
        messages: c.messages.map((m) => ({
          ...m,
          attachments: m.attachments?.map(({ base64: _b, ...rest }) => rest),
        })),
      }));
      try {
        const data = await handoffPull(token, { conversations: stripped });
        if (data?.conversations) {
          state.mergeConversations(data.conversations);
        }
      } catch {
        // 自动同步失败不影响正常使用
      }
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!active) return;
        autoPull();
        schedule();
      }, 60000);
    };

    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") autoPull();
    });

    // 启动后延迟 8s 首次拉取（避免与 hydration/OTA/APK 检查竞争）
    initialTimer = setTimeout(autoPull, 8000);
    schedule();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      if (initialTimer) clearTimeout(initialTimer);
      sub.remove();
    };
  }, []);

  // hydration 完成前不渲染 Stack：避免 index.tsx 的 useEffect 在读到持久化数据前就执行，
  // 导致 handoffCreate 等操作覆盖已持久化的引继码/对话历史
  if (!hydrated) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.page }}>
      <SafeAreaProvider>
        <StatusBar style={mode === "dark" ? "light" : "dark"} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.page },
            animation: "slide_from_right",
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="settings" options={{ animation: "slide_from_bottom" }} />
          <Stack.Screen name="about" />
          <Stack.Screen name="licenses" />
          <Stack.Screen name="archive" />
          <Stack.Screen name="schedule" />
          <Stack.Screen name="handoff" />
        </Stack>
        {/* JS splash 过渡层：原生 splash 隐藏后渲染，动画结束自动卸载。
            ErrorBoundary 兜底，渲染失败也不影响主界面。
            使用 RN 自带 Animated API（避免 moti 在 release 下死锁） */}
        {showSplash && (
          <SplashErrorBoundary>
            <AppSplash onDone={() => setShowSplash(false)} />
          </SplashErrorBoundary>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
