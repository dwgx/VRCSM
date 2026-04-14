import { Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { Sidebar } from "@/components/Sidebar";
import { TitleBar } from "@/components/TitleBar";
import Dashboard from "@/pages/Dashboard";
import Bundles from "@/pages/Bundles";
import Avatars from "@/pages/Avatars";
import Logs from "@/pages/Logs";
import Migrate from "@/pages/Migrate";
import Settings from "@/pages/Settings";

function App() {
  return (
    <div className="flex h-screen w-screen overflow-hidden text-foreground">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TitleBar />
        <main className="flex-1 overflow-y-auto p-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/bundles" element={<Bundles />} />
            <Route path="/avatars" element={<Avatars />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/migrate" element={<Migrate />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
      <Toaster />
    </div>
  );
}

export default App;
