import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicVariant } from "@/server/catalogue/repository";
import type { BagActionState } from "@/server/cart/state";

// The bag UI rendered to HTML, without a browser or database. next/link needs
// the app router, so it is replaced by a plain anchor; the bag cookie comes from
// an in-memory jar.

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined) }),
}));
vi.mock("next/cache", () => ({ prefetch: async () => {} }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode; prefetch?: boolean }) => {
    delete rest.prefetch;
    return h("a", { href, ...rest }, children);
  },
}));
vi.mock("@/server/catalogue/queries", () => ({ getCategories: async () => [{ slug: "dresses", name: "Dresses" }] }));

const { BAG_COOKIE, serializeBag } = await import("@/server/cart/bag");
const { BagLink, bagLabel } = await import("@/components/cart/bag-link");
const { BagCount } = await import("@/components/cart/bag-count");
const { bagFeedback, feedbackFor } = await import("@/components/cart/bag-feedback");
const { AddToBag, BagNotice } = await import("@/components/cart/add-to-bag");
const { VariantPicker } = await import("@/components/catalogue/variant-picker");
const { SiteHeader } = await import("@/components/ui/site-header");

const render = (node: ReactNode) => renderToStaticMarkup(node);
const submitButton = (html: string) => html.match(/<button type="submit"[^>]*>[^<]*<\/button>/)?.[0] ?? "";
const anchors = (html: string) => [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0]);
const anchorTo = (html: string, href: string) => anchors(html).filter((a) => a.includes(`href="${href}"`));

beforeEach(() => jar.clear());

describe("bag link", () => {
  it("names the bag with its item count for screen readers", () => {
    expect(bagLabel(null)).toBe("Bag");
    expect(bagLabel(0)).toBe("Bag, empty");
    expect(bagLabel(1)).toBe("Bag, 1 item");
    expect(bagLabel(4)).toBe("Bag, 4 items");
  });

  it("links to the bag and shows the count only when there is something in it", () => {
    expect(render(h(BagLink, { count: 3 }))).toBe('<a href="/bag" aria-label="Bag, 3 items">Bag<span aria-hidden="true" class="ml-1 tabular-nums">(3)</span></a>');
    expect(render(h(BagLink, { count: 0 }))).toBe('<a href="/bag" aria-label="Bag, empty">Bag</a>');
    expect(render(h(BagLink, { count: null }))).toBe('<a href="/bag" aria-label="Bag">Bag</a>');
  });
});

describe("bag count from the cookie", () => {
  const countLabel = async () => render(await BagCount({})).match(/aria-label="([^"]+)"/)?.[1];

  it("counts units across all lines, not distinct lines", async () => {
    jar.set(BAG_COOKIE, serializeBag([
      { variantId: "cmvariant0001", quantity: 2, seenUnitPriceMinor: 380000 },
      { variantId: "cmvariant0002", quantity: 3, seenUnitPriceMinor: null },
    ]));
    expect(await countLabel()).toBe("Bag, 5 items");
  });

  it("shows an empty bag when there is no cookie", async () => {
    expect(await countLabel()).toBe("Bag, empty");
  });

  it("never fails on a malformed, oversized or unknown-version cookie", async () => {
    for (const value of ["garbage", "%E0%A4%A", `v9.cmvariant0001_2`, `v1.${"a".repeat(5000)}`]) {
      jar.set(BAG_COOKIE, value);
      expect(await countLabel()).toBe("Bag, empty");
    }
    jar.set(BAG_COOKIE, "v1.cmvariant0001_2.junk"); // the readable part still counts
    expect(await countLabel()).toBe("Bag, 2 items");
  });
});

describe("add-to-bag feedback", () => {
  const state = (s: Partial<BagActionState>): BagActionState => ({ ok: false, ...s });

  it("says nothing before the server has answered", () => {
    expect(bagFeedback({ ok: false })).toBeNull();
  });

  it("reports a successful add with a way to the bag", () => {
    expect(bagFeedback(state({ ok: true, outcome: "added", message: "Added to your bag." }))).toEqual({ tone: "success", message: "Added to your bag.", viewBag: true });
  });

  it("reports quantity limits as a notice, not an error", () => {
    for (const outcome of ["limited", "at_limit", "bag_full"] as const) {
      expect(bagFeedback(state({ outcome, message: "m" }))).toMatchObject({ tone: "notice", viewBag: true });
    }
  });

  it("reports unavailable choices and failures as errors, without offering the bag", () => {
    for (const outcome of ["sold_out", "unavailable", "not_found", "invalid", "error"] as const) {
      expect(bagFeedback(state({ outcome, message: "m" }))).toMatchObject({ tone: "error", viewBag: false });
    }
  });

  it("drops feedback about a different variant once the selection changes", () => {
    const added = state({ ok: true, outcome: "added", message: "Added to your bag.", variantId: "cmvariant0001" });
    expect(feedbackFor(added, "cmvariant0001")).not.toBeNull();
    expect(feedbackFor(added, "cmvariant0002")).toBeNull();
    expect(feedbackFor(added, null)).toBeNull();
    expect(feedbackFor(state({ outcome: "error", message: "Try again." }), "cmvariant0002")).not.toBeNull();
  });

  it("renders View bag and Continue shopping after an add, and neither after an error", () => {
    const ok = render(h(BagNotice, { feedback: { tone: "success", message: "Added to your bag.", viewBag: true } }));
    expect(ok).toContain("Added to your bag.");
    expect(anchorTo(ok, "/bag")).toHaveLength(1);
    expect(anchorTo(ok, "/shop")).toHaveLength(1);
    expect(ok).toMatch(/>View bag</);
    expect(ok).toMatch(/>Continue shopping</);
    for (const a of anchors(ok)) expect(a).toContain("min-h-11"); // 44px touch targets

    const err = render(h(BagNotice, { feedback: { tone: "error", message: "This size and colour is sold out.", viewBag: false } }));
    expect(err).toContain("sold out");
    expect(anchors(err)).toHaveLength(0);
  });
});

