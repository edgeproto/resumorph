import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { isTauri } from "./tauri";
import type { AppSettings, LlmProviderId } from "./types";

const DEFAULTS: AppSettings = {
  defaultProvider: "anthropic",
  defaultModelAnthropic: "claude-sonnet-4-20250514",
  defaultModelOpenai: "gpt-4o",
  defaultModelCustom: "gpt-4o",
  customBaseUrl: "http://localhost:11434/v1/chat/completions",
  temperature: 0.7,
  exportIncludePdf: false,
  pdfConverter: "auto",
};

function parseSettingsMap(
  map: Record<string, string>,
): AppSettings {
  return {
    defaultProvider: (map.default_provider as LlmProviderId) ?? DEFAULTS.defaultProvider,
    defaultModelAnthropic: map.default_model_anthropic ?? DEFAULTS.defaultModelAnthropic,
    defaultModelOpenai: map.default_model_openai ?? DEFAULTS.defaultModelOpenai,
    defaultModelCustom: map.default_model_custom ?? DEFAULTS.defaultModelCustom,
    customBaseUrl: map.custom_base_url ?? DEFAULTS.customBaseUrl,
    temperature: parseFloat(map.temperature ?? String(DEFAULTS.temperature)),
    exportIncludePdf: map.export_include_pdf === "true",
    pdfConverter: (map.pdf_converter as AppSettings["pdfConverter"]) ?? DEFAULTS.pdfConverter,
  };
}

export function useAppSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const map = await api.getSettingsMap();
      return parseSettingsMap(map);
    },
    initialData: DEFAULTS,
    retry: isTauri() ? 3 : 0,
  });
}

export function modelForProvider(settings: AppSettings, provider: LlmProviderId): string {
  switch (provider) {
    case "anthropic":
      return settings.defaultModelAnthropic;
    case "openai":
      return settings.defaultModelOpenai;
    case "custom":
      return settings.defaultModelCustom;
  }
}

export async function saveAppSettings(settings: Partial<AppSettings>): Promise<void> {
  const entries: [string, string][] = [];
  if (settings.defaultProvider !== undefined) {
    entries.push(["default_provider", settings.defaultProvider]);
  }
  if (settings.defaultModelAnthropic !== undefined) {
    entries.push(["default_model_anthropic", settings.defaultModelAnthropic]);
  }
  if (settings.defaultModelOpenai !== undefined) {
    entries.push(["default_model_openai", settings.defaultModelOpenai]);
  }
  if (settings.defaultModelCustom !== undefined) {
    entries.push(["default_model_custom", settings.defaultModelCustom]);
  }
  if (settings.customBaseUrl !== undefined) {
    entries.push(["custom_base_url", settings.customBaseUrl]);
  }
  if (settings.temperature !== undefined) {
    entries.push(["temperature", String(settings.temperature)]);
  }
  if (settings.exportIncludePdf !== undefined) {
    entries.push(["export_include_pdf", String(settings.exportIncludePdf)]);
  }
  if (settings.pdfConverter !== undefined) {
    entries.push(["pdf_converter", settings.pdfConverter]);
  }
  await Promise.all(entries.map(([k, v]) => api.setSetting(k, v)));
}

export { DEFAULTS as DEFAULT_SETTINGS };
