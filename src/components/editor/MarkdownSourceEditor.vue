<script setup lang="ts">
/**
 * MarkdownSourceEditor.vue —— Markdown 源码编辑器
 *
 * 职责：
 * - 基于 CodeMirror 6 提供纯文本的 Markdown 源码编辑视图（与所见即所得的 PureMarkEditor 互为切换）。
 * - 双向同步源码内容，并在源码光标与 PureMark 富文本光标之间做近似位置换算，
 *   以便在两种模式切换时尽量保持光标位置一致。
 *
 * 主要 props：
 * - modelValue：源码文本，配合 update:modelValue 实现 v-model。
 * - readOnly：是否只读。
 *
 * 主要 emits：update:modelValue（文档变化时回传最新源码）。
 *
 * UI 位置：编辑区在源码模式下的主体，占满整个编辑容器。
 */
import { basicSetup } from "codemirror";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, Prec } from "@codemirror/state";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import useSourceCode from "@/hooks/useSourceCode";
import useTab from "@/hooks/useTab";

/** 描述源码中一段链接/图片 Markdown 语法的位置信息，用于光标偏移换算 */
interface MdSpan {
  type: "link" | "image";
  start: number;
  end: number;
  textStart: number;
  textEnd: number;
  raw: string;
  text: string;
  url: string;
}

const props = defineProps<{
  /** 源码文本（v-model） */
  modelValue: string;
  /** 是否只读 */
  readOnly: boolean | undefined;
}>();
const emit = defineEmits(["update:modelValue"]);
const { toggleSourceCode } = useSourceCode();
const { currentTab } = useTab();
// 拦截 Ctrl/Cmd-/ 注释快捷键，改为切换源码/富文本模式（优先级最高，覆盖 CodeMirror 默认行为）
const blockCtrlSlashDOM = Prec.highest(
  EditorView.domEventHandlers({
    keydown: (e, _view) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        toggleSourceCode();
        return true;
      }
      return false;
    },
  })
);

const editorContainer = ref<HTMLElement>();
let editorView: EditorView | null = null;

// 挂载时创建 CodeMirror 实例，并恢复上次记录的光标位置
onMounted(() => {
  const startState = EditorState.create({
    doc: props.modelValue,
    extensions: [
      blockCtrlSlashDOM,
      basicSetup,
      markdown(),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          emit("update:modelValue", update.state.doc.toString());
        }
        // 获取 cm 光标
        if (update.selectionSet) {
          const pos = update.state.selection.main;
          const puredownOffset = calcPuredownOffset(update.state.doc.toString(), pos.head);
          currentTab.value!.puredownCursorOffset = puredownOffset;
          currentTab.value!.codeMirrorCursorOffset = pos.head;
        }
      }),
      EditorView.lineWrapping,
      EditorView.editable.of(!props.readOnly),
    ],
  });

  editorView = new EditorView({
    state: startState,
    parent: editorContainer.value!,
  });

  // 安全地设置光标位置
  const cursorOffset = currentTab.value?.codeMirrorCursorOffset || 0;
  const safeOffset = Math.min(cursorOffset, editorView.state.doc.length);
  editorView.dispatch({
    selection: { anchor: safeOffset },
    scrollIntoView: true,
  });
});
// 同步外部 props 变化：当外部 modelValue 与编辑器内容不一致时整体替换文档，并钳制光标位置
watch(
  () => props.modelValue,
  (newVal) => {
    if (editorView && editorView.state.doc.toString() !== newVal) {
      const currentCursor = editorView.state.selection.main.head;

      editorView.dispatch({
        changes: {
          from: 0,
          to: editorView.state.doc.length,
          insert: newVal,
        },
        // 设置光标位置，确保不超出新文档范围
        selection: { anchor: Math.min(currentCursor, newVal.length) },
      });
    }
  }
);

// 清理：销毁 CodeMirror 实例避免内存泄漏
onBeforeUnmount(() => {
  editorView?.destroy();
});
/**
 * 将 Markdown 源码近似还原为纯文本（剥离各类语法符号），
 * 用于估算富文本（PureMark）中的字符偏移量。
 */
function toPuredownApproxText(md: string): string {
  return (
    md
      // 删除标题符号（#、空格）
      .replace(/^#+\s*/gm, "")
      // 删除强调符（*、_、~、`）
      .replace(/[*_~`]+/g, "")
      // 链接 [text](url) -> 'a'
      .replace(/\[.*?\]\(.*?\)/g, "a")
      // 图片 ![alt](url) -> 'a'
      .replace(/!\[.*?\]\(.*?\)/g, "a")
      // 引用符号 >
      .replace(/^\s*>+\s?/gm, "")
      // 列表项符号 -, *, 1.
      .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
      // 表格符号
      .replace(/\|/g, "")
      // 删除行尾多余空格
      .trim()
  );
}
/** 扫描源码，找出所有链接/图片语法片段及其在文本中的精确范围 */
function findMdSpans(md: string): MdSpan[] {
  const spans: MdSpan[] = [];
  // eslint-disable-next-line regexp/no-unused-capturing-group
  const regex = /!?(\[([^\]]*)\])\(([^)]+)\)/g;
  let match;
  // eslint-disable-next-line no-cond-assign
  while ((match = regex.exec(md)) !== null) {
    const isImage = match[0].startsWith("!");
    const start = match.index;
    const end = regex.lastIndex;
    const textStart = start + (isImage ? 2 : 1);
    const textEnd = textStart + match[2].length;
    spans.push({
      type: isImage ? "image" : "link",
      start,
      end,
      textStart,
      textEnd,
      raw: match[0],
      text: match[2],
      url: match[3],
    });
  }
  return spans;
}
/**
 * 根据源码光标偏移 cmOffset，估算其在 PureMark 富文本中的近似字符偏移，
 * 链接/图片整体视为一个字符，[text] 内部按文本内位置计算。
 */
function calcPuredownOffset(md: string, cmOffset: number): number {
  const spans = findMdSpans(md);
  let puredownOffset = 0;
  let pos = 0;

  for (const span of spans) {
    if (cmOffset < span.start) {
      // 光标在此 span 前 → 累积前面文本
      puredownOffset += toPuredownApproxText(md.slice(pos, cmOffset)).length;
      return puredownOffset;
    }

    if (cmOffset >= span.start && cmOffset <= span.end) {
      // 光标在某个链接/图片语法中间
      if (cmOffset <= span.textEnd) {
        // 光标在 [text] 内部，按 text 内位置算
        const insideTextOffset = cmOffset - span.textStart;
        puredownOffset += toPuredownApproxText(md.slice(pos, span.start)).length + insideTextOffset;
      } else {
        // 光标在 (url) 内或后面 → 视为整个节点末尾
        puredownOffset += toPuredownApproxText(md.slice(pos, span.start)).length + 1;
      }
      return puredownOffset;
    }

    // 光标在此 span 之后
    puredownOffset += toPuredownApproxText(md.slice(pos, span.start)).length + 1; // 链接/图片视作一个
    pos = span.end;
  }

  // 光标在最后
  puredownOffset += toPuredownApproxText(md.slice(pos, cmOffset)).length;
  return puredownOffset;
}
</script>

<template>
  <div id="codemirror" ref="editorContainer" class="editor-container" />
</template>

<style scoped>
.editor-container {
  border: 1px solid #ccc;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1.5;
  height: 100%;
  width: 100%;
  overflow: auto;
}
</style>
