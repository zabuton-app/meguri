/**
 * Stable per-file identity for drag-and-drop and cache keys. File ids are only
 * unique within a workspace, so the workspace has to be part of the key.
 */
export function mediaSortId(file: { workspaceId: string; id: number }): string {
  return `${file.workspaceId}:${file.id}`;
}
