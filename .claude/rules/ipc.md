---
paths:
  - "shared/ipc/**"
  - "electron/ipc/**"
  - "src/ipc/**"
  - "electron/preload.ts"
---

# IPC

The Zod schemas in `shared/ipc/` are the single source of truth for IPC types. Never hand-write a type that mirrors them.

To add a channel ([docs/architecture.md](../../docs/architecture.md#adding-a-new-ipc-channel) has the details):

1. A new DTO gets a Zod schema in `shared/ipc/schema.ts`.
2. Add the name to `INVOKE_CHANNELS` (or `EVENT_CHANNELS`) in `shared/ipc/channelNames.ts`. The preload whitelist follows automatically.
3. Add `ChannelInputs.<channel>` and `ChannelOutputs[<channel>]` in `shared/ipc/channels.ts` (typecheck catches a mismatch).
4. Register `handle("<channel>", ...)` in the domain module under `electron/ipc/`. A handler that passes a file path to the OS must go through `ensureFileInsideRoot`.
5. Add `api.<method>` in `src/ipc/client.ts`.
