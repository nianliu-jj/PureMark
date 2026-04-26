<script setup lang="ts">
import { computed } from "vue";
import { Switch } from "@/components/ui/switch";
import { useConfig } from "@/hooks/useConfig";

const { config, setConf } = useConfig();

const autoExpandSidebar = computed(() => config.value.workspace?.autoExpandSidebar ?? false);

function updateAutoExpandSidebar(value: boolean) {
  setConf("workspace", {
    ...config.value.workspace,
    autoExpandSidebar: value,
  });
}
</script>

<template>
  <div class="WorkspaceSettingBox">
    <div class="setting-row switch-row">
      <span class="row-label">侧边栏</span>
      <div class="switch-wrapper">
        <Switch
          :model-value="autoExpandSidebar"
          label="启动时自动展开左右侧边栏"
          @update:model-value="updateAutoExpandSidebar"
        />
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.WorkspaceSettingBox {
  display: flex;
  flex-direction: column;
  gap: 16px;

  .setting-row {
    display: flex;
    align-items: flex-start;
    gap: 14px;

    .row-label {
      min-width: 100px;
      padding-top: 10px;
      font-size: 14px;
      color: var(--text-color-1);
      flex-shrink: 0;
    }
  }

  .switch-wrapper {
    padding-top: 8px;
  }
}

@media (max-width: 768px) {
  .WorkspaceSettingBox {
    .setting-row {
      flex-direction: column;
      gap: 8px;

      .row-label {
        min-width: auto;
        padding-top: 0;
      }
    }

    .switch-wrapper {
      padding-top: 0;
    }
  }
}
</style>
