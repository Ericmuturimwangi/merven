import sharp from "sharp";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MIN_IMAGE_EDGE = 400;
export const MAX_IMAGE_EDGE = 8000;
export const OUTPUT_MAX_WIDTH = 2000;
export const MAX_IMAGES_PER_PRODUCT = 12;

export type ImageKind = "jpeg" | "png" | "webp";

/** Identifies an image by its magic bytes; the declared MIME type and filename are ignored. */
export function sniffImageType(bytes: Uint8Array): ImageKind | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)
  )
    return "png";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  )
    return "webp";
  return null;
}

export type ProcessedImage = { data: Buffer; width: number; height: number; contentType: "image/webp" };
export type ImageResult = { ok: true; image: ProcessedImage } | { ok: false; error: string };

/**
 * Validates an uploaded image and re-encodes it to WebP. Re-encoding strips
 * EXIF/GPS metadata and anything appended to the file, so only decoded pixels
 * are ever stored.
 */
export async function processImageUpload(file: Blob): Promise<ImageResult> {
  if (file.size === 0) return { ok: false, error: "The file is empty." };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "Images must be 5 MB or smaller." };

  const input = Buffer.from(await file.arrayBuffer());
  const kind = sniffImageType(input);
  if (!kind) return { ok: false, error: "Only JPEG, PNG or WebP images are allowed." };

  try {
    const pipeline = sharp(input, { limitInputPixels: 50_000_000, failOn: "error" });
    const meta = await pipeline.metadata();
    if (meta.format !== kind) return { ok: false, error: "The file contents don't match an allowed image type." };
    const width = meta.autoOrient?.width ?? meta.width;
    const height = meta.autoOrient?.height ?? meta.height;
    if (!width || !height) return { ok: false, error: "Could not read the image dimensions." };
    if (Math.min(width, height) < MIN_IMAGE_EDGE)
      return { ok: false, error: `Images must be at least ${MIN_IMAGE_EDGE}px on each side.` };
    if (Math.max(width, height) > MAX_IMAGE_EDGE)
      return { ok: false, error: `Images must be at most ${MAX_IMAGE_EDGE}px on each side.` };

    const { data, info } = await pipeline
      .rotate()
      .resize({ width: OUTPUT_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { ok: true, image: { data, width: info.width, height: info.height, contentType: "image/webp" } };
  } catch {
    return { ok: false, error: "The image could not be processed. Please try a different file." };
  }
}
