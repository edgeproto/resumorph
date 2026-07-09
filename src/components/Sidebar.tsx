import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { NavLink, useNavigate, useSearchParams } from "react-router-dom";
import { CreateProfileModal } from "./CreateProfileModal";
import { api, parseProfileResume } from "../lib/api";
import { sessionLabel } from "../lib/sessions";

const navItems = [
  { to: "/profiles", label: "Profiles", icon: "👤" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

export function Sidebar() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const profileId = searchParams.get("profile") ?? "";
  const activeSessionId = searchParams.get("session") ?? "";
  const [showCreateProfile, setShowCreateProfile] = useState(false);

  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles"],
    queryFn: api.listProfiles,
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ["sessions", profileId],
    queryFn: () => api.listSessions(profileId),
    enabled: !!profileId,
  });

  const selectedProfile = profiles.find((p) => p.id === profileId);
  const hasResume = selectedProfile ? !!parseProfileResume(selectedProfile) : false;

  function selectProfile(nextProfileId: string) {
    if (!nextProfileId) {
      navigate("/");
      return;
    }
    navigate(`/?profile=${nextProfileId}`);
  }

  function handleNewSession() {
    if (profiles.length === 0) {
      setShowCreateProfile(true);
      return;
    }
    if (!profileId) {
      const firstWithResume = profiles.find((p) => p.parsedJson);
      if (firstWithResume) {
        navigate(`/?profile=${firstWithResume.id}`);
      } else {
        setShowCreateProfile(true);
      }
      return;
    }
    navigate(`/?profile=${profileId}`);
  }

  return (
    <>
      <aside className="gpt-sidebar">
        <div className="gpt-sidebar-top">
          <div className="gpt-brand">Resumorph</div>

          <button
            type="button"
            className="gpt-new-chat"
            onClick={handleNewSession}
          >
            + New session
          </button>

          <div className="gpt-profile-picker">
            <label className="gpt-profile-label" htmlFor="sidebar-profile">
              Profile
            </label>
            {profiles.length === 0 ? (
              <button
                type="button"
                className="gpt-profile-empty"
                onClick={() => setShowCreateProfile(true)}
              >
                Create a profile…
              </button>
            ) : (
              <select
                id="sidebar-profile"
                className="gpt-profile-select"
                value={profileId}
                onChange={(e) => selectProfile(e.target.value)}
              >
                <option value="">Select profile…</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {!p.parsedJson ? " (no resume)" : ""}
                  </option>
                ))}
              </select>
            )}
            {selectedProfile && (
              <p className="gpt-profile-meta muted small">
                {hasResume ? "Resume on file" : "No resume — add in Profiles"}
              </p>
            )}
          </div>
        </div>

        {profileId ? (
          <div className="gpt-history">
            <p className="gpt-history-label">Sessions</p>
            {sessions.length === 0 && (
              <p className="muted small gpt-history-empty">No sessions yet</p>
            )}
            <ul className="gpt-history-list">
              {sessions.map((s) => (
                <li key={s.id}>
                  <NavLink
                    to={`/?profile=${profileId}&session=${s.id}`}
                    className={`gpt-history-item${activeSessionId === s.id ? " active" : ""}`}
                  >
                    {sessionLabel(s)}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="muted small gpt-sidebar-hint">
            Select a profile to see session history.
          </p>
        )}

        <nav className="gpt-sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? "gpt-nav-link active" : "gpt-nav-link"
              }
            >
              <span className="gpt-nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {showCreateProfile && (
        <CreateProfileModal onClose={() => setShowCreateProfile(false)} />
      )}
    </>
  );
}
