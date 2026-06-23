import { ipc } from "@/lib/ipc";

export type OscPrimitive = number | string | boolean;

export interface OscSendOptions {
  host?: string;
  port?: number;
}

export interface OscSendResult {
  ok: boolean;
}

export function sendOscMessage(
  address: string,
  args: OscPrimitive[] = [],
  options: OscSendOptions = {},
): Promise<OscSendResult> {
  return ipc.oscSend(address, args, options);
}

export function sendChatbox(
  message: string,
  options: OscSendOptions = {},
  notify = true,
  clearPrevious = true,
): Promise<OscSendResult> {
  return sendOscMessage(
    "/chatbox/input",
    [message.slice(0, 144), notify, clearPrevious],
    options,
  );
}

export function startOscListener(port = 9001): Promise<{ ok: boolean }> {
  return ipc.oscListenStart(port);
}

export function stopOscListener(): Promise<{ ok: boolean }> {
  return ipc.oscListenStop();
}
