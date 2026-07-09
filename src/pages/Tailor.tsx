import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChatMessage } from "../components/ChatUI";
import { ExportDialog } from "../components/ExportDialog";
import { JobDescriptionInput } from "../components/JobDescriptionInput";
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
import type { LlmProviderId, ParsedJobDescription } from "../lib/types";

export function Tailor() {
  const queryClient = useQueryClient();
  const { data: settings } = useAppSettings();
  const [searchParams] = useSearchParams();

  const [profileId, setProfileId] = useState("");
  const [sessionId, setSessionId] = useState(searchParams.get("session") ?? "");
  const [jd, setJd] = useState<ParsedJobDescription | null>(null);
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

  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles"],
    queryFn: api.listProfiles,
  });

  const { data: presets = [] } = useQuery({
    queryKey: ["promptPresets"],
    queryFn: api.listPromptPresets,
  });

  const { data: session } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => api.getSession(sessionId),
    enabled: !!sessionId,
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

  useEffect(() => {
    if (session) {
      setProfileId(session.profileId);
      if (session.jobDescription) {
        setJd({
          text: session.jobDescription,
          jobTitle: session.jobTitle,
          company: session.company,
          sourceType: "text",
        });
      }
    }
  }, [session]);

  async function handleTailor() {
    if (!profileId || !jd?.text.trim() || !parsed) return;

    setLoading(true);
    setError(null);
    setTailoredRaw(null);
    setTailored(null);

    try {
      let activeSessionId = sessionId;
      if (!activeSessionId) {
        const session = await api.createSession({
          profileId,
          jobDescription: jd.text,
          jobTitle: jd.jobTitle ?? undefined,
          company: jd.company ?? undefined,
        });
        activeSessionId = session.id;
        setSessionId(session.id);
        queryClient.invalidateQueries({ queryKey: ["sessions"] });
      } else {
        await api.updateSession(activeSessionId, {
          jobDescription: jd.text,
          jobTitle: jd.jobTitle ?? undefined,
          company: jd.company ?? undefined,
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
        jobDescription: jd.text,
        jobTitle: jd.jobTitle ?? "",
        company: jd.company ?? "",
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
          baseUrl: provider === "custom" ? settings?.customBaseUrl : undefined,
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

  const canTailor = !!profileId && !!jd?.text.trim() && !!parsed && !loading;

  return (
    <div className="gpt-page">
      <header className="gpt-topbar">
        <select
          className="gpt-select"
          value={profileId}
          onChange={(e) => {
            setProfileId(e.target.value);
            setSessionId("");
            setTailored(null);
            setTailoredRaw(null);
          }}
        >
          <option value="">Select profile...</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          className="gpt-select gpt-select-sm"
          value={selectedPresetId}
          onChange={(e) => setSelectedPresetId(e.target.value)}
        >
          {tailorPresets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {jd && <JobDescriptionInput value={jd} onChange={setJd} compact />}
      </header>

      <div className="gpt-thread">
        {!jd && (
          <div className="gpt-empty">
            <h1>Tailor your resume</h1>
            <p className="muted">
              Upload the full job description — we&apos;ll detect the role and
              company automatically.
            </p>
            <div className="gpt-empty-jd">
              <JobDescriptionInput value={jd} onChange={setJd} />
            </div>
          </div>
        )}

        {jd && !tailored && !loading && (
          <div className="gpt-empty">
            <h1>
              {jd.jobTitle ?? "Ready to tailor"}
              {jd.company ? ` at ${jd.company}` : ""}
            </h1>
            <p className="muted">
              {profileId
                ? "Click below to generate a tailored resume for this role."
                : "Select a profile above to continue."}
            </p>
            {!parsed && profileId && (
              <p className="error">This profile has no uploaded resume.</p>
            )}
          </div>
        )}

        {loading && (
          <ChatMessage role="assistant" content="">
            <span className="gpt-typing">Tailoring your resume...</span>
          </ChatMessage>
        )}

        {tailored && (
          <ChatMessage role="assistant" content="Here's your tailored resume:">
            <ResumePreview
              original={parsed}
              tailored={tailored}
              tailoredRaw={tailoredRaw}
            />
            <div className="button-row mt">
              <button type="button" onClick={() => setShowExport(true)}>
                Export resume
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setTailored(null);
                  setTailoredRaw(null);
                }}
              >
                Tailor again
              </button>
            </div>
          </ChatMessage>
        )}

        {error && <p className="error">{error}</p>}
      </div>

      <div className="gpt-bottom">
        {jd && (
          <div className="gpt-tailor-actions">
            <button
              type="button"
              className="gpt-tailor-btn"
              onClick={handleTailor}
              disabled={!canTailor}
            >
              {loading ? "Tailoring..." : "Tailor resume"}
            </button>
          </div>
        )}
      </div>

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
