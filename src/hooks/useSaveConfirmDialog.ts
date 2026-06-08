/**
 * useSaveConfirmDialog — 保存相关确认对话框的状态与 Promise 化交互。
 *
 * 管理三类确认弹窗：关闭未保存（close）、另存覆盖（overwrite）、磁盘文件已变更（file-changed）。
 * 每个 show* 方法返回一个 Promise，弹窗显示后由用户点击对应按钮（handleSave/handleDiscard/
 * handleCancel/handleOverwrite）来 resolve 该 Promise，从而让调用方以 await 方式拿到用户选择。
 * 注意：组件级 hook，每次调用各自持有独立状态（非模块级共享）。
 */
import { ref } from "vue";

type DialogType = "close" | "overwrite" | "file-changed";
type CloseChoice = "save" | "discard" | "cancel";
type OverwriteChoice = "save" | "overwrite" | "cancel";
type FileChangedChoice = "overwrite" | "cancel";

/**
 * 提供保存确认弹窗的状态与命令式 API。
 * @returns 弹窗状态（isDialogVisible/dialogType/fileName/tabName）、三个 show* 方法（返回选择结果 Promise）
 *          及四个按钮处理函数（resolve 对应选择并关闭弹窗）。
 */
export function useSaveConfirmDialog() {
  const isDialogVisible = ref(false);
  const dialogType = ref<DialogType>("close");
  const fileName = ref<string | undefined>();
  const tabName = ref<string | undefined>();
  const resolvePromise = ref<((value: CloseChoice | OverwriteChoice) => void) | null>(null);

  // 显示「关闭未保存」确认弹窗，返回用户选择（save/discard/cancel）。
  const showDialog = (currentTabName?: string): Promise<CloseChoice> => {
    return new Promise((resolve) => {
      dialogType.value = "close";
      tabName.value = currentTabName;
      isDialogVisible.value = true;
      resolvePromise.value = resolve as (value: CloseChoice | OverwriteChoice) => void;
    });
  };

  // 显示「另存覆盖」确认弹窗，返回用户选择（save/overwrite/cancel）。
  const showOverwriteDialog = (file: string): Promise<OverwriteChoice> => {
    return new Promise((resolve) => {
      dialogType.value = "overwrite";
      fileName.value = file;
      isDialogVisible.value = true;
      resolvePromise.value = resolve as (value: CloseChoice | OverwriteChoice) => void;
    });
  };

  // 显示「磁盘文件已变更」确认弹窗，返回用户选择（overwrite/cancel）。
  const showFileChangedDialog = (file: string): Promise<FileChangedChoice> => {
    return new Promise((resolve) => {
      dialogType.value = "file-changed";
      fileName.value = file;
      isDialogVisible.value = true;
      resolvePromise.value = resolve as (
        value: CloseChoice | OverwriteChoice | FileChangedChoice
      ) => void;
    });
  };

  const handleSave = () => {
    isDialogVisible.value = false;
    if (resolvePromise.value) {
      resolvePromise.value("save");
      resolvePromise.value = null;
    }
  };

  const handleDiscard = () => {
    isDialogVisible.value = false;
    if (resolvePromise.value) {
      resolvePromise.value("discard");
      resolvePromise.value = null;
    }
  };

  const handleCancel = () => {
    isDialogVisible.value = false;
    if (resolvePromise.value) {
      resolvePromise.value("cancel");
      resolvePromise.value = null;
    }
  };

  const handleOverwrite = () => {
    isDialogVisible.value = false;
    if (resolvePromise.value) {
      resolvePromise.value("overwrite" as OverwriteChoice);
      resolvePromise.value = null;
    }
  };

  return {
    isDialogVisible,
    dialogType,
    fileName,
    tabName,
    showDialog,
    showOverwriteDialog,
    showFileChangedDialog,
    handleSave,
    handleDiscard,
    handleCancel,
    handleOverwrite,
  };
}
