import type { RouteRecordRaw } from "vue-router";

export const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "editor",
    component: () => import("@/views/EditorView.vue"),
  },
  {
    path: "/diag",
    name: "diag",
    component: () => import("@/views/DiagView.vue"),
  },
  {
    path: "/about",
    name: "about",
    component: () => import("@/views/AboutView.vue"),
  },
];
