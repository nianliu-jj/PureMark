<script setup lang="ts">
/**
 * SaveConfirmDialog.vue —— 保存/覆盖确认对话框
 *
 * 职责：
 * - 在以下三种场景弹出确认框，复用同一套样式与结构：
 *   1. close：关闭存在未保存修改的标签页。
 *   2. overwrite：另存为时目标文件已存在，确认是否覆盖。
 *   3. file-changed：磁盘上的文件被外部改动，确认是否用当前编辑内容覆盖。
 *
 * 主要 props：
 * - visible：是否显示对话框。
 * - type：对话框类型，决定标题、正文与底部按钮组合。
 * - tabName / fileName：用于在文案中展示文档名或文件名。
 *
 * 主要 emits：save / discard / cancel / overwrite，由宿主决定具体动作。
 *
 * UI 位置：全屏遮罩的模态对话框（position: fixed）。
 */
type DialogType = "close" | "overwrite" | "file-changed";

interface Props {
  /** 是否可见 */
  visible: boolean;
  /** 标签页名称，用于 close 场景的文案 */
  tabName?: string;
  /** 对话框类型，决定展示内容与按钮 */
  type?: DialogType;
  /** 文件名，用于 overwrite / file-changed 场景的文案 */
  fileName?: string;
}

interface Emits {
  /** 用户选择保存 */
  (e: "save"): void;
  /** 用户选择丢弃修改 */
  (e: "discard"): void;
  /** 用户取消操作 */
  (e: "cancel"): void;
  /** 用户确认覆盖 */
  (e: "overwrite"): void;
}

const { visible, tabName, type = "close", fileName } = defineProps<Props>();
const emit = defineEmits<Emits>();

function handleSave() {
  emit("save");
}

function handleDiscard() {
  emit("discard");
}

function handleCancel() {
  emit("cancel");
}

function handleOverwrite() {
  emit("overwrite");
}
</script>

<template>
  <Transition name="dialog-fade" appear>
    <div v-if="visible" class="dialog-overlay">
      <div class="dialog-content" @click.stop>
        <div class="dialog-header">
          <h3 v-if="type === 'close'">确认关闭</h3>
          <h3 v-else-if="type === 'overwrite'">文件已存在</h3>
          <h3 v-else-if="type === 'file-changed'">文件已变动</h3>
        </div>
        <div class="dialog-body">
          <template v-if="type === 'close'">
            <p v-if="tabName">文档 "{{ tabName }}" 有未保存的修改，请选择操作：</p>
            <p v-else>当前文档有未保存的修改，请选择操作：</p>
          </template>
          <template v-else-if="type === 'overwrite'">
            <p v-if="fileName">文件 "{{ fileName }}" 已存在，是否要覆盖当前内容？</p>
            <p v-else>文件已存在，是否要覆盖当前内容？</p>
            <p class="dialog-detail">选择"保存"将先保存当前内容，然后打开新文件。</p>
          </template>
          <template v-else-if="type === 'file-changed'">
            <p v-if="fileName">文件 "{{ fileName }}" 已经变动，是否覆盖当前编辑的内容？</p>
            <p v-else>文件已经变动，是否覆盖当前编辑的内容？</p>
          </template>
        </div>
        <div class="dialog-footer">
          <template v-if="type === 'close'">
            <button class="btn btn-secondary" @click="handleDiscard">丢弃</button>
            <div>
              <button class="btn btn-save" @click="handleSave">保存</button>
              <button class="btn btn-secondary" @click="handleCancel">取消</button>
            </div>
          </template>
          <template v-else-if="type === 'overwrite'">
            <button class="btn btn-secondary" @click="handleCancel">取消</button>
            <div>
              <button class="btn btn-save" @click="handleSave">保存</button>
              <button class="btn btn-overwrite" @click="handleOverwrite">覆盖</button>
            </div>
          </template>
          <template v-else-if="type === 'file-changed'">
            <button class="btn btn-secondary" @click="handleCancel">取消</button>
            <button class="btn btn-overwrite file-changed-overwrite" @click="handleOverwrite">
              覆盖
            </button>
          </template>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped lang="less">
.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: all 0.3s ease;
}

.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}

.dialog-fade-enter-from .dialog-content,
.dialog-fade-leave-to .dialog-content {
  transform: translateY(-20px) scale(0.95);
}

.dialog-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(2px);
}

.dialog-content {
  background: var(--background-color-1);
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  min-width: 400px;
  max-width: 500px;
  transition: transform 0.3s ease;
  border: 1px solid var(--border-color-1);
}

.dialog-header {
  padding: 20px 24px 0;

  h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--text-color);
  }
}

.dialog-body {
  padding: 16px 24px;

  p {
    margin: 0;
    font-size: 14px;
    color: var(--text-color-2);
    line-height: 1.5;
  }

  .dialog-detail {
    margin-top: 8px;
    font-size: 12px;
    color: var(--text-color-3);
  }
}

.dialog-footer {
  padding: 0 24px 20px;
  display: flex;
  justify-content: space-between;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;

  &:active {
    transform: translateY(0);
  }
}

.btn-save {
  margin-right: 12px;
  background: linear-gradient(135deg, var(--primary-color) 0%, var(--primary-color) 100%);
  color: white;

  &:hover {
    opacity: 0.8;
  }

  &:active {
    background: var(--active-color);
  }
}

.btn-secondary {
  background: var(--background-color-2);
  color: var(--text-color-3);
  border: 1px solid var(--border-color-1);

  &:hover {
    background: var(--hover-background-color);
    color: var(--text-color-1);
    border-color: var(--border-color-2);
  }

  &:active {
    background: var(--active-color);
    color: var(--text-color);
  }
}

.btn-overwrite {
  margin-left: 12px;
  background: #f56565;
  color: white;

  &:hover {
    background: #e53e3e;
  }

  &:active {
    background: #c53030;
  }

  &.file-changed-overwrite {
    margin-left: 0;
  }
}
</style>
