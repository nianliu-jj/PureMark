<script setup lang="ts">
import { NButton, NCard, NSpace, NTag, useMessage } from "naive-ui";
import { onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { invoke } from "@/composables/useTauri";
import {
  createFile as apiCreateFile,
  deleteFile as apiDeleteFile,
  getDirectoryFiles,
  getFilePathInClipboard,
  isReadOnly,
  onDirectoryChanged,
  onFileChanged,
  openFile as openFileDialog,
  readFileByPath,
  unwatchDirectory,
  watchDirectory,
  watchFiles,
  workspaceExists,
} from "@/services/api";
import { useAppStore } from "@/stores/app";

const router = useRouter();
const app = useAppStore();
const message = useMessage();

const pingResult = ref<string>("(未调用)");
const counter = ref(0);
const stage2Log = ref<string[]>([]);

function log(line: string) {
  const t = new Date().toISOString().slice(11, 19);
  stage2Log.value.unshift(`[${t}] ${line}`);
  if (stage2Log.value.length > 20) stage2Log.value.pop();
}

async function onPing() {
  try {
    const r = await invoke<string>("ping", { name: `PureMark v${app.version}` });
    pingResult.value = r;
    message.success(`Rust 回应：${r}`);
  } catch (e) {
    message.error(String(e));
  }
}

async function onReadReadme() {
  try {
    const r = await readFileByPath("D:/Markdown项目/PureMark/README.md");
    if (!r) {
      log("readFileByPath(README.md) → null（文件可能不存在）");
      return;
    }
    log(`readFileByPath ✓ path=${r.filePath}`);
    log(`  traits: bom=${r.fileTraits.hasBOM} eol=${r.fileTraits.lineEnding}`);
    log(`  content len=${r.content.length}`);
    message.success("README 读取成功，详情见日志");
  } catch (e) {
    log(`readFileByPath error: ${e}`);
    message.error(String(e));
  }
}

async function onIsReadOnly() {
  try {
    const ro = await isReadOnly("D:/Markdown项目/PureMark/README.md");
    log(`isReadOnly(README.md) → ${ro}`);
    message.info(`readonly: ${ro}`);
  } catch (e) {
    log(`isReadOnly error: ${e}`);
    message.error(String(e));
  }
}

async function onOpenDialog() {
  try {
    const r = await openFileDialog();
    if (!r) {
      log("openFile() → 用户取消");
      return;
    }
    log(`openFile() ✓ path=${r.filePath} len=${r.content.length}`);
    message.success(`已打开：${r.filePath}`);
  } catch (e) {
    log(`openFile error: ${e}`);
    message.error(String(e));
  }
}

async function onReadClipboardFiles() {
  try {
    const list = await getFilePathInClipboard();
    log(`clipboard files: ${JSON.stringify(list)}`);
    message.info(`剪贴板文件数：${list.length}`);
  } catch (e) {
    log(`clipboard error: ${e}`);
    message.error(String(e));
  }
}

function incr() {
  counter.value++;
}

const PROJECT_ROOT = "D:/Markdown项目/PureMark";
const SAMPLE_FILE = `${PROJECT_ROOT}/test-stage3.md`;
let unsubDirChanged: (() => void) | null = null;
let unsubFileChanged: (() => void) | null = null;

function countMd(nodes: Array<{ name: string; isDirectory: boolean; children?: any[] }>): number {
  let n = 0;
  for (const node of nodes) {
    if (!node.isDirectory) n++;
    if (node.children) n += countMd(node.children);
  }
  return n;
}

async function onScanProjectRoot() {
  try {
    const nodes = await getDirectoryFiles(PROJECT_ROOT);
    const rootEntries = nodes.length;
    const totalMd = countMd(nodes);
    log(`getDirectoryFiles ✓ rootEntries=${rootEntries} totalMd=${totalMd}`);
    message.success(`扫描完成：顶层 ${rootEntries} 项 / md 共 ${totalMd}`);
  } catch (e) {
    log(`getDirectoryFiles error: ${e}`);
    message.error(String(e));
  }
}

async function onCheckExists() {
  try {
    const ok = await workspaceExists(PROJECT_ROOT);
    const miss = await workspaceExists(`${PROJECT_ROOT}/never-exists-9fjd`);
    log(`workspaceExists: root=${ok} ghost=${miss}`);
    message.info(`root=${ok} ghost=${miss}`);
  } catch (e) {
    log(`workspaceExists error: ${e}`);
    message.error(String(e));
  }
}

async function onStartDirWatch() {
  try {
    await watchDirectory(PROJECT_ROOT);
    if (!unsubDirChanged) {
      unsubDirChanged = await onDirectoryChanged(() => log("📡 workspace:directory-changed"));
    }
    log(`watchDirectory ✓ ${PROJECT_ROOT}`);
    message.success("目录监听已启动，在工作区新建/删除文件试试");
  } catch (e) {
    log(`watchDirectory error: ${e}`);
    message.error(String(e));
  }
}

async function onStopDirWatch() {
  try {
    await unwatchDirectory();
    if (unsubDirChanged) {
      unsubDirChanged();
      unsubDirChanged = null;
    }
    log("unwatchDirectory ✓");
  } catch (e) {
    log(`unwatchDirectory error: ${e}`);
  }
}

async function onCreateSampleFile() {
  try {
    const path = await apiCreateFile(PROJECT_ROOT, "test-stage3.md");
    log(`createFile ✓ ${path}`);
    message.success(`已创建 ${path}`);
  } catch (e) {
    log(`createFile error: ${e}`);
    message.error(String(e));
  }
}

async function onDeleteSampleFile() {
  try {
    const ok = await apiDeleteFile(SAMPLE_FILE);
    log(`deleteFile(${SAMPLE_FILE}) → ${ok}`);
    message.info(`删除: ${ok}`);
  } catch (e) {
    log(`deleteFile error: ${e}`);
    message.error(String(e));
  }
}

async function onWatchSampleFile() {
  try {
    await watchFiles([SAMPLE_FILE]);
    if (!unsubFileChanged) {
      unsubFileChanged = await onFileChanged((p) => log(`📡 file:changed ${p}`));
    }
    log(`watchFiles ✓ [${SAMPLE_FILE}]`);
    message.success("文件监听已启动，在外部编辑 test-stage3.md 试试");
  } catch (e) {
    log(`watchFiles error: ${e}`);
    message.error(String(e));
  }
}

async function onUnwatchSampleFile() {
  try {
    await watchFiles([]);
    if (unsubFileChanged) {
      unsubFileChanged();
      unsubFileChanged = null;
    }
    log("unwatch sample file ✓");
  } catch (e) {
    log(`unwatch error: ${e}`);
  }
}

onUnmounted(() => {
  unsubDirChanged?.();
  unsubFileChanged?.();
  watchFiles([]).catch(() => {});
  unwatchDirectory().catch(() => {});
});

onMounted(async () => {
  app.markReady();
  try {
    const { platform } = await import("@tauri-apps/plugin-os");
    app.setPlatform(await platform());
  } catch {
    app.setPlatform("web");
  }
});
</script>

<template>
  <div class="full-screen flex-center flex-col gap-4 bg-bg text-text p-8 overflow-auto">
    <h1 class="text-3xl font-bold text-primary">PureMark · Tauri 自检</h1>

    <NCard class="w-full max-w-160" title="Stage 1 技术栈自检">
      <NSpace vertical :size="12">
        <div>
          <NTag type="info">Vue 3</NTag>
          <NTag type="success" class="ml-2">App v{{ app.version }}</NTag>
          <NTag type="warning" class="ml-2">Platform: {{ app.platform }}</NTag>
          <NTag :type="app.ready ? 'success' : 'default'" class="ml-2">
            ready: {{ app.ready }}
          </NTag>
        </div>

        <NSpace>
          <NButton type="primary" @click="onPing">调用 Rust ping</NButton>
          <NButton @click="incr">Uno+Pinia: {{ counter }}</NButton>
          <NButton tertiary @click="router.push('/about')">跳转 About</NButton>
        </NSpace>

        <pre class="bg-bg2 p-3 rounded text-text2 text-sm">{{ pingResult }}</pre>
      </NSpace>
    </NCard>

    <NCard class="w-full max-w-160" title="Stage 2 文件系统 API 自检">
      <NSpace vertical :size="12">
        <NSpace>
          <NButton size="small" @click="onReadReadme">read README.md</NButton>
          <NButton size="small" @click="onIsReadOnly">isReadOnly</NButton>
          <NButton size="small" @click="onOpenDialog">open dialog</NButton>
          <NButton size="small" @click="onReadClipboardFiles">clipboard files</NButton>
        </NSpace>
        <pre class="bg-bg2 p-3 rounded text-text2 text-xs max-h-64 overflow-auto"
          >{{ stage2Log.join("\n") || "(未调用)" }}
        </pre>
      </NSpace>
    </NCard>

    <NCard class="w-full max-w-160" title="Stage 3 工作区 & 监听自检">
      <NSpace vertical :size="12">
        <NSpace>
          <NButton size="small" @click="onScanProjectRoot">scan project root</NButton>
          <NButton size="small" @click="onCheckExists">workspace exists</NButton>
        </NSpace>
        <NSpace>
          <NButton size="small" type="primary" @click="onStartDirWatch">start dir watch</NButton>
          <NButton size="small" @click="onStopDirWatch">stop dir watch</NButton>
        </NSpace>
        <NSpace>
          <NButton size="small" @click="onCreateSampleFile">create test-stage3.md</NButton>
          <NButton size="small" @click="onDeleteSampleFile">delete test-stage3.md</NButton>
        </NSpace>
        <NSpace>
          <NButton size="small" type="primary" @click="onWatchSampleFile"
            >watch sample file</NButton
          >
          <NButton size="small" @click="onUnwatchSampleFile">unwatch sample file</NButton>
        </NSpace>
      </NSpace>
    </NCard>
  </div>
</template>
