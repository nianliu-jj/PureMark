import {
  defineConfig,
  presetAttributify,
  presetIcons,
  presetTypography,
  presetUno,
  transformerDirectives,
  transformerVariantGroup,
} from "unocss";

export default defineConfig({
  presets: [
    presetUno(),
    presetAttributify(),
    presetIcons({
      scale: 1.2,
      warn: true,
    }),
    presetTypography(),
  ],
  transformers: [transformerDirectives(), transformerVariantGroup()],
  shortcuts: [
    ["flex-center", "flex items-center justify-center"],
    ["flex-between", "flex items-center justify-between"],
    ["full-screen", "w-screen h-screen"],
  ],
  theme: {
    colors: {
      primary: "var(--primary-color)",
      bg: "var(--background-color-1)",
      bg2: "var(--background-color-2)",
      text: "var(--text-color)",
      text2: "var(--text-color-2)",
      text3: "var(--text-color-3)",
      hover: "var(--hover-color)",
      active: "var(--active-color)",
      border: "var(--border-color-1)",
    },
  },
});
