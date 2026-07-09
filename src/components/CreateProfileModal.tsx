import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ResumeInput } from "./ResumeInput";
import { api } from "../lib/api";
import type { ParsedResume } from "../lib/types";

interface CreateProfileModalProps {
  onClose: () => void;
  onCreated?: (profileId: string) => void;
}

export function CreateProfileModal({ onClose, onCreated }: CreateProfileModalProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [resume, setResume] = useState<ParsedResume | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Profile name is required");
      if (!resume) throw new Error("Resume is required");
      const profile = await api.createProfile({ name: name.trim() });
      return api.updateProfile(profile.id, {
        parsedJson: JSON.stringify(resume),
        sourceType: "text",
      });
    },
    onSuccess: (profile) => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      onCreated?.(profile.id);
      onClose();
    },
    onError: (e) => setError((e as Error).message),
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal modal-wide"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <h3>New profile</h3>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body">
          <p className="muted small" style={{ marginTop: 0 }}>
            Add a name and your base resume. You can reuse this profile across
            sessions.
          </p>
          <label>
            Name
            <input
              type="text"
              placeholder="e.g. Software Engineer — 2026"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </label>
          <ResumeInput
            value={resume}
            onChange={setResume}
            label="Resume"
            compact
          />
          {error && <p className="error">{error}</p>}
        </div>
        <footer className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={createMutation.isPending || !name.trim() || !resume}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? "Creating..." : "Create profile"}
          </button>
        </footer>
      </div>
    </div>
  );
}
