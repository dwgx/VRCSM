import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ipc } from "@/lib/ipc";
import type { AppVersion } from "@/lib/types";

function Settings() {
  const [version, setVersion] = useState<AppVersion | null>(null);
  const [theme, setTheme] = useState<"dark">("dark");

  useEffect(() => {
    let alive = true;
    ipc
      .version()
      .then((v) => {
        if (alive) setVersion(v);
      })
      .catch(() => {
        if (alive) setVersion({ version: "0.1.0", build: "dev" });
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure VRCSM and the underlying VRChat options.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Coming soon</CardTitle>
          <CardDescription>
            Settings (config.json + Loader.cfg) coming soon.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          <div className="flex items-center justify-between rounded-md border border-border/50 bg-background/30 p-3 text-sm">
            <div>
              <div>App theme</div>
              <div className="text-xs text-muted-foreground">Light mode is planned</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTheme("dark")}
              disabled
            >
              {theme === "dark" ? "Dark" : "Light"}
            </Button>
          </div>
          <div className="flex items-center justify-between rounded-md border border-border/50 bg-background/30 p-3 text-sm">
            <div>
              <div>App version</div>
              <div className="text-xs text-muted-foreground">
                Reported by host process
              </div>
            </div>
            <Badge variant="outline">
              {version ? `v${version.version} (${version.build})` : "—"}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default Settings;
