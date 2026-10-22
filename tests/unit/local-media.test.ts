import path from "node:path";
import { describe, expect, it } from "vitest";
import { localUploadRoot, resolveLocalKey } from "@/server/images/storage";

describe("local media path safety", () => {
  it("resolves generated keys inside the upload root", () => {
    const full = resolveLocalKey("products/0f8b6f8e-1d2c-4b3a-9e8f-7a6b5c4d3e2f.webp");
    expect(full).toBe(path.join(localUploadRoot(), "products/0f8b6f8e-1d2c-4b3a-9e8f-7a6b5c4d3e2f.webp"));
  });

  it.each([
    "../.env",
    "products/../../.env",
    "products/0f8b6f8e-1d2c-4b3a-9e8f-7a6b5c4d3e2f.webp/../../x",
    "/etc/passwd",
    "products/x.webp",
    "products/0f8b6f8e-1d2c-4b3a-9e8f-7a6b5c4d3e2f.png",
    "placeholder:amani-1",
    "",
  ])("refuses %j", (key) => {
    expect(resolveLocalKey(key)).toBeNull();
  });
});
