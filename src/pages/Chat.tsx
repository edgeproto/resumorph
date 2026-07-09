import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChatInputBar, ChatMessage } from "../components/ChatUI";
import { JobDescriptionInput } from "../components/JobDescriptionInput";
import { api, parseProfileResume } from "../lib/api";
import { completeWithProvider } from "../lib/llm";
import {
  buildPromptContext,
  getDefaultPreset,
  interpolatePrompt,
} from "../lib/prompts";
import { modelForProvider, useAppSettings } from "../lib/settings";
import type { LlmProviderId, ParsedJobDescription } from "../lib/types";

export function Chat() {
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
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
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      : getDefaultPreset(presets, "qa");
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId;
    if (!profileId) throw new Error("Select a profile first");
    const created = await api.createSession({
      profileId,
      jobDescription: jd?.text,
      jobTitle: jd?.jobTitle ?? undefined,
      company: jd?.company ?? undefined,
    });
    setSessionId(created.id);
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
    return created.id;
  }

  async function handleSend() {
    if (!input.trim()) return;
    if (!profileId) {
      setError("Select a profile first");
      return;
    }

    setLoading(true);
    setError(null);
    const question = input.trim();
    setInput("");

    try {
      const activeSessionId = await ensureSession();

      if (jd) {
        await api.updateSession(activeSessionId, {
          jobDescription: jd.text,
          jobTitle: jd.jobTitle ?? undefined,
          company: jd.company ?? undefined,
        });
      }

      await api.createMessage({
        sessionId: activeSessionId,
        role: "user",
        content: question,
      });
      queryClient.invalidateQueries({ queryKey: ["messages", activeSessionId] });

      const context = buildPromptContext(parsed, selectedProfile?.name ?? "", {
        jobDescription: jd?.text ?? "",
        jobTitle: jd?.jobTitle ?? "",
        company: jd?.company ?? "",
        userQuestion: question,
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
          temperature: settings?.temperature,
          baseUrl: provider === "custom" ? settings?.customBaseUrl : undefined,
        },
      );

      await api.createMessage({
        sessionId: activeSessionId,
        role: "assistant",
        content: response,
      });
      queryClient.invalidateQueries({ queryKey: ["messages", activeSessionId] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const hasStarted = messages.length > 0;

  return (
    <div className="gpt-page">
      <header className="gpt-topbar">
        <select
          className="gpt-select"
          value={profileId}
          onChange={(e) => {
            setProfileId(e.target.value);
            setSessionId("");
            setJd(null);
          }}
        >
          <option value="">Select profile...</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {jd && <JobDescriptionInput value={jd} onChange={setJd} compact />}
      </header>

      <div className="gpt-thread">
        {!hasStarted && !jd && (
          <div className="gpt-empty">
            <h1>How can I help with your application?</h1>
            <p className="muted">
              Upload a job description, then ask about cover letters, interview
              prep, or gaps to address.
            </p>
            <div className="gpt-empty-jd">
              <JobDescriptionInput value={jd} onChange={setJd} />
            </div>
          </div>
        )}

        {!hasStarted && jd && (
          <div className="gpt-empty">
            <h1>{jd.jobTitle ? `Applying for ${jd.jobTitle}` : "Ready to help"}</h1>
            {jd.company && <p className="muted">at {jd.company}</p>}
            <p className="muted">Ask anything about this application.</p>
          </div>
        )}

        {messages.map((m) => (
          <ChatMessage
            key={m.id}
            role={m.role as "user" | "assistant"}
            content={m.content}
          />
        ))}

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
          disabled={!profileId}
          placeholder={
            profileId
              ? "Ask about cover letters, gaps, or interview questions..."
              : "Select a profile to start..."
          }
        />
        {error && <p className="error gpt-error">{error}</p>}
      </div>
    </div>
  );
}
