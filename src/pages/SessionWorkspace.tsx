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
  type SessionAction,
} from "../lib/chatTypes";
import {
  tailoredToPreviewText,
  parseTailoredJson,
  type TailoredResume,
} from "../lib/docx";
import { completeWithProvider } from "../lib/llm";
import {
  buildPromptContext,
  getDefaultPreset,
  interpolatePrompt,
} from "../lib/prompts";
import {
  COVER_LETTER_SYSTEM_PROMPT,
  COVER_LETTER_USER_PROMPT,
  findLatestExportable,
} from "../lib/sessionExport";
import { modelForProvider, useAppSettings } from "../lib/settings";
import type {
  LlmProviderId,
  ParsedJobDescription,
  ParsedResume,
  PromptPreset,
  Session,
} from "../lib/types";
import type { ExportKind } from "../components/ExportDialog";

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
  const [model, setModel] = useState("claude-sonnet-4-20250514");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [exportKind, setExportKind] = useState<ExportKind>("resume");

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

  const exportable = useMemo(
    () => findLatestExportable(messages),
    [messages],
  );

  const canExportResume = !!exportable.tailored;
  const canExportCoverLetter = !!exportable.coverLetter;
  const canExport = canExportResume || canExportCoverLetter;

  const workspaceReady = !!profileId && !!jd && !!activeResume && !!sessionId;
  const showJdGate = !!profileId && !jd;
  const showResumeGate = !!profileId && !!jd && !activeResume;

  useEffect(() => {
    if (settings) {
      setProvider(settings.defaultProvider);
      setModel(modelForProvider(settings, settings.defaultProvider));
    }
  }, [settings]);

  useEffect(() => {
    if (session) {
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
    } else if (!sessionId) {
      setJd(null);
      setSessionResume(null);
    }
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
    const action = options.action ?? "qa";
    const userText = options.text?.trim() ?? "";
    const extra =
      options.useAdditionalInstructions && action !== "qa"
        ? additionalInstructions
        : undefined;

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

    const question =
      action === "qa"
        ? userText
        : actionUserMessage(action, extra);

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

      const response = await completeWithProvider(
        provider,
        [
          { role: "system", content: systemContent },
          ...history,
          {
            role: "user",
            content: interpolatePrompt(userPrompt, context),
          },
        ],
        {
          model,
          jsonMode,
          temperature: settings?.temperature,
          baseUrl: provider === "custom" ? settings?.customBaseUrl : undefined,
        },
      );

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
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function handleAction(action: SessionAction) {
    void sendMessage({ action, useAdditionalInstructions: true });
  }

  function handleSend() {
    void sendMessage({ action: "qa", text: input });
  }

  function openExport(kind: ExportKind) {
    setExportKind(kind);
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
        {!profileId && (
          <div className="gpt-empty">
            <h1>Welcome to Resumorph</h1>
            <p className="muted">
              Select a profile in the sidebar, or create one with a name and
              resume.
            </p>
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

        {messages.map((m) => {
          let tailored: TailoredResume | null = null;
          let coverPreview: string | null = null;

          if (m.role === "assistant") {
            const parsed = parseAssistantOutput(m.content);
            tailored = parsed.tailored;
            coverPreview = parsed.coverPreview;
          }

          const displayContent =
            tailored && (tailored.summary || tailored.experience)
              ? "Here's your tailored resume:"
              : coverPreview
                ? "Here's your cover letter:"
                : m.content;

          return (
            <ChatMessage
              key={m.id}
              role={m.role as "user" | "assistant"}
              content={displayContent}
            >
              {tailored && (tailored.summary || tailored.experience) && (
                <pre className="output preview-content">
                  {tailoredToPreviewText(tailored)}
                </pre>
              )}
              {coverPreview && !tailored && (
                <pre className="output preview-content">{coverPreview}</pre>
              )}
            </ChatMessage>
          );
        })}

        {loading && (
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
          tailored={exportable.tailored ?? undefined}
          coverLetter={exportable.coverLetter ?? undefined}
          exportKind={
            exportKind === "cover_letter" && canExportCoverLetter
              ? "cover_letter"
              : canExportResume
                ? "resume"
                : "cover_letter"
          }
          sessionId={sessionId || undefined}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}
