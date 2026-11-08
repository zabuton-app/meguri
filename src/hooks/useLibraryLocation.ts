import { useSyncExternalStore } from "react";
import { z } from "zod";
import { ALL_ID, COLLECTION_ID_PREFIX } from "@shared/workspaceIds";

export const LAST_LIBRARY_LOCATION_KEY = "meguri.library.lastLocal.v1";
const LocationSchema = z.object({ workspaceId: z.string(), path: z.string() });
export type LibraryLocation = z.infer<typeof LocationSchema>;
export type LibraryScope = "global" | "local";

export function isLocalWorkspace(id: string | null | undefined): id is string {
  return !!id && id !== ALL_ID && !id.startsWith(COLLECTION_ID_PREFIX);
}

let snapshot: { raw: string | null; value: LibraryLocation | null } | undefined;
const listeners = new Set<() => void>();
function getSnapshot() {
  let raw: string | null;
  try {
    raw = localStorage.getItem(LAST_LIBRARY_LOCATION_KEY);
  } catch {
    return snapshot?.value ?? null;
  }
  if (!snapshot || snapshot.raw !== raw) {
    let value: LibraryLocation | null = null;
    try {
      const parsed = LocationSchema.safeParse(JSON.parse(raw ?? "null"));
      if (parsed.success && isLocalWorkspace(parsed.data.workspaceId))
        value = parsed.data;
    } catch {
      /* Invalid saved locations fall back to a registered folder. */
    }
    snapshot = { raw, value };
  }
  return snapshot.value;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function rememberLibraryLocation(workspaceId: string, path: string) {
  if (!isLocalWorkspace(workspaceId)) return;
  const value = { workspaceId, path };
  const raw = JSON.stringify(value);
  if (raw === snapshot?.raw) return;
  try {
    localStorage.setItem(LAST_LIBRARY_LOCATION_KEY, raw);
  } catch {
    /* Keep the in-memory location. */
  }
  snapshot = { raw, value };
  listeners.forEach((listener) => listener());
}

export function useLibraryLocation() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
export const readLibraryLocation = getSnapshot;
