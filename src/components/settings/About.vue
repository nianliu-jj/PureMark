<script setup lang="ts">
import autotoast from "autotoast.js";
import { openExternal } from "@/services/api";
import {
  checkUpdate,
  downloadUpdate,
  quitAndInstall,
  onUpdateStatus,
  onDownloadProgress,
  type UpdateInfo,
  type UpdateProgressPayload,
} from "@/services/api/update";
import { version } from "../../../package.json";
import { computed, onMounted, onUnmounted, ref } from "vue";
import AppIcon from "@/components/ui/AppIcon.vue";
import LoadingIcon from "../ui/LoadingIcon.vue";

const logoSvg = `${import.meta.env.BASE_URL}logo.svg`;

function openByDefaultBrowser(url: string) {
  openExternal(url).catch((e) => console.error("[About] openExternal failed:", e));
}

function readStoredUpdateInfo(): Partial<UpdateInfo> {
  const raw = localStorage.getItem("updateInfo");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.warn("[About] updateInfo 缓存已损坏，已重置:", error);
    localStorage.removeItem("updateInfo");
    return {};
  }
}

function isNewerVersion(stored: string, current: string): boolean {
  const s = stored.replace(/^v/, "").split(".").map(Number);
  const c = current.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(s.length, c.length); i++) {
    const sv = s[i] || 0;
    const cv = c[i] || 0;
    if (sv > cv) return true;
    if (sv < cv) return false;
  }
  return false;
}

const storedUpdateInfo = ref<Partial<UpdateInfo>>(readStoredUpdateInfo());
const hasNewVersion = computed(() =>
  Boolean(storedUpdateInfo.value.version && isNewerVersion(storedUpdateInfo.value.version, version))
);

// 状态：idle | checking | downloading | installing
const updatePhase = ref<"idle" | "checking" | "downloading" | "installing">("idle");
const downloadPercent = ref(0);

async function handleCheckUpdate() {
  if (updatePhase.value !== "idle") return;
  updatePhase.value = "checking";
  localStorage.removeItem("ignoredVersion");

  try {
    const info = await checkUpdate();
    if (info?.version) {
      storedUpdateInfo.value = info;
      localStorage.setItem("updateInfo", JSON.stringify(info));
    } else {
      autotoast.show("当前已为最新版本", "success");
    }
  } catch (err: any) {
    autotoast.show(`检查更新失败: ${err.message || "未知错误"}`, "error");
  } finally {
    updatePhase.value = "idle";
  }
}

async function handleDownloadAndInstall() {
  if (updatePhase.value !== "idle") return;
  updatePhase.value = "downloading";
  downloadPercent.value = 0;

  try {
    await downloadUpdate();
    updatePhase.value = "installing";
    await quitAndInstall();
  } catch (err: any) {
    autotoast.show(`更新失败: ${err.message || "未知错误"}`, "error");
    updatePhase.value = "idle";
  }
}

// 监听后端进度事件（支持多窗口广播）
let unlistenStatus: (() => void) | null = null;
let unlistenProgress: (() => void) | null = null;

onMounted(async () => {
  unlistenStatus = await onUpdateStatus((payload) => {
    if (payload.status === "downloaded") {
      updatePhase.value = "installing";
    } else if (payload.status === "error") {
      autotoast.show(`更新失败: ${payload.error || "未知错误"}`, "error");
      updatePhase.value = "idle";
    }
  });
  unlistenProgress = await onDownloadProgress((payload: UpdateProgressPayload) => {
    downloadPercent.value = Math.round(payload.percent);
  });
});

onUnmounted(() => {
  unlistenStatus?.();
  unlistenProgress?.();
});
</script>

<template>
  <div class="AboutBox">
    <h1 class="link" @click="openByDefaultBrowser(`https://github.com/nianliu-jj/PureMark`)">
      <img :src="logoSvg" class="logo" /> 简墨 PureMark
    </h1>

    <p>
      <span class="version">
        <span>version: v{{ version }}</span>
      </span>
    </p>

    <!-- 检查更新 / 下载安装 按钮 -->
    <p>
      <button
        class="updateBtn"
        :disabled="updatePhase !== 'idle'"
        @click="hasNewVersion ? handleDownloadAndInstall() : handleCheckUpdate()"
      >
        <span v-if="updatePhase === 'checking'">
          <LoadingIcon class="btnIcon" /> 检查中…
        </span>
        <span v-else-if="updatePhase === 'downloading'">
          <LoadingIcon class="btnIcon" /> 下载中 {{ downloadPercent }}%
        </span>
        <span v-else-if="updatePhase === 'installing'">
          <LoadingIcon class="btnIcon" /> 安装中…
        </span>
        <span v-else-if="hasNewVersion"> ↑ 更新到 v{{ storedUpdateInfo.version }} </span>
        <span v-else>检查更新</span>
      </button>
    </p>

    <p>MIT Copyright © [2025] NianLiu</p>
    <p>
      项目主页：
      <span class="link" @click="openByDefaultBrowser(`https://github.com/nianliu-jj/PureMark`)"
        >nianliu-jj/PureMark</span
      >
    </p>
    <p>简墨（PureMark）是完全免费开源的软件</p>
  </div>
</template>

<style lang="less" scoped>
.AboutBox {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;

  .version {
    font-size: 12px;
    color: var(--text-color-2);
    margin-top: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .updateBtn {
    font-size: 13px;
    padding: 5px 18px;
    border-radius: 6px;
    border: 1px solid var(--border-color, #ddd);
    background: var(--card-color, #fff);
    color: var(--text-color);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: background 0.15s;

    &:hover:not(:disabled) {
      background: var(--primary-color-hover, #e8f0fe);
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.7;
    }
  }

  .btnIcon {
    font-size: 12px;
    color: var(--primary-color);
  }

  h1 {
    font-size: 20px;
    margin: 0;
    color: var(--text-color);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  h1 .logo {
    width: 64px;
    height: 64px;
    vertical-align: middle;
    margin-right: 8px;
  }

  p {
    font-size: 14px;
    color: var(--text-color-2);
  }
}
</style>
