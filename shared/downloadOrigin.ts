export interface DownloadOriginEntry {
  kind: "download" | "referrer" | "other";
  url: string;
  hostname: string;
}
