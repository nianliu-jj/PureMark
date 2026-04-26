/**
 * PureMark 粘贴处理插件
 *
 * 处理粘贴的 Markdown 文本和图片
 */

import { Plugin, PluginKey } from "prosemirror-state";
import { Node, Slice } from "prosemirror-model";
import { getCurrentMarkdownFilePath } from "@/plugins/imagePathPlugin";
import { writeTempImage } from "@/services/api/fs";
import { MarkdownParser } from "../parser";
import { puremarkSchema } from "../schema";
import { decorationPluginKey } from "../decorations";
import { insertMarkdownTableRowAfterCurrent } from "../commands";
import { getStorageItemWithFallback } from "@/shared/utils/storage";

/** 插件 Key */
export const pastePluginKey = new PluginKey("puremark-paste");

/** 图片粘贴方式 */
export type ImagePasteMethod = "local" | "remote";

interface StoredImageConfig {
  pasteMethod?: ImagePasteMethod;
  localPath?: string;
}

/** 图片上传函数类型 */
export type ImageUploader = (file: File) => Promise<string>;

/** 本地图片保存函数类型 */
export type LocalImageSaver = (file: File) => Promise<string>;

/** 粘贴插件配置 */
export interface PastePluginConfig {
  /** 获取图片粘贴方式 */
  getImagePasteMethod?: () => ImagePasteMethod;
  /** 图片上传函数（用于 remote 模式） */
  imageUploader?: ImageUploader;
  /** 本地图片保存函数（用于 local 模式） */
  localImageSaver?: LocalImageSaver;
}

/** 获取图片粘贴方式 */
export function getImagePasteMethod(): ImagePasteMethod {
  const method = getStoredImageConfig().pasteMethod || localStorage.getItem("pasteMethod");
  if (method === "local" || method === "remote") {
    return method;
  }
  return "local";
}

/** 获取本地图片保存路径 */
export function getLocalImagePath(): string {
  const localPath = getStoredImageConfig().localPath || localStorage.getItem("localImagePath");
  return localPath || "/assets";
}

function getStoredImageConfig(): StoredImageConfig {
  try {
    const rawConfig = getStorageItemWithFallback(localStorage, [
      "puremark-config",
      "milkup-config",
    ]);
    if (!rawConfig) return {};

    const parsed = JSON.parse(rawConfig) as { image?: StoredImageConfig };
    return parsed.image || {};
  } catch {
    return {};
  }
}

/** 默认配置 */
const defaultConfig: PastePluginConfig = {
  getImagePasteMethod,
};

/**
 * 创建粘贴处理插件
 */
export function createPastePlugin(config: PastePluginConfig = {}): Plugin {
  const parser = new MarkdownParser(puremarkSchema);
  const mergedConfig = { ...defaultConfig, ...config };

  return new Plugin({
    key: pastePluginKey,

    props: {
      handlePaste(view, event, _slice) {
        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;

        // 检查是否处于源码模式
        const decoState = decorationPluginKey.getState(view.state);
        const isSourceView = decoState?.sourceView ?? false;

        // 检查是否有图片
        const files = clipboardData.files;
        if (files && files.length > 0) {
          const hasImage = Array.from(files).some((file) => file.type.startsWith("image/"));
          if (hasImage) {
            if (isSourceView) {
              // 源码模式下：图片粘贴创建段落而非 image 节点
              handleImagePasteAsText(view, files, mergedConfig);
            } else {
              // 正常模式：创建 image 节点
              handleImagePaste(view, files, mergedConfig);
            }
            return true;
          }
        }

        // 获取粘贴的纯文本
        const text = clipboardData.getData("text/plain");
        if (!text) return false;

        // 源码模式下：所有文本都作为纯文本插入，不解析 Markdown
        if (isSourceView) {
          return false; // 让默认处理器插入纯文本
        }

        if (insertMarkdownTableRowAfterCurrent(view.state, text, view.dispatch.bind(view))) {
          return true;
        }

        // 检查是否包含 Markdown 语法
        if (!containsMarkdownSyntax(text)) {
          // 检查是否有外部 HTML（非编辑器内部复制）
          const html = clipboardData.getData("text/html");
          if (html && !html.includes("data-pm-slice")) {
            // 外部 HTML 粘贴，作为纯文本插入，避免 ProseMirror 解析 HTML marks
            const tr = view.state.tr.insertText(text);
            view.dispatch(tr);
            return true;
          }
          return false; // 让默认处理器处理
        }

        // 检查是否来自编辑器内部复制（ProseMirror 会在 HTML 中添加 data-pm-slice 标记）
        const html = clipboardData.getData("text/html");
        if (html && html.includes("data-pm-slice")) {
          return false; // 内部复制，让 ProseMirror 默认处理
        }

        // 解析 Markdown
        const { doc } = parser.parse(text);

        // 获取解析后的内容
        const content = doc.content;

        // 如果内容为空，不处理
        if (content.size === 0) return false;

        // 延迟到下一帧插入，确保 ProseMirror 完成粘贴事件处理后再更新视图
        // 这样装饰系统能正确重新计算所有语法标记的显示/隐藏状态
        requestAnimationFrame(() => {
          const pasteSlice = new Slice(content, 1, 1);
          const tr = view.state.tr.replaceSelection(pasteSlice);
          view.dispatch(tr);
        });

        return true;
      },
    },
  });
}

