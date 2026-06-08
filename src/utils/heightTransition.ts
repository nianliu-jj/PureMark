/**
 * 高度过渡动画工具函数
 * 提供统一的过渡动画效果处理
 *
 * 通过 Vue <transition> 的 JS 钩子，实现「展开 / 收起」时的高度过渡，
 * 并叠加模糊、缩放、位移与透明度变化，形成柔和的进出场效果。
 */

/** 过渡动画可配置项（均为可选，缺省走默认配置） */
export interface TransitionConfig {
  /** 动画时长（毫秒） */
  duration?: number;
  /** 进出场时的模糊半径（px） */
  blurAmount?: number;
  /** 进出场时的缩放比例 */
  scaleAmount?: number;
  /** 进出场时的纵向位移（px） */
  translateY?: number;
}

/**
 * 默认过渡配置
 */
const defaultConfig: Required<TransitionConfig> = {
  duration: 300,
  blurAmount: 20,
  scaleAmount: 0.95,
  translateY: 20,
};

/**
 * 创建过渡动画钩子函数
 *
 * 返回一组 Vue <transition> 的 JS 钩子（onBeforeEnter / onEnter / ...）。
 * 进场：从 0 高度 + 模糊 + 缩放 + 位移渐变到目标高度的正常态；
 * 离场：反向过渡。其中 onEnter 通过读取 scrollHeight 取得目标高度，
 * 并主动触发一次重排以保证过渡曲线生效。
 *
 * @param config 过渡配置（与默认配置合并）
 * @returns 可直接绑定到 <transition> 的钩子对象
 */
export function createHeightTransition(config: TransitionConfig = {}) {
  const finalConfig = { ...defaultConfig, ...config };
  const { duration, blurAmount, scaleAmount, translateY } = finalConfig;

  return {
    onBeforeEnter(el: Element) {
      const element = el as HTMLElement;
      element.style.height = "0px";
      element.style.overflow = "hidden";
      element.style.filter = `blur(${blurAmount}px)`;
      element.style.transform = `scale(${scaleAmount}) translateY(${translateY}px)`;
      element.style.opacity = "0";
    },

    onEnter(el: Element, done: () => void) {
      const element = el as HTMLElement;
      const targetHeight = element.scrollHeight;

      // 强制重排
      void element.offsetHeight;

      // 设置过渡动画
      element.style.height = `${targetHeight}px`;
      element.style.filter = "blur(0px)";
      element.style.transform = "scale(1) translateY(0px)";
      element.style.opacity = "1";

      // 动画完成后调用done
      setTimeout(done, duration);
    },

    onAfterEnter(el: Element) {
      const element = el as HTMLElement;
      element.style.height = "";
      element.style.overflow = "";
      element.style.filter = "";
      element.style.opacity = "";
      element.style.transition = "";
    },

    onBeforeLeave(el: Element) {
      const element = el as HTMLElement;
      element.style.height = `${element.scrollHeight}px`;
      element.style.overflow = "hidden";
      element.style.filter = "blur(0px)";
      element.style.transform = "scale(1) translateY(0px)";
      element.style.opacity = "1";

      // 强制重排
      void element.offsetHeight;
    },

    onLeave(el: Element, done: () => void) {
      const element = el as HTMLElement;

      // 设置过渡动画
      element.style.height = "0px";
      element.style.filter = `blur(${blurAmount}px)`;
      element.style.transform = `scale(${scaleAmount}) translateY(${translateY}px)`;
      element.style.opacity = "0";

      // 动画完成后调用done
      setTimeout(done, duration);
    },

    onAfterLeave(el: Element) {
      const element = el as HTMLElement;
      element.style.height = "";
      element.style.overflow = "";
      element.style.filter = "";
      element.style.opacity = "";
      element.style.transition = "";
    },
  };
}

/**
 * 预定义的过渡效果集合。
 *
 * 基于 createHeightTransition 预设的几种常用强度，开箱即用：
 * blurScale（默认）、subtleBlur（轻微）、strongBlur（强烈）、heightOnly（纯高度）。
 */
export const transitionEffects = {
  // 默认模糊缩放效果
  blurScale: createHeightTransition(),

  // 轻微模糊效果
  subtleBlur: createHeightTransition({
    blurAmount: 5,
    scaleAmount: 0.95,
    translateY: 20,
  }),

  // 强烈模糊效果
  strongBlur: createHeightTransition({
    blurAmount: 15,
    scaleAmount: 0.8,
    translateY: 80,
  }),

  // 纯高度动画（无模糊和缩放）
  heightOnly: createHeightTransition({
    blurAmount: 0,
    scaleAmount: 1,
    translateY: 0,
  }),
};

export type TransitionEffect = ReturnType<typeof createHeightTransition>;
