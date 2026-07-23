// 构建前脚本：把 assets/vendor/*.txt 转换为 .ts 文件，直接内联到 JS bundle 中。
// 这样不需要 expo-asset 异步加载，避免 release 模式下 native 模块初始化冲突。
// 用 JSON.stringify 转义，保证字符串安全（无需手动处理反引号/${}等特殊字符）。
const fs = require("fs");
const path = require("path");

const vendors = [
  { ts: "marked.min.ts", file: "marked.min.txt", varName: "markedJs" },
  { ts: "katex.min.ts", file: "katex.min.txt", varName: "katexJs" },
  { ts: "highlight.min.ts", file: "highlight.min.txt", varName: "hljsJs" },
  { ts: "katex-css.ts", file: "katex-css.txt", varName: "katexCss" },
  { ts: "hljs-css.ts", file: "hljs-css.txt", varName: "hljsCss" },
];

const vendorDir = path.join(__dirname, "..", "assets", "vendor");

for (const { ts, file } of vendors) {
  const src = path.join(vendorDir, file);
  if (!fs.existsSync(src)) {
    console.error(`[gen-vendor] 源文件不存在: ${src}`);
    process.exit(1);
  }
  const content = fs.readFileSync(src, "utf-8");
  const escaped = JSON.stringify(content);
  const out = path.join(vendorDir, ts);
  fs.writeFileSync(
    out,
    `// 自动生成，请勿手动编辑。源文件: ${file}\n// 由 scripts/gen-vendor.js 生成\nexport default ${escaped};\n`
  );
  console.log(`[gen-vendor] ${file} -> ${ts} (${content.length} bytes)`);
}
console.log("[gen-vendor] 完成");
