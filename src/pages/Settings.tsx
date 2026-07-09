import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PromptEditor } from "../components/PromptEditor";
import { api } from "../lib/api";
import { saveAppSettings, useAppSettings } from "../lib/settings";
import type { AppSettings, LlmProviderId } from "../lib/types";

const PROVIDERS: { id: LlmProviderId; label: string }[] = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
  { id: "custom", label: "Custom (OpenAI-compatible)" },
];

export function Settings() {
  const queryClient = useQueryClient();
  const { data: settings, isLoading: settingsLoading } = useAppSettings();

  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [form, setForm] = useState<AppSettings | null>(null);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [presetSystem, setPresetSystem] = useState("");
  const [presetUser, setPresetUser] = useState("");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const { data: appData } = useQuery({
    queryKey: ["appData"],
    queryFn: api.getAppDataInfo,
  });

  const { data: keyStatus = [] } = useQuery({
    queryKey: ["apiKeyStatus"],
    queryFn: api.listApiKeyStatus,
  });

  const { data: presets = [] } = useQuery({
    queryKey: ["promptPresets"],
    queryFn: api.listPromptPresets,
  });

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const saveKeyMutation = useMutation({
    mutationFn: ({ provider, key }: { provider: string; key: string }) =>
      api.setApiKey(provider, key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["apiKeyStatus"] });
      setKeyInputs({});
    },
  });

  const deleteKeyMutation = useMutation({
    mutationFn: (provider: string) => api.deleteApiKey(provider),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["apiKeyStatus"] }),
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
    mutationFn: (id: string) =>
      api.updatePromptPreset({
        id,
        systemPrompt: presetSystem,
        userPrompt: presetUser,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["promptPresets"] });
      setEditingPresetId(null);
    },
  });

  function updateForm<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function startEditPreset(id: string) {
    const preset = presets.find((p) => p.id === id);
    if (!preset) return;
    setEditingPresetId(id);
    setPresetSystem(preset.systemPrompt);
    setPresetUser(preset.userPrompt);
  }

  if (settingsLoading || !form) {
    return (
      <div className="page">
        <p className="muted">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <h2>Settings</h2>
        <p>API keys are stored in your OS keychain, never in the database.</p>
      </header>

      <section className="card">
        <h3>Data directory</h3>
        {appData ? (
          <dl className="info-list">
            <dt>App data</dt>
            <dd className="mono">{appData.dataDir}</dd>
            <dt>Database</dt>
            <dd className="mono">{appData.dbPath}</dd>
            <dt>Profiles</dt>
            <dd className="mono">{appData.profilesDir}</dd>
          </dl>
        ) : (
          <p className="muted">Loading...</p>
        )}
      </section>

      <section className="card">
        <h3>LLM defaults</h3>
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
      </section>

      <section className="card">
        <h3>Export preferences</h3>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={form.exportIncludePdf}
            onChange={(e) => updateForm("exportIncludePdf", e.target.checked)}
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
        <div className="button-row mt">
          <button
            type="button"
            disabled={saveSettingsMutation.isPending}
            onClick={() => saveSettingsMutation.mutate(form)}
          >
            Save preferences
          </button>
          {saveMessage && <span className="success">{saveMessage}</span>}
        </div>
      </section>

      <section className="card">
        <h3>API keys</h3>
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
                    onClick={() => deleteKeyMutation.mutate(id)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </section>

      <section className="card">
        <h3>Prompt presets</h3>
        {presets.length === 0 && <p className="muted">No presets found.</p>}
        <ul className="preset-list">
          {presets.map((p) => (
            <li key={p.id} className="preset-item">
              <div className="preset-item-header">
                <div>
                  <strong>{p.name}</strong>
                  <span className="badge">{p.mode}</span>
                  {p.isDefault && <span className="badge ok">Default</span>}
                </div>
                <button type="button" onClick={() => startEditPreset(p.id)}>
                  Edit
                </button>
              </div>
              {editingPresetId === p.id && (
                <div className="preset-editor">
                  <PromptEditor
                    mode={p.mode === "qa" ? "qa" : "tailor"}
                    systemPrompt={presetSystem}
                    userPrompt={presetUser}
                    onSystemChange={setPresetSystem}
                    onUserChange={setPresetUser}
                  />
                  <div className="button-row">
                    <button
                      type="button"
                      onClick={() => updatePresetMutation.mutate(p.id)}
                      disabled={updatePresetMutation.isPending}
                    >
                      Save preset
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setEditingPresetId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
