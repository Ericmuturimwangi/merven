const LETTER_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"];

/** Orders sizes naturally: letter sizes by scale, numeric sizes ascending, then anything else. */
export function compareSizes(a: string, b: string): number {
  const rank = (s: string) => {
    const upper = s.toUpperCase();
    const letter = LETTER_ORDER.indexOf(upper);
    if (letter >= 0) return [0, letter] as const;
    const num = Number.parseFloat(s);
    if (Number.isFinite(num)) return [1, num] as const;
    return [2, 0] as const;
  };
  const [ga, va] = rank(a);
  const [gb, vb] = rank(b);
  return ga - gb || va - vb || a.localeCompare(b);
}
