import { describe, expect, it } from "vitest";
import { buildEnquiryMessage, buildWhatsAppUrl, isKenyanMobile, normaliseWhatsAppNumber } from "@/lib/whatsapp";

const enquiry = {
  productName: "Amani Wrap Midi Dress",
  productUrl: "https://merven.example/products/amani-wrap-midi-dress",
  priceMinor: 650000,
  size: "M",
  colour: "Emerald",
  sku: "MRV-001-EME-M",
};

describe("WhatsApp click-to-chat", () => {
  it("builds a wa.me link with the number and an encoded message", () => {
    const url = new URL(buildWhatsAppUrl("254712345678", enquiry));
    expect(url.origin).toBe("https://wa.me");
    expect(url.pathname).toBe("/254712345678");
    const text = url.searchParams.get("text")!;
    expect(text).toContain("Amani Wrap Midi Dress (KES 6,500)");
    expect(text).toContain("Size: M · Colour: Emerald · Ref: MRV-001-EME-M");
    expect(text.endsWith(enquiry.productUrl)).toBe(true);
  });

  it("strips formatting from the phone number", () => {
    expect(normaliseWhatsAppNumber("+254 712-345 678")).toBe("254712345678");
    expect(buildWhatsAppUrl("+254 (712) 345 678", enquiry)).toMatch(/^https:\/\/wa\.me\/254712345678\?text=/);
  });

  it("rejects invalid numbers instead of producing a broken link", () => {
    for (const bad of ["", "abc", "0712", "+254 712 345 678 999 99", "2547123456x8"]) {
      expect(() => buildWhatsAppUrl(bad, enquiry)).toThrow();
    }
  });

  it("encodes characters that would otherwise break the query string", () => {
    const url = buildWhatsAppUrl("254712345678", { ...enquiry, productName: "Silk & Satin #1 ? 100%" });
    expect(url).not.toMatch(/[&#?%]\s/);
    expect(url.split("?")).toHaveLength(2);
    expect(new URL(url).searchParams.get("text")).toContain("Silk & Satin #1 ? 100%");
  });

  it("omits option line when no variant is chosen", () => {
    const msg = buildEnquiryMessage({ ...enquiry, size: null, colour: null, sku: null });
    expect(msg.split("\n")).toHaveLength(2);
  });

  it("recognises Kenyan mobile numbers", () => {
    expect(isKenyanMobile("254712345678")).toBe(true);
    expect(isKenyanMobile("254112345678")).toBe(true);
    expect(isKenyanMobile("2472030112")).toBe(false);
  });
});
