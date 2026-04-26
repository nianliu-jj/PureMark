import { useStorage } from "@vueuse/core";
import { computed } from "vue";
import { migrateStorageValue } from "@/shared/utils/storage";

export type AIProvider = "openai" | "anthropic" | "gemini" | "ollama" | "custom";

export interface AIConfig {
  enabled: boolean;
  provider: AIProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  debounceWait: number;
}

const defaultAIConfig: AIConfig = {
  enabled: false,
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-3.5-turbo",
  temperature: 0.7,
  debounceWait: 2000,
};

const AI_CONFIG_STORAGE_KEY = "puremark-ai-config";
const LEGACY_AI_CONFIG_STORAGE_KEYS = ["milkup-ai-config"] as const;

// Default URLs for providers
export const providerDefaultUrls: Record<AIProvider, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com",
  ollama: "http://localhost:11434",
  custom: "",
};

function clampTemperature(value?: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return defaultAIConfig.temperature;
  }
  return Math.min(1, Math.max(0, value));
}

function normalizeDebounceWait(value?: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return defaultAIConfig.debounceWait;
  }
  return Math.min(10000, Math.max(500, Math.round(value)));
}

export function normalizeAIConfig(partial?: Partial<AIConfig>): AIConfig {
  const provider = partial?.provider || defaultAIConfig.provider;

  return {
    enabled: Boolean(partial?.enabled),
    provider,
    baseUrl: partial?.baseUrl?.trim() || providerDefaultUrls[provider] || defaultAIConfig.baseUrl,
    apiKey: partial?.apiKey?.trim() || "",
    model: partial?.model?.trim() || defaultAIConfig.model,
    temperature: clampTemperature(partial?.temperature),
    debounceWait: normalizeDebounceWait(partial?.debounceWait),
  };
}

export function validateAIConfig(
  config: AIConfig,
  mode: "test" | "complete" = "complete"
): string | null {
  if (!config.baseUrl.trim()) {
    return "请输入 API Base URL";
  }

  if (config.provider !== "ollama" && !config.apiKey.trim()) {
    return "请输入 API Key";
  }

  if (mode === "complete") {
    if (!config.model.trim()) {
      return "请输入模型名称";
    }

    if (!config.enabled) {
      return "请先启用 AI 续写";
    }
  }

  return null;
}

migrateStorageValue(localStorage, AI_CONFIG_STORAGE_KEY, LEGACY_AI_CONFIG_STORAGE_KEYS);

const config = useStorage<AIConfig>(AI_CONFIG_STORAGE_KEY, defaultAIConfig, localStorage, {
  serializer: {
    read: (value: string) => {
      try {
        return normalizeAIConfig(JSON.parse(value) as Partial<AIConfig>);
      } catch {
        return normalizeAIConfig(defaultAIConfig);
      }
    },
    write: (value: AIConfig) => JSON.stringify(normalizeAIConfig(value)),
  },
});

export function useAIConfig() {
  const isEnabled = computed(() => config.value.enabled);

  const updateConfig = (updates: Partial<AIConfig>) => {
    config.value = normalizeAIConfig({ ...config.value, ...updates });
  };

  const resetToDefault = () => {
    config.value = normalizeAIConfig(defaultAIConfig);
  };

  return {
    config,
    isEnabled,
    updateConfig,
    resetToDefault,
    providerDefaultUrls,
    validateAIConfig,
  };
}
