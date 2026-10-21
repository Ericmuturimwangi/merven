import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { serverEnv } from "@/env";
import { createSupabaseImageStorage, type ImageStorage } from "./supabase-driver";

export type { ImageStorage, StoredImage } from "./supabase-driver";

// --- Local disk (development only; rejected on Vercel by env validation) -----

export const LOCAL_MEDIA_PREFIX = "/media";
const LOCAL_KEY_PATTERN = /^products\/[0-9a-f-]{36}\.webp$/;

export function localUploadRoot(): string {
  // Runtime-only location; excluded from build-time file tracing.
  return path.resolve(/*turbopackIgnore: true*/ process.env.LOCAL_UPLOAD_DIR ?? "./uploads");
}

/** Resolves a storage key to an absolute path, refusing anything outside the upload root. */
export function resolveLocalKey(key: string): string | null {
  if (!LOCAL_KEY_PATTERN.test(key)) return null;
  const root = localUploadRoot();
  const full = path.resolve(/*turbopackIgnore: true*/ root, key);
  return full.startsWith(root + path.sep) ? full : null;
}

const localStorage: ImageStorage = {
  async put(image) {
    const key = `products/${randomUUID()}.webp`;
    const full = resolveLocalKey(key)!;
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, image.data, { flag: "wx" });
    return { key, url: `${LOCAL_MEDIA_PREFIX}/${key}` };
  },
  async remove(key) {
    const full = resolveLocalKey(key);
    if (full) await unlink(full).catch(() => undefined);
  },
};

export function imageStorage(): ImageStorage {
  const env = serverEnv();
  if (env.IMAGE_STORAGE === "supabase") {
    return createSupabaseImageStorage({
      url: env.SUPABASE_URL!,
      secretKey: env.SUPABASE_SECRET_KEY!,
      bucket: env.SUPABASE_STORAGE_BUCKET,
    });
  }
  return localStorage;
}
