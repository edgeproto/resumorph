import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";

export function Layout() {
  return (
    <div className="gpt-app">
      <Sidebar />
      <main className="gpt-main">
        <Outlet />
      </main>
    </div>
  );
}
