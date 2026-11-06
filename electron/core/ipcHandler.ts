// Typed wrapper around ipcMain.handle that validates the renderer payload
// against the channel's Zod schema before invoking the handler.
//
// Defends against malformed payloads from a compromised renderer / preload
// bypass, and removes the need for ad-hoc destructuring type annotations at
// each handler site (the input type is inferred from the schema registry).
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  ChannelInputs,
  type ChannelInput,
  type ChannelName,
  type ChannelOutput,
} from "../../shared/ipc/channels.js";

export function handle<C extends ChannelName>(
  channel: C,
  fn: (
    input: ChannelInput<C>,
    event: IpcMainInvokeEvent,
  ) => ChannelOutput<C> | Promise<ChannelOutput<C>>,
): void {
  const schema = ChannelInputs[channel];
  ipcMain.handle(channel, async (event, raw: unknown) => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      throw new Error(`Invalid IPC payload for "${channel}": ${issues}`);
    }
    return await fn(parsed.data as ChannelInput<C>, event);
  });
}
