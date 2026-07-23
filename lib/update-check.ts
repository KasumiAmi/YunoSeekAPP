// APK 整包更新检查：通过现有服务器的 /api/apk/version 端点
// 服务器内部查询 GitHub Releases API 并缓存结果
// 客户端只与 yunoseek.ownbangdream.asia 通信，从不直连 GitHub
import { Platform } from "react-native";

const API_BASE = "https://yunoseek.ownbangdream.asia";
const VERSION_CHECK_URL = `${API_BASE}/api/apk/version`;

export interface VersionCheckResult {
  hasUpdate: boolean;
  latestVersion?: string;
  latestVersionCode?: number;
  apkDownloadUrl?: string; // 指向服务器代理端点，非 GitHub 直链
  changelog?: string;
  forceUpdate?: boolean;
  abi?: string; // 当前设备 ABI
}

// 读取当前设备主 ABI（Android 上 Platform.constants 含 abi 数组；iOS/其它平台兜底为 arm64-v8a）
function getDeviceAbi(): string {
  try {
    const constants = (Platform as any).constants;
    const abiList: string[] | undefined = constants?.abi;
    if (Array.isArray(abiList) && abiList.length > 0) {
      return abiList[0];
    }
  } catch {
    // 读取失败走默认值
  }
  return "arm64-v8a";
}

// 通过服务器代理端点检查是否有新版本 APK。
// currentVersionCode: 当前 APK 的 versionCode（来自 build.gradle 或 expoConfig）
export async function checkAppVersion(
  currentVersionCode: number
): Promise<VersionCheckResult> {
  try {
    const abi = getDeviceAbi();
    const res = await fetch(
      `${VERSION_CHECK_URL}?current=${currentVersionCode}&abi=${encodeURIComponent(abi)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return { hasUpdate: false };
    const data = await res.json();
    const latestVersionCode =
      typeof data?.latestVersionCode === "number" ? data.latestVersionCode : undefined;
    return {
      hasUpdate:
        typeof latestVersionCode === "number" && latestVersionCode > currentVersionCode,
      latestVersion: data?.latestVersion,
      latestVersionCode,
      // 下载 URL 指向服务器代理，不直连 GitHub
      apkDownloadUrl: `${API_BASE}/api/apk/download?abi=${encodeURIComponent(abi)}`,
      changelog: data?.changelog,
      forceUpdate: data?.forceUpdate === true,
      abi,
    };
  } catch {
    return { hasUpdate: false };
  }
}
