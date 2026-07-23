// 对话视图：单一共享 WebView 渲染所有消息（方案 B）
//
// 替代之前的 FlatList + N 个 MarkdownRenderer（每条消息一个 WebView）方案。
// 核心优势：
//   1. vendor JS（marked + katex + hljs ≈ 430KB）只加载一次
//   2. 无 removeClippedSubviews 卸载/重挂载竞态
//   3. 无 injectedJavaScriptBeforeContentLoaded 时序竞态
//   4. 主题切换通过 CSS 变量热更新，无需重载 WebView
//   5. 对话切换时 flyAndBlur 错落入场动画（参照 web 端 Svelte transition）
//
// WebView 内部自行滚动，RN 层仅负责 header / composer / sidebar 叠加。
import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import { Linking } from "react-native";
import { WebView } from "react-native-webview";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useStore, type Message } from "../lib/store";
import { type ThemeColors } from "../lib/theme";
import { profiles, type Profile } from "../lib/profiles";

// vendor 资源：构建前由 scripts/gen-vendor.js 从 .txt 生成 .ts，直接内联到 bundle
import markedJs from "../assets/vendor/marked.min";
import katexJs from "../assets/vendor/katex.min";
import hljsJs from "../assets/vendor/highlight.min";
import katexCss from "../assets/vendor/katex-css";
import hljsCss from "../assets/vendor/hljs-css";

interface VendorAssets {
  markedJs: string;
  katexJs: string;
  hljsJs: string;
  katexCss: string;
  hljsCss: string;
}

const VENDOR: VendorAssets = { markedJs, katexJs, hljsJs, katexCss, hljsCss };

export interface ConversationViewHandle {
  scrollToBottom: () => void;
  injectJS: (js: string) => void;
}

interface Props {
  messages: Message[];
  profile: Profile;
  theme: ThemeColors;
  topInset: number;
  bottomInset: number;
  onRetry?: (msgId: string) => void;
  onSwitchVersion?: (msgId: string, direction: -1 | 1) => void;
  onEdit?: (msgId: string) => void;
}

