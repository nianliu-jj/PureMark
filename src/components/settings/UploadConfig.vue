<script setup lang="ts">
import { computed } from "vue";
import Input from "@/components/ui/input/Input.vue";
import Selector from "@/components/ui/selector/Selector.vue";
import { useConfig } from "@/hooks/useConfig";
import type {
  UploadBodyType,
  UploadConfig as UploadConfigState,
  UploadRequestMethod,
} from "@/utils/uploadConfig";

const { config, setConf } = useConfig();

function updateUploadField<K extends keyof UploadConfigState>(key: K, value: UploadConfigState[K]) {
  setConf("upload", key, value);
}

const url = computed({
  get: () => config.value.upload.url,
  set: (value: string) => updateUploadField("url", value.trim()),
});

const requestMethod = computed<UploadRequestMethod>({
  get: () => config.value.upload.method,
  set: (value) => updateUploadField("method", value),
});

const headers = computed({
  get: () => config.value.upload.headers,
  set: (value: string) => updateUploadField("headers", value.trim()),
});

const bodyType = computed<UploadBodyType>({
  get: () => config.value.upload.bodyType,
  set: (value) => updateUploadField("bodyType", value),
});

const fileField = computed({
  get: () => config.value.upload.fileField,
  set: (value: string) => updateUploadField("fileField", value.trim()),
});

const extraBody = computed({
  get: () => config.value.upload.extraBody,
  set: (value: string) => updateUploadField("extraBody", value.trim()),
});

const responseUrlPath = computed({
  get: () => config.value.upload.responseUrlPath,
  set: (value: string) => updateUploadField("responseUrlPath", value.trim()),
});

const requestMethodItems = [
  { label: "POST", value: "POST" },
  { label: "PUT", value: "PUT" },
] as const;

const bodyTypeItems = [
  { label: "multipart/form-data", value: "multipart/form-data" },
  { label: "application/json", value: "application/json" },
  {
    label: "application/x-www-form-urlencoded",
    value: "application/x-www-form-urlencoded",
  },
] as const;
</script>

<template>
  <div class="remote-options">
    <Input v-model="url" placeholder="https://example.com/upload" label="请求地址" required />
    <Selector
      v-model="requestMethod"
      :items="requestMethodItems"
      placeholder="请求方法"
      label="请求方法"
      required
    />
    <Selector
      v-model="bodyType"
      :items="bodyTypeItems"
      placeholder="请求体类型"
      label="请求体类型"
      required
    />
    <Input v-model="fileField" placeholder="file" label="文件字段名" required />
    <Input v-model="responseUrlPath" placeholder="data.url" label="响应图片路径" required />
    <Input v-model="headers" placeholder='如：{"Authorization":"Bearer xxx"}' label="请求头" />
    <Input v-model="extraBody" placeholder='如：{"token":"xxx"}' label="额外字段" />
  </div>
</template>

<style lang="less" scoped>
.remote-options {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 0 10px;
  border-radius: 4px;
  gap: 12px;
}
</style>
