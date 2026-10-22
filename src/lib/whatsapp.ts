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