// ── CSS（使用 CSS 变量，主题切换时热更新，无需重载 WebView） ──────────────────────────────────────────
const CSS = `
* { box-sizing: border-box; }
html {
  margin: 0; padding: 0;
  background: transparent;
}
body {
  margin: 0; padding: 0;
  background: transparent;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
  overscroll-behavior-y: none;
  -webkit-overflow-scrolling: touch;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
  font-size: 15px;
  line-height: 1.55;
  color: var(--text);
  word-wrap: break-word;
  overflow-wrap: anywhere;
  -webkit-user-select: none; user-select: none;
  -webkit-touch-callout: none;
}
#messages { padding-top: var(--pad-top, 0px); padding-bottom: var(--pad-bottom, 0px); }

/* 去除所有可交互元素的蓝色聚焦框和点击高亮（Android WebView 默认行为） */
button, .reasoning-header, .search-badge, .action-btn, .version-arrow, .retry-btn, a {
  outline: none !important;
  -webkit-tap-highlight-color: transparent;
}

/* 文字选择：仅消息内容/代码/引用允许选择 */
.msg-content, .reasoning-body, pre, code, blockquote { -webkit-user-select: text; user-select: text; -webkit-touch-callout: default; }

/* ── flyAndBlur 入场动画（参照 web 端 Svelte flyAndBlur transition） ── */
/* 同时插值 transform / opacity / filter: blur，出场反向 */
/* duration 按 circOut 缓动随索引递增，越靠后的条目动画越长，形成自然错落 */
.msg {
  opacity: 0;
  transform: translateY(12px);
  filter: blur(4px);
  transition:
    opacity var(--anim-dur, 480ms) cubic-bezier(0.07, 0.85, 0.4, 1) var(--anim-delay, 0ms),
    transform var(--anim-dur, 480ms) cubic-bezier(0.07, 0.85, 0.4, 1) var(--anim-delay, 0ms),
    filter var(--anim-dur, 480ms) cubic-bezier(0.07, 0.85, 0.4, 1) var(--anim-delay, 0ms);
}
.msg.visible {
  opacity: 1;
  transform: none;
  filter: none;
}
@media (prefers-reduced-motion: reduce) {
  .msg { transition: none !important; opacity: 1 !important; transform: none !important; filter: none !important; }
  .pulse-dots span, .thinking-spinner, .reasoning-label-glow { animation: none !important; }
}

/* ── 消息布局 ── */
.msg { margin: 4px 14px; }
/* 用户消息：附件 + 气泡垂直堆叠，整体靠右对齐 */
.msg-user { display: flex; flex-direction: column; align-items: flex-end; }
.msg-assistant { display: flex; flex-direction: row; gap: 8px; }
.avatar { width: 32px; height: 32px; border-radius: 16px; flex-shrink: 0; object-fit: cover; background: rgba(120,120,120,0.08); }
.assistant-content { flex: 1; min-width: 0; padding: 4px 2px; }

/* 用户气泡 */
.user-bubble {
  background: rgba(var(--brand-rgb), 0.14);
  border-radius: 18px 18px 6px 18px;
  padding: 10px 14px;
  max-width: 78%;
  color: var(--text);
  word-break: break-word;
}
/* 用户消息底部操作栏（复制 + 编辑） */
.user-footer {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 3px;
  justify-content: flex-end;
}

/* 附件 */
.attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; justify-content: flex-end; }
.attach-img { width: 100px; height: 100px; border-radius: 10px; object-fit: cover; }

/* ── Markdown 内容样式 ── */
.msg-content > *:last-child { margin-bottom: 0; }
.msg-content p { margin: 0 0 8px; }
.msg-content h1 { font-size: 22px; font-weight: 700; margin: 12px 0 6px; line-height: 1.3; }
.msg-content h2 { font-size: 19px; font-weight: 700; margin: 10px 0 5px; line-height: 1.3; }
.msg-content h3 { font-size: 17px; font-weight: 600; margin: 8px 0 4px; line-height: 1.3; }
.msg-content h4, .msg-content h5, .msg-content h6 { font-weight: 600; margin: 6px 0 4px; line-height: 1.3; }
.msg-content a { color: var(--brand); text-decoration: underline; }
.msg-content strong { font-weight: 700; }
.msg-content em { font-style: italic; }
.msg-content blockquote {
  border-left: 3px solid var(--brand);
  padding: 4px 10px;
  margin: 6px 0;
  background: rgba(128,128,128,0.05);
  border-radius: 4px;
}
.msg-content hr { border: 0; border-top: 1px solid var(--line); margin: 10px 0; }
.msg-content ul, .msg-content ol { padding-left: 24px; margin: 4px 0; }
.msg-content li { margin: 2px 0; }
.msg-content table {
  border-collapse: collapse;
  width: 100%;
  margin: 6px 0;
  border: 1px solid var(--line);
  border-radius: 6px;
  overflow: hidden;
  display: block;
  overflow-x: auto;
}
.msg-content th, .msg-content td { padding: 6px 10px; border-bottom: 1px solid var(--line); text-align: left; }
.msg-content th { background: rgba(128,128,128,0.06); font-weight: 600; }
.msg-content tr:last-child td { border-bottom: 0; }
.msg-content code {
  font-family: ui-monospace, "Cascadia Code", Menlo, Consolas, monospace;
  font-size: 13px;
  background: rgba(128,128,128,0.12);
  padding: 1px 4px;
  border-radius: 4px;
  color: var(--text);
}
.msg-content pre {
  background: #1e1e2e;
  color: #cdd6f4;
  padding: 12px;
  border-radius: 10px;
  overflow-x: auto;
  margin: 6px 0;
}
.msg-content pre code {
  background: transparent;
  color: #cdd6f4;
  padding: 0;
  font-size: 13px;
  line-height: 1.5;
}
.msg-content img { max-width: 100%; height: auto; border-radius: 8px; margin: 6px 0; }
.katex { font-size: 1.05em; }
.katex-display { margin: 8px 0; overflow-x: auto; overflow-y: hidden; padding: 4px 0; }
.katex-display > .katex { white-space: nowrap; }

/* ── Reasoning 折叠区 ── */
.reasoning {
  border-left: 2px solid rgba(128,128,128,0.2);
  padding-left: 8px;
  margin-bottom: 6px;
}
.reasoning-header {
  display: flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  margin-bottom: 2px;
}
.reasoning-label { font-size: 11px; font-weight: 600; color: var(--muted); }
.reasoning-body { font-size: 12px; line-height: 17px; color: var(--muted); margin-top: 4px; white-space: pre-wrap; }
.chevron-icon { display: inline-flex; align-items: center; color: var(--muted); }

/* thinking spinner：streaming 时唯一的加载动画（旋转圆圈），1s 平缓线性。
   之前另有一个 .reasoning-label-glow 呼吸文字动画与之并排，功能重叠且叠加抖动，已移除。 */
.thinking-spinner {
  width: 14px; height: 14px;
  border: 2px solid var(--brand);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── 搜索结果 ── */
.search-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 14px;
  background: rgba(var(--brand-rgb), 0.08);
  margin-top: 6px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  color: var(--brand);
}
.search-list { margin-top: 6px; display: flex; flex-direction: column; gap: 6px; }
.search-item {
  display: block;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(var(--brand-rgb), 0.05);
  border-left: 2px solid var(--brand);
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  text-decoration: none;
}
.search-snippet { font-size: 11px; color: var(--muted); margin-top: 2px; line-height: 15px; }

/* ── 流式脉冲点 ── */
.pulse-dots { display: flex; gap: 5px; padding: 6px 0; }
.pulse-dots span {
  width: 7px; height: 7px; border-radius: 4px;
  background: var(--muted);
  animation: pulse 500ms infinite alternate;
}
.pulse-dots span:nth-child(2) { animation-delay: 150ms; }
.pulse-dots span:nth-child(3) { animation-delay: 300ms; }
@keyframes pulse { from { opacity: 0.3; } to { opacity: 1; } }

/* ── 错误 + 重试 ── */
.error-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
  gap: 8px;
}
.error-text { color: #ef4444; font-size: 13px; flex: 1; }
.retry-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 4px 8px;
  border-radius: 8px;
  border: none;
  background: rgba(var(--brand-rgb), 0.15);
  color: var(--brand);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

/* ── 底部：时间戳 + 操作按钮 ── */
.msg-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}
.timestamp { font-size: 10px; color: var(--muted); }
.footer-actions { display: flex; align-items: center; gap: 16px; }
/* 版本切换器：多版本回答时显示，如 2/3 + 左右箭头 */
.version-switcher { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); }
.version-arrow { background: rgba(var(--brand-rgb), 0.08); border: none; color: var(--brand); padding: 2px 8px; border-radius: 6px; cursor: pointer; font-size: 14px; line-height: 1; }
.version-text { font-weight: 600; min-width: 28px; text-align: center; }
.action-btn {
  background: none;
  border: none;
  padding: 2px;
  cursor: pointer;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
}
`;

