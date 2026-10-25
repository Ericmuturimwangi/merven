import { describe, expect, it } from "vitest";
import { photoIndexForColour } from "@/components/catalogue/product-colour";

describe("photoIndexForColour", () => {
  const photos = [{ colour: null }, { colour: "Purple" }, { colour: "Orange" }, { colour: "Orange" }];

  it("finds the first photo of the chosen colour", () => {
    expect(photoIndexForColour(photos, "Orange")).toBe(2);
    expect(photoIndexForColour(photos, "Purple")).toBe(1);
  });

  it("keeps the current photo when no colour is chosen or none is tagged with it", () => {
    expect(photoIndexForColour(photos, null)).toBeNull();
    expect(photoIndexForColour(photos, "Red")).toBeNull();
    expect(photoIndexForColour([], "Orange")).toBeNull();
  });

  it("matches colour names exactly, as the variants spell them", () => {
    expect(photoIndexForColour(photos, "orange")).toBeNull();
  });
});
