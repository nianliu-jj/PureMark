export interface MarkdownSyntaxIssue {
  line: number;
  column: number;
  message: string;
  excerpt: string;
}

interface MarkerRule {
  marker: string;
  label: string;
}

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

function isEscaped(text: string, index: number): boolean {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) {
    slashCount++;
  }
  return slashCount % 2 === 1;
}

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

function getColumn(text: string, pattern: RegExp): number {
  const match = pattern.exec(text);
  return match ? match.index + 1 : 1;
}

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