// ── JS（WebView 内渲染逻辑） ──────────────────────────────────────────
// 注意：此字符串在 template literal 中，需注意转义：
//   \\  → \（正则反斜杠）
//   \`  → `（代码围栏反引号）
//   避免 ${（否则被当作模板插值）
const JS = `
(function() {
  // ── 工具函数 ──
  function pm(obj) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } catch(e) {}
  }
  function escapeBasic(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(s) {
    return escapeBasic(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── SVG 图标（Lucide 风格，与 Ionicons 对齐） ──
  var ICON_COPY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
  var ICON_CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  var ICON_RETRY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>';
  var ICON_GLOBE = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>';
  var ICON_CHEVRON_DOWN = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
  var ICON_CHEVRON_UP = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>';
  var ICON_EDIT = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';

  // ── Markdown 渲染（从 MarkdownRenderer 移植，保留相同转义） ──
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
  function renderMarkdown(text) {
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
    return html;
  }
  function highlightCode(el) {
    if (typeof window.hljs === 'undefined') return;
    el.querySelectorAll('pre code').forEach(function(block) {
      if (block.dataset.highlighted === 'yes') return;
      try { window.hljs.highlightElement(block); block.dataset.highlighted = 'yes'; } catch (e) {}
    });
  }
  function interceptLinks(el) {
    el.querySelectorAll('a').forEach(function(a) {
      a.addEventListener('click', function(e) {
        e.preventDefault();
        pm({ type: 'link', url: a.href });
      });
    });
  }

  // ── 时间格式化 ──
  function formatTime(ts) {
    if (!ts || isNaN(new Date(ts).getTime())) return '';
    var d = new Date(ts);
    var h = d.getHours().toString().padStart(2, '0');
    var m = d.getMinutes().toString().padStart(2, '0');
    return h + ':' + m;
  }

  // ── 搜索结果 HTML ──
  function renderSearchHtml(m) {
    var html = '';
    html += '<div class="search-badge" onclick="window.toggleSearch(\\'' + escapeAttr(m.id) + '\\')">';
    html += ICON_GLOBE;
    html += '<span>已搜索到 ' + m.sr.length + ' 个网页</span>';
    html += '<span class="chevron-icon">' + ICON_CHEVRON_DOWN + '</span>';
    html += '</div>';
    html += '<div class="search-list" style="display:none">';
    if (m.sr) m.sr.forEach(function(r) {
      html += '<a class="search-item" href="' + escapeAttr(r.url) + '">' + escapeBasic(r.title) + '</a>';
      if (r.snippet) {
        html += '<div class="search-snippet">' + escapeBasic(r.snippet) + '</div>';
      }
    });
    html += '</div>';
    return html;
  }

  // ── 单条消息 HTML ──
  function renderMessageHtml(m) {
    var html = '';
    var isUser = m.role === 'user';
    html += '<div class="msg msg-' + m.role + '" data-id="' + escapeAttr(m.id) + '">';

    if (isUser) {
      // 用户消息：附件 + 文本气泡
      if (m.att && m.att.length) {
        html += '<div class="attachments">';
        m.att.forEach(function(a) {
          html += '<img class="attach-img" src="' + escapeAttr(a.uri) + '" />';
        });
        html += '</div>';
      }
      html += '<div class="user-bubble">' + escapeBasic(m.content) + '</div>';
      // 用户消息操作栏：复制 + 编辑
      html += '<div class="user-footer">';
      html += '<button class="action-btn copy-btn" onclick="window.copyMessage(\\'' + escapeAttr(m.id) + '\\')">' + ICON_COPY + '</button>';
      html += '<button class="action-btn" onclick="window.editMessage(\\'' + escapeAttr(m.id) + '\\')">' + ICON_EDIT + '</button>';
      html += '</div>';
    } else {
      // 助手消息：头像 + 内容区
      html += '<img class="avatar" src="' + escapeAttr(m.av || '') + '" />';
      html += '<div class="assistant-content">';

      // Reasoning 折叠区（仅当开启深度思考且有思考链时显示）
      if (m.rc && m.re) {
        html += '<div class="reasoning">';
        html += '<div class="reasoning-header" onclick="window.toggleReasoning(\\'' + escapeAttr(m.id) + '\\')">';
        if (m.st) {
          html += '<div class="thinking-spinner"></div>';
          html += '<span class="reasoning-label">思考中...</span>';
        } else {
          html += '<span class="reasoning-label">深度思考</span>';
          html += '<span class="chevron-icon">' + ICON_CHEVRON_DOWN + '</span>';
        }
        html += '</div>';
        // 思考链正文（默认折叠，仅在非 streaming 且展开时显示）
        if (!m.st) {
          html += '<div class="reasoning-body" style="display:none">' + escapeBasic(m.rc) + '</div>';
        }
        // 深度思考开启时，搜索结果放在思考链内
        if (m.sr && m.sr.length) {
          html += renderSearchHtml(m);
        }
        html += '</div>';
      }

      // 搜索结果（深度思考关闭时独立显示，在正文之前）
      if (!m.re && m.sr && m.sr.length) {
        html += renderSearchHtml(m);
      }

      // 正文
      if (m.content) {
        html += '<div class="msg-content">' + renderMarkdown(m.content) + '</div>';
      } else if (m.st) {
        html += '<div class="pulse-dots"><span></span><span></span><span></span></div>';
      }

      // 错误
      if (m.err) {
        html += '<div class="error-row">';
        html += '<span class="error-text">' + escapeBasic(m.err) + '</span>';
        html += '<button class="retry-btn" onclick="window.retryMessage(\\'' + escapeAttr(m.id) + '\\')">' + ICON_RETRY + ' 重试</button>';
        html += '</div>';
      }

      // 底部：时间戳 + 操作按钮（非 streaming 且有内容时才显示）
      if (!m.st && m.content) {
        html += '<div class="msg-footer">';
        html += '<span class="timestamp">' + formatTime(m.ts) + '</span>';
        // 版本切换器：仅当有多个回答版本时显示（vs = versions.length，含当前）
        if (m.vs > 1) {
          html += '<div class="version-switcher">';
          html += '<button class="version-arrow" onclick="window.switchVersion(\\'' + escapeAttr(m.id) + '\\', -1)">‹</button>';
          html += '<span class="version-text">' + (m.cv + 1) + '/' + m.vs + '</span>';
          html += '<button class="version-arrow" onclick="window.switchVersion(\\'' + escapeAttr(m.id) + '\\', 1)">›</button>';
          html += '</div>';
        }
        html += '<div class="footer-actions">';
        html += '<button class="action-btn" onclick="window.retryMessage(\\'' + escapeAttr(m.id) + '\\')">' + ICON_RETRY + '</button>';
        html += '<button class="action-btn copy-btn" onclick="window.copyMessage(\\'' + escapeAttr(m.id) + '\\')">' + ICON_COPY + '</button>';
        html += '</div>';
        html += '</div>';
      }

      html += '</div>'; // assistant-content
    }

    html += '</div>'; // msg
    return html;
  }

  // ── 状态：是否在底部附近（用于流式自动滚动） ──
  var isNearBottom = true;
  window.addEventListener('scroll', function() {
    isNearBottom = (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 100);
  });

  // ── flyAndBlur 入场动画 ──
  // 每条的 duration 按 circOut 缓动随索引递增，越靠后的条目动画越长
  // delay 从上往下递增，形成自然错落
  function animateIn() {
    var msgs = document.querySelectorAll('.msg');
    msgs.forEach(function(m, i) {
      m.classList.remove('visible');
      m.style.setProperty('--anim-delay', Math.min(i * 40, 320) + 'ms');
      m.style.setProperty('--anim-dur', (480 + Math.min(i * 20, 320)) + 'ms');
    });
    // 强制 reflow 让 transition 重新触发
    void document.body.offsetHeight;
    requestAnimationFrame(function() {
      msgs.forEach(function(m) { m.classList.add('visible'); });
    });
  }

  // ── 主题热更新（CSS 变量） ──
  window.setTheme = function(vars) {
    var root = document.documentElement;
    if (vars.text) root.style.setProperty('--text', vars.text);
    if (vars.muted) root.style.setProperty('--muted', vars.muted);
    if (vars.brand) root.style.setProperty('--brand', vars.brand);
    if (vars.brandRgb) root.style.setProperty('--brand-rgb', vars.brandRgb);
    if (vars.line) root.style.setProperty('--line', vars.line);
  };

  // ── 渲染所有消息（对话切换时调用） ──
  window.renderAll = function(messagesJson) {
    var container = document.getElementById('messages');
    container.innerHTML = '';
    var msgs = JSON.parse(messagesJson);
    var html = '';
    msgs.forEach(function(m) {
      html += renderMessageHtml(m);
    });
    container.innerHTML = html;
    // 高亮代码 + 拦截链接
    highlightCode(container);
    interceptLinks(container);
    // 滚动到底部
    isNearBottom = true;
    window.scrollTo(0, document.body.scrollHeight);
    // flyAndBlur 入场动画
    animateIn();
  };

  // ── 更新单条消息（流式 / 新消息追加） ──
  window.updateMessage = function(msgJson) {
    var m = JSON.parse(msgJson);
    var existing = document.querySelector('.msg[data-id="' + m.id + '"]');

    // 思考阶段（streaming 中、无正文、无错误）：视觉无变化（spinner 在转、reasoning-body 隐藏），
    // 跳过 DOM 更新，避免 replaceWith 重启 spinner CSS animation 导致抽搐。
    if (existing && m.st && !m.content && !m.err) {
      return;
    }

    // 局部更新优化：streaming 中 content 增量时只更新 .msg-content innerHTML，
    // 不 replaceWith 整个 .msg。避免 thinking-spinner 的 CSS animation 因 DOM 全替换而重启（抽搐根因）。
    // 条件：existing 存在、streaming 中、有 content、无错误、且已有 .msg-content（非 pulse-dots→content 切换）。
    if (existing && m.st && m.content && !m.err) {
      var mc = existing.querySelector('.msg-content');
      if (mc) {
        mc.innerHTML = renderMarkdown(m.content);
        highlightCode(mc);
        interceptLinks(mc);
        if (isNearBottom) {
          requestAnimationFrame(function() {
            window.scrollTo(0, document.body.scrollHeight);
          });
        }
        return;
      }
    }

    // 保留 reasoning / search 的展开状态
    var reasoningExpanded = false;
    var searchExpanded = false;
    if (existing) {
      var rb = existing.querySelector('.reasoning-body');
      if (rb && rb.style.display !== 'none') reasoningExpanded = true;
      var sl = existing.querySelector('.search-list');
      if (sl && sl.style.display !== 'none') searchExpanded = true;
    }

    var wasVisible = existing ? existing.classList.contains('visible') : false;
    var html = renderMessageHtml(m);
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    var newEl = tmp.firstElementChild;

    if (existing) {
      existing.replaceWith(newEl);
    } else {
      document.getElementById('messages').appendChild(newEl);
    }

    highlightCode(newEl);
    interceptLinks(newEl);

    // 恢复展开状态
    if (reasoningExpanded) {
      var nrb = newEl.querySelector('.reasoning-body');
      if (nrb) nrb.style.display = 'block';
      var nch = newEl.querySelector('.reasoning-header .chevron-icon');
      if (nch) nch.innerHTML = ICON_CHEVRON_UP;
    }
    if (searchExpanded) {
      var nsl = newEl.querySelector('.search-list');
      if (nsl) nsl.style.display = 'block';
      var nsch = newEl.querySelector('.search-badge .chevron-icon');
      if (nsch) nsch.innerHTML = ICON_CHEVRON_UP;
    }

    // 可见性：已存在的消息保持 visible，新消息触发入场动画
    if (wasVisible) {
      newEl.classList.add('visible');
    } else {
      newEl.style.setProperty('--anim-delay', '0ms');
      newEl.style.setProperty('--anim-dur', '480ms');
      requestAnimationFrame(function() {
        newEl.classList.add('visible');
      });
    }

    // 自动滚动（仅在用户位于底部附近时）
    if (isNearBottom) {
      requestAnimationFrame(function() {
        window.scrollTo(0, document.body.scrollHeight);
      });
    }
  };

  // ── 滚动到底部（RN 调用） ──
  window.scrollToBottom = function() {
    isNearBottom = true;
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  };

  // ── 复制反馈 ──
  window.showCopied = function(id) {
    var btn = document.querySelector('.msg[data-id="' + id + '"] .copy-btn');
    if (btn) {
      btn.innerHTML = ICON_CHECK;
      btn.style.color = '#4ade80';
      setTimeout(function() {
        btn.innerHTML = ICON_COPY;
        btn.style.color = '';
      }, 1500);
    }
  };

  // ── Reasoning 折叠/展开 ──
  window.toggleReasoning = function(id) {
    var el = document.querySelector('.msg[data-id="' + id + '"] .reasoning-body');
    if (!el) return;
    var expanded = el.style.display !== 'none';
    el.style.display = expanded ? 'none' : 'block';
    var chevron = document.querySelector('.msg[data-id="' + id + '"] .reasoning-header .chevron-icon');
    if (chevron) {
      chevron.innerHTML = expanded ? ICON_CHEVRON_DOWN : ICON_CHEVRON_UP;
    }
  };

  // ── 搜索结果折叠/展开 ──
  window.toggleSearch = function(id) {
    var el = document.querySelector('.msg[data-id="' + id + '"] .search-list');
    if (!el) return;
    var expanded = el.style.display !== 'none';
    el.style.display = expanded ? 'none' : 'block';
    var chevron = document.querySelector('.msg[data-id="' + id + '"] .search-badge .chevron-icon');
    if (chevron) {
      chevron.innerHTML = expanded ? ICON_CHEVRON_DOWN : ICON_CHEVRON_UP;
    }
  };

  // ── 复制消息（postMessage 给 RN 处理剪贴板） ──
  window.copyMessage = function(id) {
    pm({ type: 'copy', id: id });
  };

  // ── 重试消息（postMessage 给 RN） ──
  window.retryMessage = function(id) {
    pm({ type: 'retry', id: id });
  };

  // ── 切换回答版本（postMessage 给 RN） ──
  window.switchVersion = function(id, dir) {
    pm({ type: 'switchVersion', id: id, dir: dir });
  };

  // ── 编辑用户消息（postMessage 给 RN：回滚助手回复 + 填充输入框） ──
  window.editMessage = function(id) {
    pm({ type: 'edit', id: id });
  };

  // 通知 RN WebView 已就绪
  pm({ type: 'ready' });
})();
`;

