import { describe, expect, it } from "vitest";
import {
  buildContactWhatsAppUrl,
  buildEnquiryMessage,
  buildWhatsAppUrl,
  formatWhatsAppNumber,
  isKenyanMobile,
  normaliseWhatsAppNumber,
} from "@/lib/whatsapp";

const enquiry = {
  productName: "Polka Dot Tie-Waist Dress",
  productUrl: "https://merven.example/products/polka-dot",
  priceMinor: 380000,
  size: "M",
  colour: "White",
};

describe("WhatsApp enquiry message", () => {
  it("uses the boutique's message structure with the selected options", () => {
    expect(buildEnquiryMessage(enquiry)).toBe(
      [
        "Hello Merven Fashions, I'm interested in Polka Dot Tie-Waist Dress.",
        "",
        "Price: KES 3,800",
        "Size: M",
        "Colour: White",
        "Product link: https://merven.example/products/polka-dot",
        "",
        "Please confirm availability and delivery details.",
      ].join("\n"),
    );
  });

  it("states explicitly when a size or colour hasn't been chosen", () => {
    const msg = buildEnquiryMessage({ ...enquiry, size: null, colour: "  " });
    expect(msg).toContain("Size: not selected yet");
    expect(msg).toContain("Colour: not selected yet");
    expect(msg).not.toMatch(/\[|\]|undefined|null/);
  });

  it("marks a price range as a starting price", () => {
    expect(buildEnquiryMessage({ ...enquiry, priceIsFrom: true })).toContain("Price: from KES 3,800");
  });

  it("never claims the enquiry is an order", () => {
    expect(buildEnquiryMessage(enquiry).toLowerCase()).not.toMatch(/order (is )?confirmed|your order/);
  });
});

describe("WhatsApp click-to-chat URL", () => {
  it("builds a wa.me link with the number and the encoded message", () => {
    const url = new URL(buildWhatsAppUrl("254720630112", enquiry));
    expect(url.origin).toBe("https://wa.me");
    expect(url.pathname).toBe("/254720630112");
    expect(url.searchParams.get("text")).toBe(buildEnquiryMessage(enquiry));
  });

  it("strips formatting from the phone number", () => {
    expect(normaliseWhatsAppNumber("+254 720-630 112")).toBe("254720630112");
    expect(buildWhatsAppUrl("+254 (720) 630 112", enquiry)).toMatch(/^https:\/\/wa\.me\/254720630112\?text=/);
  });

  it("rejects invalid numbers instead of producing a broken link", () => {
    for (const bad of ["", "abc", "0712", "+254 712 345 678 999 99", "2547123456x8"]) {
      expect(() => buildWhatsAppUrl(bad, enquiry)).toThrow();
    }
  });

  it("encodes characters that would otherwise break the query string", () => {
    const url = buildWhatsAppUrl("254720630112", { ...enquiry, productName: "Silk & Satin #1 ? 100%" });
    expect(url.split("?")).toHaveLength(2);
    expect(url).not.toContain("\n");
    expect(new URL(url).searchParams.get("text")).toContain("Silk & Satin #1 ? 100%");
  });

  it("recognises Kenyan mobile numbers", () => {
    expect(isKenyanMobile("254720630112")).toBe(true);
    expect(isKenyanMobile("254112345678")).toBe(true);
    expect(isKenyanMobile("2472030112")).toBe(false);
  });
});

describe("contact helpers", () => {
  it("formats the configured number for display", () => {
    expect(formatWhatsAppNumber("254720630112")).toBe("+254 720 630 112");
    expect(formatWhatsAppNumber("447700900123")).toBe("+447700900123");
  });
  it("builds a general chat link to the same number", () => {
    const url = new URL(buildContactWhatsAppUrl("254720630112"));
    expect(url.pathname).toBe("/254720630112");
    expect(url.searchParams.get("text")).toBe("Hello Merven Fashions, I have a question.");
  });
});