describe("add-to-bag button", () => {
  it("is disabled, and sends no variant, when nothing valid is selected", () => {
    const html = render(h(AddToBag, { variantId: null }));
    expect(submitButton(html)).toContain('disabled=""');
    expect(html).not.toContain('name="variantId"');
  });

  it("sends only the selected variant and a quantity of 1", () => {
    const html = render(h(AddToBag, { variantId: "cmvariant0001", describedBy: "status" }));
    const button = submitButton(html);
    expect(button).not.toContain('disabled=""');
    expect(button).toContain('aria-describedby="status"');
    expect(button).toContain(">Add to bag<");
    const inputs = [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)].map((m) => [m[1], m[2]]);
    expect(inputs).toEqual([["variantId", "cmvariant0001"], ["quantity", "1"]]);
  });

  it("has an always-present live region, empty until the server answers", () => {
    expect(render(h(AddToBag, { variantId: "cmvariant0001" }))).toContain('<div role="status" aria-live="polite"></div>');
  });
});

describe("variant picker", () => {
  const variant = (o: Partial<PublicVariant>): PublicVariant => ({
    id: "cmvariant0001",
    sku: "SKU-1",
    size: "M",
    colour: "White",
    colourHex: null,
    priceMinor: 380000,
    available: true,
    lowStock: false,
    ...o,
  });
  const picker = (variants: PublicVariant[], onlinePayment: { testMode: boolean } | null = null) =>
    render(
      h(VariantPicker, {
        productName: "Tie Dress",
        productUrl: "https://merven.example/products/tie-dress",
        priceFromMinor: 380000,
        priceToMinor: 380000,
        variants,
        whatsappNumber: "254712345678",
        onlinePayment,
      }),
    );
  const whatsapp = (html: string) => anchors(html).find((a) => a.includes("https://wa.me/"))!;

  it("keeps Add to bag disabled until a colour and size are chosen", () => {
    const html = picker([variant({}), variant({ id: "cmvariant0002", size: "L" })]);
    expect(html).toContain("Choose a size.");
    expect(submitButton(html)).toContain('disabled=""');
  });

  it("enables Add to bag for an available single choice, pointing at its status line", () => {
    const html = picker([variant({})]);
    const statusId = html.match(/<p id="([^"]+)"[^>]*aria-live="polite">White, size M: available\.<\/p>/)?.[1];
    expect(statusId).toBeTruthy();
    expect(submitButton(html)).not.toContain('disabled=""');
    expect(submitButton(html)).toContain(`aria-describedby="${statusId}"`);
    expect(html).toContain('name="variantId" value="cmvariant0001"');
  });

  it("disables Add to bag for a sold-out choice", () => {
    const html = picker([variant({ available: false })]);
    expect(submitButton(html)).toContain('disabled=""');
    expect(html).not.toContain('name="variantId"');
  });

  it("keeps the WhatsApp enquiry link and its message unchanged", () => {
    const link = whatsapp(picker([variant({})]));
    const text = "Hello Merven Fashions, I'm interested in Tie Dress.\n\nPrice: KES 3,800\nSize: M\nColour: White\nProduct link: https://merven.example/products/tie-dress\n\nPlease confirm availability and delivery details.";
    expect(link).toContain(`href="https://wa.me/254712345678?text=${encodeURIComponent(text).replace(/'/g, "&#x27;")}"`);
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
    expect(picker([variant({})])).toContain(">Enquire on WhatsApp<");
    expect(picker([variant({ available: false })])).toContain(">Ask about a restock on WhatsApp<");
  });

  it("keeps Buy now unchanged: shown only with online payment and an available choice", () => {
    expect(anchorTo(picker([variant({})], { testMode: true }), "/checkout?items=cmvariant0001:1")).toHaveLength(1);
    expect(picker([variant({})], { testMode: true })).toContain("Buy now and pay online (test mode)");
    expect(picker([variant({})], null)).not.toContain("/checkout");
    expect(picker([variant({ available: false })], { testMode: true })).not.toContain("/checkout");
  });
});

describe("site header", () => {
  it("shows a bag link at every screen size, in its own Suspense boundary", async () => {
    // BagCount suspends here (it is async), so the static fallback renders: what the shared shell holds.
    const html = render(await SiteHeader());
    const bagLinks = anchorTo(html, "/bag");
    expect(bagLinks).toHaveLength(1); // the mobile menu's copy only renders while the menu is open
    expect(bagLinks[0]).toContain('aria-label="Bag"');
    expect(bagLinks[0]).toContain("min-h-11");
    expect(bagLinks[0]).not.toMatch(/\bhidden\b/); // visible on phones as well as desktop
  });
});
