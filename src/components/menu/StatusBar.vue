<script setup lang="ts">
/**
 * StatusBar.vue —— 底部状态栏
 *
 * 职责：
 * - 左侧：源码/富文本切换按钮，以及更新下载进度的内联提示（点击可恢复更新弹窗）。
 * - 右侧：保存状态、字数/行数统计、只读切换、全文 Markdown 语法检查面板。
 *
 * 主要 props：
 * - content：当前文档内容，用于字数/行数统计与语法检查。
 * - updateStatus / downloadProgress / isUpdateDialogVisible：更新进度提示相关状态。
 *
 * 主要 emits：
 * - restore-update：点击进度条恢复更新对话框。
 *
 * UI 位置：编辑器窗口最底部。
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import AppIcon from "@/components/ui/AppIcon.vue";
import useSourceCode from "@/hooks/useSourceCode";
import useTab from "@/hooks/useTab";
import { checkMarkdownSyntax } from "@/utils/markdownSyntaxCheck";

const props = defineProps<{
  /** 当前文档内容 */
  content: string;
  /** 更新流程状态 */
  updateStatus?: "idle" | "downloading" | "downloaded" | "error";
  /** 更新下载进度百分比 */
  downloadProgress?: number;
  /** 更新对话框是否已显示（决定是否在状态栏内联提示） */
  isUpdateDialogVisible?: boolean;
}>();
const emit = defineEmits<{
  /** 请求恢复显示更新对话框 */
  (e: "restore-update"): void;
}>();

const { isShowSource, toggleSourceCode } = useSourceCode();
const { currentTab } = useTab();
const syntaxPanelVisible = ref(false);
const syntaxIssues = ref<ReturnType<typeof checkMarkdownSyntax>>([]);

/** 当前标签页的保存状态文案 */
const saveStatusText = computed(() => {
  const tab = currentTab.value;
  if (!tab) return "已保存";
  if (tab.saveStatus === "saving") return "保存中";
  if (tab.saveStatus === "error") return "保存失败";
  return tab.isModified ? "未保存" : "已保存";
});

/** 文档字数（按中文字符与英文单词计数） */
const wordCount = computed(() => {
  const text = props.content ?? "";
  return countMarkdownWords(text);
});

/** 文档行数（含空行） */
const lineCount = computed(() => {
  return countMarkdownLines(props.content ?? "", { skipEmpty: false });
});

function handleRestore() {
  emit("restore-update");
}

