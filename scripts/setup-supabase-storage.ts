// Creates or updates the product image bucket. Idempotent.
//
//   pnpm storage:setup
//
// Bucket policy:
//   - public = true: objects are readable by URL (product photos are public anyway).
//   - Only image/webp, max 5 MB: the app re-encodes every upload to WebP.
//   - No storage.objects RLS policies are created, so anon/authenticated users
//     cannot list, upload, update or delete. Only the server's secret key can write.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
if (!url || !key?.startsWith("sb_secret_")) {
  console.error("Set SUPABASE_URL and SUPABASE_SECRET_KEY (sb_secret_…) first.");
  process.exit(1);
}
if (!/^https?:\/\/[^/]+/.test(url)) {
  console.error(`SUPABASE_URL must be the full project URL, e.g. https://<project-ref>.supabase.co (got "${url}").`);
  process.exit(1);
}

const BUCKET_OPTIONS = { public: true, fileSizeLimit: 5 * 1024 * 1024, allowedMimeTypes: ["image/webp"] };

async function main() {
  const storage = createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } }).storage;
  const existing = await storage.getBucket(bucket);
  if (existing.data) {
    const { error } = await storage.updateBucket(bucket, BUCKET_OPTIONS);
    if (error) throw error;
    console.log(`Updated bucket "${bucket}".`);
  } else {
    const { error } = await storage.createBucket(bucket, BUCKET_OPTIONS);
    if (error) throw error;
    console.log(`Created bucket "${bucket}".`);
  }
  const { data } = await storage.getBucket(bucket);
  console.log(JSON.stringify({ id: data?.id, public: data?.public, file_size_limit: data?.file_size_limit, allowed_mime_types: data?.allowed_mime_types }));
  console.log("Next: confirm there are no permissive storage.objects policies (see README), then run pnpm storage:verify.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
