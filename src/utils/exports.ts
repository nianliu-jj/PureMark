/**
 * 文档导出工具。
 *
 * 渲染层导出能力的统一入口，封装多种导出格式：
 * - HTML：克隆当前编辑器 DOM、内联样式与图片，生成自包含 HTML 文件
 * - PDF / 长图：委托 services/exports 下的实现
 * - Word：将 Markdown 源码或渲染 DOM 解析为结构化 Block 后导出 docx
 * - 纯文本：直接下载 Markdown 源码
 * 同时提供定位“当前激活编辑器元素 / 选择器”的辅助方法。
 */
import { exportAsWord as doExportWord } from "@/services/exports/docx";
import { exportAsPDF as doExportPDF } from "@/services/exports/pdf";
import { exportAsImage as doExportImage } from "@/services/exports/image";
import type { DocxBlock, ExportImageOptions, ExportPDFOptions } from "@/shared/types/export";

type Block = DocxBlock;

// 定位当前激活编辑器正文容器的选择器（data-active="true" 标记激活的实例）
const ACTIVE_EDITOR_SELECTOR = '.puremark-editor-instance[data-active="true"] .puremark-container';

/**
 * 获取当前激活编辑器的正文 DOM 元素。
 *
 * @returns 激活编辑器的容器元素
 * @throws 未找到激活编辑器元素时抛出错误
 */
export function getActiveEditorElement(): HTMLElement {
  const element = document.querySelector(ACTIVE_EDITOR_SELECTOR);
  if (!(element instanceof HTMLElement)) throw new Error("Active editor element not found");
  return element;
}

/**
 * 获取当前激活编辑器正文容器的 CSS 选择器。
 *
 * @returns 选择器字符串（供 PDF / 图片导出按选择器查找元素）
 */
export function getActiveEditorSelector(): string {
  return ACTIVE_EDITOR_SELECTOR;
}

/**
 * 导出选定元素为一个带样式和图片的独立 HTML 文件
 * @param element - 要导出的元素
 * @param filename - 导出文件名（默认为 export.html）
 */
export async function exportElementWithStylesAndImages(
  element: HTMLElement,
  filename: string = "export.html"
): Promise<void> {
  // 克隆元素并应用内联样式
  const cloned = cloneWithInlineStyles(element);

  // 将 <img> 转为 base64
  await inlineImages(cloned);

  // 生成完整 HTML
  const html = `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        min-width: 1100px;
        height: auto;
      }
      .export-container {
        box-sizing: border-box;
        display: flex;
        justify-content: center;
      }
      .export-container > .puremark-container {
        width: 100%!important;
      }
      .export-container > .puremark-container .puremark-editor,.export-container > .puremark-container .puremark-editor > div[contenteditable="true"] {
        width: 100%!important;
      }
      p {
        word-break: break-word;
        width: 100%!important;
      }
    </style>
  </head>
  <body>
    <div class="export-container">${cloned.outerHTML}</div>
  </body>
  </html>`;

  // 下载文件
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 克隆元素及其所有子元素，并将样式内联化
 * @param element - 原始元素
 * @returns 克隆后的元素（样式已内联）
 */
function cloneWithInlineStyles(element: HTMLElement): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  applyStylesRecursive(element, clone);
  return clone;
}

/**
 * 递归地应用 computed style
 * @param src - 原始节点
 * @param dest - 克隆节点
 */
function applyStylesRecursive(src: Element, dest: Element): void {
  const computed = getComputedStyle(src);
  const style = Array.from(computed)
    .map((key) => `${key}:${computed.getPropertyValue(key)};`)
    .join("");
  dest.setAttribute("style", style);

  // 🚨 修复 <a> 链接的点击性
  if (dest instanceof HTMLAnchorElement) {
    dest.style.pointerEvents = "auto";
    dest.style.cursor = "pointer";
    dest.style.textDecoration = "underline";
    dest.setAttribute("target", "_blank"); // 可选：让导出文件中点击在新标签打开
  }

  const srcChildren = Array.from(src.children);
  const destChildren = Array.from(dest.children);
  for (let i = 0; i < srcChildren.length; i++) {
    applyStylesRecursive(srcChildren[i], destChildren[i]);
  }
}

/**
 * 将元素中的所有 <img> src 转换为 base64（data URL）
 * @param root - 要处理的根元素
 */
async function inlineImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));

  const tasks = images.map(async (img) => {
    const src = img.src;
    if (src.startsWith("data:")) return; // 已经是内联的

    try {
      const res = await fetch(src, { mode: "cors" });
      const blob = await res.blob();
      const base64 = await blobToDataURL(blob);
      img.src = base64;
    } catch (err) {
      console.warn("图片内联失败:", src, err);
    }
  });

  await Promise.all(tasks);
}

/**
 * Blob → data URL
 * @param blob - Blob 对象
 * @returns base64 编码的 data URL
 */
function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

/**
 * 导出指定元素为 PDF 文件。
 *
 * 委托 services/exports/pdf 实现，按选择器定位元素后生成 PDF。
 *
 * @param elementSelector 目标元素的 CSS 选择器
 * @param outputName 输出文件名
 * @param options PDF 导出选项（页面尺寸、边距等）
 */
