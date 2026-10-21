import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { ProcessedImage } from "./validate";

// Supabase Storage driver. Kept free of `server-only` so CLI scripts can use it,
// but it must only ever be constructed on the server: it holds the secret key.

export type StoredImage = { key: string; url: string };

export interface ImageStorage {
  put(image: ProcessedImage, opts: { productId: string }): Promise<StoredImage>;
  remove(key: string): Promise<void>;
}

export const SUPABASE_BUCKET_DEFAULT = "product-images";

/** Object keys this app writes: products/<productId>/<uuid>.webp — nothing else is ever touched. */
export const SUPABASE_KEY_PATTERN = /^products\/[a-z0-9]{1,64}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

export function isSupabaseKey(key: string): boolean {
  return SUPABASE_KEY_PATTERN.test(key);
}

export function supabasePublicPrefix(url: string, bucket: string): string {
  return `${url.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/`;
}

export type SupabaseStorageConfig = {
  url: string;
  secretKey: string;
  bucket?: string;
  /** Test hook. */
  fetch?: typeof fetch;
};

export function createSupabaseImageStorage(config: SupabaseStorageConfig): ImageStorage {
  const bucket = config.bucket ?? SUPABASE_BUCKET_DEFAULT;
  const client = createClient(config.url, config.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: config.fetch ? { fetch: config.fetch } : undefined,
  });
  const objects = () => client.storage.from(bucket);
  const publicPrefix = supabasePublicPrefix(config.url, bucket);

  return {
    async put(image, { productId }) {
      if (image.contentType !== "image/webp") throw new Error("Only re-encoded WebP images may be stored");
      const key = `products/${productId}/${randomUUID()}.webp`;
      if (!isSupabaseKey(key)) throw new Error("Invalid product id for storage path");

      const { error } = await objects().upload(key, image.data, {
        contentType: "image/webp",
        cacheControl: "31536000", // keys are unique and never overwritten
        upsert: false,
      });
      if (error) throw new Error(`Supabase upload failed: ${error.message}`);

      const url = objects().getPublicUrl(key).data.publicUrl;
      if (!url.startsWith(publicPrefix)) throw new Error("Unexpected Supabase public URL");
      return { key, url };
    },

    async remove(key) {
      // Placeholder, legacy and local keys are not Supabase objects; ignore them.
      if (!isSupabaseKey(key)) return;
      const { error } = await objects().remove([key]);
      if (error) throw new Error(`Supabase delete failed: ${error.message}`);
    },
  };
}
