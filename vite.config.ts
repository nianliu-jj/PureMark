import path from "node:path";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import UnoCSS from "unocss/vite";
import { defineConfig } from "vite";
import vitePluginsAutoI18n, { EmptyTranslator } from "vite-auto-i18n-plugin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const alias = {
  "@": path.resolve(__dirname, "./src"),
};

const i18nPlugin = vitePluginsAutoI18n({
  deepScan: true,
  globalPath: "./lang",
  namespace: "lang",
  distPath: "./dist/assets",
  distKey: "index",
  targetLangList: ["ja", "ko", "ru", "en", "fr"],
  originLang: "zh-cn",
  translator: new EmptyTranslator(),
});

// Tauri v2: 使用 host 环境变量作为 dev server host
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.0.0"),
  },
  plugins: [vue(), UnoCSS(), i18nPlugin],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  base: "./",
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        "theme-editor": path.resolve(__dirname, "theme-editor.html"),
      },
    },
  },
  resolve: {
    alias,
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
}));
