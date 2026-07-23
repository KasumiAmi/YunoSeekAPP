// 构建时间生成脚本：将当前时间戳写入 lib/build-info.ts
// 在 expo run:android 前运行，确保关于页面显示正确的构建时间
// 用法：node scripts/gen-build-info.js
const fs = require("fs");
const path = require("path");

const outPath = path.join(__dirname, "..", "lib", "build-info.ts");
const now = Date.now();

const content = `// 自动生成：构建时间戳（由 scripts/gen-build-info.js 写入）
// 请勿手动编辑——每次构建前重新运行脚本
export const BUILD_TIME = ${now};
`;

fs.writeFileSync(outPath, content, "utf-8");
console.log(`[gen-build-info] wrote BUILD_TIME=${now} (${new Date(now).toISOString()}) to ${outPath}`);
