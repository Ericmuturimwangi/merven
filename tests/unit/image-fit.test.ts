import { describe, expect, it } from "vitest";
import { imageFit } from "@/lib/image-fit";

describe("imageFit", () => {
  it("fills the 4:5 frame for portrait-to-square photos (only sides are trimmed)", () => {
    expect(imageFit(1200, 1500)).toBe("cover");
    expect(imageFit(696, 890)).toBe("cover");
    expect(imageFit(907, 888)).toBe("cover");
    expect(imageFit(1000, 1000)).toBe("cover");
  });
  it("shows taller and landscape photos whole, so length is never cut off", () => {
    expect(imageFit(600, 1400)).toBe("contain");
    expect(imageFit(1600, 900)).toBe("contain");
    expect(imageFit(1100, 1000)).toBe("contain");
    expect(imageFit(0, 0)).toBe("contain");
  });
});
