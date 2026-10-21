// Prices are stored as integer minor units (1 KES = 100 minor units).

export const CURRENCY = "KES" as const;
const MINOR_PER_MAJOR = 100;

const formatter = new Intl.NumberFormat("en-KE", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** 450000 -> "KES 4,500"; 450050 -> "KES 4,500.50" (fractions always show 2 dp). */
export function formatKES(minor: number): string {
  if (!Number.isSafeInteger(minor)) throw new TypeError("Price must be an integer number of minor units");
  const major = minor / MINOR_PER_MAJOR;
  const text =
    minor % MINOR_PER_MAJOR === 0
      ? formatter.format(major)
      : new Intl.NumberFormat("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(major);
  return `${CURRENCY} ${text}`;
}

/**
 * Parses admin input such as "4500", "4,500", "4500.50" or "KES 4,500" into minor units.
 * Returns null for anything that isn't a non-negative amount with at most 2 decimals.
 */
export function parseKESToMinor(input: string): number | null {
  const cleaned = input.trim().replace(/^kes\s*/i, "").replace(/,/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * MINOR_PER_MAJOR + Number(fraction.padEnd(2, "0"));
}

/** Minor units -> plain decimal string for form fields, e.g. 450000 -> "4500". */
export function minorToInput(minor: number): string {
  const whole = Math.trunc(minor / MINOR_PER_MAJOR);
  const fraction = minor % MINOR_PER_MAJOR;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, "0")}`;
}
