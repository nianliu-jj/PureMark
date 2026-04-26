<script setup lang="ts">
import { NButton, NCard } from "naive-ui";
import { useRouter } from "vue-router";
import { useAppStore } from "@/stores/app";

const router = useRouter();
const app = useAppStore();
</script>

<template>
  <div class="full-screen flex-center bg-bg text-text p-8">
    <NCard class="w-full max-w-120" title="关于简墨（PureMark）">
      <p class="text-text2 leading-relaxed mb-4">
        这是路由跳转验证页。Pinia 的 ready 状态在跳转后仍保持：
        <strong class="text-primary">{{ app.ready }}</strong
        >。
      </p>
      <NButton @click="router.back()">返回</NButton>
    </NCard>
  </div>
</template>
