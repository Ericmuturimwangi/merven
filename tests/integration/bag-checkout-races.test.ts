import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakePaystack, testPaymentConfig, testOrderOpts } from "../support/fake-paystack";
import { hasTestDb, makeCategory, makeProduct, resetDb, testPrisma } from "../support/db";

// Races between requests from one browser, against the test database. Each
// simulated request sees its own snapshot of the browser's cookies (as a real
// request carries them when sent), and its Set-Cookie writes are applied to the
// browser in an order the test chooses, as when two responses race back.

type CookieOp = { name: string; value: string | null; options?: Record<string, unknown> };
type RequestStore = { jar: Map<string, string>; ops: CookieOp[]; ip: string };

const h0 = await vi.hoisted(async () => {
  process.env.BETTER_AUTH_SECRET ??= "x".repeat(40);
  process.env.WHATSAPP_NUMBER = "254720630112";
  process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
  const { AsyncLocalStorage } = await import("node:async_hooks");
  return { als: new AsyncLocalStorage<RequestStore>(), ps: null as null | ReturnType<typeof import("../support/fake-paystack").fakePaystack> };
});
const store = () => {
  const s = h0.als.getStore();
  if (!s) throw new Error("cookie access outside a simulated request");
  return s;
};

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (store().jar.has(name) ? { name, value: store().jar.get(name)! } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      store().jar.set(name, value);
      store().ops.push({ name, value, options });
    },
    delete: (name: string) => {
      store().jar.delete(name);
      store().ops.push({ name, value: null });
    },
  }),
  headers: async () => new Headers({ "x-forwarded-for": store().ip }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
  useRouter: () => ({ refresh: () => {}, replace: () => {} }),
}));
vi.mock("next/cache", () => ({ updateTag: () => {}, refresh: () => {}, revalidateTag: () => {}, cacheTag: () => {}, cacheLife: () => {}, prefetch: async () => {} }));
vi.mock("next/server", () => ({ after: () => {}, connection: async () => {} }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => h("a", { href, ...rest }, children) }));
vi.mock("next/image", () => ({ default: ({ src, alt }: { src: string; alt: string }) => h("img", { src, alt }) }));
vi.mock("@/server/db", async () => ({ db: (await import("../support/db")).testPrisma() }));
vi.mock("@/server/payments/runtime", async () => {
  const { testPrisma } = await import("../support/db");
  const deps = async () => (h0.ps ? { prisma: testPrisma(), paystack: h0.ps.client, config: testPaymentConfig } : null);
  return { paymentDeps: deps, paymentAvailability: async () => ({ available: Boolean(await deps()), testMode: true }), afterPaymentChange: async () => {} };
});

const checkout = await import("@/server/checkout/actions");
const cart = await import("@/server/cart/actions");
const svc = await import("@/server/orders/order-service");
const { settleBagAction } = await import("@/server/cart/settle-action");
const { CheckoutContent } = await import("@/components/checkout/checkout-content");
const { BagCheckoutStatus } = await import("@/components/cart/bag-checkout-status");
const { BAG_COOKIE, parseBag } = await import("@/server/cart/bag");
const { BAG_SESSION_COOKIE } = await import("@/server/cart/bag-session");
const { CHECKOUT_COOKIE, parseCheckoutLink, bagCheckoutKey } = await import("@/server/cart/checkout-link");
const { orderAccessToken } = await import("@/server/orders/access");
const { initialBagState } = await import("@/server/cart/state");
const { checkoutInputSchema } = await import("@/server/orders/checkout-input");

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

