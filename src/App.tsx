import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { api } from "./lib/api";
import { Chat } from "./pages/Chat";
import { Profiles } from "./pages/Profiles";
import { Settings } from "./pages/Settings";
import { Tailor } from "./pages/Tailor";
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
            <Route index element={<Navigate to="/tailor" replace />} />
            <Route path="profiles" element={<Profiles />} />
            <Route path="tailor" element={<Tailor />} />
            <Route path="chat" element={<Chat />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