export async function exportElementAsPDF(
  elementSelector: string,
  outputName: string,
  options?: ExportPDFOptions
): Promise<void> {
  await doExportPDF(
    elementSelector,
    outputName,
    options as import("@/shared/types/export").ExportPDFOptions | undefined
  );
}

/**
 * 导出指定元素为长图片。
 *
 * 委托 services/exports/image 实现，将整块内容渲染为单张长图。
 *
 * @param elementSelector 目标元素的 CSS 选择器
 * @param fileBaseName 输出文件基础名（不含扩展名）
 * @param options 图片导出选项（格式、缩放等）
 */
export async function exportElementAsImage(
  elementSelector: string,
  fileBaseName: string,
  options: ExportImageOptions
): Promise<void> {
  await doExportImage(elementSelector, fileBaseName, options);
}

/**
 * 遍历 Markdown 渲染后的 DOM，生成结构化 Block 数据。
 *
 * 深度优先遍历指定根元素，过滤掉非正文节点（拖拽手柄、工具栏、菜单、
 * 链接预览、行内编辑器等带特定 class 或 data-ignore 的节点），
 * 将标题、段落、代码块（含 CodeMirror 内容）、有序 / 无序列表识别为对应 Block。
 *
 * @param selector 渲染容器的 CSS 选择器
 * @returns 结构化 Block 列表
 * @throws 未找到元素时抛出错误
 */
export function serializeMarkdownToBlocks(selector: string): Block[] {
  const el = document.querySelector(selector);
  if (!el) throw new Error("Element not found");

  const blocks: Block[] = [];

  function traverse(node: Node) {
    if (!(node instanceof HTMLElement)) return;

    const className = node.className || "";
    if (
      className.includes("puredown-block-handle") ||
      className.includes("crepe-drop-cursor") ||
      className.includes("puredown-link-preview") ||
      className.includes("puredown-link-edit") ||
      className.includes("puredown-toolbar") ||
      className.includes("puredown-latex-inline-edit") ||
      className.includes("puredown-slash-menu")
    ) {
      return;
    }

    if (node.dataset.ignore) return;
    if (node.classList.contains("cm-content")) {
      const lines: string[] = [];
      node.querySelectorAll(".cm-line").forEach((line) => {
        lines.push(line.textContent || "");
      });
      blocks.push({ type: "code", lines });
      return;
    }
    const tag = node.tagName.toLowerCase();
    if (tag.startsWith("h")) {
      blocks.push({
        type: "heading",
        level: Number(tag[1]) as 1 | 2 | 3,
        text: node.textContent || "",
      });
    } else if (tag === "p") {
      blocks.push({ type: "paragraph", text: node.textContent || "" });
    } else if (tag === "pre") {
      blocks.push({ type: "code", lines: node.textContent?.split("\n") || [] });
    } else if (tag === "ul" || tag === "ol") {
      const items: string[] = [];
      node.querySelectorAll("li").forEach((li) => items.push(li.textContent || ""));
      blocks.push({ type: "list", items, ordered: tag === "ol" });
    }

    node.childNodes.forEach(traverse);
  }

  traverse(el);
  return blocks;
}

/**
 * 将 Markdown 源码导出为 Word（docx）文件。
 *
 * 先把源码解析为结构化 Block，再委托 services/exports/docx 生成文档。
 *
 * @param markdown Markdown 源码
 * @param outputName 输出文件名
 */
export async function exportMarkdownAsWord(markdown: string, outputName: string): Promise<void> {
  const blocks = parseMarkdownToBlocks(markdown);
  await doExportWord(blocks as DocxBlock[], outputName);
}

/**
 * 将 Markdown 源码文本解析为结构化 Block 数据。
 *
 * 逐行扫描源码并识别块级结构：标题（最多映射到 3 级）、围栏代码块、
 * 有序 / 无序列表（连续行合并为一个列表）、空行跳过，其余按段落处理。
 *
 * @param markdown Markdown 源码
 * @returns 结构化 Block 列表
 */
export function parseMarkdownToBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 标题
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 3) as 1 | 2 | 3;
      blocks.push({ type: "heading", level, text: headingMatch[2] });
      i++;
      continue;
    }

    // 代码块
    if (line.trimStart().startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "code", lines: codeLines });
      i++; // 跳过结束的 ```
      continue;
    }

    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", items, ordered: false });
      continue;
    }

    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", items, ordered: true });
      continue;
    }

    // 空行跳过
    if (line.trim() === "") {
      i++;
      continue;
    }

    // 段落
    blocks.push({ type: "paragraph", text: line });
    i++;
  }

  return blocks;
}

/**
 * 导出为纯文本文件（直接使用 Markdown 源码）。
 *
 * 将源码包成 Blob 并触发浏览器下载，下载后延迟释放对象 URL。
 *
 * @param markdown Markdown 源码
 * @param outputName 输出文件名（默认 export.txt）
 */
export function exportAsText(markdown: string, outputName: string = "export.txt"): void {
  const blob = new Blob([markdown], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = outputName;
  a.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
