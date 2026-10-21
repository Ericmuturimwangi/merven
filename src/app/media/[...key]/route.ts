import { readFile } from "node:fs/promises";
import { resolveLocalKey } from "@/server/images/storage";

// Serves images saved by the local storage driver (development / single server).
// Keys are strictly validated, so only generated product image files can be read.
export async function GET(_request: Request, { params }: RouteContext<"/media/[...key]">) {
  if ((process.env.IMAGE_STORAGE ?? "local") !== "local") return new Response("Not found", { status: 404 });
  const { key } = await params;
  const full = resolveLocalKey(key.join("/"));
  if (!full) return new Response("Not found", { status: 404 });
  try {
    const data = await readFile(full);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
