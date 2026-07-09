import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChatInputBar, ChatMessage } from "../components/ChatUI";
import { ExportDialog } from "../components/ExportDialog";
import { JobDescriptionInput } from "../components/JobDescriptionInput";
import { ResumeInput } from "../components/ResumeInput";
import { api, parseProfileResume } from "../lib/api";
import {
  CHAT_TYPES,
  isExportableChatType,
  type ChatType,
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
  Session,
} from "../lib/types";

function parseSessionResume(session: Session | undefined): ParsedResume | null {
  if (!session?.resumeJson) return null;
  try {
    return JSON.parse(session.resumeJson) as ParsedResume;
  } catch {
    return null;
  }
}

function parseChatType(value: string | undefined | null): ChatType {
  if (value === "tailor" || value === "cover_letter" || value === "qa") {
    return value;
  }
  return "tailor";
}

function defaultUserQuestion(chatType: ChatType): string {
  if (chatType === "tailor") {
    return "Tailor my resume for this job. Return JSON only.";
  }
  if (chatType === "cover_letter") {
    return "Write a cover letter for this job. Return JSON with cover_letter key.";
  }
  return "";
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
  const [chatType, setChatType] = useState<ChatType>("tailor");
  const [provider, setProvider] = useState<LlmProviderId>("anthropic");
  const [model, setModel] = useState("claude-sonnet-4-20250514");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [userPrompt, setUserPrompt] = useState("");
  const [input, setInput] = useState("");
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
    () => findLatestExportable(messages, chatType),
    [messages, chatType],
  );

  const canExport =
    isExportableChatType(chatType) &&
    ((chatType === "tailor" && !!exportable.tailored) ||
      (chatType === "cover_letter" && !!exportable.coverLetter));

  useEffect(() => {
    if (settings) {
      setProvider(settings.defaultProvider);
      setModel(modelForProvider(settings, settings.defaultProvider));
    }
  }, [settings]);

  useEffect(() => {
    if (session?.chatType) {
      setChatType(parseChatType(session.chatType));
    } else if (!sessionId) {
      setChatType("tailor");
    }
  }, [session, sessionId]);

  useEffect(() => {
    if (chatType === "cover_letter") {
      setSystemPrompt(COVER_LETTER_SYSTEM_PROMPT);
      setUserPrompt(COVER_LETTER_USER_PROMPT);
      return;
    }
    const mode = chatType === "tailor" ? "tailor" : "qa";
    const preset = getDefaultPreset(presets, mode);
    if (preset) {
      setSystemPrompt(preset.systemPrompt);
      setUserPrompt(preset.userPrompt);
    }
  }, [presets, chatType]);

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

  async function handleChatTypeChange(next: ChatType) {
    setChatType(next);
    if (sessionId) {
      await api.updateSession({ id: sessionId, chatType: next });
      queryClient.invalidateQueries({ queryKey: ["session", sessionId] });
    }
  }

  async function handleJdChange(next: ParsedJobDescription | null) {
    setJd(next);
    if (sessionId) {
      await persistSessionContext(sessionId, next, sessionResume);
    }
  }

  async function handleResumeChange(next: ParsedResume | null) {
    setSessionResume(next);
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

  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId;
    if (!profileId) throw new Error("Select a profile in the sidebar first");
    const created = await api.createSession({
      profileId,
      jobDescription: jd?.text,
      jobTitle: jd?.jobTitle ?? undefined,
      company: jd?.company ?? undefined,
      resumeJson: sessionResume ? JSON.stringify(sessionResume) : undefined,
      chatType,
    });
    const params = new URLSearchParams();
    params.set("profile", profileId);
    params.set("session", created.id);
    navigate(`/?${params.toString()}`, { replace: true });
    queryClient.invalidateQueries({ queryKey: ["sessions", profileId] });
    return created.id;
  }

  async function handleSend() {
    if (!profileId) {
      setError("Select a profile in the sidebar first");
      return;
    }
    if (!activeResume) {
      setError("Add a resume to the profile or attach one for this session");
      return;
    }

    const question = input.trim() || defaultUserQuestion(chatType);
    if (!question) return;

    setLoading(true);
    setError(null);
    setInput("");

    try {
      const activeSessionId = await ensureSession();
      const priorMessages = sessionId === activeSessionId ? messages : [];

      await api.createMessage({
        sessionId: activeSessionId,
        role: "user",
        content: question,
      });
      queryClient.invalidateQueries({
        queryKey: ["messages", activeSessionId],
      });

      if (jd || sessionResume) {
        await persistSessionContext(activeSessionId, jd, sessionResume);
      }

      const context = buildPromptContext(
        activeResume,
        selectedProfile?.name ?? "",
        {
          jobDescription: jd?.text ?? "",
          jobTitle: jd?.jobTitle ?? "",
          company: jd?.company ?? "",
          userQuestion: question,
        },
      );

      const contextBlock = interpolatePrompt(
        "Profile: {{profile_name}}\nRole: {{job_title}} at {{company}}\n\nResume:\n{{resume_text}}\n\nStructured sections:\n{{resume_json}}\n\nJob description:\n{{job_description}}",
        context,
      );

      const systemContent = `${systemPrompt}\n\n--- Application context ---\n${contextBlock}`;

      const history = priorMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      const jsonMode = chatType === "tailor" || chatType === "cover_letter";

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
        sessionId: activeSessionId,
        role: "assistant",
        content: response,
      });
      queryClient.invalidateQueries({
        queryKey: ["messages", activeSessionId],
      });

      if (jsonMode) {
        try {
          const parsed = parseTailoredJson(response);
          await api.createOutput({
            sessionId: activeSessionId,
            contentJson: chatType === "tailor" ? response : null,
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

  const hasStarted = messages.length > 0;
  const activeChatType = CHAT_TYPES.find((t) => t.id === chatType);

  return (
    <div className="gpt-page">
      <header className="gpt-topbar">
        <div className="gpt-topbar-center">
          <select
            className="gpt-mode-select"
            value={chatType}
            onChange={(e) =>
              handleChatTypeChange(e.target.value as ChatType)
            }
            disabled={!profileId}
            title={activeChatType?.description}
          >
            {CHAT_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="gpt-topbar-actions">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setShowAttach(!showAttach)}
            disabled={!profileId}
          >
            Attach
          </button>

          {canExport && (
            <button
              type="button"
              className="btn-primary gpt-export-btn"
              onClick={() => setShowExport(true)}
            >
              Export {chatType === "cover_letter" ? "cover letter" : "resume"}
            </button>
          )}
        </div>
      </header>

      {showAttach && profileId && (
        <div className="attach-panel">
          <div className="attach-grid">
            <div>
              <h4>Job description</h4>
              <JobDescriptionInput value={jd} onChange={handleJdChange} />
            </div>
            <div>
              <h4>Resume (this session)</h4>
              <p className="muted small">
                Overrides profile resume for this session only.
              </p>
              <ResumeInput
                value={sessionResume}
                onChange={handleResumeChange}
                label="Session resume"
              />
            </div>
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
              Select a profile in the sidebar, or{" "}
              <Link to="/profiles">create one with a title and resume</Link>.
            </p>
          </div>
        )}

        {profileId && !hasStarted && (
          <div className="gpt-empty">
            <h1>
              {selectedProfile?.name ?? "New session"}
            </h1>
            <p className="muted">{activeChatType?.description}</p>
            {!activeResume && (
              <p className="error">
                Profile has no resume.{" "}
                <Link to="/profiles">Add one in Profiles</Link> or attach below.
              </p>
            )}
            <div className="gpt-empty-jd attach-grid">
              <JobDescriptionInput value={jd} onChange={handleJdChange} />
              <ResumeInput
                value={sessionResume}
                onChange={handleResumeChange}
                label="Session resume"
              />
            </div>
          </div>
        )}

        {messages.map((m) => {
          let tailored: TailoredResume | null = null;
          let coverPreview: string | null = null;
          if (m.role === "assistant") {
            if (chatType === "tailor") {
              try {
                tailored = parseTailoredJson(m.content);
              } catch {
                /* prose */
              }
            } else if (chatType === "cover_letter") {
              try {
                const parsed = parseTailoredJson(m.content);
                coverPreview = parsed.cover_letter ?? null;
              } catch {
                coverPreview = m.content;
              }
            }
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
              {coverPreview && (
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

      <div className="gpt-bottom">
        {canExport && (
          <div className="gpt-export-hint">
            <span className="muted small">
              Happy with this version? Click Export above, or send more
              instructions to refine.
            </span>
          </div>
        )}
        <ChatInputBar
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          loading={loading}
          disabled={!profileId || !activeResume}
          placeholder={
            !profileId
              ? "Select a profile in the sidebar..."
              : !activeResume
                ? "Add a resume to continue..."
                : chatType === "tailor"
                  ? "Tailor my resume… or ask for changes"
                  : chatType === "cover_letter"
                    ? "Write a cover letter… or ask for changes"
                    : "Ask an application question..."
          }
        />
        {error && <p className="error gpt-error">{error}</p>}
      </div>

      {showExport && profileId && (
        <ExportDialog
          profileId={profileId}
          tailored={exportable.tailored ?? undefined}
          coverLetter={exportable.coverLetter ?? undefined}
          exportKind={chatType === "cover_letter" ? "cover_letter" : "resume"}
          sessionId={sessionId || undefined}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}
