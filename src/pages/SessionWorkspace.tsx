import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChatInputBar, ChatMessage } from "../components/ChatUI";
import { ExportDialog } from "../components/ExportDialog";
import { JobDescriptionInput } from "../components/JobDescriptionInput";
import { ResumeInput } from "../components/ResumeInput";
import { api, parseProfileResume } from "../lib/api";
import { parseTailoredJson, type TailoredResume } from "../lib/docx";
import { completeWithProvider } from "../lib/llm";
import { buildPromptContext, getDefaultPreset, interpolatePrompt } from "../lib/prompts";
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

function wantsTailorJson(text: string): boolean {
  return /\btailor(?:ing)?\b|\brewrite\b.*\bresume\b|\bresume\b.*\bfor\b/i.test(
    text,
  );
}

function tryParseTailored(content: string): TailoredResume | null {
  try {
    return parseTailoredJson(content);
  } catch {
    return null;
  }
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
  const [provider, setProvider] = useState<LlmProviderId>("anthropic");
  const [model, setModel] = useState("claude-sonnet-4-20250514");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [userPrompt, setUserPrompt] = useState("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportTailored, setExportTailored] = useState<TailoredResume | null>(null);
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

  useEffect(() => {
    if (settings) {
      setProvider(settings.defaultProvider);
      setModel(modelForProvider(settings, settings.defaultProvider));
    }
  }, [settings]);

  useEffect(() => {
    const preset =
      getDefaultPreset(presets, "session") ??
      getDefaultPreset(presets, "qa");
    if (preset) {
      setSystemPrompt(preset.systemPrompt);
      setUserPrompt(preset.userPrompt);
    }
  }, [presets]);

  useEffect(() => {
    if (session) {
      if (session.jobDescription) {
        setJd({
          text: session.jobDescription,
          jobTitle: session.jobTitle,
          company: session.company,
          sourceType: "text",
        });
      }
      setSessionResume(parseSessionResume(session));
    }
  }, [session]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function setUrl(nextProfile: string, nextSession: string) {
    const params = new URLSearchParams();
    if (nextProfile) params.set("profile", nextProfile);
    if (nextSession) params.set("session", nextSession);
    navigate(`/?${params.toString()}`, { replace: true });
  }

  function startNewSession() {
    setJd(null);
    setSessionResume(null);
    setUrl(profileId, "");
  }

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
    if (!profileId) throw new Error("Select a profile first");
    const created = await api.createSession({
      profileId,
      jobDescription: jd?.text,
      jobTitle: jd?.jobTitle ?? undefined,
      company: jd?.company ?? undefined,
      resumeJson: sessionResume ? JSON.stringify(sessionResume) : undefined,
    });
    setUrl(profileId, created.id);
    queryClient.invalidateQueries({ queryKey: ["sessions", profileId] });
    return created.id;
  }

  async function handleSend() {
    if (!input.trim()) return;
    if (!profileId) {
      setError("Select a profile first");
      return;
    }
    if (!activeResume) {
      setError("Add a resume to the profile or attach one in this session");
      return;
    }

    setLoading(true);
    setError(null);
    const question = input.trim();
    setInput("");

    try {
      const activeSessionId = await ensureSession();
      const priorMessages = messages;

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
          jsonMode: wantsTailorJson(question),
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

      const tailored = tryParseTailored(response);
      if (tailored) {
        setExportTailored(tailored);
        setShowExport(true);
        await api.createOutput({
          sessionId: activeSessionId,
          contentJson: response,
          coverLetter: tailored.cover_letter ?? null,
        });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const hasStarted = messages.length > 0;
  const profilesWithResume = profiles.filter((p) => p.parsedJson);

  return (
    <div className="gpt-page">
      <header className="gpt-topbar">
        <select
          className="gpt-select"
          value={profileId}
          onChange={(e) => {
            setJd(null);
            setSessionResume(null);
            setUrl(e.target.value, "");
          }}
        >
          <option value="">Select profile...</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {!p.parsedJson ? " (no resume)" : ""}
            </option>
          ))}
        </select>

        {profileId && (
          <button type="button" className="btn-ghost" onClick={startNewSession}>
            + New session
          </button>
        )}

        <button
          type="button"
          className="btn-ghost"
          onClick={() => setShowAttach(!showAttach)}
          disabled={!profileId}
        >
          Attach
        </button>

        {jd && (
          <JobDescriptionInput value={jd} onChange={handleJdChange} compact />
        )}
        {sessionResume && (
          <ResumeInput
            value={sessionResume}
            onChange={handleResumeChange}
            compact
          />
        )}
        {exportTailored && (
          <button type="button" onClick={() => setShowExport(true)}>
            Export
          </button>
        )}
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
              Select a profile or{" "}
              <Link to="/profiles">create one with a title and resume</Link>.
            </p>
          </div>
        )}

        {profileId && !hasStarted && !jd && !sessionResume && (
          <div className="gpt-empty">
            <h1>Start a new application session</h1>
            <p className="muted">
              Attach a job description and/or a different resume, then ask
              anything — tailor your resume, write a cover letter, prep for
              interviews.
            </p>
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

        {profileId && !hasStarted && (jd || sessionResume) && (
          <div className="gpt-empty">
            <h1>
              {jd?.jobTitle
                ? `Applying for ${jd.jobTitle}`
                : "Ready when you are"}
            </h1>
            {jd?.company && <p className="muted">at {jd.company}</p>}
            <p className="muted">
              Ask me to tailor your resume, write a cover letter, or answer
              application questions.
            </p>
          </div>
        )}

        {messages.map((m) => {
          const tailored =
            m.role === "assistant" ? tryParseTailored(m.content) : null;
          return (
            <ChatMessage
              key={m.id}
              role={m.role as "user" | "assistant"}
              content={tailored ? "Here's your tailored resume:" : m.content}
            >
              {tailored && (
                <div className="button-row mt">
                  <button
                    type="button"
                    onClick={() => {
                      setExportTailored(tailored);
                      setShowExport(true);
                    }}
                  >
                    Export resume
                  </button>
                </div>
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
        <ChatInputBar
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          loading={loading}
          disabled={!profileId || !activeResume}
          placeholder={
            !profileId
              ? "Select a profile..."
              : !activeResume
                ? "Add a resume to continue..."
                : "Message Resumorph — tailor resume, cover letter, Q&A..."
          }
        />
        {error && <p className="error gpt-error">{error}</p>}
        {profileId && profilesWithResume.length === 0 && (
          <p className="error gpt-error">
            No profiles with resumes.{" "}
            <Link to="/profiles">Create a profile</Link>.
          </p>
        )}
      </div>

      {showExport && exportTailored && profileId && (
        <ExportDialog
          profileId={profileId}
          tailored={exportTailored}
          sessionId={sessionId || undefined}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}
