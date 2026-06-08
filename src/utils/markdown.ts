/**
 * Markdown 文本归一化工具（脏检查场景）。
 *
 * 用于判断文档是否被修改时的内容比对，消除尾部空白差异，
 * 避免仅末尾换行不同就被误判为“已修改”。
 */

/**
 * 归一化 Markdown 内容以用于脏检查（dirty check）比对。
 *
 * 去除文本末尾的所有连续空行及尾随空白（空格 / 制表符），
 * 使“仅尾部空白不同”的两份内容比对结果相等。
 *
 * @param content 原始 Markdown 文本
 * @returns 去除尾部空白后的文本
 */
export function normalizeMarkdownForDirtyCheck(content: string): string {
  return content.replace(/(?:\r?\n(?:[ \t]*\r?\n)*)[ \t]*$/u, "");
}