/**
 * 处理图片粘贴
 */
async function handleImagePaste(
  view: any,
  files: FileList,
  config: PastePluginConfig
): Promise<void> {
  const method = config.getImagePasteMethod?.() || getImagePasteMethod();
  const schema = view.state.schema;
  const nodes: Node[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.type.startsWith("image/")) continue;

    try {
      let src: string;

      switch (method) {
        case "remote":
          if (config.imageUploader) {
            src = await config.imageUploader(file);
          } else {
            throw new Error("未配置图片上传能力，无法粘贴图片");
          }
          break;

        case "local":
          if (config.localImageSaver) {
            src = await config.localImageSaver(file);
          } else {
            // 尝试使用桌面端图片保存能力
            src = await saveImageLocally(file);
          }
          break;
      }

      const imageNode = schema.nodes.image?.createAndFill({
        src,
        alt: file.name,
        title: "",
      });

      if (imageNode) {
        nodes.push(imageNode);
      }
    } catch (error) {
      console.error("Failed to process image:", error);
    }
  }

  if (nodes.length > 0) {
    const { $from } = view.state.selection;
    let tr = view.state.tr;

    for (const node of nodes) {
      tr = tr.insert($from.pos, node);
    }

    view.dispatch(tr);
  }
}

/**
 * 源码模式下处理图片粘贴：创建包含 Markdown 文本的段落
 */
async function handleImagePasteAsText(
  view: any,
  files: FileList,
  config: PastePluginConfig
): Promise<void> {
  const method = config.getImagePasteMethod?.() || getImagePasteMethod();
  const schema = view.state.schema;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.type.startsWith("image/")) continue;

    try {
      let src: string;

      switch (method) {
        case "remote":
          if (config.imageUploader) {
            src = await config.imageUploader(file);
          } else {
            throw new Error("未配置图片上传能力，无法粘贴图片");
          }
          break;
        case "local":
          if (config.localImageSaver) {
            src = await config.localImageSaver(file);
          } else {
            src = await saveImageLocally(file);
          }
          break;
      }

      const alt = file.name;
      const markdownText = `![${alt}](${src})`;
      const paragraph = schema.nodes.paragraph.create(
        { imageAttrs: { src, alt, title: "" } },
        schema.text(markdownText)
      );

      const { $from } = view.state.selection;
      const tr = view.state.tr.insert($from.pos, paragraph);
      view.dispatch(tr);
    } catch (error) {
      console.error("Failed to process image:", error);
    }
  }
}

/**
 * 兼容旧热更新模块的命名导出。
 * 图片粘贴已不再支持 Base64，此函数保留为失败路径，避免旧模块导入时报错。
 */
export function fileToBase64(_file: File): Promise<string> {
  return Promise.reject(new Error("图片粘贴已不再支持 Base64"));
}

/**
 * 保存图片到本地
 */
export async function saveImageLocally(file: File): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);
    const localImagePath = getLocalImagePath();
    const currentFilePath = getCurrentMarkdownFilePath();

    const tempPath = await writeTempImage({
      file: buffer,
      targetPath: localImagePath,
      currentFilePath,
      fileName: file.name,
      mimeType: file.type,
    });

    if (tempPath) return tempPath;
  } catch (error) {
    console.warn("保存本地图片失败：", error);
    throw error;
  }

  throw new Error("本地图片保存失败");
}

/**
 * 检查文本是否包含 Markdown 语法
 */
function containsMarkdownSyntax(text: string): boolean {
  const patterns = [
    /^#{1,6}\s/m, // 标题
    /\*\*[^*]+\*\*/, // 粗体
    /\*[^*]+\*/, // 斜体
    /~~[^~]+~~/, // 删除线
    /`[^`]+`/, // 行内代码
    /^```/m, // 代码块
    /\[[^\]]+\]\([^)]*\)/, // 链接（允许空 URL）
    /!\[[^\]]*\]\([^)]+\)/, // 图片
    /^>\s?/m, // 引用
    /^[-*+]\s/m, // 无序列表
    /^\d+\.\s/m, // 有序列表
    /^[-*_]{3,}\s*$/m, // 分隔线
    /==[^=]+==/, // 高亮
    /^\s*\$\$/m, // 数学块（支持缩进）
    /\$[^$]+\$/, // 行内数学
    /<su[bp]>.+?<\/su[bp]>/, // sub/sup
    /<[a-zA-Z][a-zA-Z0-9]*(?:\s[^>]*)?>.*?<\/[a-zA-Z][a-zA-Z0-9]*>/, // 行内 HTML
    /^- \[[ xX]\]/m, // 任务列表
    /^\|.+\|$/m, // 表格
  ];

  return patterns.some((pattern) => pattern.test(text));
}
