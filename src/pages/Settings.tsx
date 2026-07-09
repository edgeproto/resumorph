import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { PromptEditor } from "../components/PromptEditor";
import { api } from "../lib/api";
import { getDefaultPreset } from "../lib/prompts";
import { saveAppSettings, DEFAULT_SETTINGS, useAppSettings } from "../lib/settings";
import { isTauri } from "../lib/tauri";
import type { ApiKeyStatus, AppSettings, LlmProviderId, PromptPreset } from "../lib/types";

const PROVIDERS: { id: LlmProviderId; label: string }[] = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
  { id: "custom", label: "Custom (OpenAI-compatible)" },
];

const PROMPT_SECTIONS: {
  mode: "tailor" | "cover_letter" | "qa";
  title: string;
  description: string;
  editorMode: "tailor" | "cover_letter" | "qa";
}[] = [
  {
    mode: "tailor",
    title: "Resume prompt",
    description:
      "Used when you click Tailor Resume. Controls ATS-friendly JSON output and bullet depth.",
    editorMode: "tailor",
  },
  {
    mode: "cover_letter",
    title: "Cover letter prompt",
    description:
      "Used when you click Create Cover Letter. Controls tone, length, and JSON output format.",
    editorMode: "cover_letter",
  },
  {
    mode: "qa",
    title: "Q&A prompt",
    description:
      "Used for freeform chat and application questions. Controls short, native American answers.",
    editorMode: "qa",
  },
];

type PresetDraft = { systemPrompt: string; userPrompt: string };

function emptyDraft(): PresetDraft {
  return { systemPrompt: "", userPrompt: "" };
}

function draftFromPreset(preset: PromptPreset | undefined): PresetDraft {
  if (!preset) return emptyDraft();
  return {
    systemPrompt: preset.systemPrompt,
    userPrompt: preset.userPrompt,
  };
}

