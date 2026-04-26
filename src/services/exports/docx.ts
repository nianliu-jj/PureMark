import type { DocxBlock } from "@/shared/types/export";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

const JS_KEYWORDS = /\b(?:const|let|var|function|return|if|else)\b/g;

function renderHeading(block: Extract<DocxBlock, { type: "heading" }>): Paragraph {
  const heading =
    block.level === 1
      ? HeadingLevel.HEADING_1
      : block.level === 2
        ? HeadingLevel.HEADING_2
        : HeadingLevel.HEADING_3;
  return new Paragraph({ text: block.text, heading });
}

function renderListItems(block: Extract<DocxBlock, { type: "list" }>): Paragraph[] {
  return block.items.map(
    (item) =>
      new Paragraph({
        text: item,
        numbering: {
          reference: block.ordered ? "my-numbered" : "my-bullet",
          level: 0,
        },
      })
  );
}

function renderCodeLine(line: string, index: number): Paragraph {
  const children: TextRun[] = [
    new TextRun({
      text: `${String(index + 1).padStart(3, "0")} | `,
      color: "999999",
    }),
  ];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(JS_KEYWORDS);
  while ((match = re.exec(line))) {
    if (match.index > lastIndex) {
      children.push(new TextRun({ text: line.slice(lastIndex, match.index), font: "Courier New" }));
    }
    children.push(
      new TextRun({ text: match[0], bold: true, color: "0000FF", font: "Courier New" })
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < line.length) {
    children.push(new TextRun({ text: line.slice(lastIndex), font: "Courier New" }));
  }
  return new Paragraph({ children, spacing: { after: 100 } });
}

function buildParagraphs(blocks: DocxBlock[]): Paragraph[] {
  const out: Paragraph[] = [];
  for (const b of blocks) {
    if (b.type === "heading") out.push(renderHeading(b));
    else if (b.type === "paragraph") out.push(new Paragraph({ text: b.text }));
    else if (b.type === "list") out.push(...renderListItems(b));
    else if (b.type === "code") b.lines.forEach((line, i) => out.push(renderCodeLine(line, i)));
  }
  return out;
}

export async function exportAsWord(blocks: DocxBlock[], defaultName: string): Promise<void> {
  const doc = new Document({
    sections: [{ children: buildParagraphs(blocks) }],
    numbering: {
      config: [
        {
          reference: "my-bullet",
          levels: [{ level: 0, format: "bullet", text: "•", alignment: "left" }],
        },
        {
          reference: "my-numbered",
          levels: [{ level: 0, format: "decimal", text: "%1.", alignment: "left" }],
        },
      ],
    },
  });

  const blob = await Packer.toBlob(doc);
  const buffer = new Uint8Array(await blob.arrayBuffer());

  const targetPath = await saveDialog({
    title: "导出为 Word",
    defaultPath: defaultName.endsWith(".docx") ? defaultName : `${defaultName}.docx`,
    filters: [{ name: "Word Document", extensions: ["docx"] }],
  });
  if (!targetPath) {
    throw new Error("用户取消了保存");
  }

  await writeFile(targetPath, buffer);
}
