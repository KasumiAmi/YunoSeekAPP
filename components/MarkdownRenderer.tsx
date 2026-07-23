// Markdown 渲染组件：WebView + marked + KaTeX（与 web 端 render.js 对齐）
// 支持：标题/段落/列表/表格/链接/加粗斜体/引用/行内代码/代码块（高亮）/hr/数学公式
// 资源策略：marked/KaTeX/highlight.js 通过 scripts/gen-vendor.js 内联为 .ts 文件，
// 直接 import 到 JS bundle 中，无需 expo-asset 异步加载，避免 release 模式下
// native 模块初始化冲突导致 AsyncStorage 数据丢失。
import React, { memo, useState, useRef, useEffect } from "react";
import { Linking, useColorScheme, View } from "react-native";
import { WebView } from "react-native-webview";
import { useStore } from "../lib/store";
import { getTheme, resolveThemeMode, type ThemeColors } from "../lib/theme";

// vendor 资源：构建前由 scripts/gen-vendor.js 从 .txt 生成 .ts，直接内联到 bundle
import markedJs from "../assets/vendor/marked.min";
import katexJs from "../assets/vendor/katex.min";
import hljsJs from "../assets/vendor/highlight.min";
import katexCss from "../assets/vendor/katex-css";
import hljsCss from "../assets/vendor/hljs-css";

const VENDOR: VendorAssets = { markedJs, katexJs, hljsJs, katexCss, hljsCss };

interface Props {
  content: string;
}

interface VendorAssets {
  markedJs: string;
  katexJs: string;
  hljsJs: string;
  katexCss: string;
  hljsCss: string;
}

// 用主题颜色 + 本地内联资源生成 WebView HTML（不含 content，仅渲染逻辑）
function buildHtml(theme: ThemeColors, v: VendorAssets): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>${v.katexCss}</style>
<style>${v.hljsCss}</style>
<script>${v.markedJs}</script>
<script>${v.katexJs}</script>
<script>${v.hljsJs}</script>
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: transparent;
    color: ${theme.text};
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
    font-size: 15px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
    word-wrap: break-word;
    overflow-wrap: anywhere;
    overscroll-behavior: none;
    -webkit-overflow-scrolling: auto;
  }
  body { -webkit-user-select: none; user-select: none; }
  pre, code, blockquote { -webkit-user-select: text; user-select: text; }
  #root > *:last-child { margin-bottom: 0; }
  p { margin: 0 0 8px; }
  h1 { font-size: 22px; font-weight: 700; margin: 12px 0 6px; line-height: 1.3; }
  h2 { font-size: 19px; font-weight: 700; margin: 10px 0 5px; line-height: 1.3; }
  h3 { font-size: 17px; font-weight: 600; margin: 8px 0 4px; line-height: 1.3; }
  h4, h5, h6 { font-weight: 600; margin: 6px 0 4px; line-height: 1.3; }
  a { color: ${theme.brand}; text-decoration: underline; }
  strong { font-weight: 700; }
  em { font-style: italic; }
  blockquote {
    border-left: 3px solid ${theme.brand};
    padding: 4px 10px;
    margin: 6px 0;
    background: rgba(128,128,128,0.05);
    border-radius: 4px;
  }
  hr { border: 0; border-top: 1px solid ${theme.line}; margin: 10px 0; }
  ul, ol { padding-left: 24px; margin: 4px 0; }
  li { margin: 2px 0; }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 6px 0;
    border: 1px solid ${theme.line};
    border-radius: 6px;
    overflow: hidden;
    display: block;
    overflow-x: auto;
  }
  th, td { padding: 6px 10px; border-bottom: 1px solid ${theme.line}; text-align: left; }
  th { background: rgba(128,128,128,0.06); font-weight: 600; }
  tr:last-child td { border-bottom: 0; }
  code {
    font-family: ui-monospace, "Cascadia Code", Menlo, Consolas, monospace;
    font-size: 13px;
    background: rgba(128,128,128,0.12);
    padding: 1px 4px;
    border-radius: 4px;
    color: ${theme.text};
  }
  pre {
    background: #1e1e2e;
    color: #cdd6f4;
    padding: 12px;
    border-radius: 10px;
    overflow-x: auto;
    margin: 6px 0;
  }
  pre code {
    background: transparent;
    color: #cdd6f4;
    padding: 0;
    font-size: 13px;
    line-height: 1.5;
  }
  .katex { font-size: 1.05em; }
  .katex-display {
    margin: 8px 0;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 4px 0;
  }
  .katex-display > .katex { white-space: nowrap; }
  img { max-width: 100%; height: auto; border-radius: 8px; margin: 6px 0; }
