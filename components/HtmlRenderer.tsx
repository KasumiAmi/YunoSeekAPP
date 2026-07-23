// HTML 富文本渲染器：用于公告等需要嵌入 HTML 标签的场景
// 独立于 MarkdownRenderer（对话正文），直接在 WebView 中渲染原始 HTML
// 支持 <a>/<img>/<b>/<p>/<br> 等标签，链接点击通过 postMessage 拦截
import React, { useEffect, useRef, useState, memo } from "react";
import { View, Linking, useColorScheme } from "react-native";
import WebView from "react-native-webview";
import { useStore } from "../lib/store";
import { getTheme, resolveThemeMode } from "../lib/theme";

interface Props {
  content: string;
}

interface ThemeColors {
  text: string;
  muted: string;
  bg: string;
  brand: string;
  line: string;
}

function buildHtml(theme: ThemeColors, content: string): string {
  // 将内容直接嵌入 HTML，避免 injectedJavaScriptBeforeContentLoaded 时序问题
  // JSON.stringify 保证字符串安全转义，再处理 </script> 防截断
  const contentJson = JSON.stringify(content || "").replace(/<\/script/gi, "<\\/script");
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    background: transparent;
    color: ${theme.text};
    font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    font-size: 14px;
    line-height: 1.6;
    overflow: hidden;
    -webkit-text-size-adjust: 100%;
  }
  #root { padding: 0; word-wrap: break-word; overflow-wrap: break-word; }
  img { max-width: 100%; height: auto; border-radius: 10; margin: 8px 0; }
  a { color: ${theme.brand}; text-decoration: none; }
  p { margin: 4px 0; }
  b, strong { font-weight: 600; }
  i, em { font-style: italic; }
  ul, ol { padding-left: 20px; margin: 4px 0; }
  li { margin: 2px 0; }
  h1, h2, h3, h4 { font-weight: 600; margin: 8px 0 4px; }
  h1 { font-size: 18px; }
  h2 { font-size: 16px; }
  h3 { font-size: 15px; }
  blockquote { border-left: 3px solid ${theme.line}; padding-left: 12px; margin: 6px 0; color: ${theme.muted}; }
  code { font-family: "SF Mono", "Consolas", monospace; background: ${theme.line}33; padding: 1px 5px; border-radius: 4px; font-size: 13px; }
  pre { background: ${theme.line}33; padding: 10px; border-radius: 8; overflow-x: auto; margin: 6px 0; }
  pre code { background: transparent; padding: 0; }
  hr { border: none; border-top: 1px solid ${theme.line}; margin: 10px 0; }
  table { border-collapse: collapse; width: 100%; margin: 6px 0; }
  th, td { border: 1px solid ${theme.line}; padding: 6px 8px; text-align: left; }
</style>
</head>
<body>
<div id="root"></div>
<script>
(function() {
  var root = document.getElementById('root');
  var initialContent = ${contentJson};

  function sendHeight() {
    try {
      var h1 = document.documentElement.scrollHeight || 0;
      var h2 = document.body.scrollHeight || 0;
      var h3 = root ? root.scrollHeight : 0;
      var h = Math.ceil(Math.max(h1, h2, h3));
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: "height", height: h }));
      }
    } catch(e) {}
  }

  window.renderContent = function(html) {
    if (root) root.innerHTML = html || '';
    var links = root ? root.querySelectorAll('a[href]') : [];
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener('click', function(e) {
        e.preventDefault();
        var href = this.getAttribute('href');
        if (href && window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: "link", url: href }));
        }
      });
    }
    requestAnimationFrame(function() { sendHeight(); });
  };

  // 直接渲染嵌入的内容
  window.renderContent(initialContent);

  // ResizeObserver 监听内容变化（图片加载等异步高度变化）
  if (typeof ResizeObserver !== 'undefined') {
    try {
      var ro = new ResizeObserver(function() { sendHeight(); });
      ro.observe(document.body);
    } catch(e) {}
  }
  // 图片加载完成后重新测量
  var imgs = root ? root.querySelectorAll('img') : [];
  for (var k = 0; k < imgs.length; k++) {
    imgs[k].addEventListener('load', function() { sendHeight(); });
  }
})();
</script>
</body>
</html>`;
}

export const HtmlRenderer = memo(function HtmlRenderer({ content }: Props) {
  const systemScheme = useColorScheme();
  const themeMode = useStore((s) => s.themeMode);
  const profile = useStore((s) => s.getCurrentProfile());
  const mode = resolveThemeMode(themeMode, systemScheme);
  const theme = getTheme(mode, profile.themeColor);

  const webviewRef = useRef<WebView>(null);
  const loadedRef = useRef(false);
  const [height, setHeight] = useState(0);

  const themeColors: ThemeColors = {
    text: theme.text,
    muted: theme.muted,
    bg: theme.page,
    brand: theme.brand,
    line: theme.line,
  };

  // 内容直接嵌入 HTML，content 变化时重建 HTML
  const html = React.useMemo(() => buildHtml(themeColors, content), [theme, content]);

  useEffect(() => {
    loadedRef.current = false;
    setHeight(0);
  }, [html]);

  // 高度兜底：300ms 后仍未收到高度则主动测量
  useEffect(() => {
    if (!loadedRef.current) return;
    const timer = setTimeout(() => {
      if (webviewRef.current && height === 0) {
        webviewRef.current.injectJavaScript(
          `try { requestAnimationFrame(function(){ sendHeight(); }); } catch(e){} true;`
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
        onLoadEnd={() => {
          loadedRef.current = true;
          if (webviewRef.current) {
            webviewRef.current.injectJavaScript(
              `try { requestAnimationFrame(function(){ sendHeight(); }); } catch(e){} true;`
            );
          }
        }}
        onShouldStartLoadWithRequest={(req) => {
          if (req.url === "about:blank" || req.url.startsWith("data:")) return true;
          return false;
        }}
      />
    </View>
  );
});
