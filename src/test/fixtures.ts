import type {
  AppStatus,
  FileDetail,
  FileRow,
  WorkspacesList,
} from "@/ipc/types";

export const WS_ID = "ws-test-abc123";

export const sampleFileRow: FileRow = {
  id: 1,
  workspaceId: WS_ID,
  relPath: "videos/sample.mp4",
  kind: "video",
  ext: "mp4",
  size: 1_024_000,
  width: 1920,
  height: 1080,
  duration: 125,
  rating: 3,
  favorite: 0,
  thumbStatus: "done",
  capturedAt: null,
  lastAccessedAt: null,
  tags: [],
};

export const sampleFileDetail: FileDetail = {
  ...sampleFileRow,
  absPath: "/media/videos/sample.mp4",
  codec: "h264",
  fps: 30,
  mtime: 1_700_000_000,
  meta: null,
  tags: [],
  playHistory: [],
  bookmarks: [],
  thumbOffsetSec: null,
};

export const defaultAppStatus: AppStatus = {
  root: "/media",
  ready: true,
  initError: null,
  initErrorKind: null,
  mediaBase: "http://127.0.0.1:17345",
  workspaceId: WS_ID,
  devMode: true,
};

export const defaultWorkspacesList: WorkspacesList = {
  workspaces: [
    {
      id: WS_ID,
      path: "/media",
      label: "Media",
      active: true,
      emoji: "📁",
    },
    {
      id: "ws-other",
      path: "/other",
      label: "Other",
      active: false,
    },
    {
      id: "__all__",
      path: "",
      label: "All",
      active: false,
    },
  ],
  collections: [],
  activeId: WS_ID,
};
