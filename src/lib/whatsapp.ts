import { formatKES } from "./money";

export type WhatsAppEnquiry = {
  productName: string;
  productUrl: string;
  priceMinor: number;
  /** True when no variant is chosen and prices differ between variants. */
  priceIsFrom?: boolean;
  size?: string | null;
  colour?: string | null;
};

/** Digits only, 8–15 long (E.164 without "+"). Accepts "+254 712 345 678" style input. */
export function normaliseWhatsAppNumber(raw: string): string {
  const digits = raw.replace(/[\s()+-]/g, "");
  if (!/^\d{8,15}$/.test(digits)) {
    throw new Error("WhatsApp number must be 8–15 digits in international format");
  }
  return digits;
}

/** True for Kenyan mobile numbers in international form (2547XXXXXXXX / 2541XXXXXXXX). */
export function isKenyanMobile(digits: string): boolean {
  return /^254[17]\d{8}$/.test(digits);
}

const NOT_SELECTED = "not selected yet";

/**
 * Prefilled enquiry text. Unchosen options are stated explicitly rather than
 * left out, so the boutique never has to guess which size or colour was meant.
 */
export function buildEnquiryMessage(e: WhatsAppEnquiry): string {
  return [
    `Hello Merven Fashions, I'm interested in ${e.productName}.`,
    "",
    `Price: ${e.priceIsFrom ? "from " : ""}${formatKES(e.priceMinor)}`,
    `Size: ${e.size?.trim() || NOT_SELECTED}`,
    `Colour: ${e.colour?.trim() || NOT_SELECTED}`,
    `Product link: ${e.productUrl}`,
    "",
    "Please confirm availability and delivery details.",
  ].join("\n");
}

/**
 * Builds a click-to-chat link. This only opens WhatsApp with a prefilled message;
 * it never sends anything on the customer's behalf.
 */
export function buildWhatsAppUrl(phone: string, enquiry: WhatsAppEnquiry): string {
  const number = normaliseWhatsAppNumber(phone);
  return `https://wa.me/${number}?text=${encodeURIComponent(buildEnquiryMessage(enquiry))}`;
}

/** One bag line as the customer sees it. Prices come from the server, never from the browser. */
export type CartEnquiryLine = {
  /** Null when the piece can't be described (e.g. it is no longer listed): such lines are left out. */
  productName: string | null;
  colour: string | null;
  size: string | null;
  quantity: number;
  /** Current unit price, or null when the piece can't be bought. */
  unitPriceMinor: number | null;
  status: "available" | "insufficient_stock" | "sold_out" | "unavailable" | "not_found";
  /** How many can be bought now (for "only N available"). */
  maxQuantity: number;
};

const LINE_NOTE: Partial<Record<CartEnquiryLine["status"], string>> = {
  sold_out: "Sold out on the website. Could you tell me if it will be restocked?",
  unavailable: "No longer available on the website.",
};

/**
 * Prefilled enquiry for a whole bag. It lists each piece with the price shown
 * on the website, marks anything that can't be bought as it is, and says
 * plainly that delivery isn't included and that this is not an order.
 * Returns null when no line can be described.
 */
export function buildCartEnquiryMessage(lines: CartEnquiryLine[], subtotalMinor: number): string | null {
  const described = lines.filter((l): l is CartEnquiryLine & { productName: string } => !!l.productName?.trim());
  if (described.length === 0) return null;

  const items = described.map((l, i) => {
    const options = [l.colour?.trim(), l.size?.trim() ? `size ${l.size.trim()}` : null].filter(Boolean).join(", ");
    const out = [`${i + 1}. ${l.productName.trim()}${options ? ` — ${options}` : ""}`, `   Quantity: ${l.quantity}`];
    if (l.status === "available" && l.unitPriceMinor != null) {
      out.push(`   Unit price: ${formatKES(l.unitPriceMinor)}`, `   Line total: ${formatKES(l.unitPriceMinor * l.quantity)}`);
    } else if (l.status === "insufficient_stock" && l.unitPriceMinor != null) {
      out.push(`   Unit price: ${formatKES(l.unitPriceMinor)}`, `   Only ${l.maxQuantity} available on the website.`);
    } else {
      out.push(`   ${LINE_NOTE[l.status] ?? "No longer available on the website."}`);
    }
    return out.join("\n");
  });

  const partial = described.some((l) => l.status !== "available");
  return [
    "Hello Merven Fashions, I'd like to enquire about the items in my bag.",
    "",
    items.join("\n\n"),
    "",
    `${partial ? "Subtotal (items available as listed)" : "Subtotal"}: ${formatKES(subtotalMinor)}`,
    "Delivery: Not included; to be confirmed.",
    "",
    "Please confirm item availability, delivery charges and payment options.",
    "This is an enquiry, not a confirmed order.",
  ].join("\n");
}

/** Click-to-chat link for a whole bag, or null when there is nothing to enquire about. */
export function buildCartWhatsAppUrl(phone: string, lines: CartEnquiryLine[], subtotalMinor: number): string | null {
  const message = buildCartEnquiryMessage(lines, subtotalMinor);
  return message ? `https://wa.me/${normaliseWhatsAppNumber(phone)}?text=${encodeURIComponent(message)}` : null;
}

/** "254720630112" -> "+254 720 630 112" for display; other countries get "+" and digits. */
export function formatWhatsAppNumber(phone: string): string {
  const n = normaliseWhatsAppNumber(phone);
  const ke = n.match(/^(254)(\d{3})(\d{3})(\d{3})$/);
  return ke ? `+${ke[1]} ${ke[2]} ${ke[3]} ${ke[4]}` : `+${n}`;
}

/** A general (not product-specific) chat link for the footer and help pages. */
export function buildContactWhatsAppUrl(phone: string): string {
  const text = "Hello Merven Fashions, I have a question.";
  return `https://wa.me/${normaliseWhatsAppNumber(phone)}?text=${encodeURIComponent(text)}`;
}