describe.skipIf(!hasTestDb)("bag checkout races", () => {
  const prisma = testPrisma();
  const v = {} as Record<"white" | "black" | "skirt", string>;
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  let browser: Map<string, string>;
  let ip: string;

  beforeEach(async () => {
    await resetDb(prisma);
    browser = new Map();
    ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
    h0.ps = fakePaystack();
    fetchSpy.mockClear();
    const cat = await makeCategory(prisma, "Dresses");
    await makeProduct(prisma, { categoryId: cat.id, slug: "abeni-dress", name: "Abeni Dress", priceMinor: 250000, variants: [{ size: "8", colour: "White", stock: 9 }, { size: "8", colour: "Black", stock: 9 }] });
    await makeProduct(prisma, { categoryId: cat.id, slug: "ankara-skirt", name: "Ankara Skirt", priceMinor: 300000, variants: [{ size: "M", colour: "Blue", stock: 9 }] });
    const id = async (colour: string) => (await prisma.productVariant.findFirstOrThrow({ where: { colour } })).id;
    v.white = await id("White");
    v.black = await id("Black");
    v.skirt = await id("Blue");
  });
  afterEach(() => expect(fetchSpy).not.toHaveBeenCalled());
  afterAll(() => prisma.$disconnect());

  // --- simulated browser -----------------------------------------------------------
  /** Runs `fn` as one request carrying the browser's cookies as they are now. Nothing reaches the browser yet. */
  async function send<T>(fn: () => Promise<T>, from: Map<string, string> = browser) {
    const s: RequestStore = { jar: new Map(from), ops: [], ip };
    let result: T | undefined;
    let redirect: string | undefined;
    try {
      result = await h0.als.run(s, fn);
    } catch (e) {
      redirect = (e as { url?: string }).url;
      if (!redirect) throw e;
    }
    return { result, redirect, ops: s.ops };
  }
  /** The browser receives a response: its Set-Cookie headers, in order. */
  const receive = (res: { ops: CookieOp[] }) => {
    for (const op of res.ops) {
      if (op.value === null) browser.delete(op.name);
      else browser.set(op.name, op.value);
    }
  };
  const run = async <T>(fn: () => Promise<T>) => {
    const res = await send(fn);
    receive(res);
    return res;
  };

  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, val] of Object.entries(fields)) f.set(k, val);
    return f;
  };
  const add = (variantId: string, quantity = 1) => () => cart.addToBagAction(initialBagState, form({ variantId, quantity: String(quantity) }));
  const update = (variantId: string, quantity: number) => () => cart.updateBagQuantityAction(initialBagState, form({ variantId, quantity: String(quantity) }));
  const remove = (variantId: string) => () => cart.removeFromBagAction(initialBagState, form({ variantId }));
  const bag = () => parseBag(browser.get(BAG_COOKIE)).lines.map((l) => [l.variantId, l.quantity]);
  const hidden = (html: string) => Object.fromEntries([...html.matchAll(/<input type="hidden" name="(items|expectedTotalMinor|source)" value="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const reviewFields = async (sp: Record<string, string> = {}) => hidden(renderToStaticMarkup((await send(() => CheckoutContent({ searchParams: Promise.resolve(sp) }))).result!));
  const details = { name: "Amina Otieno", email: "amina@example.com", phone: "0712345678" };
  const submit = (fields: Record<string, string>) => () => checkout.startCheckoutAction({ ok: false }, form({ ...details, ...fields }));
  const orders = () => prisma.order.findMany({ include: { items: true, payments: true }, orderBy: { createdAt: "asc" } });
  const deps = () => ({ prisma, paystack: h0.ps!.client, config: testPaymentConfig });
  async function pay(reference: string) {
    h0.ps!.settle(reference, { status: "success" });
    await svc.verifyAndApply(deps(), reference); // as the webhook would: no cookies involved
  }
  async function paidBagOrder(lines: [string, number][]) {
    for (const [id, q] of lines) await run(add(id, q));
    await run(submit(await reviewFields()));
    const [order] = (await orders()).slice(-1);
    await pay(order.payments[0].reference);
    return order;
  }

  // --- duplicate orders ------------------------------------------------------------
  describe("concurrent bag checkout submissions", () => {
    it("converge on one unpaid order and one payment initialisation", async () => {
      await run(add(v.white, 2));
      await run(add(v.skirt));
      const fields = await reviewFields();
      // Two submissions leave the browser before either response comes back.
      const [a, b] = await Promise.all([send(submit(fields)), send(submit(fields))]);
      const all = await orders();
      expect(all).toHaveLength(1);
      expect(all[0].status).toBe("PENDING_PAYMENT");
      expect(all[0].payments).toHaveLength(1);
      expect(h0.ps!.initialized).toHaveLength(1);
      const ref = all[0].reference;
      const targets = [a.redirect, b.redirect].sort();
      expect(targets[0]).toBe(`/checkout/order/${ref}?token=${orderAccessToken(ref)}`); // the loser continues that order
      expect(targets[1]).toMatch(/^https:\/\/checkout\.paystack\.com\//); // the winner went to pay
      receive(a);
      receive(b);
      expect(parseCheckoutLink(browser.get(CHECKOUT_COOKIE))).toBe(ref);
    });

    it("keeps existing protection against a second payment attempt", async () => {
      await run(add(v.white));
      const fields = await reviewFields();
      await Promise.all([send(submit(fields)), send(submit(fields))]);
      const [order] = await orders();
      // The loser lands on the order page; "Try paying again" re-uses the open attempt.
      const retry = await run(() => checkout.retryPaymentAction({ ok: false }, form({ reference: order.reference, token: orderAccessToken(order.reference) })));
      expect(retry.redirect).toMatch(/^https:\/\/checkout\.paystack\.com\//);
      expect(await prisma.paymentAttempt.count()).toBe(1);
      expect(h0.ps!.initialized).toHaveLength(1);
    });

    it("lets different baskets from the same browser create different orders", async () => {
      await run(add(v.white));
      const tabA = new Map(browser);
      const fieldsA = await reviewFields();
      await run(add(v.skirt));
      const tabB = new Map(browser);
      const fieldsB = await reviewFields();
      expect(tabA.get(BAG_SESSION_COOKIE)).toBe(tabB.get(BAG_SESSION_COOKIE)); // same browser session
      await Promise.all([send(submit(fieldsA), tabA), send(submit(fieldsB), tabB)]);
      const all = await orders();
      expect(all).toHaveLength(2);
      expect(new Set(all.map((o) => o.checkoutKey)).size).toBe(2);
    });

    it("allows the same basket again once the earlier order is paid", async () => {
      const first = await paidBagOrder([[v.white, 1]]);
      await run(() => settleBagAction());
      await run(add(v.white));
      const res = await run(submit(await reviewFields()));
      expect(res.redirect).toMatch(/^https:\/\/checkout\.paystack\.com\//);
      const all = await orders();
      expect(all).toHaveLength(2);
      expect(all[1].checkoutKey).toBe(first.checkoutKey); // same browser, basket and price; the paid order no longer holds it
      expect(all.map((o) => o.status)).toEqual(["PAID", "PENDING_PAYMENT"]);
    });

    it("leaves Buy now as it was: no checkout key, no bag session needed, separate orders", async () => {
      const fields = await reviewFields({ items: `${v.white}:1` });
      const [a, b] = await Promise.all([send(submit(fields)), send(submit(fields))]);
      expect([a.redirect, b.redirect].every((u) => u?.startsWith("https://checkout.paystack.com/"))).toBe(true);
      const all = await orders();
      expect(all).toHaveLength(2);
      expect(all.every((o) => o.checkoutKey === null)).toBe(true);
      expect([...a.ops, ...b.ops].map((o) => o.name)).toEqual([]); // no cookies at all
    });

    it("issues the bag session as an HttpOnly cookie, then keeps its value and renews its expiry on every bag write", async () => {
      const res = await run(add(v.white));
      const session = res.ops.find((o) => o.name === BAG_SESSION_COOKIE);
      expect(session?.value).toMatch(/^[A-Za-z0-9_-]{24}$/);
      expect(session?.options).toEqual({ httpOnly: true, sameSite: "lax", path: "/", secure: false, maxAge: 30 * 24 * 60 * 60 });
      for (const write of [add(v.black), update(v.black, 2), remove(v.black)]) {
        const again = await run(write);
        const renewed = again.ops.find((o) => o.name === BAG_SESSION_COOKIE);
        expect(renewed?.value).toBe(session?.value); // never rotated
        expect(renewed?.options).toEqual(session?.options); // same attributes, fresh 30 days
      }
    });

    it("replaces a malformed session value", async () => {
      browser.set(BAG_SESSION_COOKIE, "not-a-valid-session");
      await run(add(v.white));
      expect(browser.get(BAG_SESSION_COOKIE)).toMatch(/^[A-Za-z0-9_-]{24}$/);
    });
  });

  describe("checkout key conflicts in createOrder", () => {
    const input = (items: { variantId: string; quantity: number }[], total: number) =>
      checkoutInputSchema.parse({ ...details, items, expectedTotalMinor: total });

    it("returns the unpaid order holding the key and creates nothing else", async () => {
      const key = bagCheckoutKey("s".repeat(24), [{ variantId: v.white, quantity: 1 }], 250000);
      const first = await svc.createOrder(prisma, input([{ variantId: v.white, quantity: 1 }], 250000), { ...testOrderOpts, checkoutKey: key });
      expect(first.ok).toBe(true);
      const second = await svc.createOrder(prisma, input([{ variantId: v.white, quantity: 1 }], 250000), { ...testOrderOpts, checkoutKey: key });
      expect(second).toMatchObject({ ok: false, reason: "duplicate", order: { reference: first.ok ? first.order.reference : "" } });
      expect(await prisma.order.count()).toBe(1);
      expect(await prisma.paymentAttempt.count()).toBe(1);
      // Without a key (Buy now) nothing is deduplicated.
      expect((await svc.createOrder(prisma, input([{ variantId: v.white, quantity: 1 }], 250000), testOrderOpts)).ok).toBe(true);
    });

    it("gives a changed basket or a changed total a different key", () => {
      const base = bagCheckoutKey("s".repeat(24), [{ variantId: "a", quantity: 1 }, { variantId: "b", quantity: 2 }], 100);
      expect(bagCheckoutKey("s".repeat(24), [{ variantId: "b", quantity: 2 }, { variantId: "a", quantity: 1 }], 100)).toBe(base); // order-insensitive
      expect(bagCheckoutKey("s".repeat(24), [{ variantId: "a", quantity: 1 }, { variantId: "b", quantity: 3 }], 100)).not.toBe(base);
      expect(bagCheckoutKey("s".repeat(24), [{ variantId: "a", quantity: 1 }, { variantId: "b", quantity: 2 }], 101)).not.toBe(base);
      expect(bagCheckoutKey("t".repeat(24), [{ variantId: "a", quantity: 1 }, { variantId: "b", quantity: 2 }], 100)).not.toBe(base);
    });

    it("releases the key of an unpaid order that can no longer be paid online", async () => {
      const key = bagCheckoutKey("s".repeat(24), [{ variantId: v.white, quantity: 1 }], 250000);
      const first = await svc.createOrder(prisma, input([{ variantId: v.white, quantity: 1 }], 250000), { ...testOrderOpts, checkoutKey: key });
      if (!first.ok) throw new Error("setup");
      await prisma.paymentAttempt.updateMany({ data: { status: "FAILED" } });
      for (let i = 1; i < svc.MAX_ATTEMPTS_PER_ORDER; i++) {
        await prisma.paymentAttempt.create({ data: { orderId: first.order.id, reference: `${first.order.reference}-PFAILED${i}`, testMode: true, status: "FAILED", amountMinor: 250000, currency: "KES" } });
      }
      const next = await svc.createOrder(prisma, input([{ variantId: v.white, quantity: 1 }], 250000), { ...testOrderOpts, checkoutKey: key });
      expect(next.ok).toBe(true);
      const old = await prisma.order.findUniqueOrThrow({ where: { id: first.order.id } });
      expect(old).toMatchObject({ status: "PENDING_PAYMENT", checkoutKey: null });
      expect(old.needsAttention).toContain("Payment attempt limit reached");
    });

    it("doesn't release the key while an attempt is still open", async () => {
      const key = bagCheckoutKey("s".repeat(24), [{ variantId: v.white, quantity: 1 }], 250000);
      const first = await svc.createOrder(prisma, input([{ variantId: v.white, quantity: 1 }], 250000), { ...testOrderOpts, checkoutKey: key });
      if (!first.ok) throw new Error("setup");
      for (let i = 1; i < svc.MAX_ATTEMPTS_PER_ORDER; i++) {
        await prisma.paymentAttempt.create({ data: { orderId: first.order.id, reference: `${first.order.reference}-PFAILED${i}`, testMode: true, status: "FAILED", amountMinor: 250000, currency: "KES" } });
      }
      // The first attempt is still INITIALIZING (outcome unknown): never hand out a second order.
      expect(await svc.createOrder(prisma, input([{ variantId: v.white, quantity: 1 }], 250000), { ...testOrderOpts, checkoutKey: key })).toMatchObject({ reason: "duplicate" });
    });
  });

  // --- settlement vs bag writes ----------------------------------------------------
  describe("settlement racing bag changes", () => {
    it("settlement answers first, a concurrent add answers last: the add is kept, paid lines stay gone", async () => {
      await paidBagOrder([[v.white, 2], [v.skirt, 1]]);
      const [settle, addition] = await Promise.all([send(() => settleBagAction()), send(add(v.black))]);
      receive(settle);
      receive(addition);
      expect(bag()).toEqual([[v.black, 1]]);
      expect(browser.has(CHECKOUT_COOKIE)).toBe(false);
    });

    it("a concurrent add answers first, settlement last: paid lines are not restored (the add is lost)", async () => {
      await paidBagOrder([[v.white, 2], [v.skirt, 1]]);
      const [settle, addition] = await Promise.all([send(() => settleBagAction()), send(add(v.black))]);
      receive(addition);
      receive(settle);
      expect(bag()).toEqual([]); // documented cookie limitation: the add that answered first is overwritten
      expect(browser.has(CHECKOUT_COOKIE)).toBe(false);
    });

    const otherWrites: [string, () => () => Promise<unknown>][] = [
      ["an update", () => update(v.skirt, 2)],
      ["a remove", () => remove(v.black)],
      ["a clear", () => () => cart.clearBagAction()],
    ];
    for (const [name, make] of otherWrites) {
      for (const settlementLast of [false, true]) {
        it(`${name} racing settlement (settlement answers ${settlementLast ? "last" : "first"}) never restores paid lines`, async () => {
          await run(add(v.black)); // an unpaid line already in the bag
          await paidBagOrder([[v.white, 2], [v.skirt, 1]]);
          const [settle, other] = await Promise.all([send(() => settleBagAction()), send(make())]);
          for (const res of settlementLast ? [other, settle] : [settle, other]) receive(res);
          expect(bag().map(([id]) => id)).not.toContain(v.white);
          expect(bag()).not.toContainEqual([v.skirt, 1]);
          expect(browser.has(CHECKOUT_COOKIE)).toBe(false);
        });
      }
    }

    it("every bag write applies a confirmed payment, keeping added and changed lines", async () => {
      await paidBagOrder([[v.white, 2], [v.skirt, 1]]);
      // No settlement request at all: the next ordinary bag write converges by itself.
      await run(add(v.black));
      expect(bag()).toEqual([[v.black, 1]]);
      expect(browser.has(CHECKOUT_COOKIE)).toBe(false);
    });

    it("keeps lines whose quantity changed during checkout, matching variant and quantity exactly", async () => {
      await run(add(v.white, 2));
      await run(add(v.skirt));
      await run(submit(await reviewFields()));
      const [order] = await orders();
      await run(update(v.skirt, 2)); // changed while paying
      await pay(order.payments[0].reference);
      await run(add(v.black));
      expect(bag()).toEqual([[v.skirt, 2], [v.black, 1]]);
    });

    it("never removes lines for pending, failed or unverified payments, whatever is written", async () => {
      await run(add(v.white, 2));
      await run(submit(await reviewFields()));
      const [order] = await orders();
      await run(add(v.black)); // pending
      expect(bag()).toEqual([[v.white, 2], [v.black, 1]]);
      h0.ps!.settle(order.payments[0].reference, { status: "failed" });
      await svc.verifyAndApply(deps(), order.payments[0].reference);
      await run(remove(v.black)); // failed
      await run(() => settleBagAction());
      expect(bag()).toEqual([[v.white, 2]]);
      expect(parseCheckoutLink(browser.get(CHECKOUT_COOKIE))).toBe(order.reference);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING_PAYMENT");
    });

    it("still settles a webhook-first payment on the next visit", async () => {
      const order = await paidBagOrder([[v.white, 2]]);
      const res = await run(() => settleBagAction());
      expect(res.result).toMatchObject({ settled: true, reference: order.reference, kept: 0 });
      expect(browser.has(BAG_COOKIE)).toBe(false);
    });
  });

  // --- notices ---------------------------------------------------------------------
  describe("unpaid-order notices", () => {
    const status = async (unpaidNotice?: boolean) => renderToStaticMarkup((await send(() => BagCheckoutStatus({ unpaidNotice }))).result!);
    const continueLinks = (html: string) => (html.match(/>Continue with (that|your) order</g) ?? []).length;

    it("shows exactly one unpaid-order notice on /checkout", async () => {
      await run(add(v.white));
      await run(submit(await reviewFields()));
      const review = renderToStaticMarkup((await send(() => CheckoutContent({ searchParams: Promise.resolve({}) }))).result!);
      const page = (await status(false)) + review; // what /checkout renders
      expect(continueLinks(page)).toBe(1);
      expect(text(page)).toContain("already started checkout for this bag");
    });

    it("shows the /bag notice only while the unpaid order matches the bag", async () => {
      await run(add(v.white));
      await run(submit(await reviewFields()));
      expect(text(await status())).toContain("You started paying for this bag");
      await run(add(v.skirt)); // the bag no longer matches that order
      const html = await status();
      expect(text(html)).not.toContain("You started paying");
      expect(continueLinks(html)).toBe(0);
    });

    it("doesn't present an order at an old price as this bag's checkout", async () => {
      await run(add(v.white));
      await run(submit(await reviewFields()));
      await prisma.product.update({ where: { slug: "abeni-dress" }, data: { priceMinor: 260000 } });
      expect(continueLinks(await status())).toBe(0);
    });
  });

  // --- bag session ---------------------------------------------------------------
  describe("bag session required before a bag checkout", () => {
    it("a bag without a session creates nothing on the first submission, then proceeds", async () => {
      await run(add(v.white));
      browser.delete(BAG_SESSION_COOKIE); // a bag from before sessions existed, or a session cleared on its own
      const fields = await reviewFields();
      const first = await run(submit(fields));
      expect(first.result).toMatchObject({ ok: false, reviewAgain: true });
      expect(await prisma.order.count()).toBe(0);
      expect(h0.ps!.initialized).toHaveLength(0);
      expect(browser.get(BAG_SESSION_COOKIE)).toMatch(/^[A-Za-z0-9_-]{24}$/); // established for next time
      const second = await run(submit(fields));
      expect(second.redirect).toMatch(/^https:\/\/checkout\.paystack\.com\//);
      expect(await prisma.order.count()).toBe(1);
    });

    it("simultaneous submissions without a session create no orders, even with different new sessions", async () => {
      await run(add(v.white));
      browser.delete(BAG_SESSION_COOKIE);
      const fields = await reviewFields();
      const [a, b] = await Promise.all([send(submit(fields)), send(submit(fields))]);
      expect([a.result, b.result]).toEqual([expect.objectContaining({ reviewAgain: true }), expect.objectContaining({ reviewAgain: true })]);
      const sessions = [a, b].map((r) => r.ops.find((o) => o.name === BAG_SESSION_COOKIE)?.value);
      expect(sessions[0]).not.toBe(sessions[1]); // each request made its own: neither was used for a key
      expect(await prisma.order.count()).toBe(0);
      receive(a);
      receive(b); // the browser keeps one of them
      await Promise.all([send(submit(fields)), send(submit(fields))]);
      expect(await prisma.order.count()).toBe(1);
      expect(h0.ps!.initialized).toHaveLength(1);
    });
  });

  // --- resumption needs the same items and the same total --------------------------
  describe("resuming an unpaid order", () => {
    const priceAbeni = (priceMinor: number) => prisma.product.update({ where: { slug: "abeni-dress" }, data: { priceMinor } });

    it("resumes an order for the same items at the same total", async () => {
      await run(add(v.white, 2));
      const fields = await reviewFields();
      await run(submit(fields));
      const [order] = await orders();
      expect((await run(submit(fields))).redirect).toBe(`/checkout/order/${order.reference}?token=${orderAccessToken(order.reference)}`);
      expect(await prisma.order.count()).toBe(1);
    });

    it("doesn't resume an order for the same items at a different total", async () => {
      await run(add(v.white, 2));
      await run(submit(await reviewFields()));
      const [old] = await orders();
      await priceAbeni(260000);
      const html = renderToStaticMarkup((await send(() => CheckoutContent({ searchParams: Promise.resolve({}) }))).result!);
      expect(text(html)).not.toContain("already started checkout");
      const fields = hidden(html);
      expect(fields.expectedTotalMinor).toBe("520000"); // reviewed at today's price
      const res = await run(submit(fields));
      expect(res.redirect).toMatch(/^https:\/\/checkout\.paystack\.com\//);
      const all = await orders();
      expect(all.map((o) => [o.reference === old.reference, o.totalMinor, o.status])).toEqual([[true, 500000, "PENDING_PAYMENT"], [false, 520000, "PENDING_PAYMENT"]]);
      expect(parseCheckoutLink(browser.get(CHECKOUT_COOKIE))).toBe(all[1].reference);
    });

    it("never resumes the current order for a stale review, and never orders at a browser total", async () => {
      await run(add(v.white));
      const stale = await reviewFields(); // 250000
      await priceAbeni(260000);
      await run(submit(await reviewFields())); // an order at 260000, linked
      const res = await run(submit(stale));
      expect(res.redirect).toBeUndefined();
      expect(res.result).toMatchObject({ reviewAgain: true, message: expect.stringContaining("price changed") });
      const all = await orders();
      expect(all.map((o) => o.totalMinor)).toEqual([260000]);
    });

    it("concurrent submissions with different reviewed totals can't return the wrong order", async () => {
      await run(add(v.white));
      const stale = await reviewFields();
      await priceAbeni(260000);
      const current = await reviewFields();
      const [s, c] = await Promise.all([send(submit(stale)), send(submit(current))]);
      expect(s.redirect).toBeUndefined();
      expect(s.result).toMatchObject({ reviewAgain: true });
      expect(c.redirect).toMatch(/^https:\/\/checkout\.paystack\.com\//);
      expect((await orders()).map((o) => o.totalMinor)).toEqual([260000]);
    });

    it("doesn't resume a different basket", async () => {
      await run(add(v.white));
      await run(submit(await reviewFields()));
      await run(add(v.white)); // now 2
      const res = await run(submit(await reviewFields()));
      expect(res.redirect).toMatch(/^https:\/\/checkout\.paystack\.com\//);
      expect(await prisma.order.count()).toBe(2);
    });
  });

  // --- exhausted orders ------------------------------------------------------------
  describe("an unpaid order with every payment attempt used", () => {
    /**
     * Uses every attempt. "never-reached": none ever got a Paystack page (refused
     * or not found), so none can be paid; "reached": the first one had a page and
     * Paystack reported it abandoned, so it might still be paid; "open": one is pending.
     */
    async function exhaust(orderId: string, reference: string, how: "never-reached" | "reached" | "open") {
      const first = { "never-reached": { status: "FAILED" as const, authorizationUrl: null }, reached: { status: "ABANDONED" as const }, open: { status: "PENDING" as const } }[how];
      await prisma.paymentAttempt.updateMany({ where: { orderId }, data: first });
      for (let i = 1; i < svc.MAX_ATTEMPTS_PER_ORDER; i++) {
        await prisma.paymentAttempt.create({ data: { orderId, reference: `${reference}-PUSED${i}`, testMode: true, status: "FAILED", amountMinor: 250000, currency: "KES" } });
      }
    }

    it("is continued, not replaced, while one of its Paystack pages could still be paid", async () => {
      await run(add(v.white));
      const fields = await reviewFields();
      await run(submit(fields));
      const [old] = await orders();
      await exhaust(old.id, old.reference, "reached");
      expect(text(renderToStaticMarkup((await send(() => CheckoutContent({ searchParams: Promise.resolve({}) }))).result!))).toContain("already started checkout");
      // Its order page asks the customer to contact the shop; no second order that could also be paid.
      expect((await run(submit(fields))).redirect).toBe(`/checkout/order/${old.reference}?token=${orderAccessToken(old.reference)}`);
      expect(await prisma.order.count()).toBe(1);
      expect((await orders())[0].checkoutKey).toBe(old.checkoutKey);
    });

    it("is replaced by a new order when none of its attempts ever reached Paystack", async () => {
      await run(add(v.white));
      const fields = await reviewFields();
      await run(submit(fields));
      const [old] = await orders();
      await exhaust(old.id, old.reference, "never-reached");
      expect(text(renderToStaticMarkup((await send(() => CheckoutContent({ searchParams: Promise.resolve({}) }))).result!))).not.toContain("already started checkout");
      const res = await run(submit(fields));
      expect(res.redirect).toMatch(/^https:\/\/checkout\.paystack\.com\//);
      const all = await orders();
      expect(all).toHaveLength(2);
      expect(all[0]).toMatchObject({ status: "PENDING_PAYMENT", checkoutKey: null });
      expect(all[0].needsAttention).toContain("Payment attempt limit reached");
      expect(all[1].checkoutKey).toBe(old.checkoutKey); // the key moved to the new order
      expect(parseCheckoutLink(browser.get(CHECKOUT_COOKIE))).toBe(all[1].reference);
    });

    it("is not replaced while one of its attempts is still open", async () => {
      await run(add(v.white));
      const fields = await reviewFields();
      await run(submit(fields));
      const [old] = await orders();
      await exhaust(old.id, old.reference, "open");
      expect((await run(submit(fields))).redirect).toBe(`/checkout/order/${old.reference}?token=${orderAccessToken(old.reference)}`);
      expect(await prisma.order.count()).toBe(1);
    });

    it("concurrent replacements converge on one new order and never return the exhausted one", async () => {
      await run(add(v.white));
      const fields = await reviewFields();
      await run(submit(fields));
      const [old] = await orders();
      await exhaust(old.id, old.reference, "never-reached");
      const initialised = h0.ps!.initialized.length;
      const results = await Promise.all([send(submit(fields)), send(submit(fields)), send(submit(fields))]);
      const all = await orders();
      expect(all).toHaveLength(2); // the exhausted order and exactly one replacement
      const replacement = all[1];
      expect(h0.ps!.initialized.length - initialised).toBe(1);
      for (const r of results) {
        expect(r.redirect).not.toContain(old.reference);
        expect(r.redirect === `/checkout/order/${replacement.reference}?token=${orderAccessToken(replacement.reference)}` || r.redirect?.startsWith("https://checkout.paystack.com/")).toBe(true);
      }
    });

    it("createOrder: a concurrent key release re-evaluates instead of returning the exhausted holder", async () => {
      const input = checkoutInputSchema.parse({ ...details, items: [{ variantId: v.white, quantity: 1 }], expectedTotalMinor: 250000 });
      const key = bagCheckoutKey("s".repeat(24), input.items, 250000);
      const first = await svc.createOrder(prisma, input, { ...testOrderOpts, checkoutKey: key });
      if (!first.ok) throw new Error("setup");
      await exhaust(first.order.id, first.order.reference, "never-reached");
      const results = await Promise.all([1, 2, 3, 4].map(() => svc.createOrder(prisma, input, { ...testOrderOpts, checkoutKey: key })));
      const created = results.filter((r) => r.ok);
      expect(created).toHaveLength(1);
      const winner = created[0].ok ? created[0].order.reference : "";
      for (const r of results) if (!r.ok) expect(r).toMatchObject({ reason: "duplicate", order: { reference: winner } });
      expect(await prisma.order.count({ where: { checkoutKey: key, status: "PENDING_PAYMENT" } })).toBe(1);
    });
  });
});
