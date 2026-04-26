import "virtual:uno.css";
import "../lang/index.js";
import { createApp } from "vue";
import { directives } from "@/directives";
import naiveUI from "@/plugins/naive-ui";
import router from "@/router";
import pinia from "@/stores";
import App from "./App.vue";
import "./style.less";
import "@/themes/theme-main.less";

const app = createApp(App);

Object.entries(directives).forEach(([name, directive]) => {
  app.directive(name, directive);
});

app.use(pinia);
app.use(router);
app.use(naiveUI);

app.mount("#app");
