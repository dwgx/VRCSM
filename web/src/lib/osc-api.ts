import { ipc, type OscTaggedArg } from "@/lib/ipc";

// A plain OSC value, or a type-tagged value (see OscTaggedArg) for cases where
// the bare JS type would lose fidelity — a whole-number float, most importantly.
export type OscPrimitive = number | string | boolean;
export type OscArg = OscPrimitive | OscTaggedArg;

export interface OscSendOptions {
  host?: string;
  port?: number;
}

export interface OscSendResult {
  ok: boolean;
}

export function sendOscMessage(
  address: string,
  args: OscArg[] = [],
  options: OscSendOptions = {},
): Promise<OscSendResult> {
  return ipc.oscSend(address, args, options);
}

export function sendChatbox(
  message: string,
  options: OscSendOptions = {},
  sendImmediately = true,
  playNotificationSound = true,
): Promise<OscSendResult> {
  return sendOscMessage(
    "/chatbox/input",
    [message.slice(0, 144), sendImmediately, playNotificationSound],
    options,
  );
}

export function startOscListener(port = 9001): Promise<{ ok: boolean }> {
  return ipc.oscListenStart(port);
}

export function stopOscListener(): Promise<{ ok: boolean }> {
  return ipc.oscListenStop();
}
