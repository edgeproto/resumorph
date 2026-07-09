import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { api } from "./lib/api";
import { Profiles } from "./pages/Profiles";
import { SessionWorkspace } from "./pages/SessionWorkspace";
import { Settings } from "./pages/Settings";
import "./index.css";

const queryClient = new QueryClient();

function App() {
  useEffect(() => {
    api.initAppData().catch(console.error);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<SessionWorkspace />} />
            <Route path="profiles" element={<Profiles />} />
            <Route path="settings" element={<Settings />} />
            <Route path="tailor" element={<Navigate to="/" replace />} />
            <Route path="chat" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
