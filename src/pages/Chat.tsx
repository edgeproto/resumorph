import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { PromptEditor } from "../components/PromptEditor";
import { api, parseProfileResume } from "../lib/api";
import { completeWithProvider } from "../lib/llm";
import {
  buildPromptContext,
  getDefaultPreset,
  interpolatePrompt,
} from "../lib/prompts";
import { modelForProvider, useAppSettings } from "../lib/settings";
import type { LlmProviderId, PromptPreset } from "../lib/types";

export function Chat() {
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
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
  const [showPromptEditor, setShowPromptEditor] = useState(false);
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

  const { data: sessions = [] } = useQuery({
    queryKey: ["sessions", profileId],
    queryFn: () => api.listSessions(profileId),
    enabled: !!profileId,
  });

  const { data: messages = [] } = useQuery({
    queryKey: ["messages", sessionId],
    queryFn: () => api.listMessages(sessionId),
    enabled: !!sessionId,
  });

  const qaPresets = presets.filter((p) => p.mode === "qa");
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
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const createSessionMutation = useMutation({
    mutationFn: () =>
      api.createSession({
        profileId,
        jobDescription: jobDescription || undefined,
        jobTitle: jobTitle || undefined,
        company: company || undefined,
      }),
    onSuccess: (session) => {
      setSessionId(session.id);
      queryClient.invalidateQueries({ queryKey: ["sessions", profileId] });
    },
  });

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

  function handlePresetChange(id: string) {
    setSelectedPresetId(id);
    const preset = presets.find((p) => p.id === id);
    if (preset) {
      setSystemPrompt(preset.systemPrompt);
      setUserPrompt(preset.userPrompt);
    }
  }

  async function handleSend() {
    if (!input.trim()) return;

    setLoading(true);
    setError(null);
    const question = input.trim();
    setInput("");

    try {
      let activeSessionId = sessionId;
      if (!activeSessionId) {
        if (!profileId) throw new Error("Select a profile first");
        const session = await api.createSession({
          profileId,
          jobDescription: jobDescription || undefined,
          jobTitle: jobTitle || undefined,
          company: company || undefined,
        });
        activeSessionId = session.id;
        setSessionId(session.id);
        queryClient.invalidateQueries({ queryKey: ["sessions", profileId] });
      }

      await api.createMessage({
        sessionId: activeSessionId,
        role: "user",
        content: question,
      });
      queryClient.invalidateQueries({
        queryKey: ["messages", activeSessionId],
      });

      const context = buildPromptContext(parsed, selectedProfile?.name ?? "", {
        jobDescription,
        jobTitle,
        company,
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
          baseUrl:
            provider === "custom" ? settings?.customBaseUrl : undefined,
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
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h2>Application Q&A</h2>
        <p>Ask cover letter questions, gap analysis, and more.</p>
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
              <option value="">Select...</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          {profileId && sessions.length > 0 && (
            <label>
              Session history
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
            />
          </label>
          <label>
            Company
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
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
              <option value="custom">Custom</option>
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
              {qaPresets.map((p: PromptPreset) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          Job description (context)
          <textarea
            rows={4}
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
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
          {!sessionId && (
            <button
              type="button"
              disabled={!profileId || createSessionMutation.isPending}
              onClick={() => createSessionMutation.mutate()}
            >
              Start chat session
            </button>
          )}
        </div>

        {showPromptEditor && (
          <PromptEditor
            mode="qa"
            systemPrompt={systemPrompt}
            userPrompt={userPrompt}
            onSystemChange={setSystemPrompt}
            onUserChange={setUserPrompt}
          />
        )}
      </section>

      {(sessionId || profileId) && (
        <section className="card chat-panel">
          <div className="chat-messages">
            {messages.length === 0 && (
              <p className="muted">
                Ask a question to get started — e.g. &quot;Write a cover
                letter&quot; or &quot;What gaps should I address?&quot;
              </p>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`chat-bubble ${m.role}`}>
                <strong>{m.role}</strong>
                <p>{m.content}</p>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
          >
            <input
              type="text"
              placeholder="e.g. Write a cover letter..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading || !profileId}
            />
            <button
              type="submit"
              disabled={loading || !input.trim() || !profileId}
            >
              Send
            </button>
          </form>
          {error && <p className="error">{error}</p>}
        </section>
      )}
    </div>
  );
}
