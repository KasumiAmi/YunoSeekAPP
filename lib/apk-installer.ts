// APK 应用内下载 + 安装
// 替代之前的 Linking.openURL 浏览器下载方式
// 流程：expo-file-system 下载到 documentDirectory/apk_updates/ → FileProvider 生成 content:// URI → expo-intent-launcher 调起系统安装器
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { Platform } from "react-native";
import Constants from "expo-constants";

const APK_FILENAME = "yunoseek-update.apk";
const DOWNLOAD_DIR = `${FileSystem.documentDirectory}apk_updates/`;
const APK_PATH = `${DOWNLOAD_DIR}${APK_FILENAME}`;

export async function downloadAndInstallApk(
  url: string,
  onProgress?: (pct: number) => void
): Promise<void> {
  if (Platform.OS !== "android") return;

  // 1. 确保目录存在
  const dirInfo = await FileSystem.getInfoAsync(DOWNLOAD_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(DOWNLOAD_DIR, { intermediates: true });
  }

  // 2. 删除旧 APK（如果存在）
  const oldInfo = await FileSystem.getInfoAsync(APK_PATH);
  if (oldInfo.exists) {
    await FileSystem.deleteAsync(APK_PATH);
  }

  // 3. 下载 APK（createDownloadResumable 支持进度回调）
  const downloadResumable = FileSystem.createDownloadResumable(
    url,
    APK_PATH,
    {},
    (progress) => {
      if (onProgress && progress.totalBytesExpectedToWrite > 0) {
        onProgress(progress.totalBytesWritten / progress.totalBytesExpectedToWrite);
      }
    }
  );

  const result = await downloadResumable.downloadAsync();
  if (!result || result.status !== 200) {
    throw new Error(`下载失败: HTTP ${result?.status ?? "unknown"}`);
  }

  // 4. 构造 content:// URI
  // FileProvider authority: ${applicationId}.apk.fileprovider（在 AndroidManifest.xml 中配置）
  // file_paths.xml: <files-path name="apk_updates" path="apk_updates/" />
  // <files-path> 对应 Context.getFilesDir()，即 FileSystem.documentDirectory
  // 所以 content URI 路径为 /apk_updates/{filename}
  const packageName =
    Constants.expoConfig?.android?.package ?? "asia.ownbangdream.yunoseek";
  const contentUri = `content://${packageName}.apk.fileprovider/apk_updates/${APK_FILENAME}`;

  // 5. 调起系统安装器
  // flags: 1 = FLAG_GRANT_READ_URI_PERMISSION（授权安装器读取 content:// URI）
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    type: "application/vnd.android.package-archive",
    flags: 1,
  });
}
