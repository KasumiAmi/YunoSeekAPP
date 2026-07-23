# YunoSeek

<p align="center">
  <img src="./assets/yunoseek-logo.png" alt="YunoSeek" width="120" />
</p>

<p align="center">
  <strong>YunoSeek</strong> · 基于 React Native (Expo) 的角色化 AI 聊天应用
</p>

<p align="center">
  <img alt="Expo SDK" src="https://img.shields.io/badge/Expo%20SDK-57-000020?logo=expo&logoColor=white" />
  <img alt="React Native" src="https://img.shields.io/badge/React%20Native-0.86-61DAFB?logo=react&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white" />
  <img alt="Platform" src="https://img.shields.io/badge/platform-Android-3DDC84?logo=android&logoColor=white" />
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue" />
</p>

---

YunoSeek 是 [YunoSeek网页版](https://yunoseek.ownbangdream.asia) 自托管后端的 React Native 原生客户端。已配置有 6 位BanG Dream! YUME∞MITA（喜报，这是梦限大）角色与 DeepSeek 风格的对话 UI 结合，提供流式响应、深度思考、联网搜索、图片识图、引继码同步、放送日程、知识库归档以及应用内 OTA / APK 自更新等完整功能。

**⚠️BanG Dream! ，BanG Dream! YUME∞MITA的所有权为Bushiroad所有**
<p align="center">
  <img src="./assets/arl.png" alt="阿拉蕾可爱捏" />
</p>

> 本仓库仅包含客户端代码。后端服务（Node.js `server.js`）独立部署，不在本仓库范围内。

## 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [构建与发布](#构建与发布)
- [OTA 与 APK 更新](#ota-与-apk-更新)
- [关键约定](#关键约定)
- [许可证](#许可证)
- [致谢](#致谢)

## 功能特性

- **6 位梦限大角色对话**　头像 / 立绘 / 主题色 / 声优资料完整内置，对话内可一键切换
- **流式 SSE 响应**　支持 `think` 深度思考折叠、`yuno-search` 联网搜索徽章与逐字渲染
- **图片识图**　调用 `expo-image-picker` 选图 / 拍照，`vision` 自动激活
- **DeepSeek 风格输入卡片**　胶囊状输入框、附件面板、思考强度 pill
- **沉浸式 overlay 布局**　顶栏 / 底栏浮于消息列表之上，毛玻璃 + 角色主题色覆盖
- **对话历史侧栏**　搜索、时间分组、用户卡片、长按弹出菜单、右滑手势呼出
- **重试多版本切换**　每次重新生成保留历史版本，可在 `‹ N/N ›` 之间切换
- **引继码双向同步**　拉取时带本地快照做服务端合并，前台切换 + 60s 轮询自动拉取
- **知识库归档 / 放送日程 / 公告横幅**　复用后端 API，HTML 富媒体 + spoilerLevel 三态化
- **应用内 APK 下载安装**　`expo-file-system` 流式下载 + `FileProvider` + 系统安装器，带进度遮罩
- **OTA 热更新**　基于 `expo-updates`，自托管 manifest / assets 端点

## 技术栈

| 类别 | 选型 |
|------|------|
| 框架 | Expo SDK 57 · React Native 0.86 · React 19 |
| 路由 | expo-router ~57.0.7（文件系统路由） |
| 状态管理 | Zustand ^5.0.14 + persist 中间件（AsyncStorage） |
| 动画 / 手势 | react-native-reanimated ^4.5.0 · react-native-gesture-handler ~2.32.0 · moti ^0.30.0 |
| 视觉 | expo-blur · expo-linear-gradient · expo-image |
| Markdown / 公式 / 代码高亮 | marked · KaTeX · highlight.js（构建时内联到 bundle） |
| 设备能力 | expo-haptics · expo-clipboard · expo-image-picker · expo-file-system · expo-intent-launcher · expo-network |
| 更新 | expo-updates ^57.0.8 + 自托管 manifest 端点 |
| 工具链 | TypeScript 6 · Babel (babel-preset-expo) · Metro |

## 项目结构

```
 YunoSeekAPP/
├── app/                         ← expo-router 页面
│   ├── _layout.tsx              ← 根布局（Stack + 主题 + 安全区 + OTA）
│   ├── index.tsx               ← 主聊天页（沉浸式 overlay + 流式 SSE + 欢迎页）
│   ├── about.tsx               ← 关于页
│   ├── settings.tsx            ← 设置页（主题 / 语言 / 角色 / 自定义 API / 检查更新）
│   ├── archive.tsx             ← 知识库归档
│   ├── schedule.tsx            ← 放送日程
│   ├── handoff.tsx             ← 引继码（pull / push / 自动同步）
│   └── licenses.tsx            ← 第三方许可证
├── components/
│   ├── ChatMessage.tsx         ← 消息（无气泡 assistant + reasoning 折叠 + 搜索徽章 + 重试多版本）
│   ├── Composer.tsx           ← DeepSeek 风格输入卡片 + pill + 附件面板
│   ├── ConversationView.tsx    ← 对话主体（WebView 渲染 + 流式 100ms 节流）
│   ├── ConversationSidebar.tsx ← 侧栏（搜索 + 时间分组 + 长按菜单 + 右滑手势）
│   ├── ProfileModal.tsx        ← 角色档案（立绘 + bio + 声优照切换）
│   ├── AnnouncementBanner.tsx  ← 公告横幅（毛玻璃 + HTML 富媒体）
│   ├── MarkdownRenderer.tsx   ← Markdown 渲染（代码块 / 暗色主题）
│   ├── HtmlRenderer.tsx        ← HTML 渲染（公告 / 归档详情）
│   ├── ApkDownloadOverlay.tsx  ← APK 下载进度遮罩
│   ├── AppSplash.tsx           ← 启动画面
│   ├── HamburgerIcon.tsx       ← 侧栏触发按钮
│   └── icons.tsx               ← 图标集合
├── lib/
│   ├── api.ts                  ← API 层（封装所有 /api/* 端点 + friendlyError）
│   ├── sse.ts                  ← SSE 流式解析（think 标签 + yuno-search 事件跨 chunk 缓冲）
│   ├── store.ts                ← Zustand store（对话 / 角色 / 设置 / 服务端配置 + mergeConversations）
│   ├── profiles.ts             ← 6 角色数据（与 web 端 app.js 一致）
│   ├── i18n.ts                 ← 4 语言本地化
│   ├── theme.ts                ← 主题系统（亮暗 + 角色主题色覆盖）
│   ├── apk-installer.ts        ← 应用内 APK 下载安装（FileProvider + IntentLauncher）
│   ├── use-apk-download.ts     ← APK 下载状态 Hook
│   ├── update-check.ts         ← OTA / APK 更新检查
│   ├── anime-schedule-time.ts  ← 放送日程时间工具
│   └── build-info.ts           ← 构建信息（时间戳）
├── scripts/
│   ├── gen-vendor.js           ← marked / KaTeX / highlight.js 内联生成器
│   ├── gen-icons.py            ← 图标批量生成
│   ├── gen-android-res.py      ← Android 资源生成
│   ├── gen-build-info.js       ← 构建信息生成
│   ├── ota-apk.js              ← 服务端 OTA + APK API（4 端点 + 镜像 fallback）
│   ├── patch-server.js         ← 幂等注入服务端路由
│   ├── publish-apk.js          ← GitHub Release 发布 + versionCode 嵌入
│   └── publish-ota.js          ← OTA 资源发布
├── assets/                      ← 图片 / 图标 / vendor 资源
├── memory/                      ← 项目开发日志（仅本地，已 .gitignore）
├── app.json                     ← Expo 配置
├── eas.json                     ← EAS Build 配置
├── build-android.ps1           ← Windows 本地 Release 构建脚本
├── index.ts                     ← RN 入口
├── metro.config.js
├── tsconfig.json
└── package.json
```

## 快速开始

### 环境要求

- Node.js ≥ 20
- Android Studio（含 JDK 21，RN 0.86 兼容版本）
- Android SDK Platform 36 + Build-Tools
- Expo CLI：`npm install -g eas-cli`
- 已部署的 YunoSeek 后端（默认 `https://yunoseek.ownbangdream.asia`）

### 安装

```bash
git clone <repo-url>  YunoSeekAPP
cd  YunoSeekAPP
npm install
```

### 本地开发

```bash
npm start            # Expo Dev Server
npm run android      # 直接编译到已连接设备 / 模拟器
```

> 默认连接 Expo Go。若涉及原生模块（expo-blur 毛玻璃、FileProvider、IntentLauncher），需用 `npm run android` 编译 development client。

### 自定义 API 地址

后端地址在 [lib/api.ts](lib/api.ts) 顶部 `API_BASE` 硬编码（RN 无同源概念）。如需切换到本地后端，修改该常量即可，或通过设置页的「自定义 API」开关覆盖。

## 构建与发布

### 本地 Release 编译（Windows）

```powershell
powershell -ExecutionPolicy Bypass -File build-android.ps1
```

脚本会自动：
- 将 `JAVA_HOME` 指向 Android Studio 自带的 JDK 21
- 注入 `EXPO_PUBLIC_BUILD_TIME` 毫秒时间戳（让「关于」页显示真实构建时间）
- 执行 `cd android; .\gradlew.bat assembleRelease`

产物位于 `android/app/build/outputs/apk/release/`，3 个 ABI（`arm64-v8a` / `armeabi-v7a` / `x86_64`）。

### EAS Build（云端）

```bash
eas login
eas build --profile preview --platform android   # APK
eas build --profile production --platform android # AAB
```

### 发布到 GitHub Release

```bash
node scripts/publish-apk.js
```

脚本会：
1. 从 `android/app/build.gradle` 读取 `versionCode`
2. 创建 GitHub Release，body 开头写入 `<!-- versionCode: N -->`（服务端据此识别最新版本）
3. 上传 3 个 ABI 的 APK

## OTA 与 APK 更新（本项目未完善OTA功能，仅供参考）

应用内置双轨更新机制：

| 通道 | 用途 | 端点 |
|------|------|------|
| OTA（expo-updates） | JS bundle 与资源热更新 | `GET /api/ota/manifest` · `GET /api/ota/assets?path=xxx` |
| APK 自更新 | 原生层版本升级 | `GET /api/apk/version?current=N&abi=xxx` · `GET /api/apk/download?abi=xxx` |

服务端实现位于 [scripts/ota-apk.js](scripts/ota-apk.js)，运行 `node scripts/patch-server.js` 可幂等注入到后端 `server.js`。

**镜像 fallback 顺序**：`ghproxy.com` → `ghproxy.net` → `gh-proxy.com` → `ghproxy.homeboyc.cn` → 直连 GitHub，首个成功镜像缓存复用。

**服务端环境变量**：

| 变量 | 必填 | 说明 |
|------|------|------|
| `GITHUB_REPO` | ✅ | `owner/repo` |
| `GITHUB_TOKEN` | ❌ | GitHub PAT（提高 API 限额） |
| `GITHUB_MIRRORS` | ❌ | 自定义镜像列表（逗号分隔） |
| `OTA_DIR` | ❌ | OTA 资源目录（默认 `./ota`） |

客户端更新流程：启动时检查 → 非强制弹窗 / 强制弹窗 → 应用内 `downloadAndInstallApk()` 流式下载 + 进度遮罩 → 系统安装器接管（拒绝 `Linking.openURL` 浏览器下载）。

## 另请注意

- **API 硬编码**　`lib/api.ts` 中 `API_BASE` 不走相对路径（RN 无同源概念）
- **vendor 资源内联**　marked / KaTeX / highlight.js 通过 `scripts/gen-vendor.js` 在构建时内联为 `.ts`，禁止运行时 `expo-asset` 加载（会触发 native 模块冲突导致 AsyncStorage 数据丢失）
- **对话角色绑定固定**　`setCurrentProfile` / `shuffleProfile` 不改写已有对话的 `profileKey`
- **重试不重复消息**　`doSend` 的 `retryOpts` 控制是否跳过添加新用户消息
- **友好错误文案**　API 错误必须用 `friendlyError()` 抽取可读消息，不显示原始 JSON
- **引继码恢复后必须 setHandoffToken**　确保本地引继码与服务端一致
- **毛玻璃兜底**　`expo-blur` BlurView 在 Expo Go 静默失效，正式 APK 生效，需用 wrapper View + `backgroundColor` 兜底
- **预测性返回手势已撤销**　`app.json` 不再启用 `predictiveBackGestureEnabled`，使用标准 `slide_from_right` 转场

## 许可证

[MIT](LICENSE)

## 致谢

- [Expo](https://expo.dev/) · SDK 57 与配套原生模块
- [React Native](https://reactnative.dev/) · 0.86
- [Zustand](https://github.com/pmndrs/zustand) · 状态管理
- [react-native-reanimated](https://github.com/software-mansion/react-native-reanimated) · 动画引擎
- [marked](https://marked.js.org/) · Markdown 解析
- [KaTeX](https://katex.org/) · 数学公式渲染
- [highlight.js](https://highlightjs.org/) · 代码高亮
- 所有为本项目提供反馈与测试的伙伴

