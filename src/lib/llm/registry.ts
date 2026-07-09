import { invoke } from "@tauri-apps/api/core";
import { api } from "../api";
import { isTauri } from "../tauri";
import type { LlmCompleteOptions, LlmMessage, LlmProviderId, LLMProvider } from "../types";
import { anthropicProvider } from "./anthropic";
import { createCustomOpenAiProvider, openaiProvider } from "./openai";

const BROWSER_ANTHROPIC_PROXY = "/api/llm/anthropic";
const BROWSER_OPENAI_PROXY = "/api/llm/openai";

const providers: Record<LlmProviderId, LLMProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  custom: createCustomOpenAiProvider(
    "https://api.openai.com/v1/chat/completions",
  ),
};

export function getProvider(id: LlmProviderId, customBaseUrl?: string): LLMProvider {
  if (id === "custom" && customBaseUrl) {
    return createCustomOpenAiProvider(customBaseUrl);
  }
  return providers[id];
}

export async function completeWithProvider(
  providerId: LlmProviderId,
  messages: LlmMessage[],
  options: LlmCompleteOptions,
): Promise<string> {
  if (isTauri()) {
    return invoke<string>("complete_llm", {
      input: {
        provider: providerId,
        messages,
        model: options.model,
        jsonMode: options.jsonMode,
        temperature: options.temperature,
        baseUrl: options.baseUrl,
      },
    });
  }

  const apiKey = await api.getApiKey(providerId);
  if (!apiKey?.trim()) {
    throw new Error("No API key configured. Add one in Settings.");
  }

  const browserOptions: LlmCompleteOptions = {
    ...options,
    baseUrl:
      providerId === "anthropic"
        ? BROWSER_ANTHROPIC_PROXY
        : providerId === "openai"
          ? BROWSER_OPENAI_PROXY
          : options.baseUrl,
  };

  const provider = getProvider(providerId, browserOptions.baseUrl);
  return provider.complete(messages, browserOptions, apiKey);
}
