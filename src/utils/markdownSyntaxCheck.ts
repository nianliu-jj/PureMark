/**
 * Markdown 语法检查工具。
 *
 * 对 Markdown 源码做轻量级静态校验，逐行扫描常见的语法问题：
 * 行内标记未成对（粗体 / 斜体 / 代码 / 数学等）、标题井号缺空格或超级数、
 * 链接 / 图片语法缺括号、代码围栏未闭合。
 * 返回结构化的问题列表（含行号、列号、提示与摘录）供 UI 展示。
 */

/** 单条语法问题描述 */
export interface MarkdownSyntaxIssue {
  /** 问题所在行号（从 1 开始） */
  line: number;
  /** 问题所在列号（从 1 开始） */
  column: number;
  /** 面向用户的提示文案 */
  message: string;
  /** 问题所在行的内容摘录 */
  excerpt: string;
}

/** 行内成对标记的检查规则 */
interface MarkerRule {
  /** 标记字符串，如 ** 或 ` */
  marker: string;
  /** 未成对时的提示文案 */
  label: string;
}

// 需要成对出现的行内标记规则。
// 顺序敏感：多字符标记（**、__）排在单字符（*、_）之前，避免误判。
const INLINE_MARKERS: MarkerRule[] = [
  { marker: "**", label: "粗体标记 ** 未成对" },
  { marker: "__", label: "粗体标记 __ 未成对" },
  { marker: "~~", label: "删除线标记 ~~ 未成对" },
  { marker: "==", label: "高亮标记 == 未成对" },
  { marker: "`", label: "行内代码标记 ` 未成对" },
  { marker: "$", label: "行内数学标记 $ 未成对" },
  { marker: "*", label: "斜体标记 * 未成对" },
  { marker: "_", label: "斜体标记 _ 未成对" },
];

/**
 * 判断指定位置的字符是否被反斜杠转义。
 *
 * 向前统计连续反斜杠数量，奇数个表示当前字符被转义（应跳过）。
 */
function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) {
    slashCount++;
  }
  return slashCount % 2 === 1;
}

/**
 * 统计某行中未被转义的标记出现次数。
 *
 * 逐个查找 marker 出现位置，跳过被反斜杠转义的命中，
 * 用于后续按奇偶判断标记是否成对。
 */
function countMarker(text: string, marker: string): number {
  let count = 0;
  let index = 0;
  while (index < text.length) {
    const found = text.indexOf(marker, index);
    if (found === -1) break;
    if (!isEscaped(text, found)) {
      count++;
    }
    index = found + marker.length;
  }
  return count;
}

/** 返回正则首个匹配的列号（从 1 开始），无匹配则返回 1 */
function getColumn(text: string, pattern: RegExp): number {
  const match = pattern.exec(text);
  return match ? match.index + 1 : 1;
}

/** 向问题列表追加一条记录（空行摘录统一显示为 "(空行)"） */
function pushIssue(
  issues: MarkdownSyntaxIssue[],
  line: number,
  column: number,
  message: string,
  excerpt: string
) {
  issues.push({
    line,
    column,
    message,
    excerpt: excerpt.trim() || "(空行)",
  });
}

/**
 * 检查 Markdown 源码并返回所有语法问题。
 *
 * 算法：先统一换行为 LF 再逐行扫描。
 * - 代码围栏（``` 或 ~~~）：进入围栏后跳过内部所有行，遇到同类型标记出栈；
 *   扫描结束仍未闭合则报告“代码块缺少结束围栏”。
 * - 非围栏行依次检查：标题 # 后缺空格、标题超过 6 级、
 *   图片 / 链接缺右中括号或右圆括号、行内成对标记按奇偶判定是否未闭合
 *   （每行命中一种即停止，避免重复报告）。
 *
 * @param content Markdown 源码文本
 * @returns 语法问题列表（无问题则为空数组）
 */
export function checkMarkdownSyntax(content: string): MarkdownSyntaxIssue[] {
  const issues: MarkdownSyntaxIssue[] = [];
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let fence: { marker: string; line: number } | null = null;

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);

    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) {
        fence = { marker, line: lineNo };
      } else if (fence.marker === marker) {
        fence = null;
      }
      return;
    }

    if (fence) return;

    if (/^#{1,6}\S/.test(trimmed)) {
      pushIssue(issues, lineNo, getColumn(line, /#{1,6}\S/), "标题标记 # 后需要保留一个空格", line);
    }

    if (/^#{7,}\s/.test(trimmed)) {
      pushIssue(issues, lineNo, getColumn(line, /#{7,}/), "标题最多支持 6 级", line);
    }

    if (/!\[[^\]]*$/.test(line)) {
      pushIssue(issues, lineNo, getColumn(line, /!\[/), "图片语法缺少 ] 或 (路径)", line);
    }

    if (/(?<!!)\[[^\]]*$/.test(line)) {
      pushIssue(issues, lineNo, getColumn(line, /(?<!!)\[/), "链接语法缺少 ] 或 (地址)", line);
    }

    if (/!?\[[^\]]+\]\([^)]*$/.test(line)) {
      pushIssue(issues, lineNo, getColumn(line, /!?\[/), "链接或图片语法缺少右括号 )", line);
    }

    for (const rule of INLINE_MARKERS) {
      const count = countMarker(line, rule.marker);
      if (count % 2 !== 0) {
        pushIssue(
          issues,
          lineNo,
          getColumn(line, new RegExp(`\\${rule.marker[0]}`)),
          rule.label,
          line
        );
        break;
      }
    }
  });

  const unclosedFence = fence as { marker: string; line: number } | null;
  if (unclosedFence) {
    pushIssue(
      issues,
      unclosedFence.line,
      1,
      "代码块缺少结束围栏",
      lines[unclosedFence.line - 1] ?? ""
    );
  }

  return issues;
}
