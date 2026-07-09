import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PlaceholderWizard } from "../components/PlaceholderWizard";
import { api, parseProfileResume } from "../lib/api";

export function Profiles() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [wizardProfileId, setWizardProfileId] = useState<string | null>(null);

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["profiles"],
    queryFn: api.listProfiles,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => api.createProfile({ name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      setNewName("");
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
        <p>Create a profile for each resume persona. Upload once, reuse everywhere.</p>
      </header>

      <section className="card">
        <h3>New profile</h3>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) createMutation.mutate(newName.trim());
          }}
        >
          <input
            type="text"
            placeholder="e.g. Software Engineer — 2026"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="submit" disabled={createMutation.isPending}>
            Create
          </button>
        </form>
      </section>

      <section className="card">
        <h3>Your profiles</h3>
        {isLoading && <p className="muted">Loading...</p>}
        {!isLoading && profiles.length === 0 && (
          <p className="muted">No profiles yet. Create one above.</p>
        )}
        <ul className="profile-list">
          {profiles.map((profile) => {
            const parsed = parseProfileResume(profile);
            const isExpanded = expandedId === profile.id;
            return (
              <li key={profile.id} className="profile-item">
                <div className="profile-item-header">
                  <div>
                    <strong>{profile.name}</strong>
                    <span className="badge">{profile.sourceType}</span>
                  </div>
                  <div className="profile-actions">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedId(isExpanded ? null : profile.id)
                      }
                    >
                      {isExpanded ? "Hide" : "Details"}
                    </button>
                    <button
                      type="button"
                      onClick={() => ingestMutation.mutate(profile.id)}
                      disabled={ingestMutation.isPending}
                    >
                      {profile.templatePath ? "Re-upload" : "Upload resume"}
                    </button>
                    {profile.sourceType === "docx" && profile.templatePath && (
                      <button
                        type="button"
                        onClick={() => setWizardProfileId(profile.id)}
                      >
                        Placeholder wizard
                      </button>
                    )}
                    <button
                      type="button"
                      className="danger"
                      onClick={() => {
                        if (confirm(`Delete profile "${profile.name}"?`)) {
                          deleteMutation.mutate(profile.id);
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="profile-details">
                    <p className="muted">
                      Updated {new Date(profile.updatedAt).toLocaleString()}
                    </p>
                    {profile.templatePath && (
                      <p className="mono">{profile.templatePath}</p>
                    )}
                    {parsed && (
                      <div className="sections-preview">
                        <h4>Parsed sections</h4>
                        {parsed.sections.map((s) => (
                          <details key={s.name}>
                            <summary>{s.name}</summary>
                            <pre>{s.content}</pre>
                          </details>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {ingestMutation.isError && (
          <p className="error">{(ingestMutation.error as Error).message}</p>
        )}
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
