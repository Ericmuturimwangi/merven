import { formatKES } from "./money";

export type WhatsAppEnquiry = {
  productName: string;
  productUrl: string;
  priceMinor: number;
  size?: string | null;
  colour?: string | null;
  sku?: string | null;
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

export function buildEnquiryMessage(e: WhatsAppEnquiry): string {
  const lines = [`Hello Merven Fashions, I'd like to ask about the ${e.productName} (${formatKES(e.priceMinor)}).`];
  const options = [e.size && `Size: ${e.size}`, e.colour && `Colour: ${e.colour}`, e.sku && `Ref: ${e.sku}`].filter(Boolean);
  if (options.length) lines.push(options.join(" · "));
  lines.push(e.productUrl);
  return lines.join("\n");
}

/**
 * Builds a click-to-chat link. This only opens WhatsApp with a prefilled message;
 * it never sends anything on the customer's behalf.
 */
export function buildWhatsAppUrl(phone: string, enquiry: WhatsAppEnquiry): string {
  const number = normaliseWhatsAppNumber(phone);
  return `https://wa.me/${number}?text=${encodeURIComponent(buildEnquiryMessage(enquiry))}`;
}
