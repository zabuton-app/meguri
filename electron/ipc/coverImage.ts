import { nativeImage } from "electron";

export function normalizeCoverImage(bytes: Buffer): Buffer | null {
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) return null;
  const { width, height } = image.getSize();
  const resized =
    Math.max(width, height) <= 384
      ? image
      : image.resize(width >= height ? { width: 384 } : { height: 384 });
  return resized.toPNG();
}
