import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ExportDialog } from "../components/ExportDialog";
import { PromptEditor } from "../components/PromptEditor";
import { ResumePreview } from "../components/ResumePreview";
import { api, parseProfileResume } from "../lib/api";
import { parseTailoredJson, type TailoredResume } from "../lib/docx";
import { completeWithProvider } from "../lib/llm";
import {
  buildPromptContext,
  getDefaultPreset,
  interpolatePrompt,
} from "../lib/prompts";
import { modelForProvider, useAppSettings } from "../lib/settings";
import type { LlmProviderId, PromptPreset } from "../lib/types";

export function Tailor() {
  const queryClient = useQueryClient();
  const { data: settings } = useAppSettings();

  const [profileId, setProfileId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [company, setCompany] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [provider, setProvider] = useState<LlmProviderId>("anthropic");
  const [model, setModel] = useState("claude-sonnet-4-20250514");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [userPrompt, setUserPrompt] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [tailoredRaw, setTailoredRaw] = useState<string | null>(null);
  const [tailored, setTailored] = useState<TailoredResume | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [showPromptEditor, setShowPromptEditor] = useState(false);

  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles"],
    queryFn: api.listProfiles,
  });

  const { data: presets = [] } = useQuery({
    queryKey: ["promptPresets"],
    queryFn: api.listPromptPresets,
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ["sessions", profileId],
    queryFn: () => api.listSessions(profileId),
    enabled: !!profileId,
  });

  const tailorPresets = presets.filter((p) => p.mode === "tailor");
  const selectedProfile = profiles.find((p) => p.id === profileId);
  const parsed = selectedProfile ? parseProfileResume(selectedProfile) : null;

  useEffect(() => {
    if (settings) {
      setProvider(settings.defaultProvider);
      setModel(modelForProvider(settings, settings.defaultProvider));
    }
  }, [settings]);

  useEffect(() => {
    const preset = selectedPresetId
      ? presets.find((p) => p.id === selectedPresetId)
      : getDefaultPreset(presets, "tailor");
    if (preset) {
      setSystemPrompt(preset.systemPrompt);
      setUserPrompt(preset.userPrompt);
      if (!selectedPresetId) setSelectedPresetId(preset.id);
    }
  }, [presets, selectedPresetId]);

  const savePresetMutation = useMutation({
    mutationFn: () => {
      const preset = presets.find((p) => p.id === selectedPresetId);
      if (!preset) throw new Error("No preset selected");
      return api.updatePromptPreset({
        id: preset.id,
        systemPrompt,
        userPrompt,
      });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["promptPresets"] }),
  });

  function loadSession(id: string) {
    const session = sessions.find((s) => s.id === id);
    if (!session) return;
    setSessionId(session.id);
    setJobDescription(session.jobDescription ?? "");
    setJobTitle(session.jobTitle ?? "");
    setCompany(session.company ?? "");
  }

  async function handleTailor() {
    if (!profileId || !jobDescription.trim() || !parsed) return;

    setLoading(true);
    setError(null);
    setTailoredRaw(null);
    setTailored(null);

    try {
      let activeSessionId = sessionId;
      if (!activeSessionId) {
        const session = await api.createSession({
          profileId,
          jobDescription,
          jobTitle: jobTitle || undefined,
          company: company || undefined,
        });
        activeSessionId = session.id;
        setSessionId(session.id);
        queryClient.invalidateQueries({ queryKey: ["sessions", profileId] });
      } else {
        await api.updateSession(activeSessionId, {
          jobDescription,
          jobTitle: jobTitle || undefined,
          company: company || undefined,
        });
      }

      let placeholderKeys = "";
      if (
        selectedProfile?.templatePath &&
        selectedProfile.sourceType === "docx"
      ) {
        const keys = await api.detectDocxPlaceholders(
          selectedProfile.templatePath,
        );
        placeholderKeys = keys.map((k) => `{${k}}`).join(", ");
      }

      const context = buildPromptContext(parsed, selectedProfile?.name ?? "", {
        jobDescription,
        jobTitle,
        company,
        placeholderKeys,
      });

      const filledUser = interpolatePrompt(userPrompt, context);

      const response = await completeWithProvider(
        provider,
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: filledUser },
        ],
        {
          model,
          jsonMode: true,
          temperature: settings?.temperature,
          baseUrl:
            provider === "custom" ? settings?.customBaseUrl : undefined,
        },
      );

      setTailoredRaw(response);
      const parsedOutput = parseTailoredJson(response);
      setTailored(parsedOutput);

      await api.createOutput({
        sessionId: activeSessionId,
        contentJson: response,
        coverLetter: parsedOutput.cover_letter ?? null,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function handlePresetChange(id: string) {
    setSelectedPresetId(id);
    const preset = presets.find((p) => p.id === id);
    if (preset) {
      setSystemPrompt(preset.systemPrompt);
      setUserPrompt(preset.userPrompt);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h2>Tailor</h2>
        <p>Paste a job description, edit prompts, and generate a tailored resume.</p>
      </header>

      <section className="card">
        <div className="form-row">
          <label>
            Profile
            <select
              value={profileId}
              onChange={(e) => {
                setProfileId(e.target.value);
                setSessionId("");
              }}
            >
              <option value="">Select a profile...</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sourceType})
                </option>
              ))}
            </select>
          </label>

          {profileId && sessions.length > 0 && (
            <label>
              Previous session
              <select
                value={sessionId}
                onChange={(e) => loadSession(e.target.value)}
              >
                <option value="">New session</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.jobTitle || s.company || "Session"}{" "}
                    {new Date(s.createdAt).toLocaleDateString()}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="form-row">
          <label>
            Job title
            <input
              type="text"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="Software Engineer"
            />
          </label>
          <label>
            Company
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Acme Corp"
            />
          </label>
        </div>

        <div className="form-row">
          <label>
            Provider
            <select
              value={provider}
              onChange={(e) => {
                const p = e.target.value as LlmProviderId;
                setProvider(p);
                if (settings) setModel(modelForProvider(settings, p));
              }}
            >
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="custom">Custom (OpenAI-compatible)</option>
            </select>
          </label>
          <label>
            Model
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
          <label>
            Prompt preset
            <select
              value={selectedPresetId}
              onChange={(e) => handlePresetChange(e.target.value)}
            >
              {tailorPresets.map((p: PromptPreset) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          Job description
          <textarea
            rows={8}
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            placeholder="Paste the full job description here..."
          />
        </label>

        <div className="button-row">
          <button
            type="button"
            className="secondary"
            onClick={() => setShowPromptEditor(!showPromptEditor)}
          >
            {showPromptEditor ? "Hide prompts" : "Edit prompts"}
          </button>
          {showPromptEditor && (
            <button
              type="button"
              className="secondary"
              disabled={savePresetMutation.isPending}
              onClick={() => savePresetMutation.mutate()}
            >
              Save preset
            </button>
          )}
        </div>

        {showPromptEditor && (
          <PromptEditor
            mode="tailor"
            systemPrompt={systemPrompt}
            userPrompt={userPrompt}
            onSystemChange={setSystemPrompt}
            onUserChange={setUserPrompt}
          />
        )}

        <div className="button-row mt">
          <button
            type="button"
            onClick={handleTailor}
            disabled={loading || !profileId || !parsed || !jobDescription.trim()}
          >
            {loading ? "Tailoring..." : "Tailor resume"}
          </button>
          {tailored && (
            <button
              type="button"
              className="secondary"
              onClick={() => setShowExport(true)}
            >
              Export
            </button>
          )}
        </div>

        {!parsed && profileId && (
          <p className="error">Selected profile has no uploaded resume.</p>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      {(parsed || tailored) && (
        <section className="card">
          <h3>Preview</h3>
          <ResumePreview
            original={parsed}
            tailored={tailored}
            tailoredRaw={tailoredRaw}
          />
        </section>
      )}

      {showExport && tailored && profileId && (
        <ExportDialog
          profileId={profileId}
          tailored={tailored}
          sessionId={sessionId}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}
