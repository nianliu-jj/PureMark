import type { Ref } from "vue";
import { defineComponent, ref } from "vue";
import { createContext } from "./createContext";

interface PureMarkContext {
  isCollapsed: Ref<boolean>;
  collapse: () => void;
  expand: () => void;
  toggleCollapse: () => void;
}

const [usePureMark, provideContext] = createContext<PureMarkContext>("PureMark");

function initState() {
  const isCollapsed = ref(false);

  function collapse() {
    isCollapsed.value = true;
  }

  function expand() {
    isCollapsed.value = false;
  }

  function toggleCollapse() {
    isCollapsed.value = !isCollapsed.value;
  }

  provideContext({
    isCollapsed,
    collapse,
    expand,
    toggleCollapse,
  });
}

const PureMarkProvider = defineComponent((_, { slots }) => {
  initState();

  return () => slots.default?.();
});

export { PureMarkProvider, usePureMark };
