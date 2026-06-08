/**
 * Markdown 文本预处理工具。
 *
 * 在 Markdown 进入编辑器内核解析前做基础清洗：
 * 补全未闭合的代码块、统一 BOM 与换行符。
 */

/**
 * 修复未闭合的代码块。
 *
 * 统计 ``` 围栏出现次数，若为奇数则说明存在未闭合代码块，
 * 自动在文本末尾追加一行 ``` 完成闭合，避免后续解析异常。
 *
 * @param markdown 原始 Markdown 文本
 * @returns 闭合后的文本（原本闭合则原样返回）
 */
export function fixUnclosedCodeBlock(markdown: string): string {
  const count = (markdown.match(/```/g) || []).length;
  if (count % 2 !== 0) {
    console.warn("[Puredown] 检测到未闭合的代码块，已自动补全。");
    return `${markdown}\n\`\`\``;
  }
  return markdown;
}

/**
 * 规范化 Markdown 文本。
 *
 * 移除文件头部的 BOM 标记，并将 CRLF 换行统一替换为 LF，
 * 确保编辑器内部始终以 LF 处理换行。
 *
 * @param text 原始文本
 * @returns 归一化后的文本
 */
export function normalizeMarkdown(text: string): string {
  return (
    text
      // 移除 BOM
      .replace(/^\uFEFF/, "")
      // 替换 CRLF → LF
      .replace(/\r\n/g, "\n")
  );
}
