// Typed wrapper around ipcMain.handle that checks the call comes from the app's
// own page and validates the renderer payload against the channel's Zod schema
// before invoking the handler.
//
// Defends against malformed payloads from a compromised renderer / preload
// bypass, and removes the need for ad-hoc destructuring type annotations at
// each handler site (the input type is inferred from the schema registry).
//
// handleExtraFor() does the same sender check for an app's own channels
// (`extraChannels` in startApp()), but leaves validating the payload to the app.
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  ChannelInputs,
  type ChannelInput,
  type ChannelName,
  type ChannelOutput,
} from "../../shared/ipc/channels.js";
import { isAppUrl } from "./appUrl.js";

export function handle<C extends ChannelName>(
  channel: C,
  fn: (
    input: ChannelInput<C>,
    event: IpcMainInvokeEvent,
  ) => ChannelOutput<C> | Promise<ChannelOutput<C>>,
): void {
  const schema = ChannelInputs[channel];
  ipcMain.handle(channel, async (event, raw: unknown) => {
    assertAppSender(channel, event);
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

/**
 * Registers the handler for one of an app's own invoke channels
 * (`extraChannels.invoke` in startApp()). It answers the app's own page only,
 * like handle(), and passes the payload through as is: the app's channels have
 * no schema in `shared/ipc/`, so the handler validates its own input.
 */
export type HandleExtra = (
  channel: string,
  fn: (raw: unknown, event: IpcMainInvokeEvent) => unknown,
) => void;

/**
 * A HandleExtra that refuses any channel outside `channels`, so no handler is
 * registered for a channel the preload would not let through.
 */
export function handleExtraFor(channels: readonly string[]): HandleExtra {
  return (channel, fn) => {
    if (!channels.includes(channel)) {
      throw new Error(`IPC "${channel}" is not in extraChannels.invoke`);
    }
    ipcMain.handle(channel, async (event, raw: unknown) => {
      assertAppSender(channel, event);
      return await fn(raw, event);
    });
  };
}

// Only the app's own page may call in: a page the window was somehow navigated
// to, or a frame inside it, would otherwise reach every handler.
function assertAppSender(channel: string, event: IpcMainInvokeEvent): void {
  const sender = event.senderFrame?.url ?? "";
  if (!isAppUrl(sender)) {
    throw new Error(
      `IPC "${channel}" rejected from ${sender || "a detached frame"}`,
    );
  }
}
