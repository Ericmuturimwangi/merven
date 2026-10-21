import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, processImageUpload, sniffImageType } from "@/server/images/validate";

async function image(format: "jpeg" | "png" | "webp", width = 800, height = 1000) {
  return sharp({ create: { width, height, channels: 3, background: "#1f5b45" } })
    .toFormat(format)
    .toBuffer();
}

const blob = (buf: Buffer | string, type = "image/jpeg") => new Blob([typeof buf === "string" ? buf : new Uint8Array(buf)], { type });

describe("image upload validation", () => {
  it.each(["jpeg", "png", "webp"] as const)("accepts %s and re-encodes to WebP", async (fmt) => {
    const r = await processImageUpload(blob(await image(fmt)));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(sniffImageType(r.image.data)).toBe("webp");
      expect(r.image).toMatchObject({ width: 800, height: 1000, contentType: "image/webp" });
    }
  });

  it("ignores the declared MIME type and rejects non-images", async () => {
    const r = await processImageUpload(blob("<?php system($_GET['c']); ?>", "image/jpeg"));
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/JPEG, PNG or WebP/) });
  });

  it("rejects SVG and GIF", async () => {
    expect((await processImageUpload(blob('<svg xmlns="http://www.w3.org/2000/svg"/>', "image/svg+xml"))).ok).toBe(false);
    const gif = await sharp({ create: { width: 500, height: 500, channels: 3, background: "#000" } }).gif().toBuffer();
    expect((await processImageUpload(blob(gif, "image/gif"))).ok).toBe(false);
  });

  it("rejects a truncated file with a valid header", async () => {
    const jpg = await image("jpeg");
    expect((await processImageUpload(blob(jpg.subarray(0, 64)))).ok).toBe(false);
  });

  it("rejects files over the size limit before decoding", async () => {
    const r = await processImageUpload(new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)]));
    expect(r).toEqual({ ok: false, error: "Images must be 5 MB or smaller." });
  });

  it("enforces minimum dimensions", async () => {
    const r = await processImageUpload(blob(await image("png", 200, 300)));
    expect(r.ok).toBe(false);
  });

  it("strips EXIF metadata", async () => {
    const withExif = await sharp(await image("jpeg"))
      .withExif({ IFD0: { Copyright: "secret-gps-test", Artist: "someone" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const r = await processImageUpload(blob(withExif));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((await sharp(r.image.data).metadata()).exif).toBeUndefined();
      expect(r.image.data.includes("secret-gps-test")).toBe(false);
    }
  });

  it("drops data appended after the image (polyglot files)", async () => {
    const payload = Buffer.concat([await image("png"), Buffer.from("<script>alert(1)</script>")]);
    const r = await processImageUpload(blob(payload, "image/png"));
    if (r.ok) expect(r.image.data.includes("<script>")).toBe(false);
  });
});
