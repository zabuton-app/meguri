import { MAX_BULK_FILES } from "../../shared/tags.js";
import { handle } from "../core/ipcHandler.js";
import {
  previewPexelsSources,
  writePexelsSources,
} from "../core/queries/pexelsSources.js";
import type { SearchResult } from "../core/types.js";
import type { IpcContext } from "./context.js";
import { bulkTargetCores, coreById, queryTargets } from "./helpers.js";

export function registerPexelsSourceHandlers({
  ws,
  queryClient,
}: IpcContext): void {
  const readTargets = (targets: { workspaceId: string; fileIds: number[] }[]) =>
    bulkTargetCores(ws, targets).flatMap(({ workspaceId, core, fileIds }) =>
      previewPexelsSources(core.db, workspaceId, { fileIds }),
    );

  handle("pexels_sources_preview", async (input) => {
    if ("targets" in input) {
      return { rows: readTargets(input.targets), overLimit: false };
    }
    if ("globalQuery" in input) {
      const { kind } = input.globalQuery;
      if (kind && kind !== "video") return { rows: [], overLimit: false };
      // Match the All view's filters and pagination from its first page.
      const targets = queryTargets(ws.allCores());
      const query = { ...input.globalQuery, kind: "video" };
      const groups = new Map<string, Set<number>>();
      let count = 0;
      let cursor: SearchResult["nextCursor"] = null;
      do {
        const page: SearchResult = await queryClient.run<SearchResult>({
          kind: "search",
          targets,
          query: {
            ...query,
            cursor: cursor ?? undefined,
            limit: Math.min(500, MAX_BULK_FILES + 1 - count),
          },
        });
        for (const { workspaceId, id } of page.items) {
          let ids = groups.get(workspaceId);
          if (!ids) groups.set(workspaceId, (ids = new Set()));
          if (ids.has(id)) continue;
          ids.add(id);
          count += 1;
        }
        if (count > MAX_BULK_FILES) return { rows: [], overLimit: true };
        cursor = page.nextCursor;
      } while (cursor !== null);
      return {
        rows: readTargets(
          [...groups].map(([workspaceId, ids]) => ({
            workspaceId,
            fileIds: [...ids],
          })),
        ),
        overLimit: false,
      };
    }
    const { workspaceId, folder } = input;
    const rows = previewPexelsSources(
      coreById(ws, workspaceId).db,
      workspaceId,
      {
        folder,
        limit: MAX_BULK_FILES + 1,
      },
    );
    return rows.length > MAX_BULK_FILES
      ? { rows: [], overLimit: true }
      : { rows, overLimit: false };
  });

  handle(
    "pexels_source_set",
    ({ workspaceId, ...edit }) =>
      writePexelsSources(coreById(ws, workspaceId).db, [edit], true) > 0,
  );
  handle("pexels_sources_save", ({ edits }) => {
    const grouped = new Map<string, typeof edits>();
    for (const edit of edits) {
      const group = grouped.get(edit.workspaceId);
      if (group) group.push(edit);
      else grouped.set(edit.workspaceId, [edit]);
    }
    // Resolve every workspace before writing to any of them.
    const targets = [...grouped].map(([workspaceId, group]) => ({
      core: coreById(ws, workspaceId),
      group,
    }));
    let saved = 0;
    for (const { core, group } of targets) {
      saved += writePexelsSources(core.db, group, false);
    }
    return { saved, skipped: edits.length - saved };
  });
}
