<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import AppIcon from "@/components/ui/AppIcon.vue";
import emitter from "@/events";
import useOutline from "@/hooks/useOutline";

const { outline } = useOutline();

const collapsedSet = reactive(new Set<string>());

const collapsibleCount = computed(() =>
  outline.value.reduce((count, _item, index) => count + (hasChildren(index) ? 1 : 0), 0)
);

function isHiddenByCollapse(index: number): boolean {
  const items = outline.value;
  let targetLevel = items[index].level;
  for (let i = index - 1; i >= 0; i--) {
    if (items[i].level < targetLevel) {
      if (collapsedSet.has(items[i].id)) {
        return true;
      }
      targetLevel = items[i].level;
    }
  }
  return false;
}

function hasChildren(index: number): boolean {
  const items = outline.value;
  const currentLevel = items[index].level;
  return index + 1 < items.length && items[index + 1].level > currentLevel;
}

function toggleCollapse(oi: { id: string }) {
  if (collapsedSet.has(oi.id)) {
    collapsedSet.delete(oi.id);
  } else {
    collapsedSet.add(oi.id);
  }
}

function onOiClick(oi: { pos: number }) {
  emitter.emit("outline:scrollTo", oi.pos);
}

const contextMenu = ref<{
  visible: boolean;
  x: number;
  y: number;
  item: { id: string; text: string; level: number; pos: number } | null;
}>({
  visible: false,
  x: 0,
  y: 0,
  item: null,
});

const showCollapseSubmenu = ref(false);

function onItemContextMenu(
  e: MouseEvent,
  oi: { id: string; text: string; level: number; pos: number }
) {
  e.preventDefault();
  e.stopPropagation();
  showCollapseSubmenu.value = false;
  contextMenu.value = {
    visible: true,
    x: e.clientX,
    y: e.clientY,
    item: oi,
  };
}

function closeContextMenu() {
  contextMenu.value.visible = false;
  showCollapseSubmenu.value = false;
}

function handleJump() {
  if (contextMenu.value.item) {
    emitter.emit("outline:scrollTo", contextMenu.value.item.pos);
  }
  closeContextMenu();
}

function collapseByLevel(level: number) {
  outline.value.forEach((oi, index) => {
    if (oi.level === level && hasChildren(index)) {
      collapsedSet.add(oi.id);
    }
  });
  closeContextMenu();
}

function expandAll() {
  collapsedSet.clear();
  closeContextMenu();
}

function collapseAll() {
  outline.value.forEach((oi, index) => {
    if (hasChildren(index)) {
      collapsedSet.add(oi.id);
    }
  });
}

watch(
  outline,
  (items) => {
    const validIds = new Set(items.map((item) => item.id));
    Array.from(collapsedSet).forEach((id) => {
      if (!validIds.has(id)) {
        collapsedSet.delete(id);
      }
    });
  },
  { deep: true }
);

function onDocClick() {
  closeContextMenu();
}

onMounted(() => document.addEventListener("click", onDocClick));
onUnmounted(() => document.removeEventListener("click", onDocClick));
</script>

<template>
  <div class="OutlinePanel">
    <div class="panel-header">
      <span class="panel-title">大纲</span>
    </div>

    <div class="content-container">
      <div class="outlineList">
        <div v-if="outline.length > 0" class="outlineToolbar">
          <button class="outlineToolbarBtn" :disabled="collapsibleCount === 0" @click="collapseAll">
            全部折叠
          </button>
          <button class="outlineToolbarBtn" :disabled="collapsedSet.size === 0" @click="expandAll">
            全部展开
          </button>
        </div>
        <template v-if="outline.length > 0">
          <template v-for="(oi, index) in outline" :key="oi.id">
            <div
              v-if="!isHiddenByCollapse(index)"
              class="outlineItem"
              :style="{ paddingLeft: `${oi.level * 12}px` }"
              @click="onOiClick(oi)"
              @contextmenu="onItemContextMenu($event, oi)"
            >
              <span
                v-if="hasChildren(index)"
                class="collapse-icon"
                :class="{ collapsed: collapsedSet.has(oi.id) }"
                @click.stop="toggleCollapse(oi)"
              >
                <AppIcon name="arrow-right" />
              </span>
              <span v-else class="collapse-icon-placeholder"></span>
              <span class="outlineItem-text">{{ oi.text }}</span>
            </div>
          </template>
        </template>
        <div v-else class="empty-state">
          <AppIcon name="List-outlined" class="empty-icon" />
          <span class="empty-text">暂无大纲</span>
        </div>
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="outline-context-menu"
        :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
        @click.stop
      >
        <div class="outline-ctx-item" @click="handleJump">
          <span>跳转到该位置</span>
        </div>
        <div class="outline-ctx-divider" />
        <div
          class="outline-ctx-item has-submenu"
          @mouseenter="showCollapseSubmenu = true"
          @mouseleave="showCollapseSubmenu = false"
        >
          <span>折叠</span>
          <AppIcon name="arrow-right" class="submenu-arrow" />
          <div v-if="showCollapseSubmenu" class="outline-submenu">
            <div class="outline-ctx-item" @click="collapseByLevel(1)">折叠一级标题</div>
            <div class="outline-ctx-item" @click="collapseByLevel(2)">折叠二级标题</div>
            <div class="outline-ctx-item" @click="collapseByLevel(3)">折叠三级标题</div>
            <div class="outline-ctx-item" @click="collapseByLevel(4)">折叠四级标题</div>
            <div class="outline-ctx-item" @click="collapseByLevel(5)">折叠五级标题</div>
            <div class="outline-ctx-item" @click="collapseByLevel(6)">折叠六级标题</div>
            <div class="outline-ctx-divider" />
            <div class="outline-ctx-item" @click="expandAll">展开全部</div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style lang="less" scoped>