/** 统计行数，可选择是否跳过空行 */
function countMarkdownLines(text: string, options = { skipEmpty: true }): number {
  if (!text) return options.skipEmpty ? 0 : 1;
  const rawLines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (options.skipEmpty) {
    return rawLines.filter((line) => line.trim().length > 0).length;
  }
  return rawLines.length;
}
/** 统计字数：剥离代码块、图片、链接 URL 与各类语法符号后，匹配中文字符与英文单词 */
function countMarkdownWords(text: string): number {
  const base64Regex = /data:image\/[a-zA-Z]+;base64,[a-zA-Z0-9+/=]+/g;
  const normalized = text
    .replaceAll("&#x20;", "")
    .replace(base64Regex, "image")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[[^\]]+]\([^)]*\)/g, "$1")
    .replace(/[`*_~=#>$[\]()-]/g, " ");
  return normalized.match(/[\u4e00-\u9fa5]|[a-zA-Z0-9]+/g)?.length ?? 0;
}

/** 切换当前标签页的只读/可编辑状态 */
function toggleReadOnly() {
  if (!currentTab.value) return;
  currentTab.value.readOnly = !currentTab.value.readOnly;
}

/** 对全文执行 Markdown 语法检查并展开结果面板 */
function runSyntaxCheck() {
  syntaxIssues.value = checkMarkdownSyntax(props.content ?? "");
  syntaxPanelVisible.value = true;
}

function closeSyntaxPanel() {
  syntaxPanelVisible.value = false;
}
// 阶段 4：Ctrl/Cmd + / 快捷键切换源码视图
function onToggleSourceKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === "/") {
    e.preventDefault();
    toggleSourceCode();
  }
}
onMounted(() => window.addEventListener("keydown", onToggleSourceKeydown));
onUnmounted(() => window.removeEventListener("keydown", onToggleSourceKeydown));
</script>

<template>
  <div class="StatusBarBox">
    <div class="left-section">
      <div>
        <span class="status-icon-btn" @click.stop="toggleSourceCode()">
          <AppIcon :name="isShowSource ? 'input' : 'markdown'" />
        </span>
      </div>

      <!-- Update Progress (Centered-ish or just after icons) -->
      <div
        v-if="updateStatus === 'downloading' && !isUpdateDialogVisible"
        class="update-progress-bar"
        @click="handleRestore"
        title="点击恢复下载弹窗"
      >
        <AppIcon name="download" class="status-inline-icon" />
        <span>正在下载 {{ downloadProgress }}%</span>
        <div class="mini-progress-bg">
          <div class="mini-progress-fill" :style="{ width: `${downloadProgress}%` }"></div>
        </div>
      </div>
      <div
        v-else-if="updateStatus === 'downloaded' && !isUpdateDialogVisible"
        class="update-progress-bar success"
        @click="handleRestore"
      >
        <AppIcon name="check-circle" class="status-inline-icon" />
        <span>下载完成，点击安装</span>
      </div>
    </div>

    <div class="right-section">
      <span class="statusBarText save-state" :class="currentTab?.saveStatus">
        {{ saveStatusText }}
      </span>
      <span class="statusBarText">{{ wordCount }} 字</span>
      <span class="statusBarText">{{ lineCount }} 行</span>
      <button
        class="status-action"
        :class="{ active: currentTab?.readOnly }"
        title="切换只读模式"
        @click="toggleReadOnly"
      >
        {{ currentTab?.readOnly ? "只读" : "可编辑" }}
      </button>
      <button class="status-action" title="检查全文 Markdown 语法" @click="runSyntaxCheck">
        语法检查
      </button>

      <div v-if="syntaxPanelVisible" class="syntax-panel" @click.stop>
        <div class="syntax-panel-head">
          <strong>语法检查</strong>
          <button class="syntax-close" @click="closeSyntaxPanel">×</button>
        </div>
        <div v-if="syntaxIssues.length === 0" class="syntax-empty">未发现语法问题</div>
        <div v-else class="syntax-list">
          <div v-for="(issue, index) in syntaxIssues" :key="index" class="syntax-item">
            <div class="syntax-message">
              第 {{ issue.line }} 行，第 {{ issue.column }} 列：{{ issue.message }}
            </div>
            <div class="syntax-excerpt">{{ issue.excerpt }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.StatusBarBox {
  user-select: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-color-1);
  text-align: right;
  background: var(--background-color-2);
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: relative;

  .left-section {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .right-section {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    margin-left: auto;
    position: relative;
  }

  span {
    padding: 2px 8px;
    display: inline-block;

    &:hover {
      background: var(--hover-color);
    }
  }
}

.statusBarText {
  font-size: 12px;
  margin: 2px 0;
  color: var(--text-color-3);

  &.unsaved,
  &.saving {
    color: var(--primary-color);
  }

  &.error {
    color: #e53e3e;
  }
}

.status-action {
  height: 22px;
  border: none;
  border-radius: 4px;
  padding: 0 8px;
  background: transparent;
  color: var(--text-color-3);
  font-size: 12px;
  cursor: pointer;

  &:hover,
  &.active {
    background: var(--hover-color);
    color: var(--text-color-1);
  }
}

.syntax-panel {
  position: absolute;
  right: 0;
  bottom: 28px;
  width: min(520px, calc(100vw - 24px));
  max-height: 300px;
  overflow: hidden;
  border: 1px solid var(--border-color-1);
  border-radius: 8px;
  background: var(--background-color-1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  text-align: left;
  cursor: default;
  z-index: 20;
}

.syntax-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color-1);
  font-size: 13px;
}

.syntax-close {
  border: none;
  background: transparent;
  color: var(--text-color-3);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}

.syntax-empty {
  padding: 16px 12px;
  color: var(--text-color-3);
  font-size: 12px;
}

.syntax-list {
  max-height: 246px;
  overflow: auto;
}

.syntax-item {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color-1);

  &:last-child {
    border-bottom: none;
  }
}

.syntax-message {
  color: var(--text-color-1);
  font-size: 12px;
  line-height: 1.5;
}

.syntax-excerpt {
  margin-top: 4px;
  color: var(--text-color-3);
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.update-progress-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-color-2);
  padding: 2px 8px;
  border-radius: 4px;
  transition: background 0.2s;

  &:hover {
    background: var(--hover-color);
  }

  &.success {
    color: var(--primary-color);
  }

  .mini-progress-bg {
    width: 60px;
    height: 4px;
    background: var(--border-color-1);
    border-radius: 2px;
    overflow: hidden;
  }

  .mini-progress-fill {
    height: 100%;
    background: var(--primary-color);
    transition: width 0.3s;
  }
}
</style>
