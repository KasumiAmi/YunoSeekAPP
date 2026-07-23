// Metro bundler 配置
// 修复 react-native-reanimated v4 依赖的 react-native-worklets 模块解析
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// react-native-worklets 的 package.json "react-native" 字段指向 ./src/index（无扩展名），
// Metro 默认解析可能找不到。显式指定包路径让 Metro 直接定位。
config.resolver.extraNodeModules = {
  "react-native-worklets": path.resolve(__dirname, "node_modules/react-native-worklets"),
};

// 将 .txt 加入 assetExts：用于本地打包 marked/KaTeX/highlight.js 资源，
// 通过 require('../assets/vendor/xxx.txt') + expo-asset + FileSystem.readAsStringAsync 加载
if (!config.resolver.assetExts.includes("txt")) {
  config.resolver.assetExts.push("txt");
}

module.exports = config;
