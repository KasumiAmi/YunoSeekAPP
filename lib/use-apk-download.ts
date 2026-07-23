// APK 应用内下载 Hook：管理下载状态 + 进度 + 错误处理
// 供 app/index.tsx（启动弹窗）和 app/settings.tsx（手动检查更新）共用
import { useState, useCallback, useRef } from "react";
import { Alert, Platform } from "react-native";
import { downloadAndInstallApk } from "./apk-installer";

export function useApkDownload() {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const runningRef = useRef(false);

  const download = useCallback(async (url: string) => {
    if (Platform.OS !== "android") {
      Alert.alert("提示", "仅支持 Android 设备");
      return;
    }
    if (runningRef.current) return;
    runningRef.current = true;
    setDownloading(true);
    setProgress(0);
    try {
      await downloadAndInstallApk(url, (pct) => {
        setProgress(pct);
      });
      // 下载完成，系统安装器已自动弹出，隐藏进度遮罩
      setDownloading(false);
    } catch (err: any) {
      setDownloading(false);
      Alert.alert("下载失败", err?.message || "请稍后重试");
    } finally {
      runningRef.current = false;
    }
  }, []);

  return { downloading, progress, download };
}
