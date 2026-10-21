// Live end-to-end check of the Supabase Storage setup. Needs real credentials.
//
//   pnpm storage:verify
//
// Optional: SUPABASE_PUBLISHABLE_KEY (sb_publishable_…) to also prove that a
// browser-level key cannot upload, delete or list.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { createSupabaseImageStorage, supabasePublicPrefix } from "../src/server/images/supabase-driver";

const url = process.env.SUPABASE_URL!;
const secret = process.env.SUPABASE_SECRET_KEY!;
const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
if (!url || !secret?.startsWith("sb_secret_")) {
  console.error("Set SUPABASE_URL and SUPABASE_SECRET_KEY (sb_secret_…) first.");
  process.exit(1);
}
if (!/^https?:\/\/[^/]+/.test(url)) {
  console.error(`SUPABASE_URL must be the full project URL, e.g. https://<project-ref>.supabase.co (got "${url}").`);
  process.exit(1);
}

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

async function main() {
  const admin = createClient(url, secret, opts).storage;
  const objects = admin.from(bucket);
  const { data: b } = await admin.getBucket(bucket);
  check(!!b, `bucket "${bucket}" exists`);
  check(b?.public === true, "bucket is public-read");
  check(JSON.stringify(b?.allowed_mime_types) === JSON.stringify(["image/webp"]), "bucket only accepts image/webp", String(b?.allowed_mime_types));
  check(Number(b?.file_size_limit) > 0 && Number(b?.file_size_limit) <= 5 * 1024 * 1024, "bucket has a ≤ 5 MB size limit", String(b?.file_size_limit));

  const webp = await sharp({ create: { width: 400, height: 500, channels: 3, background: "#6e2b2b" } }).webp().toBuffer();
  const driver = createSupabaseImageStorage({ url, secretKey: secret, bucket });
  const stored = await driver.put({ data: webp, width: 400, height: 500, contentType: "image/webp" }, { productId: "healthcheck" });
  check(stored.url.startsWith(supabasePublicPrefix(url, bucket)), "server upload with secret key", stored.key);

  const pub = await fetch(stored.url, { cache: "no-store" });
  check(pub.ok && pub.headers.get("content-type") === "image/webp", "public URL serves the image to anonymous visitors", `${pub.status} ${pub.headers.get("content-type")}`);

  const png = await sharp(webp).png().toBuffer();
  const pngUp = await objects.upload(`products/healthcheck/${randomUUID()}.png`, png, { contentType: "image/png" });
  check(!!pngUp.error, "bucket rejects non-WebP uploads even with the secret key", pngUp.error?.message);
  if (!pngUp.error && pngUp.data) await objects.remove([pngUp.data.path]);

  const noKey = await fetch(`${url}/storage/v1/object/${bucket}/products/healthcheck/${randomUUID()}.webp`, {
    method: "POST",
    headers: { "content-type": "image/webp" },
    body: new Uint8Array(webp),
  });
  check(!noKey.ok, "upload without any key is refused", String(noKey.status));

  if (publishable) {
    const anon = createClient(url, publishable, opts).storage.from(bucket);
    const up = await anon.upload(`products/healthcheck/${randomUUID()}.webp`, webp, { contentType: "image/webp" });
    check(!!up.error, "publishable (browser) key cannot upload", up.error?.message);
    await anon.remove([stored.key]);
    const still = await fetch(`${stored.url}?v=${Date.now()}`, { cache: "no-store" });
    check(still.ok, "publishable (browser) key cannot delete", String(still.status));
    const list = await anon.list("products/healthcheck");
    check(!!list.error || (list.data?.length ?? 0) === 0, "publishable (browser) key cannot list objects");
  } else {
    console.log("• SUPABASE_PUBLISHABLE_KEY not set: skipped browser-key upload/delete/list checks");
  }

  await driver.remove(stored.key);
  const { data: left } = await objects.list("products/healthcheck");
  check(!(left ?? []).some((o) => stored.key.endsWith(o.name)), "server delete removes the object");

  console.log(failures === 0 ? "\nSupabase Storage verification PASSED" : `\n${failures} check(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
