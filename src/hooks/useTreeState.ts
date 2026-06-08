/**
 * useTreeState / useTreeNode — 工作区文件树的展开状态与单节点交互逻辑。
 *
 * expandedNodes 是模块级共享的目录展开集合（以路径标识），供整棵树跨组件共享展开/收起状态。
 * useTreeState 暴露对该集合的命令式操作；useTreeNode 为单个树节点提供派生状态
 * （是否展开 / 是否选中）与点击交互（目录切展开、文件调用 useTab.openFile 打开）。
 */
import type { Tab } from "@/types/tab";
import { computed, reactive, ref } from "vue";
import useTab from "@/hooks/useTab";
import { transitionEffects } from "@/utils/heightTransition";

// 树节点接口
export interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: TreeNode[];
}

// 树节点组件属性接口
export interface TreeNodeProps {
  node: TreeNode;
  level?: number;
  currentTab: Tab | null;
}

// 全局的树节点展开状态管理
const expandedNodes = reactive<Set<string>>(new Set());

// 切换节点展开状态
/** 切换节点展开状态。 */
function toggleNodeExpanded(nodePath: string) {
  if (expandedNodes.has(nodePath)) {
    expandedNodes.delete(nodePath);
  } else {
    expandedNodes.add(nodePath);
  }
}

// 检查节点是否展开
/** 检查节点是否展开。 */
function isNodeExpanded(nodePath: string): boolean {
  return expandedNodes.has(nodePath);
}

// 设置节点展开状态
/** 显式设置节点展开/收起。 */
function setNodeExpanded(nodePath: string, expanded: boolean) {
  if (expanded) {
    expandedNodes.add(nodePath);
  } else {
    expandedNodes.delete(nodePath);
  }
}

// 清空所有展开状态
/** 清空所有展开状态。 */
function clearExpandedNodes() {
  expandedNodes.clear();
}

// 树节点逻辑管理
/**
 * 单个树节点的交互逻辑。
 * @param props 节点数据、层级与当前 Tab（用于判定选中）
 * @returns 子容器引用、isExpanded/isSelected 派生状态、toggleExpanded、过渡钩子与 handleNodeClick。
 */
export function useTreeNode(props: TreeNodeProps) {
  const { openFile } = useTab();

  // 子节点容器引用
  const childrenContainer = ref<HTMLElement>();

  // 使用全局状态管理展开状态
  const isExpanded = computed(() => isNodeExpanded(props.node.path));

  // 是否被选中
  const isSelected = computed(() => {
    return props.currentTab && props.currentTab.filePath === props.node.path;
  });

  // 切换展开状态
  function toggleExpanded() {
    if (props.node.isDirectory && props.node.children) {
      toggleNodeExpanded(props.node.path);
    }
  }

  // 使用预定义的过渡效果
  const transitionHooks = transitionEffects.blurScale;

  // 点击节点
  async function handleNodeClick() {
    if (props.node.isDirectory) {
      toggleExpanded();
    } else {
      // 处理文件点击，打开文件
      await openFile(props.node.path);
    }
  }

  return {
    childrenContainer,
    isExpanded,
    isSelected,
    toggleExpanded,
    transitionHooks,
    handleNodeClick,
  };
}

// 基础状态管理
/**
 * 暴露全局文件树展开状态及其操作。
 * @returns expandedNodes 与 toggle/is/set/clear 系列方法。
 */
export function useTreeState() {
  return {
    expandedNodes,
    toggleNodeExpanded,
    isNodeExpanded,
    setNodeExpanded,
    clearExpandedNodes,
  };
}
