import type { ExportImageOptions, ImageExportFormat } from "@/shared/types/export";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import html2canvas from "html2canvas";

const IMAGE_FORMAT_MAP: Record<ImageExportFormat, { mime: string; ext: string; quality?: number }> =
  {
    png: { mime: "image/png", ext: "png" },
    jpg: { mime: "image/jpeg", ext: "jpg", quality: 0.92 },
    webp: { mime: "image/webp", ext: "webp", quality: 0.92 },
  };

/**
 * 沿 DOM 向上寻找第一个非透明背景色，作为长图的画布底色。
 * 保证"所见即所得"（深色主题导出深色长图），并让不支持透明的 JPG 不出现黑底。
 */
function resolveBackgroundColor(element: HTMLElement): string {
  let node: HTMLElement | null = element;
  while (node) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") {
      return bg;
    }
    node = node.parentElement;
  }
  return "#ffffff";
}

/**
 * canvas → Uint8Array（按指定 MIME / 质量编码）。
 */
function canvasToBytes(
  canvas: HTMLCanvasElement,
  mime: string,
  quality?: number
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("画布导出失败"));
          return;
        }
        blob
          .arrayBuffer()
          .then((buffer) => resolve(new Uint8Array(buffer)))
          .catch(reject);
      },
      mime,
      quality
    );
  });
}

/**
 * 把 `elementSelector` 指向的元素整体截成单张长图，并弹对话框保存。
 *
 * 复用 html2canvas（与 PDF 导出同源），按目标元素完整高度栅格化，
 * 因此即使内容超出视口、当前滚动在中间也能拿到完整渲染结果。
 */
export async function exportAsImage(
  elementSelector: string,
  fileBaseName: string,
  options: ExportImageOptions
): Promise<void> {
  const element = document.querySelector<HTMLElement>(elementSelector);
  if (!element) {
    throw new Error(`exportAsImage: element "${elementSelector}" not found`);
  }

  const { format, scale = 2 } = options;
  const { mime, ext, quality } = IMAGE_FORMAT_MAP[format];
  const backgroundColor = resolveBackgroundColor(element);

  const canvas = await html2canvas(element, {
    scale,
    useCORS: true,
    backgroundColor,
    windowWidth: element.scrollWidth,
  });

  const bytes = await canvasToBytes(canvas, mime, quality);

  const targetPath = await saveDialog({
    title: "导出为图片",
    defaultPath: `${fileBaseName}.${ext}`,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (!targetPath) {
    throw new Error("用户取消了保存");
  }

  await writeFile(targetPath, bytes);
}
