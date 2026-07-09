import { api } from "../api";
import type { LlmCompleteOptions, LlmMessage, LlmProviderId, LLMProvider } from "../types";
import { anthropicProvider } from "./anthropic";
import { createCustomOpenAiProvider, openaiProvider } from "./openai";

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
  const apiKey = await api.getApiKey(providerId);
  const provider = getProvider(providerId, options.baseUrl);
  return provider.complete(messages, options, apiKey);
}
