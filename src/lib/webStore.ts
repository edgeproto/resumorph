const SETTINGS_KEY = "resumorph_settings";
const API_KEYS_KEY = "resumorph_api_keys";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function webGetSettingsMap(): Record<string, string> {
  return readJson<Record<string, string>>(SETTINGS_KEY, {});
}

export function webSetSetting(key: string, value: string) {
  const map = webGetSettingsMap();
  map[key] = value;
  writeJson(SETTINGS_KEY, map);
}

export function webGetApiKeys(): Record<string, string> {
  return readJson<Record<string, string>>(API_KEYS_KEY, {});
}

export function webSetApiKey(provider: string, apiKey: string) {
  const keys = webGetApiKeys();
  keys[provider] = apiKey;
  writeJson(API_KEYS_KEY, keys);
}

export function webDeleteApiKey(provider: string) {
  const keys = webGetApiKeys();
  delete keys[provider];
  writeJson(API_KEYS_KEY, keys);
}

export function webGetApiKey(provider: string): string {
  return webGetApiKeys()[provider] ?? "";
}

export function webHasApiKey(provider: string): boolean {
  return !!webGetApiKey(provider);
}

export function webListApiKeyStatus() {
  const providers = ["anthropic", "openai", "custom"] as const;
  return providers.map((provider) => ({
    provider,
    hasKey: webHasApiKey(provider),
  }));
}
