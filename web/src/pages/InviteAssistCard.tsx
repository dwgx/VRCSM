import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ipc } from "@/lib/ipc";
import { useGreyPrefs } from "@/lib/grey-prefs";
import { Button } from "@/components/ui/button";

export default function InviteAssistCard() {
  const { t } = useTranslation();
  const { prefs, reload } = useGreyPrefs();
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const tos = t("grey.tos.inviteAssist", {
    defaultValue:
      "Invite Assist, when enabled, will invite people on your InviteAssist list into your current instance when they send you an invite request. It will not join you to their world. It is OFF until you confirm. Auto-inviting can surprise people in private instances and may violate VRChat’s Terms of Service if abused. 10-minute cooldown per person.",
  });

  async function enable() {
    setError(null);
    try {
      if (!prefs?.inviteAssist?.["confirmedAt"]) {
        setConfirmOpen(true);
        return;
      }
      await ipc.call("inviteAssist.setEnabled", { enabled: true });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function confirm() {
    setError(null);
    try {
      await ipc.call("inviteAssist.confirm", { acknowledged: true });
      setConfirmOpen(false);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function disable() {
    setError(null);
    try {
      await ipc.call("inviteAssist.setEnabled", { enabled: false });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!prefs?.greyEnabled) {
    return null;
  }

  return (
    <div className="unity-panel border border-[hsl(var(--border))] p-3 flex flex-col gap-2">
      <div className="font-mono text-[12px] font-medium">
        {t("inviteAssist.title", { defaultValue: "Invite Assist" })}
      </div>
      <p className="text-[11px] text-[hsl(var(--muted-foreground))] leading-relaxed">{tos}</p>
      <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
        {t("inviteAssist.openFriendHint", {
          defaultValue: "Open a friend to add people to Invite Assist.",
        })}
      </p>
      <div className="flex gap-2">
        {prefs?.inviteAssist?.["enabled"] === true ? (
          <Button size="sm" variant="outline" onClick={() => void disable()}>
            {t("common.disable", { defaultValue: "Disable" })}
          </Button>
        ) : (
          <Button size="sm" variant="tonal" onClick={() => void enable()}>
            {t("inviteAssist.enable", { defaultValue: "Enable Invite Assist" })}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void ipc.call("inviteAssist.cancelPending", {}).catch((e: unknown) => {
              setError(e instanceof Error ? e.message : String(e));
            })
          }
        >
          {t("inviteAssist.cancel", { defaultValue: "Cancel pending" })}
        </Button>
      </div>
      {confirmOpen ? (
        <div className="border border-[hsl(var(--border))] p-2 flex flex-col gap-1 text-[11px]">
          <div>{t("inviteAssist.confirm", { defaultValue: "Enable Invite Assist" })}</div>
          <ul className="list-disc pl-4 text-[hsl(var(--muted-foreground))]">
            <li>Only requestInvite, not incoming invites</li>
            <li>Only the explicit InviteAssist list</li>
            <li>Only while you are in a world and VRChat is running</li>
          </ul>
          <Button size="sm" onClick={() => void confirm()}>
            {t("inviteAssist.confirm", { defaultValue: "Enable Invite Assist" })}
          </Button>
        </div>
      ) : null}
      {error ? <p className="text-[11px] text-[hsl(var(--destructive))]">{error}</p> : null}
    </div>
  );
}
