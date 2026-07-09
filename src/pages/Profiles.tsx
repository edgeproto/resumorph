import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { PlaceholderWizard } from "../components/PlaceholderWizard";
import { ResumeInput } from "../components/ResumeInput";
import { api } from "../lib/api";
import type { ParsedResume } from "../lib/types";

export function Profiles() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [resume, setResume] = useState<ParsedResume | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [wizardProfileId, setWizardProfileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["profiles"],
    queryFn: api.listProfiles,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error("Title is required");
      if (!resume) throw new Error("Resume is required");
      const profile = await api.createProfile({ name: title.trim() });
      return api.updateProfile(profile.id, {
        parsedJson: JSON.stringify(resume),
        sourceType: "text",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      setTitle("");
      setResume(null);
      setError(null);
    },
    onError: (e) => setError((e as Error).message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      await api.updateProfile(id, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteProfile(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profiles"] }),
  });

  const ingestMutation = useMutation({
    mutationFn: (profileId: string) => api.pickAndIngestResume(profileId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profiles"] }),
  });

  return (
    <div className="page">
      <header className="page-header">
        <h2>Profiles</h2>
        <p>
          Each profile needs a <strong>title</strong> and <strong>resume</strong>.
          Use them across application sessions.
        </p>
      </header>

      <section className="card">
        <h3>New profile</h3>
        <label>
          Title
          <input
            type="text"
            placeholder="e.g. Software Engineer — 2026"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <ResumeInput value={resume} onChange={setResume} label="Resume" />
        <button
          type="button"
          disabled={createMutation.isPending || !title.trim() || !resume}
          onClick={() => createMutation.mutate()}
        >
          {createMutation.isPending ? "Creating..." : "Create profile"}
        </button>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="card">
        <h3>Your profiles</h3>
        {isLoading && <p className="muted">Loading...</p>}
        {!isLoading && profiles.length === 0 && (
          <p className="muted">No profiles yet.</p>
        )}
        <ul className="profile-list">
          {profiles.map((profile) => (
            <li key={profile.id} className="profile-item">
              <div className="profile-item-header">
                {editingId === profile.id ? (
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                ) : (
                  <div>
                    <strong>{profile.name}</strong>
                    <span className="badge">
                      {profile.parsedJson ? profile.sourceType : "no resume"}
                    </span>
                  </div>
                )}
                <div className="profile-actions">
                  {editingId === profile.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          updateMutation.mutate({
                            id: profile.id,
                            name: editTitle,
                          })
                        }
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <Link
                        to={`/?profile=${profile.id}`}
                        className="btn-ghost"
                        style={{ textDecoration: "none" }}
                      >
                        Sessions
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(profile.id);
                          setEditTitle(profile.name);
                        }}
                      >
                        Edit title
                      </button>
                      <button
                        type="button"
                        onClick={() => ingestMutation.mutate(profile.id)}
                        disabled={ingestMutation.isPending}
                      >
                        {profile.parsedJson ? "Replace resume" : "Upload resume"}
                      </button>
                      {profile.sourceType === "docx" &&
                        profile.templatePath && (
                          <button
                            type="button"
                            onClick={() => setWizardProfileId(profile.id)}
                          >
                            Placeholders
                          </button>
                        )}
                      <button
                        type="button"
                        className="danger"
                        onClick={() => {
                          if (confirm(`Delete "${profile.name}"?`)) {
                            deleteMutation.mutate(profile.id);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {wizardProfileId && (
        <PlaceholderWizard
          profileId={wizardProfileId}
          onClose={() => setWizardProfileId(null)}
        />
      )}
    </div>
  );
}