</style>
</head>
<body>
<div id="root"></div>
<script>
(function() {
  // 基础转义（marked/katex 未就绪时降级用）
  function escapeBasic(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function renderLite(text) {
    var html = escapeBasic(text);
    html = html.replace(/\`\`\`([\\w]*)\\n?([\\s\\S]*?)\`\`\`/g, function(_, lang, code) {
      return '<pre><code>' + code.replace(/^\\n+|\\n+$/g, '') + '</code></pre>';
    });
    html = html.replace(/\`([^\`\\n]+)\`/g, '<code>$1</code>');
    html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    html = html.replace(/(^|\\s)\\*([^*\\n]+)\\*/g, '$1<em>$2</em>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
               .replace(/^## (.+)$/gm, '<h2>$1</h2>')
               .replace(/^# (.+)$/gm, '<h1>$1</h1>');
    return html;
  }
  function repairUnclosedFences(text) {
    var count = (text.match(/\`\`\`/g) || []).length;
    if (count % 2 === 1) return text + '\\n\`\`\`';
    return text;
  }
  // 预提取数学公式，避免 marked 破坏 LaTeX
  function extractMath(text) {
    var mathBlocks = [];
    function placeholder(id) { return '@@MATH' + id + '@@'; }
    function handleBlock(raw, content, display) {
      var id = mathBlocks.length;
      if (typeof window.katex !== 'undefined') {
        try {
          var html = window.katex.renderToString(content, {
            displayMode: display,
            throwOnError: false,
            output: 'html'
          });
          mathBlocks.push(html);
        } catch (e) {
          mathBlocks.push(raw);
        }
      } else {
        mathBlocks.push(raw);
      }
      return placeholder(id);
    }
    var result = text;
    // 顺序：先 $$，再 \\[\\]，再 \\(\\)，最后行内 $
    result = result.replace(/\\$\\$([\\s\\S]*?)\\$\\$/g, function(m, c) { return handleBlock(m, c, true); });
    result = result.replace(/\\\\\\[([\\s\\S]*?)\\\\\\]/g, function(m, c) { return handleBlock(m, c, true); });
    result = result.replace(/\\\\\\(([\\s\\S]*?)\\\\\\)/g, function(m, c) { return handleBlock(m, c, false); });
    result = result.replace(/\\$([^$\\n]+?)\\$/g, function(m, c) { return handleBlock(m, c, false); });
    return { text: result, mathBlocks: mathBlocks };
  }
  function restoreMath(html, mathBlocks) {
    return html.replace(/@@MATH(\\d+)@@/g, function(_, id) {
      return mathBlocks[Number(id)] || '';
    });
  }
  function renderInto(text) {
    var root = document.getElementById('root');
    if (!root) return;
    var repaired = repairUnclosedFences(text || '');
    var extracted = extractMath(repaired);
    var cleaned = extracted.text.trimEnd();
    var html;
    if (typeof window.marked === 'undefined') {
      html = renderLite(cleaned);
    } else {
      try {
        window.marked.setOptions({ gfm: true, breaks: true });
        html = window.marked.parse(cleaned);
        html = restoreMath(html, extracted.mathBlocks);
      } catch (e) {
        html = renderLite(cleaned);
      }
    }
    root.innerHTML = html;
    if (typeof window.hljs !== 'undefined') {
      root.querySelectorAll('pre code').forEach(function(block) {
        if (block.dataset.highlighted === 'yes') return;
        try { window.hljs.highlightElement(block); block.dataset.highlighted = 'yes'; } catch (e) {}
      });
    }
    // 链接拦截：交给 RN 打开外部浏览器
    root.querySelectorAll('a').forEach(function(a) {
      a.addEventListener('click', function(e) {
        e.preventDefault();
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'link', url: a.href }));
        } catch (err) {}
      });
    });
    sendHeight();
  }
  function sendHeight() {
    // 多种测量方式取最大值，确保 WebView height 始终 >= 实际内容高度，避免内部出现可滚动区域
    var h1 = document.documentElement.scrollHeight || 0;
    var h2 = document.body.scrollHeight || 0;
    var h3 = document.documentElement.offsetHeight || 0;
    var h4 = document.body.offsetHeight || 0;
    var h = Math.ceil(Math.max(h1, h2, h3, h4));
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'height', height: h }));
    } catch (e) {}
  }
  // 暴露给 RN 调用：window.renderContent(text)
  // 直接调用 renderInto：vendor 库已就绪时用 marked/katex 渲染，
  // 未就绪时 renderInto 内部降级用 renderLite 渲染基本格式
  window.renderContent = function(text) {
    try { renderInto(text); } catch (e) { console.error(e); }
    // 延迟一帧再测量高度，确保浏览器完成布局后再读取 scrollHeight
    requestAnimationFrame(function() { sendHeight(); });
  };
  // 渲染 RN 通过 injectedJavaScriptBeforeContentLoaded 注入的初始内容
  if (typeof window.__initialContent !== 'undefined' && window.__initialContent !== null) {
    var ic = window.__initialContent;
    window.__initialContent = null;
    window.renderContent(ic);
  }
  // 监听 body 高度变化（流式时频繁触发）
  if (typeof ResizeObserver !== 'undefined') {
    var ro = new ResizeObserver(function() { sendHeight(); });
    var started = false;
    var start = function() {
      if (started) return;
      started = true;
      ro.observe(document.body);
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  }
})();
</script>
</body>
</html>`;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content }: Props) {
  const systemScheme = useColorScheme();
  const themeMode = useStore((s) => s.themeMode);
  const profile = useStore((s) => s.getCurrentProfile());
  const mode = resolveThemeMode(themeMode, systemScheme);
  const theme = getTheme(mode, profile.themeColor);

  const webviewRef = useRef<WebView>(null);
  const loadedRef = useRef(false);
  // 记录初始加载时使用的 content，用于 onLoadEnd 时检测是否在加载期间 content 已变化
  const initialContentRef = useRef(content);
  const [height, setHeight] = useState(0);

  // vendor 资源已内联到 JS bundle，直接使用，无需异步加载
  // theme 变化时重新构建 HTML（含新的 CSS 变量）
  const html = React.useMemo(() => buildHtml(theme, VENDOR), [theme]);

  // WebView 重载（theme 变化导致 html 变化）时重置状态
  useEffect(() => {
    loadedRef.current = false;
    initialContentRef.current = content;
    setHeight(0);
  }, [html]);

  // 在 WebView 加载（包括重载）前注入初始 content，避免 injectJavaScript 早于页面脚本执行
  // 页面 IIFE 会读取 window.__initialContent 并渲染
  const injectedBeforeContentLoaded = React.useMemo(() => {
    const escaped = JSON.stringify(content);
    return `try { window.__initialContent = ${escaped}; } catch(e) {} true;`;
  }, [content]);

  // content 变化时通过 injectJavaScript 更新（仅在 WebView 已加载后调用）
  useEffect(() => {
    if (!loadedRef.current || !webviewRef.current) return;
    const escaped = JSON.stringify(content);
    const js = `try { window.renderContent(${escaped}); } catch(e) { console.error(e); } true;`;
    webviewRef.current.injectJavaScript(js);
  }, [content]);

  // 高度回退：如果 onLoadEnd 后 300ms 仍未收到高度消息，主动注入 JS 测量
  useEffect(() => {
    if (!loadedRef.current) return;
    const timer = setTimeout(() => {
      if (webviewRef.current && height === 0) {
        webviewRef.current.injectJavaScript(
          `try { requestAnimationFrame(function(){ var h1=document.documentElement.scrollHeight||0;var h2=document.body.scrollHeight||0;var h=Math.ceil(Math.max(h1,h2));window.ReactNativeWebView.postMessage(JSON.stringify({type:'height',height:h})); }); } catch(e){} true;`
        );
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [height]);

  const handleMessage = (event: { nativeEvent: { data: string } }) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === "height" && typeof msg.height === "number") {
        setHeight(Math.max(msg.height, 0));
      } else if (msg.type === "link" && typeof msg.url === "string") {
        Linking.openURL(msg.url).catch(() => {});
      }
    } catch {
      // ignore
    }
  };

  return (
    <View style={{ minHeight: content ? 20 : 0 }}>
      <WebView
        ref={webviewRef}
        source={{ html }}
        style={{ height: Math.max(height + 2, content ? 20 : 2), backgroundColor: "transparent" }}
        onMessage={handleMessage}
        originWhitelist={["*"]}
        scrollEnabled={false}
        nestedScrollEnabled={false}
        overScrollMode="never"
        bounces={false}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        pointerEvents="auto"
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        injectedJavaScriptBeforeContentLoaded={injectedBeforeContentLoaded}
        onLoadEnd={() => {
          // WebView 加载完成（含重载），标记已就绪
          loadedRef.current = true;
          // 如果在 WebView 加载期间 content 已变化，initialContentRef 记录的是
          // 加载开始时的 content，而当前 content 可能已不同。
          // 此时 useEffect 因 loadedRef 为 false 而跳过了注入，需要在此补注入。
          if (initialContentRef.current !== content && webviewRef.current) {
            const escaped = JSON.stringify(content);
            const js = `try { window.renderContent(${escaped}); } catch(e) { console.error(e); } true;`;
            webviewRef.current.injectJavaScript(js);
          }
          // 主动触发一次高度测量（兜底 sendHeight 未触发的情况）
          if (webviewRef.current) {
            webviewRef.current.injectJavaScript(
              `try { requestAnimationFrame(function(){ sendHeight(); }); } catch(e){} true;`
            );
          }
        }}
        // 禁止 WebView 内导航（链接由 onMessage 拦截）
        onShouldStartLoadWithRequest={(req) => {
          if (req.url === "about:blank" || req.url.startsWith("data:")) return true;
          return false;
        }}
      />
    </View>
  );
});
