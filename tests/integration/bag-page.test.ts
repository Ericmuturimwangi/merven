import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasTestDb, makeCategory, makeProduct, resetDb, testPrisma } from "../support/db";

// The /bag page content rendered from the bag cookie against the test database,
// with the real bag actions. Online payment is disabled: the bag and its
// WhatsApp enquiry must work without it and never create orders or payments.

const h0 = vi.hoisted(() => {
  process.env.WHATSAPP_NUMBER = "254720630112";
  return { jar: new Map<string, string>(), paymentCalls: 0 };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (h0.jar.has(name) ? { name, value: h0.jar.get(name)! } : undefined),
    set: (name: string, value: string) => void h0.jar.set(name, value),
    delete: (name: string) => void h0.jar.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ prefetch: async () => {} }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => h("a", { href, ...rest }, children) }));
vi.mock("next/image", () => ({ default: ({ src, alt }: { src: string; alt: string }) => h("img", { src, alt }) }));
vi.mock("@/server/db", async () => ({ db: (await import("../support/db")).testPrisma() }));
vi.mock("@/server/payments/runtime", () => ({
  paymentDeps: async () => (h0.paymentCalls++, null),
  paymentAvailability: async () => ({ available: false, testMode: false }), // payments off: decides only whether Checkout shows
  afterPaymentChange: async () => {},
}));
process.env.PAYMENTS_ENABLED = "false";

const { BagContents } = await import("@/components/cart/bag-contents");
const actions = await import("@/server/cart/actions");
const { BAG_COOKIE, serializeBag } = await import("@/server/cart/bag");
const { initialBagState } = await import("@/server/cart/state");
const { buildCartEnquiryMessage } = await import("@/lib/whatsapp");

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const text = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

