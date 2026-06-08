<script setup lang="ts">
/**
 * ReloadConfirmDialog.vue —— 重启确认对话框
 *
 * 职责：
 * - 在需要重启应用才能生效的场景（如切换语言设置）弹出，提示用户先保存工作。
 * - 提供三种选择：取消、稍后手动重启、全部保存并立即重启。
 *
 * 通过 props 回调与宿主通信（非 emits）：
 * - onClose(action)：用户点击底部按钮时调用，action 表示选择的操作。
 * - onMaskClick：点击遮罩层时的回调（由外层 overlay 触发）。
 *
 * UI 位置：模态对话框，覆盖在编辑器之上。
 */
const props = defineProps<{
  /** 关闭对话框并回传用户选择的动作 */
  onClose: (action: "cancel" | "saveAndReload" | "reloadLater") => void;
  /** 点击遮罩层时触发 */
  onMaskClick: () => void;
}>();

/** 取消：不重启也不保存 */
function handleCancel() {
  props.onClose("cancel");
}

/** 全部保存并立即重启 */
function handleSaveAndReload() {
  props.onClose("saveAndReload");
}

/** 稍后由用户手动重启 */
function handleReloadLater() {
  props.onClose("reloadLater");
}
</script>

<template>
  <div class="dialog-overlay">
    <div class="dialog-content" @click.stop>
      <div class="dialog-header">
        <h3>请确保所有工作已经保存!</h3>
      </div>
      <div class="dialog-body">
        <h5>更新语言设置需要重启应用后生效</h5>
        <div id="updateLog" class="puredownPreview"></div>
      </div>
      <div class="dialog-footer">
        <button class="btn btn-secondary" @click="handleCancel">取消</button>
        <button class="btn btn-secondary" @click="handleReloadLater">稍后手动重启</button>
        <button class="btn btn-overwrite" @click="handleSaveAndReload">全部保存并重启</button>
      </div>
    </div>
  </div>
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
  backdrop-filter: blur(2px);
  color: var(--text-color);
  position: unset;
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
  padding: 0 24px;
  margin: 16px 0;
  max-height: 60vh;
  overflow-y: auto;

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

  .puredownPreview#updateLog {
    :deep(.ProseMirror) {
      padding: 0;
    }

    :deep(.puredown-block-handle) {
      display: none;
    }
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

.btn-ignore {
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
}
</style>
