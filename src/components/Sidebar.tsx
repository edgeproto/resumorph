import { useQuery } from "@tanstack/react-query";
import { NavLink, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { jdLabel } from "../lib/jd";

const navItems = [
  { to: "/tailor", label: "Tailor resume", icon: "✦" },
  { to: "/chat", label: "Q&A chat", icon: "💬" },
  { to: "/profiles", label: "Profiles", icon: "👤" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

export function Sidebar() {
  const location = useLocation();
  const showSessions =
    location.pathname === "/chat" || location.pathname === "/tailor";

  const { data: sessions = [] } = useQuery({
    queryKey: ["sessions"],
    queryFn: () => api.listSessions(),
    enabled: showSessions,
  });

  return (
    <aside className="gpt-sidebar">
      <div className="gpt-sidebar-top">
        <div className="gpt-brand">Resumorph</div>
        <NavLink to="/tailor" className="gpt-new-chat">
          + New tailor
        </NavLink>
        <NavLink to="/chat" className="gpt-new-chat gpt-new-chat-secondary">
          + New chat
        </NavLink>
      </div>

      {showSessions && sessions.length > 0 && (
        <div className="gpt-history">
          <p className="gpt-history-label">Recent</p>
          <ul className="gpt-history-list">
            {sessions.slice(0, 20).map((s) => (
              <li key={s.id}>
                <NavLink
                  to={
                    location.pathname === "/tailor"
                      ? `/tailor?session=${s.id}`
                      : `/chat?session=${s.id}`
                  }
                  className="gpt-history-item"
                >
                  {s.jobTitle && s.company
                    ? `${s.jobTitle} @ ${s.company}`
                    : s.jobTitle || s.company || jdLabel({
                        text: s.jobDescription ?? "",
                        jobTitle: s.jobTitle,
                        company: s.company,
                        sourceType: "text",
                      }).slice(0, 40) || "Untitled"}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      )}

      <nav className="gpt-sidebar-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
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
