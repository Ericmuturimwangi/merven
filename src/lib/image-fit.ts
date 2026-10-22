/** Portrait frame used for product imagery across the storefront. */
export const PRODUCT_FRAME_RATIO = 4 / 5;

/**
 * How a photo sits in a fixed 4:5 frame (cards, hero, category tiles).
 *
 * Photos from about 4:5 up to square fill the frame: only the sides are
 * trimmed, so the garment's full length is always kept. Taller or landscape
 * photos are shown whole, because filling would cut off length or most of the
 * picture.
 */
export function imageFit(width: number, height: number, frameRatio = PRODUCT_FRAME_RATIO): "cover" | "contain" {
  if (!width || !height) return "contain";
  const ratio = width / height;
  return ratio >= frameRatio * 0.92 && ratio <= 1.05 ? "cover" : "contain";
}
