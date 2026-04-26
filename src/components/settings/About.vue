<script setup lang="ts">
import autotoast from "autotoast.js";
import { openExternal } from "@/services/api";
import { checkUpdate, type UpdateInfo } from "@/services/api/update";
import { version } from "../../../package.json";
import { computed, ref } from "vue";
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

const storedUpdateInfo = ref<Partial<UpdateInfo>>(readStoredUpdateInfo());
const hasNewVersion = computed(() => {
  const storedVersion = storedUpdateInfo.value.version;
  return Boolean(storedVersion && isNewerVersion(storedVersion, version));
});

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
const isChecking = ref(false);

function handleCheckUpdate() {
  if (isChecking.value) {
    console.log("[About] Already checking for updates, skipping...");
    return;
  }

  console.log("[About] Starting update check...");
  isChecking.value = true;
  localStorage.removeItem("ignoredVersion");

  checkUpdate()
    .then((info) => {
      console.log("[About] Update check completed:", info);
      isChecking.value = false;

      if (info && info.version) {
        console.log("[About] New version available:", info.version);
        storedUpdateInfo.value = info;
        localStorage.setItem("updateInfo", JSON.stringify(info));
      } else {
        console.log("[About] Already on latest version");
        autotoast.show("当前已为最新版本", "success");
      }
    })
    .catch((err) => {
      console.error("[About] checkUpdate error:", err);
      autotoast.show(`检查更新失败: ${err.message || "Unknown error"}`, "error");
      isChecking.value = false;
    })
    .finally(() => {
      // 确保状态总是被重置
      console.log("[About] Update check finished, resetting state");
      isChecking.value = false;
    });
}
</script>

<template>
  <div class="AboutBox">
    <h1 class="link" @click="openByDefaultBrowser(`https://github.com/nianliu-jj/PureMark`)">
      <img :src="logoSvg" class="logo" /> 简墨 PureMark
    </h1>
    <p>
      <span class="link version" @click="handleCheckUpdate">
        <span>version: v{{ version }} </span>
        <span v-if="isChecking" class="updateTip loading">
          <LoadingIcon />
        </span>
        <span v-else-if="hasNewVersion" class="updateTip">new</span>
      </span>
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

  .updateTip {
    background: var(--secondary-color);
    color: white;
    font-size: 12px;
    border-radius: 4px;
    padding: 2px 8px;
    margin-left: 4px;
    vertical-align: middle;
    display: inline-flex;
    align-items: center;
    justify-content: center;

    &.loading {
      background: transparent;
      padding: 0;

      svg {
        font-size: 12px;
        color: var(--primary-color);
      }
    }
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .tip {
    position: absolute;
    bottom: 30px;
    font-size: 10px;
    color: var(--primary-color-transparent);
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