export function Settings() {
  const queryClient = useQueryClient();
  const { data: settings } = useAppSettings();

  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [form, setForm] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [presetDrafts, setPresetDrafts] = useState<Record<string, PresetDraft>>({});
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [presetSaveMessage, setPresetSaveMessage] = useState<
    Record<string, { type: "success" | "error"; message: string } | undefined>
  >({});
  const [keyFeedback, setKeyFeedback] = useState<
    Record<string, { type: "success" | "error"; message: string } | undefined>
  >({});

  const { data: appData } = useQuery({
    queryKey: ["appData"],
    queryFn: api.getAppDataInfo,
    enabled: isTauri(),
  });

  const { data: keyStatus = [], refetch: refetchKeyStatus } = useQuery({
    queryKey: ["apiKeyStatus"],
    queryFn: api.listApiKeyStatus,
    retry: isTauri() ? 3 : 0,
  });

  const { data: presets = [] } = useQuery({
    queryKey: ["promptPresets"],
    queryFn: api.listPromptPresets,
  });

  const promptPresets = useMemo(
    () =>
      PROMPT_SECTIONS.map((section) => ({
        ...section,
        preset: getDefaultPreset(presets, section.mode),
      })),
    [presets],
  );

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  useEffect(() => {
    setPresetDrafts((prev) => {
      const next = { ...prev };
      for (const { preset } of promptPresets) {
        if (!preset) continue;
        if (!next[preset.id]) {
          next[preset.id] = draftFromPreset(preset);
        }
      }
      return next;
    });
  }, [promptPresets]);

  function setProviderFeedback(
    provider: string,
    feedback: { type: "success" | "error"; message: string } | undefined,
  ) {
    setKeyFeedback((prev) => ({ ...prev, [provider]: feedback }));
    if (feedback) {
      setTimeout(() => {
        setKeyFeedback((prev) =>
          prev[provider] === feedback ? { ...prev, [provider]: undefined } : prev,
        );
      }, 5000);
    }
  }

  function setPresetFeedback(
    presetId: string,
    feedback: { type: "success" | "error"; message: string } | undefined,
  ) {
    setPresetSaveMessage((prev) => ({ ...prev, [presetId]: feedback }));
    if (feedback) {
      setTimeout(() => {
        setPresetSaveMessage((prev) =>
          prev[presetId] === feedback ? { ...prev, [presetId]: undefined } : prev,
        );
      }, 4000);
    }
  }

  function optimisticSetKeyStatus(provider: string, hasKey: boolean) {
    queryClient.setQueryData<ApiKeyStatus[]>(["apiKeyStatus"], (old) => {
      const base =
        old ?? PROVIDERS.map((p) => ({ provider: p.id, hasKey: false }));
      return base.map((k) => (k.provider === provider ? { ...k, hasKey } : k));
    });
  }

  const saveKeyMutation = useMutation({
    mutationFn: ({ provider, key }: { provider: string; key: string }) =>
      api.setApiKey(provider, key),
    onMutate: ({ provider }) => {
      setProviderFeedback(provider, undefined);
    },
    onSuccess: (_data, { provider }) => {
      optimisticSetKeyStatus(provider, true);
      queryClient.invalidateQueries({ queryKey: ["apiKeyStatus"] });
      refetchKeyStatus();
      setKeyInputs((prev) => ({ ...prev, [provider]: "" }));
      setProviderFeedback(provider, {
        type: "success",
        message: "API key saved.",
      });
    },
    onError: (error, { provider }) => {
      setProviderFeedback(provider, {
        type: "error",
        message:
          error instanceof Error ? error.message : "Failed to save API key.",
      });
    },
  });

  const deleteKeyMutation = useMutation({
    mutationFn: (provider: string) => api.deleteApiKey(provider),
    onMutate: (provider) => {
      setProviderFeedback(provider, undefined);
    },
    onSuccess: (_data, provider) => {
      optimisticSetKeyStatus(provider, false);
      queryClient.invalidateQueries({ queryKey: ["apiKeyStatus"] });
      setProviderFeedback(provider, {
        type: "success",
        message: "API key removed.",
      });
    },
    onError: (error, provider) => {
      setProviderFeedback(provider, {
        type: "error",
        message:
          error instanceof Error ? error.message : "Failed to remove API key.",
      });
    },
  });

  const saveSettingsMutation = useMutation({
    mutationFn: (s: AppSettings) => saveAppSettings(s),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setSaveMessage("Settings saved.");
      setTimeout(() => setSaveMessage(null), 3000);
    },
  });

  const updatePresetMutation = useMutation({
    mutationFn: ({ id, draft }: { id: string; draft: PresetDraft }) =>
      api.updatePromptPreset({
        id,
        systemPrompt: draft.systemPrompt,
        userPrompt: draft.userPrompt,
      }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["promptPresets"] });
      setPresetFeedback(id, {
        type: "success",
        message: "Prompt saved. Your next action will use this version.",
      });
    },
    onError: (error, { id }) => {
      setPresetFeedback(id, {
        type: "error",
        message:
          error instanceof Error ? error.message : "Failed to save prompt.",
      });
    },
  });

  function updateForm<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function updatePresetDraft(
    presetId: string,
    field: keyof PresetDraft,
    value: string,
  ) {
    setPresetDrafts((prev) => ({
      ...prev,
      [presetId]: {
        ...(prev[presetId] ?? emptyDraft()),
        [field]: value,
      },
    }));
  }

  const configuredKeyCount = keyStatus.filter((k) => k.hasKey).length;

  return (
    <div className="page settings-page">
      <header className="page-header">
        <h2>Settings</h2>
        <p>
          Configure API keys, model defaults, and prompts. You need at least one
          API key before tailoring or chatting.
        </p>
      </header>

      {!isTauri() && (
        <section className="card info-box">
          <strong>Browser preview mode</strong>
          <p className="muted small" style={{ margin: "0.5rem 0 0" }}>
            API keys and preferences are saved in this browser&apos;s
            localStorage. Profiles and chat require the desktop app (
            <code>npm run tauri dev</code>).
          </p>
        </section>
      )}

      <section className="card settings-section settings-keys">
        <div className="settings-section-header">
          <h3>API keys</h3>
          <p className="settings-section-desc">
            Stored in your OS keychain when available, with a local fallback if
            keychain access fails.{" "}
            {configuredKeyCount > 0 ? (
              <span className="success">
                {configuredKeyCount} provider
                {configuredKeyCount === 1 ? "" : "s"} configured.
              </span>
            ) : (
              <span className="error">No keys configured yet.</span>
            )}
          </p>
        </div>
        {PROVIDERS.map(({ id, label }) => {
          const status = keyStatus.find((k) => k.provider === id);
          return (
            <div key={id} className="key-row">
              <div>
                <strong>{label}</strong>
                <span className={`badge ${status?.hasKey ? "ok" : ""}`}>
                  {status?.hasKey ? "Configured" : "Not set"}
                </span>
              </div>
              <div className="inline-form">
                <input
                  type="password"
                  placeholder="Enter API key..."
                  value={keyInputs[id] ?? ""}
                  onChange={(e) =>
                    setKeyInputs((prev) => ({ ...prev, [id]: e.target.value }))
                  }
                />
                <button
                  type="button"
                  disabled={!keyInputs[id]?.trim() || saveKeyMutation.isPending}
                  onClick={() =>
                    saveKeyMutation.mutate({
                      provider: id,
                      key: keyInputs[id].trim(),
                    })
                  }
                >
                  Save
                </button>
                {status?.hasKey && (
                  <button
                    type="button"
                    className="danger"
                    disabled={deleteKeyMutation.isPending}
                    onClick={() => deleteKeyMutation.mutate(id)}
                  >
                    Remove
                  </button>
                )}
              </div>
              {keyFeedback[id] && (
                <p
                  className={
                    keyFeedback[id]!.type === "success" ? "success" : "error"
                  }
                  style={{ margin: "0.35rem 0 0" }}
                >
                  {keyFeedback[id]!.message}
                </p>
              )}
            </div>
          );
        })}
      </section>

      <section className="card settings-section">
        <div className="settings-section-header">
          <h3>LLM defaults</h3>
          <p className="settings-section-desc">
            Default provider and models for new sessions. The app works with any
            single provider you configure.
          </p>
        </div>
        <div className="form-row">
          <label>
            Default provider
            <select
              value={form.defaultProvider}
              onChange={(e) =>
                updateForm("defaultProvider", e.target.value as LlmProviderId)
              }
            >
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Temperature
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={form.temperature}
              onChange={(e) =>
                updateForm("temperature", parseFloat(e.target.value) || 0.7)
              }
            />
          </label>
        </div>
        <div className="form-row">
          <label>
            Anthropic model
            <input
              type="text"
              value={form.defaultModelAnthropic}
              onChange={(e) =>
                updateForm("defaultModelAnthropic", e.target.value)
              }
            />
          </label>
          <label>
            OpenAI model
            <input
              type="text"
              value={form.defaultModelOpenai}
              onChange={(e) => updateForm("defaultModelOpenai", e.target.value)}
            />
          </label>
          <label>
            Custom model
            <input
              type="text"
              value={form.defaultModelCustom}
              onChange={(e) =>
                updateForm("defaultModelCustom", e.target.value)
              }
            />
          </label>
        </div>
        <label>
          Custom endpoint base URL
          <input
            type="text"
            value={form.customBaseUrl}
            onChange={(e) => updateForm("customBaseUrl", e.target.value)}
            className="mono"
          />
        </label>
        <div className="button-row mt">
          <button
            type="button"
            disabled={saveSettingsMutation.isPending}
            onClick={() => saveSettingsMutation.mutate(form)}
          >
            Save LLM defaults
          </button>
          {saveMessage && <span className="success">{saveMessage}</span>}
        </div>
      </section>

      <section className="card settings-section">
        <div className="settings-section-header">
          <h3>Prompts</h3>
          <p className="settings-section-desc">
            Edit the system and user templates used for each action. Changes
            apply to the next tailor, cover letter, or chat message.
          </p>
        </div>
        {presets.length === 0 && (
          <p className="muted">No prompt presets found.</p>
        )}
        <div className="settings-prompt-grid">
          {promptPresets.map(({ mode, title, description, editorMode, preset }) => {
            if (!preset) {
              return (
                <div key={mode} className="settings-prompt-card">
                  <h4>{title}</h4>
                  <p className="muted small">{description}</p>
                  <p className="muted small">No default preset for this mode.</p>
                </div>
              );
            }

            const draft = presetDrafts[preset.id] ?? draftFromPreset(preset);
            const feedback = presetSaveMessage[preset.id];

            return (
              <div key={preset.id} className="settings-prompt-card">
                <h4>{title}</h4>
                <p className="muted small">{description}</p>
                <PromptEditor
                  mode={editorMode}
                  systemPrompt={draft.systemPrompt}
                  userPrompt={draft.userPrompt}
                  onSystemChange={(value) =>
                    updatePresetDraft(preset.id, "systemPrompt", value)
                  }
                  onUserChange={(value) =>
                    updatePresetDraft(preset.id, "userPrompt", value)
                  }
                />
                <div className="button-row">
                  <button
                    type="button"
                    onClick={() =>
                      updatePresetMutation.mutate({ id: preset.id, draft })
                    }
                    disabled={updatePresetMutation.isPending}
                  >
                    Save {title.toLowerCase()}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      setPresetDrafts((prev) => ({
                        ...prev,
                        [preset.id]: draftFromPreset(preset),
                      }))
                    }
                  >
                    Reset
                  </button>
                  {feedback && (
                    <span
                      className={
                        feedback.type === "success" ? "success" : "error"
                      }
                    >
                      {feedback.message}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <details className="card settings-advanced">
        <summary>Advanced</summary>
        <div className="settings-advanced-body">
          <div className="settings-advanced-block">
            <h4>Export preferences</h4>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.exportIncludePdf}
                onChange={(e) =>
                  updateForm("exportIncludePdf", e.target.checked)
                }
              />
              Offer PDF export by default
            </label>
            <label>
              PDF converter
              <select
                value={form.pdfConverter}
                onChange={(e) =>
                  updateForm(
                    "pdfConverter",
                    e.target.value as AppSettings["pdfConverter"],
                  )
                }
              >
                <option value="auto">Auto (Word COM, then LibreOffice)</option>
                <option value="word">Microsoft Word COM only</option>
                <option value="libreoffice">LibreOffice headless only</option>
              </select>
            </label>
            <div className="button-row">
              <button
                type="button"
                disabled={saveSettingsMutation.isPending}
                onClick={() => saveSettingsMutation.mutate(form)}
              >
                Save export preferences
              </button>
            </div>
          </div>

          <div className="settings-advanced-block">
            <h4>Data directory</h4>
            {appData ? (
              <dl className="info-list">
                <dt>App data</dt>
                <dd className="mono">{appData.dataDir}</dd>
                <dt>Database</dt>
                <dd className="mono">{appData.dbPath}</dd>
                <dt>Profiles</dt>
                <dd className="mono">{appData.profilesDir}</dd>
              </dl>
            ) : isTauri() ? (
              <p className="muted">Loading...</p>
            ) : (
              <p className="muted">Available in the desktop app only.</p>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}
