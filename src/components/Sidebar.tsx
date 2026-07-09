import { NavLink } from "react-router-dom";

const links = [
  { to: "/", label: "Profiles", end: true },
  { to: "/tailor", label: "Tailor" },
  { to: "/chat", label: "Q&A Chat" },
  { to: "/settings", label: "Settings" },
];

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <h1>Resumorph</h1>
        <p>Local-first resume tailorer</p>
      </div>
      <nav className="sidebar-nav">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) =>
              isActive ? "nav-link active" : "nav-link"
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
