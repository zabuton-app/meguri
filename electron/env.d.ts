// Minimal declarations for dependencies that lack types.
declare module "ffprobe-static" {
  const ffprobe: { path: string };
  export default ffprobe;
}