describe.skipIf(!hasTestDb)("/bag page", () => {
  const prisma = testPrisma();
  const v = {} as Record<"white" | "black" | "skirt" | "scarce" | "soldOut" | "inactive" | "draft", string>;

  const variant = async (slug: string, colour: string) =>
    (await prisma.productVariant.findFirstOrThrow({ where: { product: { slug }, colour }, select: { id: true } })).id;

  beforeEach(async () => {
    await resetDb(prisma);
    h0.jar.clear();
    h0.paymentCalls = 0;
    const cat = await makeCategory(prisma, "Dresses");
    await makeProduct(prisma, {
      categoryId: cat.id,
      slug: "abeni-dress",
      name: "Abeni Dress",
      priceMinor: 250000,
      variants: [
        { size: "8", colour: "White", stock: 5 },
        { size: "8", colour: "Black", stock: 5, priceMinor: 280000 },
        { size: "10", colour: "Green", stock: 0 },
        { size: "12", colour: "Red", stock: 4, active: false },
      ],
    });
    await makeProduct(prisma, { categoryId: cat.id, slug: "ankara-skirt", name: "Ankara Skirt", priceMinor: 300000, variants: [{ size: "M", colour: "Blue", stock: 8 }] });
    await makeProduct(prisma, { categoryId: cat.id, slug: "scarce-top", name: "Scarce Top", priceMinor: 200000, variants: [{ size: "S", colour: "Gold", stock: 4 }] });
    await makeProduct(prisma, { categoryId: cat.id, slug: "secret-gown", name: "Secret Gown", status: "DRAFT", variants: [{ size: "M", colour: "Silver", stock: 3 }] });
    v.white = await variant("abeni-dress", "White");
    v.black = await variant("abeni-dress", "Black");
    v.soldOut = await variant("abeni-dress", "Green");
    v.inactive = await variant("abeni-dress", "Red");
    v.skirt = await variant("ankara-skirt", "Blue");
    v.scarce = await variant("scarce-top", "Gold");
    v.draft = await variant("secret-gown", "Silver");
  });
  afterAll(() => prisma.$disconnect());

  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, val] of Object.entries(fields)) f.set(k, val);
    return f;
  };
  const add = (variantId: string, quantity = 1) => actions.addToBagAction(initialBagState, form({ variantId, quantity: String(quantity) }));
  const setQuantity = (variantId: string, quantity: number) => actions.updateBagQuantityAction(initialBagState, form({ variantId, quantity: String(quantity) }));
  const remove = (variantId: string) => actions.removeFromBagAction(initialBagState, form({ variantId }));
  const page = async () => renderToStaticMarkup(await BagContents({ headingId: "bag-heading" }));
  const items = (html: string) => [...html.matchAll(/<li class="flex gap-4 py-6">([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  const whatsappText = (html: string) => {
    const href = html.match(/href="(https:\/\/wa\.me\/[^"]+)"/)?.[1];
    return href ? new URL(decode(href)) : null;
  };
  const buttons = (html: string) => [...html.matchAll(/<button[^>]*>[\s\S]*?<\/button>/g)].map((m) => m[0]);
  const button = (html: string, label: string) => buttons(html).find((b) => b.includes(`aria-label="${label}"`) || text(b) === label);

  it("shows an empty bag with a way back to the shop", async () => {
    const html = await page();
    expect(text(html)).toContain("Your bag is empty.");
    expect(html).toContain('href="/shop"');
    expect(html).not.toContain("wa.me");
  });

  it("lists every line with options, current prices, line totals and the subtotal", async () => {
    await add(v.white, 2);
    await add(v.black);
    await add(v.skirt);
    const html = await page();
    const lines = items(html).map(text);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/Abeni Dress KES 5,000 White, size 8 KES 2,500 each/);
    expect(lines[1]).toMatch(/Abeni Dress KES 2,800 Black, size 8 KES 2,800 each/);
    expect(lines[2]).toMatch(/Ankara Skirt KES 3,000 Blue, size M KES 3,000 each/);
    expect(text(html)).toContain("4 items");
    expect(text(html)).toMatch(/Subtotal KES 10,800 Delivery Not included/);
    expect(text(html)).toContain("Delivery is not included. We'll confirm delivery arrangements and charges with you after your enquiry.");
    expect(html).toContain('href="/products/abeni-dress"');
    expect(html).not.toMatch(/checkout/i); // no checkout in this phase
  });

  it("shows a duplicated variant as one line with the combined quantity", async () => {
    h0.jar.set(BAG_COOKIE, `v1.${v.white}_2.${v.white}_1`);
    const lines = items(await page());
    expect(lines).toHaveLength(1);
    expect(text(lines[0])).toContain("KES 7,500");
    expect(text(lines[0])).toContain("Quantity 3");
  });

  it("updates line totals and the subtotal after a quantity change", async () => {
    await add(v.white);
    await add(v.skirt);
    expect(text(await page())).toContain("Subtotal KES 5,500");
    expect(await setQuantity(v.white, 3)).toMatchObject({ ok: true, quantity: 3 });
    const html = await page();
    expect(text(items(html)[0])).toContain("KES 7,500");
    expect(text(html)).toContain("Subtotal KES 10,500");
  });

  it("offers steppers within the limits and names every control", async () => {
    await add(v.white, 5);
    await add(v.skirt);
    const html = await page();
    expect(button(html, "Increase quantity of Abeni Dress")).toContain('disabled=""'); // at the 5-per-line limit
    expect(button(html, "Decrease quantity of Abeni Dress")).not.toContain('disabled=""');
    expect(button(html, "Decrease quantity of Ankara Skirt")).toContain('disabled=""'); // at 1
    expect(button(html, "Increase quantity of Ankara Skirt")).not.toContain('disabled=""');
    expect(button(html, "Remove Ankara Skirt from your bag")).toBeTruthy();
    for (const b of buttons(html)) expect(b).toMatch(/aria-label="[^"]+"|>[^<\s][^<]*</); // every button has a name
    expect(html).toContain('role="group" aria-label="Quantity of Abeni Dress"');
  });

  it("removes a line even after its variant has been deleted", async () => {
    await add(v.white);
    await add(v.skirt);
    await prisma.productVariant.delete({ where: { id: v.skirt } });
    let html = await page();
    expect(text(html)).toContain("Item no longer listed");
    expect(text(html)).toContain("This item is no longer listed.");
    expect(button(html, "Remove this item from your bag")).not.toContain('disabled=""');
    expect(await remove(v.skirt)).toMatchObject({ ok: true, outcome: "removed" });
    html = await page();
    expect(items(html)).toHaveLength(1);
    await remove(v.white);
    expect(text(await page())).toContain("Your bag is empty.");
  });

  it("explains sold-out, unavailable and short-stock lines without removing them", async () => {
    h0.jar.set(BAG_COOKIE, serializeBag([
      { variantId: v.white, quantity: 1, seenUnitPriceMinor: 250000 },
      { variantId: v.scarce, quantity: 4, seenUnitPriceMinor: 200000 },
      { variantId: v.soldOut, quantity: 1, seenUnitPriceMinor: 250000 },
      { variantId: v.inactive, quantity: 2, seenUnitPriceMinor: 250000 },
    ]));
    await prisma.productVariant.update({ where: { id: v.scarce }, data: { stock: 2 } });
    const html = await page();
    const [white, scarce, soldOut, inactive] = items(html);
    expect(text(scarce)).toContain("Only 2 available. Please reduce the quantity.");
    expect(button(scarce, "Change to 2")).not.toContain('disabled=""');
    expect(button(scarce, "Change to 2")).toContain('aria-label="Change to 2: Scarce Top"'); // names the piece
    expect(button(scarce, "Increase quantity of Scarce Top")).toContain('disabled=""');
    expect(text(soldOut)).toContain("Sold out.");
    expect(button(soldOut, "Increase quantity of Abeni Dress")).toContain('disabled=""');
    expect(text(inactive)).toContain("This item is no longer available.");
    expect(inactive).not.toContain('href="/products/'); // no link for something that isn't on sale
    for (const line of [soldOut, inactive]) {
      expect(button(line, "Decrease quantity of Abeni Dress")).toContain('disabled=""');
      expect(button(line, "Remove Abeni Dress from your bag")).not.toContain('disabled=""');
      expect(text(line)).not.toMatch(/KES/); // no price for what can't be bought
    }
    expect(text(white)).toContain("KES 2,500");
    expect(text(html)).toContain("Subtotal KES 2,500"); // only lines that can be bought as they are
    expect(text(html)).toContain("Items marked above aren’t included in the subtotal.");
    expect(items(html)).toHaveLength(4);
  });

  it("states price changes and totals with the current price", async () => {
    await add(v.black, 2);
    await prisma.productVariant.update({ where: { id: v.black }, data: { priceMinor: 310000 } });
    const html = await page();
    expect(text(html)).toContain("The price has changed from KES 2,800 to KES 3,100 since you added this item.");
    expect(text(html)).toContain("Subtotal KES 6,200");
    const ack = button(html, "OK, keep the new price")!;
    expect(ack).toContain('aria-label="OK, keep the new price: Abeni Dress"'); // names the piece
    // It resubmits the same quantity: it records the price as seen, nothing else.
    expect(ack).toBeTruthy();
    const ackForm = html.match(/<form[^>]*>(?:(?!<\/form>)[\s\S])*OK, keep the new price: Abeni Dress[\s\S]*?<\/form>/)![0];
    expect(ackForm).toContain(`name="variantId" value="${v.black}"`);
    expect(ackForm).toContain('name="quantity" value="2"');
    expect(await setQuantity(v.black, 2)).toMatchObject({ ok: true, quantity: 2 });
    const after = await page();
    expect(text(after)).not.toContain("The price has changed");
    expect(text(after)).toContain("Subtotal KES 6,200"); // unchanged: no item added
    expect(await prisma.order.count()).toBe(0);
  });

  it("never describes a draft product from a guessed id", async () => {
    h0.jar.set(BAG_COOKIE, serializeBag([{ variantId: v.draft, quantity: 1, seenUnitPriceMinor: null }, { variantId: v.white, quantity: 1, seenUnitPriceMinor: null }]));
    const html = await page();
    expect(html).not.toMatch(/Secret Gown|secret-gown|Silver/);
    expect(text(items(html)[0])).toContain("This item is no longer available.");
    expect(whatsappText(html)!.searchParams.get("text")).not.toMatch(/Secret|Silver/);
  });

  it("never fails on a malformed, oversized or unknown-version cookie", async () => {
    for (const value of ["garbage", "%E0%A4%A", `v9.${v.white}_1`, `v1.${"a".repeat(5000)}`, "v1..__.x_x"]) {
      h0.jar.set(BAG_COOKIE, value);
      const html = await page();
      expect(text(html)).toContain("Your bag is empty.");
    }
    h0.jar.set(BAG_COOKIE, `v1.${v.white}_1.junk`);
    const html = await page();
    expect(items(html)).toHaveLength(1);
    expect(text(html)).toContain("Some items in your bag couldn’t be restored");
  });

  it("links to a WhatsApp enquiry for the whole bag, encoded, to the configured number", async () => {
    await add(v.white, 2);
    await add(v.skirt);
    await add(v.black);
    await prisma.productVariant.update({ where: { id: v.black }, data: { stock: 0 } });
    const html = await page();
    const url = whatsappText(html)!;
    expect(url.origin + url.pathname).toBe("https://wa.me/254720630112");
    const message = url.searchParams.get("text")!;
    expect(message).toBe(
      buildCartEnquiryMessage(
        [
          { productName: "Abeni Dress", colour: "White", size: "8", quantity: 2, unitPriceMinor: 250000, status: "available", maxQuantity: 5 },
          { productName: "Ankara Skirt", colour: "Blue", size: "M", quantity: 1, unitPriceMinor: 300000, status: "available", maxQuantity: 5 },
          { productName: "Abeni Dress", colour: "Black", size: "8", quantity: 1, unitPriceMinor: null, status: "sold_out", maxQuantity: 0 },
        ],
        800000,
      ),
    );
    expect(message).toContain("Sold out on the website");
    expect(message).toContain("This is an enquiry, not a confirmed order.");
    const link = html.match(/<a href="https:\/\/wa\.me[^>]*>[^<]*<\/a>/)![0];
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
    expect(link).toContain(">Send this bag to us on WhatsApp<");
    expect(link).toContain('aria-describedby="bag-whatsapp-note"');
    expect(html).toContain('id="bag-whatsapp-note"');
  });

  it("offers no enquiry when nothing in the bag can be described", async () => {
    h0.jar.set(BAG_COOKIE, serializeBag([{ variantId: "cmdeletedvariant00", quantity: 1, seenUnitPriceMinor: null }]));
    const html = await page();
    expect(html).not.toContain("wa.me");
    expect(text(html)).toContain("There’s nothing in your bag we can enquire about.");
    expect(html).not.toContain("bag-whatsapp-note");
  });

  it("works with payments disabled and never creates orders or payments", async () => {
    await add(v.white, 2);
    await add(v.skirt);
    await page();
    await setQuantity(v.white, 3);
    await remove(v.skirt);
    const html = await page();
    expect(h0.paymentCalls).toBe(0); // never reaches the order/payment runtime (paymentDeps)
    expect(html).not.toMatch(/checkout/i); // no usable Checkout with payments off
    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.orderItem.count()).toBe(0);
    expect(await prisma.paymentAttempt.count()).toBe(0);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: v.white } })).stock).toBe(5);
    expect(h0.jar.has(BAG_COOKIE)).toBe(true); // nothing clears the bag
  });
});
