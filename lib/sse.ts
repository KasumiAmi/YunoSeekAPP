// SSE 流式解析器：替代现有 app.js parseSseChunk + splitSafeThinkTail
// 解析 OpenAI 兼容的 SSE 流（data: {...}\n\n），提取 delta content / reasoning_content

export interface StreamDelta {
  content?: string;
  reasoningContent?: string;
  done?: boolean;
}

export type StreamCallback = (delta: StreamDelta) => void;

/**
 * 解析 SSE 流，逐 chunk 回调。
 * 支持：
 * - data: {choices:[{delta:{content,reasoning_content}}]}
 * - data: [DONE]
 * - event: yuno-search (联网搜索结果)
 * - <think>...</think> 标签内嵌 reasoning
 */
export async function parseSSEStream(
  response: Response,
  onDelta: StreamCallback,
  onSearch?: (results: any) => void
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No readable stream");

  const decoder = new TextDecoder();
  let buffer = "";
  let thinkBuffer = ""; // 跨 chunk 的 <think> 标签缓冲
  let inThink = false;
  let nextEventIsSearch = false; // 标记下一行 data 是搜索结果

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // 保留不完整的最后一行

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // event: yuno-search → 标记下一行 data 是搜索结果
        if (trimmed.startsWith("event: yuno-search")) {
          nextEventIsSearch = true;
          continue;
        }

        // 其他 event: 行（非搜索），重置标记
        if (trimmed.startsWith("event:")) {
          nextEventIsSearch = false;
          continue;
        }

        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);

        if (data === "[DONE]") {
          // 处理残留 think buffer
          if (thinkBuffer) {
            onDelta({ reasoningContent: thinkBuffer });
            thinkBuffer = "";
          }
          onDelta({ done: true });
          return;
        }

        try {
          const parsed = JSON.parse(data);

          // 联网搜索结果（event: yuno-search 后的 data 行）
          if (nextEventIsSearch) {
            nextEventIsSearch = false;
            if (onSearch) onSearch(parsed);
            continue;
          }

          const delta = parsed?.choices?.[0]?.delta;
          if (!delta) continue;

          // reasoning_content（标准字段）
          const reasoning =
            delta.reasoning_content || delta.reasoningContent ||
            delta.reasoning || delta.thinking || delta.analysis;

          // content（可能内嵌 <think> 标签）
          let content = delta.content || "";

          if (content) {
            // 解析 <think>...</think> 标签
            const result = parseThinkTags(content, inThink, thinkBuffer);
            inThink = result.inThink;
            thinkBuffer = result.buffer;

            if (result.reasoning) {
              onDelta({ reasoningContent: result.reasoning });
            }
            if (result.content) {
              onDelta({ content: result.content });
            }
          }

          if (reasoning) {
            onDelta({ reasoningContent: reasoning });
          }
        } catch {
          // JSON 解析失败，跳过
        }
      }
    }

    // 流结束但未收到 [DONE]
    if (thinkBuffer) {
      onDelta({ reasoningContent: thinkBuffer });
    }
    onDelta({ done: true });
  } finally {
    reader.releaseLock();
  }
}

interface ThinkParseResult {
  content: string;
  reasoning: string;
  inThink: boolean;
  buffer: string;
}

/**
 * 解析 content 中的 <think>...</think> 标签，分离 reasoning 和正文。
 * 支持跨 chunk 的标签缓冲。
 */
function parseThinkTags(text: string, inThink: boolean, prevBuffer: string): ThinkParseResult {
  let content = "";
  let reasoning = "";
  let buffer = prevBuffer;
  let current = text;

  // 如果有上一个 chunk 的缓冲，拼接
  if (buffer) {
    current = buffer + current;
    buffer = "";
  }

  while (current.length > 0) {
    if (inThink) {
      const closeIdx = current.indexOf("</think>");
      if (closeIdx === -1) {
        // 检查是否是 </think> 的前缀（跨 chunk）
        const partial = findPartialTag(current, "</think>");
        if (partial > 0) {
          reasoning += current.slice(0, current.length - partial);
          buffer = current.slice(current.length - partial);
        } else {
          reasoning += current;
        }
        current = "";
      } else {
        reasoning += current.slice(0, closeIdx);
        current = current.slice(closeIdx + 8); // "</think>".length = 8
        inThink = false;
      }
    } else {
      const openIdx = current.indexOf("<think>");
      if (openIdx === -1) {
        // 检查是否是 <think> 的前缀（跨 chunk）
        const partial = findPartialTag(current, "<think>");
        if (partial > 0) {
          content += current.slice(0, current.length - partial);
          buffer = current.slice(current.length - partial);
        } else {
          content += current;
        }
        current = "";
      } else {
        content += current.slice(0, openIdx);
        current = current.slice(openIdx + 7); // "<think>".length = 7
        inThink = true;
      }
    }
  }

  return { content, reasoning, inThink, buffer };
}

/**
 * 检查 text 末尾是否是 tag 的前缀（用于跨 chunk 缓冲）。
 * 返回匹配的前缀长度，0 表示不匹配。
 */
function findPartialTag(text: string, tag: string): number {
  for (let len = Math.min(tag.length - 1, text.length); len > 0; len--) {
    if (text.endsWith(tag.slice(0, len))) return len;
  }
  return 0;
}
