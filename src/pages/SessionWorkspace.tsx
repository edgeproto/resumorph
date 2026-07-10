import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ChatInputBar, ChatMessage } from "../components/ChatUI";
import { ExportDialog } from "../components/ExportDialog";
import { JobDescriptionInput } from "../components/JobDescriptionInput";
import { ResumeInput } from "../components/ResumeInput";
import { api, parseProfileResume } from "../lib/api";
import {
  actionUserMessage,
  displayUserMessage,
  inferActionFromContext,
  type SessionAction,
} from "../lib/chatTypes";
import {
  mergeTailoredWithResume,
  tailoredToPreviewText,
  parseTailoredJson,
  type TailoredResume,
} from "../lib/docx";
import { completeWithProvider } from "../lib/llm";
import {
  buildPromptContext,
  DEFAULT_PLACEHOLDER_KEYS,
  getDefaultPreset,
  interpolatePrompt,
} from "../lib/prompts";
import {
  COVER_LETTER_SYSTEM_PROMPT,
  COVER_LETTER_USER_PROMPT,
  findLatestExportable,
} from "../lib/sessionExport";
import {
  DEFAULT_SETTINGS,
  modelForProvider,
  useAppSettings,
} from "../lib/settings";
import type {
  LlmProviderId,
  ParsedJobDescription,
  ParsedResume,
  PromptPreset,
  Session,
} from "../lib/types";
import type { ExportKind } from "../components/ExportDialog";

const RETIRED_ANTHROPIC_MODELS = new Set([
  "claude-sonnet-4-20250514",
  "claude-sonnet-4-0",
  "claude-sonnet-4",
  "claude-opus-4-20250514",
]);

function formatLlmError(error: unknown): string {
  const raw =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : "Request failed";

  if (
    raw.includes("claude-sonnet-4-20250514") ||
    raw.includes("model_not_found") ||
    raw.includes("not_found_error")
  ) {
    return `${raw} — Update Settings → LLM defaults → Anthropic model to claude-sonnet-4-6.`;
  }

  return raw;
}

function parseSessionResume(session: Session | undefined): ParsedResume | null {
  if (!session?.resumeJson) return null;
  try {
    return JSON.parse(session.resumeJson) as ParsedResume;
  } catch {
    return null;
  }
}

function getPromptsForAction(
  action: SessionAction,
  presets: PromptPreset[],
): { systemPrompt: string; userPrompt: string } {
  if (action === "cover_letter") {
    const preset = getDefaultPreset(presets, "cover_letter");
    if (preset) {
      return {
        systemPrompt: preset.systemPrompt,
        userPrompt: preset.userPrompt,
      };
    }
    return {
      systemPrompt: COVER_LETTER_SYSTEM_PROMPT,
      userPrompt: COVER_LETTER_USER_PROMPT,
    };
  }

  const mode = action === "tailor" ? "tailor" : "qa";
  const preset = getDefaultPreset(presets, mode);
  if (preset) {
    return {
      systemPrompt: preset.systemPrompt,
      userPrompt: preset.userPrompt,
    };
  }

  return {
    systemPrompt: "You are a helpful career assistant.",
    userPrompt: "{{user_question}}",
  };
}

function parseAssistantOutput(content: string): {
  tailored: TailoredResume | null;
  coverPreview: string | null;
} {
  try {
    const parsed = parseTailoredJson(content);
    const hasResume =
      !!(parsed.experience?.length || parsed.summary || parsed.skills?.length);
    if (parsed.cover_letter && !hasResume) {
      return { tailored: null, coverPreview: parsed.cover_letter };
    }
    if (hasResume) {
      return { tailored: parsed, coverPreview: parsed.cover_letter ?? null };
    }
  } catch {
    /* prose */
  }
  return { tailored: null, coverPreview: null };
}

