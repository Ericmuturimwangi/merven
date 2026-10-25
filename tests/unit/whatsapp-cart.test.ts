import { describe, expect, it } from "vitest";
import { buildCartEnquiryMessage, buildCartWhatsAppUrl, buildEnquiryMessage, type CartEnquiryLine } from "@/lib/whatsapp";

const line = (o: Partial<CartEnquiryLine>): CartEnquiryLine => ({
  productName: "Abeni Organza Sleeve Dress",
  colour: "Black",
  size: "8",
  quantity: 1,
  unitPriceMinor: 1120000,
  status: "available",
  maxQuantity: 5,
  ...o,
});

describe("bag enquiry message", () => {
  it("lists every piece with options, quantity, unit price and line total", () => {
    const msg = buildCartEnquiryMessage(
      [line({ quantity: 2, unitPriceMinor: 250000 }), line({ productName: "Ankara Wrap Skirt", colour: "Blue", size: "M", unitPriceMinor: 300000 })],
      800000,
    );
    expect(msg).toBe(
      [
        "Hello Merven Fashions, I'd like to enquire about the items in my bag.",
        "",
        "1. Abeni Organza Sleeve Dress — Black, size 8",
        "   Quantity: 2",
        "   Unit price: KES 2,500",
        "   Line total: KES 5,000",
        "",
        "2. Ankara Wrap Skirt — Blue, size M",
        "   Quantity: 1",
        "   Unit price: KES 3,000",
        "   Line total: KES 3,000",
        "",
        "Subtotal: KES 8,000",
        "Delivery: Not included; to be confirmed.",
        "",
        "Please confirm item availability, delivery charges and payment options.",
        "This is an enquiry, not a confirmed order.",
      ].join("\n"),
    );
  });

  it("formats prices like the rest of the shop, including cents", () => {
    expect(buildCartEnquiryMessage([line({ unitPriceMinor: 450050, quantity: 3 })], 1350150)).toContain("Unit price: KES 4,500.50\n   Line total: KES 13,501.50");
  });

  it("marks pieces that can't be bought as they are, without pricing them as available", () => {
    const msg = buildCartEnquiryMessage(
      [
        line({}),
        line({ productName: "Sold Dress", status: "sold_out", unitPriceMinor: null, maxQuantity: 0 }),
        line({ productName: "Old Dress", status: "unavailable", unitPriceMinor: null, maxQuantity: 0 }),
        line({ productName: "Scarce Top", status: "insufficient_stock", quantity: 4, unitPriceMinor: 200000, maxQuantity: 2 }),
      ],
      1120000,
    )!;
    expect(msg).toContain("2. Sold Dress — Black, size 8\n   Quantity: 1\n   Sold out on the website. Could you tell me if it will be restocked?");
    expect(msg).toContain("3. Old Dress — Black, size 8\n   Quantity: 1\n   No longer available on the website.");
    expect(msg).toContain("4. Scarce Top — Black, size 8\n   Quantity: 4\n   Unit price: KES 2,000\n   Only 2 available on the website.");
    expect(msg.match(/Line total/g)).toHaveLength(1); // only the available piece
    expect(msg).toContain("Subtotal (items available as listed): KES 11,200");
  });

  it("leaves out pieces that can't be described (deleted or never listed)", () => {
    const msg = buildCartEnquiryMessage([line({ productName: null, colour: null, size: null, status: "not_found", unitPriceMinor: null, maxQuantity: 0 }), line({})], 1120000)!;
    expect(msg).toContain("1. Abeni Organza Sleeve Dress");
    expect(msg).not.toContain("2.");
    expect(msg).not.toMatch(/null|undefined/);
  });

  it("returns nothing for an empty bag or one with nothing describable", () => {
    expect(buildCartEnquiryMessage([], 0)).toBeNull();
    expect(buildCartEnquiryMessage([line({ productName: null, status: "not_found" }), line({ productName: "  " })], 0)).toBeNull();
    expect(buildCartWhatsAppUrl("254720630112", [], 0)).toBeNull();
  });

  it("always says delivery is excluded and that this is not an order", () => {
    const msg = buildCartEnquiryMessage([line({})], 1120000)!;
    expect(msg).toContain("Delivery: Not included; to be confirmed.");
    expect(msg).toContain("This is an enquiry, not a confirmed order.");
    expect(msg.toLowerCase()).not.toMatch(/order (is )?confirmed|your order|paid/);
  });
});

describe("bag WhatsApp link", () => {
  it("encodes the whole message for the configured number", () => {
    const lines = [line({ productName: "Silk & Satin #1 ? 100% <b>", quantity: 2 })];
    const url = buildCartWhatsAppUrl("+254 720 630 112", lines, 2240000)!;
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://wa.me");
    expect(parsed.pathname).toBe("/254720630112");
    expect([...parsed.searchParams.keys()]).toEqual(["text"]);
    expect(parsed.searchParams.get("text")).toBe(buildCartEnquiryMessage(lines, 2240000));
    expect(url).not.toMatch(/[\n <>]/);
    expect(url.split("?")).toHaveLength(2);
  });

  it("rejects an invalid number instead of producing a broken link", () => {
    expect(() => buildCartWhatsAppUrl("0712", [line({})], 1120000)).toThrow();
  });

  it("leaves the single-product enquiry unchanged", () => {
    expect(buildEnquiryMessage({ productName: "Tie Dress", productUrl: "https://merven.example/products/tie-dress", priceMinor: 380000, size: "M", colour: "White" })).toBe(
      "Hello Merven Fashions, I'm interested in Tie Dress.\n\nPrice: KES 3,800\nSize: M\nColour: White\nProduct link: https://merven.example/products/tie-dress\n\nPlease confirm availability and delivery details.",
    );
  });
});
