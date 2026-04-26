import type { ExportPDFOptions } from "@/shared/types/export";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

const PAGE_SIZE_MAP = {
  A4: { width: 595.28, height: 841.89 },
  Letter: { width: 612, height: 792 },
} as const;

function resolvePageSize(size: ExportPDFOptions["pageSize"]): { width: number; height: number } {
  if (!size || size === "A4") return PAGE_SIZE_MAP.A4;
  if (size === "Letter") return PAGE_SIZE_MAP.Letter;
  return size;
}

/**
 * 把 `elementSelector` 指向的元素截图为多页 PDF，并弹对话框保存。
 *
 * 当前实现会：
 *   - 用 html2canvas 栅格化，分辨率受 scale 控制（默认 2x 保证清晰）
 *   - 按页高切分 canvas 为多页
 *   - 通过 Tauri fs plugin 写盘，避免让 Rust 侧知道 PDF 细节
 */
export async function exportAsPDF(
  elementSelector: string,
  defaultName: string,
  options: ExportPDFOptions = {}
): Promise<void> {
  const element = document.querySelector<HTMLElement>(elementSelector);
  if (!element) {
    throw new Error(`exportAsPDF: element "${elementSelector}" not found`);
  }

  const { scale = 2 } = options;
  const page = resolvePageSize(options.pageSize);

  const canvas = await html2canvas(element, {
    scale,
    useCORS: true,
    backgroundColor: "#ffffff",
    windowWidth: element.scrollWidth,
  });

  const pdf = new jsPDF({
    orientation: page.width > page.height ? "landscape" : "portrait",
    unit: "pt",
    format: [page.width, page.height],
  });

  const imgWidth = page.width;
  const pageHeightPx = (canvas.width * page.height) / page.width;
  const totalPages = Math.ceil(canvas.height / pageHeightPx);

  for (let i = 0; i < totalPages; i++) {
    const slice = document.createElement("canvas");
    slice.width = canvas.width;
    slice.height = Math.min(pageHeightPx, canvas.height - i * pageHeightPx);

    const ctx = slice.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(canvas, 0, -i * pageHeightPx);

    const dataUrl = slice.toDataURL("image/png", 1.0);
    if (i > 0) pdf.addPage([page.width, page.height]);
    pdf.addImage(dataUrl, "PNG", 0, 0, imgWidth, (slice.height * imgWidth) / slice.width);
  }

  const targetPath = await saveDialog({
    title: "导出为 PDF",
    defaultPath: defaultName.endsWith(".pdf") ? defaultName : `${defaultName}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!targetPath) {
    throw new Error("用户取消了保存");
  }

  const blob = pdf.output("arraybuffer") as ArrayBuffer;
  await writeFile(targetPath, new Uint8Array(blob));
}
