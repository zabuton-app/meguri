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
  hasThumb: 1,
  capturedAt: null,
  btime: null,
  lastAccessedAt: null,
  tags: [],
};

/** Audio without embedded cover art: thumbStatus is 'done' (a normal state, not a
 *  failure) but no thumbnail file exists, so hasThumb is 0. width/height/fps stay
 *  null for audio regardless of whether a cover is present. */
export const sampleAudioRow: FileRow = {
  id: 2,
  workspaceId: WS_ID,
  relPath: "music/track.mp3",
  kind: "audio",
  ext: "mp3",
  size: 4_096_000,
  width: null,
  height: null,
  duration: 240,
  rating: 0,
  favorite: 0,
  thumbStatus: "done",
  hasThumb: 0,
  capturedAt: null,
  btime: null,
  lastAccessedAt: null,
  tags: [],
};

/** Audio whose embedded cover art was extracted into a thumbnail. */
export const sampleAudioRowWithCover: FileRow = {
  ...sampleAudioRow,
  id: 3,
  relPath: "music/with-cover.mp3",
  hasThumb: 1,
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
