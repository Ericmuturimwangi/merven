import { createHmac } from "node:crypto";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakePaystack, testPaymentConfig } from "../support/fake-paystack";
import { hasTestDb, makeCategory, makeProduct, resetDb, testPrisma } from "../support/db";

// Bag checkout end to end against the test database: the review, the real
// checkout action, the Paystack callback route, the webhook handler and bag
// settlement. Paystack is the in-memory fake; any real network call fails the test.

const h0 = vi.hoisted(() => {
  process.env.BETTER_AUTH_SECRET ??= "x".repeat(40);
  process.env.WHATSAPP_NUMBER = "254720630112";
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  return { jar: new Map<string, string>(), enabled: true, ps: null as null | ReturnType<typeof import("../support/fake-paystack").fakePaystack>, ip: "198.51.100.1" };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (h0.jar.has(name) ? { name, value: h0.jar.get(name)! } : undefined),
    set: (name: string, value: string) => void h0.jar.set(name, value),
    delete: (name: string) => void h0.jar.delete(name),
  }),
  headers: async () => new Headers({ "x-forwarded-for": h0.ip }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
  useRouter: () => ({ refresh: () => {}, replace: () => {} }), // client components rendered in the review
}));
vi.mock("next/cache", () => ({ updateTag: () => {}, refresh: () => {}, revalidateTag: () => {}, cacheTag: () => {}, cacheLife: () => {}, prefetch: async () => {} }));
vi.mock("next/server", () => ({ after: () => {}, connection: async () => {} }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => h("a", { href, ...rest }, children) }));
vi.mock("next/image", () => ({ default: ({ src, alt }: { src: string; alt: string }) => h("img", { src, alt }) }));
vi.mock("@/server/db", async () => ({ db: (await import("../support/db")).testPrisma() }));
vi.mock("@/server/payments/runtime", async () => {
  const { testPrisma } = await import("../support/db");
  const deps = async () => (h0.enabled && h0.ps ? { prisma: testPrisma(), paystack: h0.ps.client, config: testPaymentConfig } : null);
  return {
    paymentDeps: deps,
    paymentAvailability: async () => ({ available: Boolean(await deps()), testMode: true }),
    afterPaymentChange: async () => {},
  };
});

