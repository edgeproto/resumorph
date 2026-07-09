import { useQuery } from "@tanstack/react-query";
import { NavLink, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { sessionLabel } from "../lib/sessions";

const navItems = [
  { to: "/profiles", label: "Profiles", icon: "👤" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

export function Sidebar() {
  const [searchParams] = useSearchParams();
  const profileId = searchParams.get("profile") ?? "";
  const activeSessionId = searchParams.get("session") ?? "";

  const { data: sessions = [] } = useQuery({
    queryKey: ["sessions", profileId],
    queryFn: () => api.listSessions(profileId),
    enabled: !!profileId,
  });

  return (
    <aside className="gpt-sidebar">
      <div className="gpt-sidebar-top">
        <div className="gpt-brand">Resumorph</div>
        <NavLink
          to={profileId ? `/?profile=${profileId}` : "/"}
          className="gpt-new-chat"
        >
          + New session
        </NavLink>
      </div>

      {profileId && (
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
      )}

      {!profileId && (
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
  );
}
