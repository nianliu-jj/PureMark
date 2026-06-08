<script setup lang="ts">
/**
 * AppearancePage.vue —— 外观设置聚合页
 *
 * 职责：将主题、背景板、字体、其他外观相关子面板组合在一个滚动页面中。
 * 自身不含逻辑，仅作为分区容器。无 props / emits。
 * UI 位置：偏好设置面板「外观」标签内容区。
 */
import BackgroundPanel from "./BackgroundPanel.vue";
import FontPage from "./FontPage.vue";
import OtherSetting from "./OtherSetting.vue";
import ThemePage from "./ThemePage.vue";
</script>

<template>
  <div class="appearance">
    <div class="appearance-item">
      <h2>主题</h2>

      <div class="appearance-item-content">
        <ThemePage />
      </div>
    </div>
    <div class="appearance-item">
      <h2>背景板</h2>

      <div class="appearance-item-content">
        <BackgroundPanel />
      </div>
    </div>
    <div class="appearance-item">
      <h2>字体</h2>

      <div class="appearance-item-content">
        <FontPage />
      </div>
    </div>

    <div class="appearance-item">
      <h2>其他</h2>

      <div class="appearance-item-content">
        <OtherSetting />
      </div>
    </div>
  </div>
</template>

<style lang="less" scoped>
.appearance {
  width: 100%;
  display: flex;
  flex-direction: column;
  padding: 0 10px;
  box-sizing: border-box;
  gap: 10px;
  padding-bottom: 200px;
  max-width: 800px;

  .appearance-item {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
}
</style>