.OutlinePanel {
  width: 100%;
  height: 100%;
  background: var(--background-color-2);
  display: flex;
  flex-direction: column;

  .panel-header {
    display: flex;
    align-items: center;
    min-height: 40px;
    padding: 0 14px;
    border-bottom: 1px solid var(--border-color-1);
    flex-shrink: 0;

    .panel-title {
      font-size: 13px;
      font-weight: 700;
      color: var(--text-color-1);
      letter-spacing: 0.04em;
    }
  }

  .content-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  .outlineList {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 8px 4px;

    .outlineToolbar {
      display: flex;
      gap: 8px;
      padding: 0 6px 8px;
    }

    .outlineToolbarBtn {
      flex: 1;
      height: 28px;
      border-radius: 8px;
      border: 1px solid var(--border-color-1);
      background: var(--background-color-1);
      color: var(--text-color-2);
      font-size: 12px;
      cursor: pointer;
      transition:
        background 0.2s ease,
        border-color 0.2s ease,
        color 0.2s ease;

      &:hover:not(:disabled) {
        background: var(--hover-background-color);
        border-color: var(--border-color-2);
        color: var(--text-color-1);
      }

      &:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 20px;
      gap: 12px;

      .empty-icon {
        font-size: 32px;
        color: var(--text-color-3);
        opacity: 0.5;
      }

      .empty-text {
        color: var(--text-color-3);
        font-size: 12px;
      }
    }

    .outlineItem {
      display: flex;
      align-items: center;
      width: 100%;
      color: var(--text-color-1);
      font-size: 13px;
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: all 0.2s ease;
      padding: 4px 4px;
      border-radius: 4px;
      margin: 0 2px;

      &:hover {
        background: var(--background-color-1);
      }

      .collapse-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        flex-shrink: 0;
        margin-right: 4px;
        transition: transform 0.2s;
        transform: rotate(90deg);
        color: var(--text-color-3);
        font-size: 10px;
        border-radius: 3px;

        &:hover {
          background: var(--hover-background-color);
        }

        &.collapsed {
          transform: rotate(0deg);
        }
      }

      .collapse-icon-placeholder {
        display: inline-block;
        width: 16px;
        height: 16px;
        flex-shrink: 0;
        margin-right: 4px;
      }

      .outlineItem-text {
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }
  }
}
</style>

<style lang="less">
.outline-context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 140px;
  background: var(--background-color-1);
  border: 1px solid var(--border-color-1);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 4px 0;
  font-size: 12px;

  .outline-ctx-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 12px;
    cursor: pointer;
    color: var(--text-color-1);
    transition: background-color 0.15s;
    position: relative;
    white-space: nowrap;

    &:hover {
      background: var(--hover-background-color);
    }

    .submenu-arrow {
      font-size: 10px;
      color: var(--text-color-3);
    }
  }

  .outline-ctx-divider {
    height: 1px;
    background: var(--border-color-1);
    margin: 4px 0;
  }

  .has-submenu {
    position: relative;
  }

  .outline-submenu {
    position: absolute;
    left: 100%;
    top: -4px;
    min-width: 130px;
    background: var(--background-color-1);
    border: 1px solid var(--border-color-1);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    padding: 4px 0;
  }
}
</style>