export function SessionWorkspace() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { data: settings } = useAppSettings();

  const profileId = searchParams.get("profile") ?? "";
  const sessionId = searchParams.get("session") ?? "";

  const [jd, setJd] = useState<ParsedJobDescription | null>(null);
  const [sessionResume, setSessionResume] = useState<ParsedResume | null>(null);
  const [showAttach, setShowAttach] = useState(false);
  const [showAdditionalInstructions, setShowAdditionalInstructions] =
    useState(false);
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const [provider, setProvider] = useState<LlmProviderId>("anthropic");
  const [model, setModel] = useState(DEFAULT_SETTINGS.defaultModelAnthropic);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [exportKind, setExportKind] = useState<ExportKind>("resume");
  const [exportTailored, setExportTailored] = useState<TailoredResume | undefined>();
  const [exportCoverLetter, setExportCoverLetter] = useState<string | undefined>();
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles"],
    queryFn: api.listProfiles,
  });

  const { data: presets = [] } = useQuery({
    queryKey: ["promptPresets"],
    queryFn: api.listPromptPresets,
  });

  const {
    data: session,
    isLoading: sessionLoading,
    isError: sessionError,
    error: sessionQueryError,
  } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => api.getSession(sessionId),
    enabled: !!sessionId,
  });

  const { data: messages = [] } = useQuery({
    queryKey: ["messages", sessionId],
    queryFn: () => api.listMessages(sessionId),
    enabled: !!sessionId,
  });

  const selectedProfile = profiles.find((p) => p.id === profileId);
  const profileResume = selectedProfile
    ? parseProfileResume(selectedProfile)
    : null;
  const activeResume = sessionResume ?? profileResume;

  const { data: templatePlaceholders = [] } = useQuery({
    queryKey: ["placeholders", selectedProfile?.templatePath],
    queryFn: () =>
      selectedProfile?.templatePath
        ? api.detectDocxPlaceholders(selectedProfile.templatePath)
        : [],
    enabled:
      !!selectedProfile?.templatePath && selectedProfile.sourceType === "docx",
  });

  function withSourceResume(tailored: TailoredResume | null | undefined) {
    if (!tailored) return undefined;
    return mergeTailoredWithResume(tailored, activeResume);
  }

  const exportable = useMemo(
    () => findLatestExportable(messages),
    [messages],
  );

  const canExportResume = !!exportable.tailored;
  const canExportCoverLetter = !!exportable.coverLetter;
  const canExport = canExportResume || canExportCoverLetter;

  const sessionHydrating = !!sessionId && sessionLoading;
  const workspaceReady =
    !!profileId && !!jd && !!activeResume && !!sessionId && !sessionHydrating;
  const showSessionLoading = !!profileId && sessionHydrating;
  const showJdGate =
    !!profileId && !jd && !showSessionLoading && !sessionError;
  const showResumeGate =
    !!profileId && !!jd && !activeResume && !showSessionLoading;
  const showSessionLoadError =
    !!profileId && !!sessionId && sessionError && !sessionHydrating;
  const showAwaitingSession =
    !!profileId && !!jd && !!activeResume && !sessionId;

  useEffect(() => {
    if (settings) {
      setProvider(settings.defaultProvider);
      const nextModel = modelForProvider(settings, settings.defaultProvider);
      setModel(
        RETIRED_ANTHROPIC_MODELS.has(nextModel)
          ? DEFAULT_SETTINGS.defaultModelAnthropic
          : nextModel,
      );
    }
  }, [settings]);

  useEffect(() => {
    if (!sessionId) {
      setJd(null);
      setSessionResume(null);
      return;
    }

    if (!session) {
      return;
    }

    if (session.jobDescription) {
      setJd({
        text: session.jobDescription,
        jobTitle: session.jobTitle,
        company: session.company,
        sourceType: "text",
      });
    } else {
      setJd(null);
    }
    setSessionResume(parseSessionResume(session));
  }, [session, sessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function persistSessionContext(
    activeSessionId: string,
    nextJd: ParsedJobDescription | null,
    nextResume: ParsedResume | null,
  ) {
    await api.updateSession({
      id: activeSessionId,
      jobDescription: nextJd?.text ?? null,
      jobTitle: nextJd?.jobTitle ?? null,
      company: nextJd?.company ?? null,
      resumeJson: nextResume ? JSON.stringify(nextResume) : undefined,
      clearResume: nextResume === null && sessionResume !== null,
    });
    queryClient.invalidateQueries({ queryKey: ["session", activeSessionId] });
    queryClient.invalidateQueries({ queryKey: ["sessions", profileId] });
  }

  async function createSessionWithJd(
    nextProfileId: string,
    nextJd: ParsedJobDescription,
  ) {
    const created = await api.createSession({
      profileId: nextProfileId,
      jobDescription: nextJd.text,
      jobTitle: nextJd.jobTitle ?? undefined,
      company: nextJd.company ?? undefined,
      resumeJson: sessionResume ? JSON.stringify(sessionResume) : undefined,
      chatType: "qa",
    });
    const params = new URLSearchParams();
    params.set("profile", nextProfileId);
    params.set("session", created.id);
    navigate(`/?${params.toString()}`, { replace: true });
    queryClient.invalidateQueries({ queryKey: ["sessions", nextProfileId] });
    return created.id;
  }

  async function handleJdChange(next: ParsedJobDescription | null) {
    setJd(next);
    setError(null);

    if (!next) {
      if (sessionId) {
        await persistSessionContext(sessionId, null, sessionResume);
      }
      return;
    }

    if (sessionId) {
      await persistSessionContext(sessionId, next, sessionResume);
      return;
    }

    if (profileId) {
      try {
        await createSessionWithJd(profileId, next);
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }

  async function handleResumeChange(next: ParsedResume | null) {
    setSessionResume(next);
    setError(null);
    if (sessionId) {
      if (next === null) {
        await api.updateSession({ id: sessionId, clearResume: true });
      } else {
        await api.updateSession({
          id: sessionId,
          resumeJson: JSON.stringify(next),
        });
      }
      queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["sessions", profileId] });
    }
  }

  async function sendMessage(options: {
    action?: SessionAction;
    text?: string;
    useAdditionalInstructions?: boolean;
  }) {
    const userText = options.text?.trim() ?? "";
    const explicitAction = options.action;
    const action =
      explicitAction ??
      (userText ? inferActionFromContext(messages, userText) : "qa");
    const extra =
      options.useAdditionalInstructions && action !== "qa"
        ? additionalInstructions
        : undefined;
    const isButtonAction = explicitAction !== undefined && explicitAction !== "qa";

    if (!profileId) {
      setError("Select a profile in the sidebar first");
      return;
    }
    if (!jd || !sessionId) {
      setError("Add a job description before sending messages");
      return;
    }
    if (!activeResume) {
      setError("Add a resume to the profile or upload one for this session");
      return;
    }

    const hasKey = await api.hasApiKey(provider);
    if (!hasKey) {
      setError(
        `No API key for ${provider}. Open Settings → API keys, save your key, then try again.`,
      );
      return;
    }

    const question =
      action === "qa"
        ? userText
        : isButtonAction
          ? actionUserMessage(action, extra)
          : userText;

    if (!question) return;

    setLoading(true);
    setError(null);
    if (action === "qa") {
      setInput("");
    }

    try {
      const { systemPrompt, userPrompt } = getPromptsForAction(action, presets);

      await api.createMessage({
        sessionId,
        role: "user",
        content: question,
      });
      queryClient.invalidateQueries({ queryKey: ["messages", sessionId] });

      const context = buildPromptContext(
        activeResume,
        selectedProfile?.name ?? "",
        {
          jobDescription: jd.text,
          jobTitle: jd.jobTitle ?? "",
          company: jd.company ?? "",
          userQuestion: question,
          placeholderKeys: (
            templatePlaceholders.length
              ? templatePlaceholders
              : DEFAULT_PLACEHOLDER_KEYS
          ).join(", "),
        },
      );

      const contextBlock = interpolatePrompt(
        "Profile: {{profile_name}}\nRole: {{job_title}} at {{company}}\n\nResume:\n{{resume_text}}\n\nStructured sections:\n{{resume_json}}\n\nJob description:\n{{job_description}}",
        context,
      );

      const systemContent = `${systemPrompt}\n\n--- Application context ---\n${contextBlock}`;

      const history = messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      const jsonMode = action === "tailor" || action === "cover_letter";
      const llmUserContent = isButtonAction
        ? interpolatePrompt(userPrompt, context)
        : action === "qa"
          ? interpolatePrompt(userPrompt, context)
          : question;

      const response = await completeWithProvider(
        provider,
        [
          { role: "system", content: systemContent },
          ...history,
          {
            role: "user",
            content: llmUserContent,
          },
        ],
        {
          model,
          jsonMode,
          temperature: settings?.temperature,
          baseUrl: provider === "custom" ? settings?.customBaseUrl : undefined,
        },
      );

      if (!response.trim()) {
        throw new Error(
          "The model returned an empty response. Check Settings for a valid API key and model.",
        );
      }

      await api.createMessage({
        sessionId,
        role: "assistant",
        content: response,
      });
      queryClient.invalidateQueries({ queryKey: ["messages", sessionId] });

      if (jsonMode) {
        try {
          const parsed = parseTailoredJson(response);
          await api.createOutput({
            sessionId,
            contentJson: action === "tailor" ? response : null,
            coverLetter: parsed.cover_letter ?? null,
          });
        } catch {
          /* refinement reply may not be JSON */
        }
      }
    } catch (e) {
      setError(formatLlmError(e));
    } finally {
      setLoading(false);
    }
  }

  async function copyText(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(key);
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch {
      setError("Could not copy to clipboard");
    }
  }

  function handleAction(action: SessionAction) {
    void sendMessage({ action, useAdditionalInstructions: true });
  }

  function handleSend() {
    void sendMessage({ text: input });
  }

  function openExport(
    kind: ExportKind,
    content?: { tailored?: TailoredResume; coverLetter?: string },
  ) {
    setExportKind(kind);
    setExportTailored(withSourceResume(content?.tailored));
    setExportCoverLetter(content?.coverLetter);
    setShowExport(true);
  }

  return (
    <div className="gpt-page">
      {workspaceReady && (
        <header className="gpt-topbar">
          <div className="gpt-action-bar">
            <button
              type="button"
              className="gpt-action-btn gpt-action-primary"
              onClick={() => handleAction("tailor")}
              disabled={loading}
            >
              Tailor Resume
            </button>
            <button
              type="button"
              className="gpt-action-btn gpt-action-primary"
              onClick={() => handleAction("cover_letter")}
              disabled={loading}
            >
              Create Cover Letter
            </button>

            {canExport && (
              <div className="gpt-export-group">
                {canExportResume && (
                  <button
                    type="button"
                    className="btn-primary gpt-export-btn"
                    onClick={() => openExport("resume")}
                  >
                    Export resume
                  </button>
                )}
                {canExportCoverLetter && (
                  <button
                    type="button"
                    className="btn-primary gpt-export-btn"
                    onClick={() => openExport("cover_letter")}
                  >
                    Export cover letter
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              className="gpt-action-btn"
              onClick={() => setShowAttach(!showAttach)}
            >
              Attach resume
            </button>
          </div>
        </header>
      )}

      {showAttach && workspaceReady && (
        <div className="attach-panel">
          <div>
            <h4>Resume override (this session)</h4>
            <p className="muted small">
              {profileResume
                ? "Overrides the profile resume for this session only."
                : "Upload a resume for this session."}
            </p>
            <ResumeInput
              value={sessionResume}
              onChange={handleResumeChange}
              label="Session resume"
            />
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setShowAttach(false)}
          >
            Done
          </button>
        </div>
      )}

      <div className="gpt-thread">
        {error && workspaceReady && (
          <div className="gpt-error-banner error" role="alert">
            {error}
          </div>
        )}
        {!profileId && (
          <div className="gpt-empty">
            <h1>Welcome to Resumorph</h1>
            <p className="muted">
              Select a profile in the sidebar, or create one with a name and
              resume.
            </p>
          </div>
        )}

        {showSessionLoading && (
          <div className="gpt-empty">
            <p className="muted">Loading session…</p>
          </div>
        )}

        {showSessionLoadError && (
          <div className="gpt-empty gpt-gate">
            <h1>Could not open session</h1>
            <p className="error">
              {formatLlmError(sessionQueryError)}
            </p>
            <p className="muted">
              The session may have been deleted. Start a new session from the
              sidebar.
            </p>
          </div>
        )}

        {showAwaitingSession && (
          <div className="gpt-empty gpt-gate">
            <h1>{selectedProfile?.name ?? "Session"}</h1>
            <p className="muted">
              Add a job description to create a session and continue.
            </p>
            <div className="gpt-gate-card">
              <JobDescriptionInput value={jd} onChange={handleJdChange} />
            </div>
          </div>
        )}

        {showJdGate && (
          <div className="gpt-empty gpt-gate">
            <h1>{selectedProfile?.name ?? "New session"}</h1>
            <p className="muted">
              Start by adding the job description. A session is created once the
              JD is saved.
            </p>
            <div className="gpt-gate-card">
              <JobDescriptionInput value={jd} onChange={handleJdChange} />
            </div>
          </div>
        )}

        {showResumeGate && (
          <div className="gpt-empty gpt-gate">
            <h1>Add your resume</h1>
            <p className="muted">
              {profileResume
                ? "Attach a different resume for this session, or use the profile resume."
                : "Upload or paste your resume to continue."}
            </p>
            {jd && (
              <div className="gpt-gate-jd-summary">
                <JobDescriptionInput value={jd} onChange={handleJdChange} compact />
              </div>
            )}
            <div className="gpt-gate-card">
              <ResumeInput
                value={sessionResume ?? profileResume}
                onChange={handleResumeChange}
                label="Resume"
              />
            </div>
          </div>
        )}

        {workspaceReady && jd && (
          <div className="gpt-session-context">
            <JobDescriptionInput value={jd} onChange={handleJdChange} compact />
          </div>
        )}

        {workspaceReady &&
          messages.map((m) => {
          let tailored: TailoredResume | null = null;
          let coverPreview: string | null = null;

          if (m.role === "assistant") {
            const parsed = parseAssistantOutput(m.content);
            tailored = withSourceResume(parsed.tailored) ?? null;
            coverPreview = parsed.coverPreview;
          }

          const displayContent =
            m.role === "user"
              ? displayUserMessage(m.content)
              : tailored && (tailored.summary || tailored.experience)
                ? "Here's your tailored resume:"
                : coverPreview
                  ? "Here's your cover letter:"
                  : m.content;

          const resumePreviewText =
            tailored && (tailored.summary || tailored.experience)
              ? tailoredToPreviewText(tailored)
              : null;

          return (
            <ChatMessage
              key={m.id}
              role={m.role as "user" | "assistant"}
              content={displayContent}
            >
              {resumePreviewText && (
                <div className="gpt-output-card">
                  <pre className="output preview-content">{resumePreviewText}</pre>
                  <div className="gpt-output-actions">
                    <button
                      type="button"
                      className="gpt-output-btn"
                      onClick={() => void copyText(resumePreviewText, `${m.id}-resume`)}
                    >
                      {copyFeedback === `${m.id}-resume` ? "Copied" : "Copy"}
                    </button>
                    <button
                      type="button"
                      className="gpt-output-btn"
                      onClick={() =>
                        openExport("resume", { tailored: tailored ?? undefined })
                      }
                    >
                      Export
                    </button>
                  </div>
                </div>
              )}
              {coverPreview && !tailored && (
                <div className="gpt-output-card">
                  <pre className="output preview-content">{coverPreview}</pre>
                  <div className="gpt-output-actions">
                    <button
                      type="button"
                      className="gpt-output-btn"
                      onClick={() => void copyText(coverPreview, `${m.id}-cover`)}
                    >
                      {copyFeedback === `${m.id}-cover` ? "Copied" : "Copy"}
                    </button>
                    <button
                      type="button"
                      className="gpt-output-btn"
                      onClick={() =>
                        openExport("cover_letter", { coverLetter: coverPreview })
                      }
                    >
                      Export
                    </button>
                  </div>
                </div>
              )}
            </ChatMessage>
          );
          })}

        {loading && workspaceReady && (
          <ChatMessage role="assistant" content="">
            <span className="gpt-typing">Thinking...</span>
          </ChatMessage>
        )}

        <div ref={messagesEndRef} />
      </div>

      {workspaceReady && (
        <div className="gpt-bottom">
          {canExport && (
            <div className="gpt-export-hint">
              <span className="muted small">
                Happy with this version? Export above, or send more instructions
                to refine.
              </span>
            </div>
          )}

          <div className="gpt-additional-wrap">
            <button
              type="button"
              className="gpt-additional-toggle"
              onClick={() => setShowAdditionalInstructions((v) => !v)}
              aria-expanded={showAdditionalInstructions}
            >
              {showAdditionalInstructions ? "Hide" : "Additional instructions"}
              <span className="muted small">
                {" "}
                (for Tailor / Cover Letter only)
              </span>
            </button>
            {showAdditionalInstructions && (
              <textarea
                className="gpt-additional-input"
                rows={2}
                value={additionalInstructions}
                onChange={(e) => setAdditionalInstructions(e.target.value)}
                placeholder="e.g. Emphasize leadership experience, keep bullets shorter..."
                disabled={loading}
              />
            )}
          </div>

          <ChatInputBar
            value={input}
            onChange={setInput}
            onSubmit={handleSend}
            loading={loading}
            disabled={!workspaceReady}
            placeholder="Ask an application question..."
          />
          {error && <p className="error gpt-error">{error}</p>}
        </div>
      )}

      {showExport && profileId && (
        <ExportDialog
          profileId={profileId}
          tailored={exportTailored ?? withSourceResume(exportable.tailored)}
          coverLetter={exportCoverLetter ?? exportable.coverLetter ?? undefined}
          exportKind={
            exportKind === "cover_letter" &&
            (exportCoverLetter ?? exportable.coverLetter)
              ? "cover_letter"
              : exportTailored ?? withSourceResume(exportable.tailored)
                ? "resume"
                : "cover_letter"
          }
          sessionId={sessionId || undefined}
          onClose={() => {
            setShowExport(false);
            setExportTailored(undefined);
            setExportCoverLetter(undefined);
          }}
        />
      )}
    </div>
  );
}
