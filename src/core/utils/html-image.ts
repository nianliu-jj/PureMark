/**
 * HTML 图片工具
 *
 * 负责在 Markdown 与 `<img>` HTML 写法之间互转：
 * 解析单行 `<img>` 标签为安全的图片属性，以及根据图片 attrs 重建源码文本
 * （优先保留原始 HTML 写法，否则生成标准 Markdown 图片/链接图片语法）。
 */

/** 从 HTML `<img>` 标签解析得到的图片信息 */
export interface ParsedHtmlImage {
  src: string;
  alt: string;
  title: string;
  htmlSource: string;
}

/** 用于重建图片源码文本的属性集合 */
export interface ImageSourceAttrs {
  src?: string;
  alt?: string;
  title?: string;
  linkHref?: string;
  linkTitle?: string;
  htmlSource?: string;
}

const DANGEROUS_URL_RE = /^\s*(javascript|vbscript|data)\s*:/i;
const HTML_IMAGE_RE = /^<img(?:\s(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?>$/i;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+)))?/g;

/**
 * 解析单行 `<img>` HTML 标签为图片信息。
 * 会校验整行是否为合法的 `<img>` 标签，并过滤 javascript/vbscript/data 等危险 URL 协议。
 * @param source 待解析的源码行
 * @returns 解析出的图片信息；若不是合法 `<img>` 或 src 危险/缺失则返回 null
 */
export function parseHtmlImageSource(source: string): ParsedHtmlImage | null {
  const htmlSource = source.trim();
  if (!HTML_IMAGE_RE.test(htmlSource)) return null;

  const attrs: Record<string, string> = {};
  const attrSource = htmlSource.replace(/^<img/i, "").replace(/\s*\/?>$/i, "");
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(attrSource)) !== null) {
    attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }

  const src = attrs.src || "";
  if (!src || DANGEROUS_URL_RE.test(src)) return null;

  return {
    src,
    alt: attrs.alt || "",
    title: attrs.title || "",
    htmlSource,
  };
}

/**
 * 根据图片属性重建源码文本。
 * 优先返回原始 HTML 写法（htmlSource）；否则生成标准 Markdown 图片语法，
 * 若带链接则包装为链接图片 `[![alt](src)](href)`。
 * @param attrs 图片属性
 * @returns 图片对应的 Markdown/HTML 源码文本
 */
export function buildImageSourceText(attrs: ImageSourceAttrs): string {
  if (attrs.htmlSource) return attrs.htmlSource;

  const alt = attrs.alt || "";
  const src = attrs.src || "";
  const title = attrs.title || "";
  const linkHref = attrs.linkHref || "";
  const linkTitle = attrs.linkTitle || "";
  const titlePart = title ? ` "${title}"` : "";
  const imgMarkdown = `![${alt}](${src}${titlePart})`;

  if (!linkHref) return imgMarkdown;

  const linkTitlePart = linkTitle ? ` "${linkTitle}"` : "";
  return `[${imgMarkdown}](${linkHref}${linkTitlePart})`;
}