const checkout = await import("@/server/checkout/actions");
const cart = await import("@/server/cart/actions");
const { settleBagAction } = await import("@/server/cart/settle-action");
const { CheckoutContent } = await import("@/components/checkout/checkout-content");
const { BagContents } = await import("@/components/cart/bag-contents");
const callback = await import("@/app/checkout/callback/route");
const { handlePaystackWebhook } = await import("@/server/payments/webhook");
const { BAG_COOKIE, parseBag, serializeBag } = await import("@/server/cart/bag");
const { CHECKOUT_COOKIE, parseCheckoutLink, encodeCheckoutLink } = await import("@/server/cart/checkout-link");
const { orderAccessToken } = await import("@/server/orders/access");
const { initialBagState } = await import("@/server/cart/state");

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const text = (html: string) => decode(html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

describe.skipIf(!hasTestDb)("bag checkout", () => {
  const prisma = testPrisma();
  const v = {} as Record<"white" | "black" | "skirt" | "draft", string>;
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  beforeEach(async () => {
    await resetDb(prisma);
    h0.jar.clear();
    h0.enabled = true;
    h0.ps = fakePaystack();
    h0.ip = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
    fetchSpy.mockClear();
    const cat = await makeCategory(prisma, "Dresses");
    await makeProduct(prisma, {
      categoryId: cat.id,
      slug: "abeni-dress",
      name: "Abeni Dress",
      priceMinor: 250000,
      variants: [
        { size: "8", colour: "White", stock: 5 },
        { size: "8", colour: "Black", stock: 5 },
      ],
    });
    await makeProduct(prisma, { categoryId: cat.id, slug: "ankara-skirt", name: "Ankara Skirt", priceMinor: 300000, variants: [{ size: "M", colour: "Blue", stock: 4 }] });
    await makeProduct(prisma, { categoryId: cat.id, slug: "secret-gown", name: "Secret Gown", status: "DRAFT", variants: [{ size: "M", colour: "Silver", stock: 3 }] });
    const id = async (colour: string) => (await prisma.productVariant.findFirstOrThrow({ where: { colour } })).id;
    v.white = await id("White");
    v.black = await id("Black");
    v.skirt = await id("Blue");
    v.draft = await id("Silver");
  });
  afterEach(() => expect(fetchSpy).not.toHaveBeenCalled()); // never a real provider call
  afterAll(() => prisma.$disconnect());

  // --- helpers ---------------------------------------------------------------------
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, val] of Object.entries(fields)) f.set(k, val);
    return f;
  };
  const add = (variantId: string, quantity = 1) => cart.addToBagAction(initialBagState, form({ variantId, quantity: String(quantity) }));
  const setQuantity = (variantId: string, quantity: number) => cart.updateBagQuantityAction(initialBagState, form({ variantId, quantity: String(quantity) }));
  const bag = () => parseBag(h0.jar.get(BAG_COOKIE)).lines.map((l) => [l.variantId, l.quantity]);
  const review = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await CheckoutContent({ searchParams: Promise.resolve(sp) }));
  const bagPage = async () => renderToStaticMarkup(await BagContents({ headingId: "h" }));
  const hidden = (html: string) => Object.fromEntries([...html.matchAll(/<input type="hidden" name="(items|expectedTotalMinor|source)" value="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const details = { name: "Amina Otieno", email: "amina@example.com", phone: "0712345678" };
  /** Submits what the rendered review would; returns the redirect URL or the refused state. */
  async function submit(fields: Record<string, string>) {
    try {
      return { state: await checkout.startCheckoutAction({ ok: false }, form({ ...details, ...fields })) };
    } catch (e) {
      const url = (e as { url?: string }).url;
      if (!url) throw e;
      return { url };
    }
  }
  const orders = () => prisma.order.findMany({ include: { items: true, payments: true }, orderBy: { createdAt: "asc" } });
  const linked = () => parseCheckoutLink(h0.jar.get(CHECKOUT_COOKIE));
  async function startBagCheckout() {
    const fields = hidden(await review());
    const res = await submit(fields);
    const [order] = (await orders()).slice(-1);
    return { fields, res, order, attempt: order?.payments[0] };
  }
  async function callbackFor(reference: string) {
    const res = await callback.GET(new Request(`http://localhost:3000/checkout/callback?reference=${reference}`));
    return res.headers.get("location");
  }

  // --- entry -----------------------------------------------------------------------
  describe("entry", () => {
    it("reviews the bag's own variants and quantities, with Edit bag instead of quantity menus", async () => {
      await add(v.white, 2);
      await add(v.skirt);
      const html = await review();
      expect(hidden(html)).toEqual({ items: `${v.white}:2,${v.skirt}:1`, expectedTotalMinor: "800000", source: "bag" });
      expect(text(html)).toContain("Qty 2");
      expect(text(html)).toContain("To pay now KES 8,000");
      expect(html).not.toContain("<select");
      expect(html).toMatch(/<a href="\/bag"[^>]*>Edit bag<\/a>/);
    });

    it("blocks checkout and sends the customer to the bag when a line can't be bought as it is", async () => {
      await add(v.white, 3);
      await add(v.skirt);
      const blocked = async () => {
        const html = await review();
        expect(text(html)).toContain("Some pieces in your bag can’t be ordered as they are");
        expect(html).toMatch(/<a href="\/bag"[^>]*>Review your bag<\/a>/);
        expect(html).not.toContain('name="items"');
      };
      await prisma.productVariant.update({ where: { id: v.white }, data: { stock: 2 } }); // short
      await blocked();
      await prisma.productVariant.update({ where: { id: v.white }, data: { stock: 0 } }); // sold out
      await blocked();
      await prisma.productVariant.update({ where: { id: v.white }, data: { stock: 5, active: false } }); // unavailable
      await blocked();
      await prisma.productVariant.update({ where: { id: v.white }, data: { active: true } });
      h0.jar.set(BAG_COOKIE, serializeBag([...parseBag(h0.jar.get(BAG_COOKIE)).lines, { variantId: "cmdeletedvariant00", quantity: 1, seenUnitPriceMinor: null }]));
      await blocked(); // unknown: never silently dropped
      h0.jar.set(BAG_COOKIE, serializeBag([{ variantId: v.draft, quantity: 1, seenUnitPriceMinor: null }]));
      await blocked();
      expect(await prisma.order.count()).toBe(0);
    });

    it("offers Checkout on /bag only when payment is available and every line is ready", async () => {
      await add(v.white);
      expect(await bagPage()).toMatch(/<a href="\/checkout"[^>]*>Go to checkout \(test mode\)<\/a>/);
      await prisma.productVariant.update({ where: { id: v.white }, data: { stock: 0 } });
      let html = await bagPage();
      expect(html).not.toContain('href="/checkout"');
      expect(text(html)).toContain("To pay online, first resolve the items marked above.");
      await prisma.productVariant.update({ where: { id: v.white }, data: { stock: 5 } });
      h0.enabled = false;
      html = await bagPage();
      expect(html).not.toMatch(/checkout/i);
    });

    it("refuses on the server when payments are off, whatever the page showed", async () => {
      await add(v.white);
      const fields = hidden(await review());
      h0.enabled = false;
      expect(text(await review())).toContain("Online payment isn’t available yet.");
      const res = await submit(fields);
      expect(res.state).toMatchObject({ ok: false, message: expect.stringContaining("isn't available") });
      expect(await prisma.order.count()).toBe(0);
      expect(h0.jar.has(CHECKOUT_COOKIE)).toBe(false);
    });

    it("keeps Buy now unchanged: URL basket, quantity menu, no bag link, bag untouched", async () => {
      await add(v.skirt);
      const before = h0.jar.get(BAG_COOKIE);
      const html = await review({ items: `${v.white}:1` });
      expect(html).toContain("<select");
      expect(hidden(html)).toEqual({ items: `${v.white}:1`, expectedTotalMinor: "250000" }); // no source
      const res = await submit(hidden(html));
      expect(res.url).toMatch(/^https:\/\/checkout\.paystack\.com\//);
      expect((await orders())[0].items.map((i) => [i.variantId, i.quantity])).toEqual([[v.white, 1]]);
      expect(h0.jar.has(CHECKOUT_COOKIE)).toBe(false);
      expect(h0.jar.get(BAG_COOKIE)).toBe(before);
    });

    it("can't be tampered into a different, cheaper or unavailable order", async () => {
      await add(v.white, 2);
      const fields = hidden(await review());
      // A basket that isn't the bag (changed in the form) is refused before any order exists.
      expect((await submit({ ...fields, items: `${v.white}:1` })).state).toMatchObject({ reviewAgain: true, message: expect.stringContaining("bag changed") });
      expect((await submit({ ...fields, items: `${v.draft}:2` })).state).toMatchObject({ reviewAgain: true });
      // A lower total is the server's to reject.
      expect((await submit({ ...fields, expectedTotalMinor: "100" })).state).toMatchObject({ reviewAgain: true, message: expect.stringContaining("price changed") });
      // A drafted product in both the bag cookie and the form still can't be ordered.
      h0.jar.set(BAG_COOKIE, serializeBag([{ variantId: v.draft, quantity: 1, seenUnitPriceMinor: null }]));
      expect((await submit({ items: `${v.draft}:1`, expectedTotalMinor: "500000", source: "bag" })).state).toMatchObject({ reviewAgain: true });
      expect(await prisma.order.count()).toBe(0);
    });

    it("rejects a submission whose price changed after review", async () => {
      await add(v.white);
      const fields = hidden(await review());
      await prisma.product.update({ where: { slug: "abeni-dress" }, data: { priceMinor: 260000 } });
      expect((await submit(fields)).state).toMatchObject({ reviewAgain: true, message: expect.stringContaining("price changed") });
      expect(await prisma.order.count()).toBe(0);
    });
  });

  // --- duplicates ------------------------------------------------------------------
  describe("duplicate submissions", () => {
    it("returns a resubmitted bag to its unpaid order instead of creating another", async () => {
      await add(v.white, 2);
      await add(v.skirt);
      const first = await startBagCheckout();
      expect(first.res.url).toMatch(/^https:\/\/checkout\.paystack\.com\//);
      expect(linked()).toBe(first.order.reference);
      // Back from Paystack and submit again (same form), or a refresh that resubmits.
      const again = await submit(first.fields);
      expect(again.url).toBe(`/checkout/order/${first.order.reference}?token=${orderAccessToken(first.order.reference)}`);
      expect(await prisma.order.count()).toBe(1);
      expect(await prisma.paymentAttempt.count()).toBe(1);
      expect(h0.ps!.initialized).toHaveLength(1);
      // The review itself now points to that order rather than offering a new payment.
      const html = await review();
      expect(text(html)).toContain(`already started checkout for this bag (order ${first.order.reference})`);
      expect(html).not.toContain('name="items"');
    });

    it("never attaches a changed bag to the old order", async () => {
      await add(v.white);
      const first = await startBagCheckout();
      await add(v.skirt);
      const second = await startBagCheckout();
      expect(second.res.url).toMatch(/^https:\/\/checkout\.paystack\.com\//);
      expect(second.order.reference).not.toBe(first.order.reference);
      expect(second.order.items.map((i) => [i.variantId, i.quantity]).sort()).toEqual([[v.white, 1], [v.skirt, 1]].sort());
      expect(linked()).toBe(second.order.reference);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: first.order.id } })).status).toBe("PENDING_PAYMENT"); // untouched
    });

    it("ignores forged and mismatched links", async () => {
      await add(v.white);
      const first = await startBagCheckout();
      for (const forged of [`${first.order.reference}.${"A".repeat(32)}`, "garbage", `${first.order.reference}`]) {
        h0.jar.set(CHECKOUT_COOKIE, forged);
        expect(text(await review())).not.toContain("already started checkout");
      }
      // A genuine link to an order with different items is not reused.
      h0.jar.set(BAG_COOKIE, serializeBag([{ variantId: v.skirt, quantity: 1, seenUnitPriceMinor: null }]));
      h0.jar.set(CHECKOUT_COOKIE, encodeCheckoutLink(first.order.reference));
      const res = await submit(hidden(await review()));
      expect(res.url).toMatch(/^https:\/\/checkout\.paystack\.com\//);
      expect(await prisma.order.count()).toBe(2);
      // Settling a forged link just removes it.
      h0.jar.set(CHECKOUT_COOKIE, "forged.value");
      expect(await settleBagAction()).toEqual({ settled: false });
      expect(h0.jar.has(CHECKOUT_COOKIE)).toBe(false);
    });

    it("converges simultaneous submissions on one order (the checkout key; see bag-checkout-races.test.ts)", async () => {
      await add(v.white);
      const fields = hidden(await review());
      const results = await Promise.allSettled([checkout.startCheckoutAction({ ok: false }, form({ ...details, ...fields })), checkout.startCheckoutAction({ ok: false }, form({ ...details, ...fields }))]);
      expect(results.every((r) => r.status === "rejected")).toBe(true); // both redirected: one to Paystack, one to that order
      expect(await prisma.order.count()).toBe(1);
      expect(await prisma.paymentAttempt.count()).toBe(1);
      expect(h0.ps!.initialized).toHaveLength(1);
      // From then on the link holds, and further submissions reuse the linked order.
      const again = await submit(fields);
      expect(again.url).toMatch(/^\/checkout\/order\//);
      expect(await prisma.order.count()).toBe(1);
    });
  });

  // --- settlement ------------------------------------------------------------------
  describe("settlement", () => {
    it("never clears the bag while the order is unpaid, failed or unverified", async () => {
      await add(v.white, 2);
      const { order, attempt } = await startBagCheckout();
      const before = bag();
      // Pending (Paystack still "ongoing"), via the callback and via the action.
      expect(await callbackFor(attempt.reference)).toContain(`/checkout/order/${order.reference}`);
      expect(await settleBagAction()).toEqual({ settled: false });
      expect(bag()).toEqual(before);
      // Verification unavailable.
      h0.ps!.failVerify(new (await import("@/server/payments/paystack")).PaystackError("network", "down"));
      await callbackFor(attempt.reference);
      expect(bag()).toEqual(before);
      h0.ps!.failVerify(null);
      // Failed payment.
      h0.ps!.settle(attempt.reference, { status: "failed" });
      await callbackFor(attempt.reference);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING_PAYMENT");
      expect(bag()).toEqual(before);
      expect(linked()).toBe(order.reference); // kept for a retry
    });

    it("removes exactly the paid lines after a verified callback, keeping anything added or changed", async () => {
      await add(v.white, 2);
      await add(v.skirt);
      const { order, attempt } = await startBagCheckout();
      // While the customer is on Paystack: another piece added, and a quantity changed.
      await add(v.black);
      await setQuantity(v.skirt, 2);
      h0.ps!.settle(attempt.reference, { status: "success" });
      const location = await callbackFor(attempt.reference);
      expect(location).toBe(`http://localhost:3000/checkout/order/${order.reference}?token=${orderAccessToken(order.reference)}`);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");
      expect(bag()).toEqual([[v.skirt, 2], [v.black, 1]]);
      expect(h0.jar.has(CHECKOUT_COOKIE)).toBe(false);
      // Repeating (a second callback, or the action) changes nothing more.
      await callbackFor(attempt.reference);
      expect(await settleBagAction()).toEqual({ settled: false });
      expect(bag()).toEqual([[v.skirt, 2], [v.black, 1]]);
    });

    it("empties the bag when everything in it was paid for", async () => {
      await add(v.white, 2);
      const { attempt } = await startBagCheckout();
      h0.ps!.settle(attempt.reference, { status: "success" });
      await callbackFor(attempt.reference);
      expect(h0.jar.has(BAG_COOKIE)).toBe(false);
    });

    it("never clears the bag for a Buy now payment", async () => {
      await add(v.white);
      const res = await submit(hidden(await review({ items: `${v.white}:1` })));
      expect(res.url).toMatch(/^https:\/\/checkout\.paystack\.com\//);
      const [order] = await orders();
      h0.ps!.settle(order.payments[0].reference, { status: "success" });
      await callbackFor(order.payments[0].reference);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");
      expect(bag()).toEqual([[v.white, 1]]); // same variant and quantity, but not a bag order
    });

    it("settles a webhook-confirmed payment on the next visit, checking the database", async () => {
      await add(v.white, 2);
      await add(v.black);
      const { order, attempt } = await startBagCheckout();
      h0.ps!.settle(attempt.reference, { status: "success" });
      const body = JSON.stringify({ event: "charge.success", data: { id: 1000, reference: attempt.reference, status: "success" } });
      const signature = createHmac("sha512", testPaymentConfig.secretKey).update(body).digest("hex");
      const deps = { prisma, paystack: h0.ps!.client, config: testPaymentConfig };
      expect((await handlePaystackWebhook(deps, body, signature)).status).toBe(200);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");
      expect(bag()).toHaveLength(2); // the webhook can't touch the customer's cookies
      // A new checkout can't start from the stale link meanwhile.
      expect(text(await review())).toContain("Your earlier order from this bag has been paid");
      // Next /bag or /checkout visit: the action settles it.
      expect(await settleBagAction()).toEqual({ settled: true, reference: order.reference, orderPath: `/checkout/order/${order.reference}?token=${orderAccessToken(order.reference)}`, kept: 0 });
      expect(h0.jar.has(BAG_COOKIE)).toBe(false);
      expect(h0.jar.has(CHECKOUT_COOKIE)).toBe(false);
    });
  });

  // --- stock -----------------------------------------------------------------------
  describe("stock", () => {
    it("names the short line of a multi-line order and never goes negative", async () => {
      await add(v.white, 2);
      await add(v.skirt);
      const { order, attempt } = await startBagCheckout();
      await prisma.productVariant.update({ where: { id: v.skirt }, data: { stock: 0 } }); // sold elsewhere meanwhile
      h0.ps!.settle(attempt.reference, { status: "success" });
      await callbackFor(attempt.reference);
      const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(paid).toMatchObject({ status: "PAID", stockStatus: "SHORTFALL" });
      expect(paid.needsAttention).toContain("Paid, but stock was insufficient for: Ankara Skirt (Blue, size M, SKU ANKARA-SKIRT-0) × 1.");
      expect(paid.needsAttention).not.toContain("Abeni Dress");
      const stock = async (id: string) => (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stock;
      expect(await stock(v.white)).toBe(3); // deducted
      expect(await stock(v.skirt)).toBe(0); // untouched, never negative
      expect(bag()).toEqual([]); // the order is paid: its lines leave the bag; the owner resolves the shortfall
    });
  });
});
