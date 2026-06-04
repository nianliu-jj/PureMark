export interface ParsedHtmlImage {
  src: string;
  alt: string;
  title: string;
  htmlSource: string;
}

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
