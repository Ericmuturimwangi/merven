import { describe, expect, it } from "vitest";
import { catalogueRedirects, toNextRedirects } from "@/content/redirects";

describe("catalogue redirects", () => {
  it("the shipped list is valid", () => {
    expect(() => toNextRedirects(catalogueRedirects)).not.toThrow();
  });

  it("produces permanent redirects", () => {
    expect(toNextRedirects([{ from: "/products/old-name", to: "/products/new-name" }])).toEqual([
      { source: "/products/old-name", destination: "/products/new-name", permanent: true },
    ]);
  });

  it.each([
    [[{ from: "products/old", to: "/products/new" }], /Invalid/],
    [[{ from: "/products/old", to: "https://evil.example/x" }], /Invalid/],
    [[{ from: "/products/a", to: "/products/a" }], /itself/],
    [[{ from: "/products/a", to: "/products/b" }, { from: "/products/a", to: "/products/c" }], /Duplicate/],
    [[{ from: "/products/a", to: "/products/b" }, { from: "/products/b", to: "/products/c" }], /chain/],
  ])("rejects unsafe lists %#", (list, err) => {
    expect(() => toNextRedirects(list)).toThrow(err);
  });
});