// 构建 WebView HTML shell（静态，不含 theme/messages，由 JS 动态注入）
function buildShell(v: VendorAssets): string {
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
<style>${CSS}</style>
</head>
<body>
<div id="messages"></div>
<script>${JS}</script>
</body>
</html>`;
}

// 序列化消息为 WebView 使用的紧凑 JSON
function serializeMessages(
  messages: Message[],
  profileMap: Record<string, { avatar: string; name: string }>,
  defaultProfile: { avatar: string; name: string }
): string {
  return JSON.stringify(
    messages.map((m) => {
      const p = (m.profileKey && profileMap[m.profileKey]) || defaultProfile;
      return {
        id: m.id,
        role: m.role,
        content: m.content,
        rc: m.reasoningContent,
        re: m.reasoningEnabled,
        st: m.streaming,
        err: m.error,
        ts: m.timestamp,
        sr: m.searchResults,
        att: m.attachments?.map((a) => ({ uri: a.uri, w: a.width, h: a.height })),
        av: m.role === "assistant" ? p.avatar : undefined,
        pn: m.role === "assistant" ? m.profileName || p.name : undefined,
        vs: m.versions?.length || 0,
        cv: m.currentVersion ?? 0,
      };
    })
  );
}

// 序列化单条消息
function serializeMessage(
  m: Message,
  profileMap: Record<string, { avatar: string; name: string }>,
  defaultProfile: { avatar: string; name: string }
): string {
  return serializeMessages([m], profileMap, defaultProfile).replace(/^\[/, "").replace(/\]$/, "");
}

// 比较两条消息是否有差异（决定是否需要 updateMessage）
function messagesDiffer(a: Message, b: Message): boolean {
  if (a.content !== b.content) return true;
  if (a.reasoningContent !== b.reasoningContent) return true;
  if (a.streaming !== b.streaming) return true;
  if (a.error !== b.error) return true;
  if (JSON.stringify(a.searchResults) !== JSON.stringify(b.searchResults)) return true;
  return false;
}

export const ConversationView = forwardRef<ConversationViewHandle, Props>(
  function ConversationView({ messages, profile, theme, topInset, bottomInset, onRetry, onSwitchVersion, onEdit }, ref) {
    const webviewRef = useRef<WebView>(null);
    const loadedRef = useRef(false);
    const messagesRef = useRef(messages);
    const lastRenderedRef = useRef<Message[]>([]);
    const convKeyRef = useRef("");

    // 所有角色的头像映射（用于按 profileKey 查找消息对应角色头像）
    const profileMap = useMemo(() => {
      const map: Record<string, { avatar: string; name: string }> = {};
      for (const p of profiles) {
        map[p.key] = { avatar: p.avatar, name: p.name };
      }
      return map;
    }, []);

    const defaultProfile = useMemo(
      () => ({ avatar: profile.avatar, name: profile.name }),
      [profile.avatar, profile.name]
    );

    // 静态 HTML shell（仅构建一次，永不重载）
    const shell = useMemo(() => buildShell(VENDOR), []);

    // 初始注入：设置 CSS 变量 + insets（在页面脚本执行前运行）
    // 仅在首次加载时执行，后续主题/inset 变更通过 injectJavaScript 热更新
    const initialInject = useMemo(() => {
      // 用 style.setProperty 逐条设置（避免字符串拼接错误）
      const js = `
        var r = document.documentElement;
        r.style.setProperty('--text', ${JSON.stringify(theme.text)});
        r.style.setProperty('--muted', ${JSON.stringify(theme.muted)});
        r.style.setProperty('--brand', ${JSON.stringify(theme.brand)});
        r.style.setProperty('--brand-rgb', ${JSON.stringify(theme.brandRgb)});
        r.style.setProperty('--line', ${JSON.stringify(theme.line)});
        // padding 用 CSS 变量（设在 documentElement 上），#messages 的 CSS 引用 var(--pad-top)/var(--pad-bottom)。
        // 不直接设 msgs.style.paddingTop：injectedJavaScriptBeforeContentLoaded 执行时机过早，
        // #messages 可能尚未解析，getElementById 返回 null 导致 padding 丢失
        // → 消息贴顶/底被顶栏与 Composer 遮挡（表现为调大 inset 数值也无效）。
        r.style.setProperty('--pad-top', '${topInset}px');
        r.style.setProperty('--pad-bottom', '${bottomInset}px');
        true;
      `;
      return js;
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // WebView 加载完成后渲染初始消息
    const handleLoadEnd = useCallback(() => {
      loadedRef.current = true;
      // 兜底：WebView 加载完成时 DOM 已就绪，再次设置 padding 变量，
      // 防止 initialInject 因执行时机过早（#messages 未解析）导致 padding 丢失。
      // 此时 documentElement 一定存在，变量必能设上，#messages 的 CSS 立即应用。
      webviewRef.current?.injectJavaScript(
        `document.documentElement.style.setProperty('--pad-top','${topInset}px');document.documentElement.style.setProperty('--pad-bottom','${bottomInset}px');true;`
      );
      const serialized = serializeMessages(messagesRef.current, profileMap, defaultProfile);
      // 关键：用 JSON.stringify 包裹已序列化的 JSON 字符串，使其成为 JS 字符串字面量。
      // 不能用模板字面量 `${serialized}`：那样 renderAll 收到的是数组对象而非字符串，
      // JSON.parse(array) 会先 String(array) 得到 "[object Object]" 再解析失败。
      // 同时消息内容中可能含有反引号（markdown 代码 span），会关闭外层模板字面量。
      webviewRef.current?.injectJavaScript(
        'window.renderAll(' + JSON.stringify(serialized) + '); true;'
      );
      lastRenderedRef.current = messagesRef.current;
      convKeyRef.current = messagesRef.current.length > 0 ? messagesRef.current[0].id : "";
    }, [profileMap, defaultProfile]);

    // 消息变化：对话切换 → 全量渲染 + flyAndBlur；同会话 → 增量更新
    useEffect(() => {
      messagesRef.current = messages;
      if (!loadedRef.current || !webviewRef.current) return;

      const convKey = messages.length > 0 ? messages[0].id : "";
      const oldMsgs = lastRenderedRef.current;

      // 对话切换（首条消息 ID 变化，或消息变少）→ 全量重新渲染
      if (convKey !== convKeyRef.current || messages.length < oldMsgs.length) {
        convKeyRef.current = convKey;
        const serialized = serializeMessages(messages, profileMap, defaultProfile);
        webviewRef.current.injectJavaScript(
          'window.renderAll(' + JSON.stringify(serialized) + '); true;'
        );
        lastRenderedRef.current = messages;
        return;
      }

      // 同会话：找出变化/新增的消息，逐条更新
      const changed: Message[] = [];
      for (let i = 0; i < messages.length; i++) {
        if (i >= oldMsgs.length) {
          changed.push(messages[i]); // 新追加的消息
        } else if (messages[i].id !== oldMsgs[i].id) {
          changed.push(messages[i]); // ID 变化（不太可能，安全起见）
        } else if (messagesDiffer(oldMsgs[i], messages[i])) {
          changed.push(messages[i]); // 内容变化（流式更新）
        }
      }

      for (const m of changed) {
        const serialized = serializeMessage(m, profileMap, defaultProfile);
        webviewRef.current.injectJavaScript(
          'window.updateMessage(' + JSON.stringify(serialized) + '); true;'
        );
      }

      lastRenderedRef.current = messages;
    }, [messages, profileMap, defaultProfile]);

    // 主题变化：通过 CSS 变量热更新，无需重载 WebView
    useEffect(() => {
      if (!loadedRef.current || !webviewRef.current) return;
      const js = `window.setTheme(${JSON.stringify({
        text: theme.text,
        muted: theme.muted,
        brand: theme.brand,
        brandRgb: theme.brandRgb,
        line: theme.line,
      })}); true;`;
      webviewRef.current.injectJavaScript(js);
    }, [theme]);

    // insets 变化：更新 padding（设 CSS 变量，#messages 自动应用）
    useEffect(() => {
      if (!loadedRef.current || !webviewRef.current) return;
      const js = `document.documentElement.style.setProperty('--pad-top','${topInset}px');document.documentElement.style.setProperty('--pad-bottom','${bottomInset}px');true;`;
      webviewRef.current.injectJavaScript(js);
    }, [topInset, bottomInset]);

    // 暴露给 RN 的方法
    useImperativeHandle(ref, () => ({
      scrollToBottom: () => {
        webviewRef.current?.injectJavaScript("window.scrollToBottom(); true;");
      },
      injectJS: (js: string) => {
        webviewRef.current?.injectJavaScript(js);
      },
    }), []);

    // 处理 WebView → RN 消息
    const handleMessage = useCallback(
      (event: { nativeEvent: { data: string } }) => {
        try {
          const data = JSON.parse(event.nativeEvent.data);
          if (data.type === "link" && typeof data.url === "string") {
            Linking.openURL(data.url).catch(() => {});
          } else if (data.type === "copy" && typeof data.id === "string") {
            const msg = messagesRef.current.find((m) => m.id === data.id);
            if (msg) {
              Clipboard.setStringAsync(msg.content).then(() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                webviewRef.current?.injectJavaScript(
                  `window.showCopied(${JSON.stringify(data.id)}); true;`
                );
              });
            }
          } else if (data.type === "retry" && typeof data.id === "string") {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onRetry?.(data.id);
          } else if (data.type === "switchVersion" && typeof data.id === "string" && (data.dir === -1 || data.dir === 1)) {
            onSwitchVersion?.(data.id, data.dir);
          } else if (data.type === "edit" && typeof data.id === "string") {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onEdit?.(data.id);
          }
        } catch {
          // ignore
        }
      },
      [onRetry, onSwitchVersion, onEdit]
    );

    return (
      <WebView
        ref={webviewRef}
        source={{ html: shell }}
        style={{ flex: 1, backgroundColor: "transparent" }}
        onMessage={handleMessage}
        originWhitelist={["*"]}
        scrollEnabled
        nestedScrollEnabled={false}
        overScrollMode="never"
        bounces={false}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        pointerEvents="auto"
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        injectedJavaScriptBeforeContentLoaded={initialInject}
        onLoadEnd={handleLoadEnd}
        onShouldStartLoadWithRequest={(req) => {
          if (req.url === "about:blank" || req.url.startsWith("data:")) return true;
          return false;
        }}
        textInteractionEnabled
      />
    );
  }
);
