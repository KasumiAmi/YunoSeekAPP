// 跳过版本持久化：用户在启动自动弹窗点"稍后"时记录版本号，
// 下次启动不再主动弹该版本（手动检查更新仍会显示）。
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@apk_update_skipped_version";

export async function getSkippedVersion(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v && typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

export async function setSkippedVersion(version: string): Promise<void> {
  if (!version) return;
  try {
    await AsyncStorage.setItem(KEY, version);
  } catch {
    // 写入失败不影响主流程
  }
}

export async function clearSkippedVersion(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {}
}
