import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BAG_COOKIE, parseBag, serializeBag } from "@/server/cart/bag";
import { describeBag } from "@/server/cart/cart-service";
import { initialBagState } from "@/server/cart/state";
import { hasTestDb, makeCategory, makeProduct, resetDb, testPrisma } from "../support/db";

// The public bag actions, end to end against the test database with an
// in-memory cookie jar. Online payment is disabled throughout: the bag must work
// without it and must never create orders or payment attempts.

type SetOptions = { httpOnly?: boolean; sameSite?: string; path?: string; secure?: boolean; maxAge?: number };
const h = vi.hoisted(() => ({
  jar: new Map<string, { value: string; options?: SetOptions }>(),
  paymentDepsCalls: 0,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (h.jar.has(name) ? { name, value: h.jar.get(name)!.value } : undefined),
    set: (name: string, value: string, options?: SetOptions) => void h.jar.set(name, { value, options }),
    delete: (name: string) => void h.jar.delete(name),
  }),
}));
vi.mock("@/server/db", async () => ({ db: (await import("../support/db")).testPrisma() }));
// Payments off. Any use of the payment runtime by the bag would be counted.
vi.mock("@/server/payments/runtime", () => ({
  paymentDeps: async () => {
    h.paymentDepsCalls++;
    return null;
  },
  paymentAvailability: async () => {
    h.paymentDepsCalls++;
    return { available: false, testMode: false };
  },
  afterPaymentChange: async () => {},
}));

process.env.PAYMENTS_ENABLED = "false";
const actions = await import("@/server/cart/actions");

describe.skipIf(!hasTestDb)("bag actions", () => {
  const prisma = testPrisma();
  const v = {} as Record<"m" | "l" | "s" | "soldOut" | "inactive" | "draft" | "archived" | "other", string>;

  const variant = async (slug: string, size: string) =>
    (await prisma.productVariant.findFirstOrThrow({ where: { product: { slug }, size }, select: { id: true } })).id;

  beforeEach(async () => {
    await resetDb(prisma);
    h.jar.clear();
    h.paymentDepsCalls = 0;
    const cat = await makeCategory(prisma, "Dresses");
    await makeProduct(prisma, {
      categoryId: cat.id,
      slug: "tie-dress",
      priceMinor: 380000,
      variants: [
        { size: "M", colour: "White", stock: 3 },
        { size: "L", colour: "White", stock: 10, priceMinor: 400000 },
        { size: "S", colour: "White", stock: 1 },
        { size: "XS", colour: "White", stock: 0 },
        { size: "XL", colour: "White", stock: 5, active: false },
      ],
    });
    await makeProduct(prisma, { categoryId: cat.id, slug: "draft-dress", status: "DRAFT", variants: [{ size: "M", colour: "Red", stock: 5 }] });
    const archived = await makeProduct(prisma, { categoryId: cat.id, slug: "old-dress", status: "ARCHIVED", variants: [{ size: "M", colour: "Blue", stock: 5 }] });
    // Archived products were published once (the helper only dates PUBLISHED ones).
    await prisma.product.update({ where: { id: archived.id }, data: { publishedAt: new Date(), archivedAt: new Date() } });
    await makeProduct(prisma, { categoryId: cat.id, slug: "wrap-top", priceMinor: 250000, variants: [{ size: "M", colour: "Black", stock: 8 }] });
    v.m = await variant("tie-dress", "M");
    v.l = await variant("tie-dress", "L");
    v.s = await variant("tie-dress", "S");
    v.soldOut = await variant("tie-dress", "XS");
    v.inactive = await variant("tie-dress", "XL");
    v.draft = await variant("draft-dress", "M");
    v.archived = await variant("old-dress", "M");
    v.other = await variant("wrap-top", "M");
  });
  afterAll(() => prisma.$disconnect());

  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, val] of Object.entries(fields)) f.set(k, val);
    return f;
  };
  const add = (variantId: string, quantity?: number) => actions.addToBagAction(initialBagState, form({ variantId, ...(quantity ? { quantity: String(quantity) } : {}) }));
  const update = (variantId: string, quantity: number | string) => actions.updateBagQuantityAction(initialBagState, form({ variantId, quantity: String(quantity) }));
  const remove = (variantId: string) => actions.removeFromBagAction(initialBagState, form({ variantId }));
  const bag = () => parseBag(h.jar.get(BAG_COOKIE)?.value).lines;
  const setRawBag = (value: string) => h.jar.set(BAG_COOKIE, { value });

  describe("adding", () => {
    it("adds a variant with the server's price and sets a hardened cookie", async () => {
      const res = await add(v.l);
      expect(res).toMatchObject({ ok: true, outcome: "added", quantity: 1, maxQuantity: 5, count: { lines: 1, items: 1 } });
      expect(bag()).toEqual([{ variantId: v.l, quantity: 1, seenUnitPriceMinor: 400000 }]);
      expect(h.jar.get(BAG_COOKIE)!.options).toEqual({ httpOnly: true, sameSite: "lax", path: "/", secure: false, maxAge: 30 * 24 * 60 * 60 });
    });

    it("merges repeat adds of the same variant and keeps other variants separate", async () => {
      await add(v.m);
      await add(v.m);
      await add(v.l);
      await add(v.other, 2);
      expect(bag().map((l) => [l.variantId, l.quantity])).toEqual([[v.m, 2], [v.l, 1], [v.other, 2]]);
    });

    it("adds what is available and says so, rather than going above stock", async () => {
      await add(v.m, 2);
      const res = await add(v.m, 2); // stock 3
      expect(res).toMatchObject({ ok: true, outcome: "limited", quantity: 3, maxQuantity: 3 });
      expect(res.message).toMatch(/Only 3 available/);
      expect(await add(v.m)).toMatchObject({ ok: false, outcome: "at_limit", maxQuantity: 3 });
      expect(bag()[0].quantity).toBe(3);
    });

    it("caps a line at 5 even when there is more stock", async () => {
      await add(v.l, 5);
      expect(await add(v.l)).toMatchObject({ ok: false, outcome: "at_limit", maxQuantity: 5 });
      expect(bag()[0].quantity).toBe(5);
    });

    it("refuses unknown, draft, archived, inactive, deleted and sold-out variants without changing the bag", async () => {
      await add(v.m);
      const before = h.jar.get(BAG_COOKIE)!.value;
      await prisma.productVariant.delete({ where: { id: v.other } });
      const cases: [string, string][] = [
        ["cmdoesnotexist000", "not_found"],
        [v.other, "not_found"],
        [v.draft, "unavailable"],
        [v.archived, "unavailable"],
        [v.inactive, "unavailable"],
        [v.soldOut, "sold_out"],
      ];
      for (const [id, outcome] of cases) expect(await add(id)).toMatchObject({ ok: false, outcome, maxQuantity: 0 });
      expect(h.jar.get(BAG_COOKIE)!.value).toBe(before);
    });

    it("rejects malformed ids and quantities before touching the database or the bag", async () => {
      for (const variantId of ["", "CMUPPER", "cm-dash", "a".repeat(65), "x'; DROP TABLE product;--"]) {
        expect(await add(variantId)).toMatchObject({ ok: false, outcome: "invalid" });
      }
      for (const quantity of ["0", "-1", "6", "1.5", "abc", ""]) {
        expect(await actions.addToBagAction(initialBagState, form({ variantId: v.m, quantity }))).toMatchObject({ ok: false, outcome: "invalid" });
      }
      expect(h.jar.has(BAG_COOKIE)).toBe(false);
    });

    it("ignores any price, name or stock the client sends", async () => {
      await actions.addToBagAction(initialBagState, form({ variantId: v.m, quantity: "1", priceMinor: "1", seenUnitPriceMinor: "1", stock: "99", name: "Free dress" }));
      expect(bag()).toEqual([{ variantId: v.m, quantity: 1, seenUnitPriceMinor: 380000 }]);
    });

    it("refuses an 11th distinct line", async () => {
      const cat = await makeCategory(prisma, "Bulk");
      for (let i = 0; i < 10; i++) {
        await makeProduct(prisma, { categoryId: cat.id, slug: `bulk-${i}`, variants: [{ size: "M", colour: "Green", stock: 5 }] });
        await add(await variant(`bulk-${i}`, "M"));
      }
      expect(bag()).toHaveLength(10);
      expect(await add(v.m)).toMatchObject({ ok: false, outcome: "bag_full", count: { lines: 10, items: 10 } });
      expect(await add(bag()[0].variantId)).toMatchObject({ ok: true, outcome: "added" }); // existing lines can still grow
    });

    it("re-checks stock on every operation", async () => {
      await add(v.m, 2);
      await prisma.productVariant.update({ where: { id: v.m }, data: { stock: 2 } });
      expect(await add(v.m)).toMatchObject({ ok: false, outcome: "at_limit", maxQuantity: 2 });
      await prisma.productVariant.update({ where: { id: v.m }, data: { stock: 1 } });
      // Above the new stock: nothing is added, and the existing line is not silently reduced.
      expect(await add(v.m)).toMatchObject({ ok: false, outcome: "at_limit", maxQuantity: 1 });
      expect(bag()[0].quantity).toBe(2);
      await prisma.productVariant.update({ where: { id: v.m }, data: { stock: 0 } });
      expect(await add(v.m)).toMatchObject({ ok: false, outcome: "sold_out" });
      await prisma.productVariant.update({ where: { id: v.m }, data: { stock: 9 } });
      expect(await add(v.m, 2)).toMatchObject({ ok: true, outcome: "added", quantity: 4 });
    });
  });

  describe("changing quantities", () => {
    it("sets a quantity and refreshes the price the customer saw", async () => {
      await add(v.l);
      await prisma.productVariant.update({ where: { id: v.l }, data: { priceMinor: 450000 } });
      expect(await update(v.l, 3)).toMatchObject({ ok: true, outcome: "updated", quantity: 3, count: { lines: 1, items: 3 } });
      expect(bag()).toEqual([{ variantId: v.l, quantity: 3, seenUnitPriceMinor: 450000 }]);
      expect(await update(v.l, 1)).toMatchObject({ ok: true, quantity: 1 });
    });

    it("caps at current stock and says so", async () => {
      await add(v.m);
      expect(await update(v.m, 5)).toMatchObject({ ok: true, outcome: "limited", quantity: 3, maxQuantity: 3 });
      expect(bag()[0].quantity).toBe(3);
    });

    it("refuses invalid quantities and lines that aren't in the bag", async () => {
      await add(v.m);
      for (const q of [0, -1, 6, "1.5", "x"]) expect(await update(v.m, q)).toMatchObject({ ok: false, outcome: "invalid" });
      expect(await update(v.l, 1)).toMatchObject({ ok: false, outcome: "not_in_bag" });
      expect(bag()).toEqual([{ variantId: v.m, quantity: 1, seenUnitPriceMinor: 380000 }]);
    });

    it("keeps an unavailable line as it is, for the customer to remove", async () => {
      await add(v.m, 2);
      await prisma.productVariant.update({ where: { id: v.m }, data: { active: false } });
      expect(await update(v.m, 1)).toMatchObject({ ok: false, outcome: "unavailable", maxQuantity: 0 });
      expect(bag()[0]).toMatchObject({ variantId: v.m, quantity: 2 });
    });
  });

  describe("removing and clearing", () => {
    it("removes one line, including one whose variant no longer exists", async () => {
      await add(v.m);
      await add(v.other);
      await prisma.productVariant.delete({ where: { id: v.other } });
      expect(await remove(v.other)).toMatchObject({ ok: true, outcome: "removed", count: { lines: 1, items: 1 } });
      expect(bag().map((l) => l.variantId)).toEqual([v.m]);
      expect(await remove(v.other)).toMatchObject({ ok: true, outcome: "removed" }); // idempotent
    });

    it("deletes the cookie when the last line goes", async () => {
      await add(v.m);
      await remove(v.m);
      expect(h.jar.has(BAG_COOKIE)).toBe(false);
    });

    it("rejects a malformed id on remove", async () => {
      expect(await remove("NOT-AN-ID")).toMatchObject({ ok: false, outcome: "invalid" });
    });

    it("clears the bag", async () => {
      await add(v.m);
      await add(v.l);
      expect(await actions.clearBagAction()).toMatchObject({ ok: true, outcome: "cleared", count: { lines: 0, items: 0 } });
      expect(h.jar.has(BAG_COOKIE)).toBe(false);
    });
  });

  describe("tampered or broken cookies", () => {
    it("starts again from an unknown version and reports it", async () => {
      setRawBag(`v9.${v.m}_5`);
      expect(await add(v.l)).toMatchObject({ ok: true, discarded: true, count: { lines: 1, items: 1 } });
      expect(bag().map((l) => l.variantId)).toEqual([v.l]);
    });

    it("keeps the valid lines of a partly malformed cookie and drops the rest", async () => {
      setRawBag(`v1.${v.m}_2_1.junk.${v.l}_9`);
      expect(await add(v.other)).toMatchObject({ ok: true, discarded: true });
      // The stored price "1" is display-only and is replaced by the server price on change.
      expect(bag()).toEqual([
        { variantId: v.m, quantity: 2, seenUnitPriceMinor: 1 },
        { variantId: v.other, quantity: 1, seenUnitPriceMinor: 250000 },
      ]);
    });

    it("rewrites a damaged cookie even when the action is refused", async () => {
      setRawBag(`v1.${v.m}_1.junk`);
      expect(await add(v.soldOut)).toMatchObject({ ok: false, outcome: "sold_out", discarded: true });
      expect(h.jar.get(BAG_COOKIE)!.value).toBe(`v1.${v.m}_1`);
    });

    it("survives an oversized cookie", async () => {
      setRawBag(`v1.${"a".repeat(5000)}`);
      expect(await add(v.m)).toMatchObject({ ok: true, discarded: true, count: { lines: 1, items: 1 } });
    });
  });

  describe("reading the bag", () => {
    it("reports every line's state without dropping any", async () => {
      await add(v.m, 2);
      await add(v.l);
      await add(v.s);
      await add(v.other);
      setRawBag(serializeBag([...bag(), { variantId: v.draft, quantity: 1, seenUnitPriceMinor: null }]));
      await prisma.productVariant.update({ where: { id: v.m }, data: { stock: 1 } }); // now insufficient
      await prisma.productVariant.update({ where: { id: v.l }, data: { priceMinor: 420000 } }); // price changed
      await prisma.productVariant.update({ where: { id: v.s }, data: { stock: 0 } }); // sold out
      await prisma.productVariant.delete({ where: { id: v.other } }); // gone

      const view = await describeBag(prisma, bag());
      const byId = new Map(view.lines.map((l) => [l.variantId, l]));
      expect(view.lines).toHaveLength(5);
      expect(byId.get(v.m)).toMatchObject({ status: "insufficient_stock", quantity: 2, maxQuantity: 1, unitPriceMinor: 380000, lowStock: true, display: { productName: "tie dress", size: "M", colour: "White" } });
      expect(byId.get(v.l)).toMatchObject({ status: "available", unitPriceMinor: 420000, lineTotalMinor: 420000, seenUnitPriceMinor: 400000, priceChanged: true });
      expect(byId.get(v.s)).toMatchObject({ status: "sold_out", maxQuantity: 0, unitPriceMinor: null, lineTotalMinor: null, display: { size: "S" } });
      expect(byId.get(v.other)).toMatchObject({ status: "not_found", display: null });
      // A never-published product is reported as unavailable, but never described.
      expect(byId.get(v.draft)).toMatchObject({ status: "unavailable", display: null, unitPriceMinor: null });
      expect(view.subtotalMinor).toBe(420000); // only lines that can be bought as they are
      expect(view.ready).toBe(false);
    });

    it("describes an archived product's line, since it was once public", async () => {
      const view = await describeBag(prisma, [{ variantId: v.archived, quantity: 1, seenUnitPriceMinor: 500000 }]);
      expect(view.lines[0]).toMatchObject({ status: "unavailable", priceChanged: false, display: { productSlug: "old-dress" } });
    });

    it("is ready when every line can be bought", async () => {
      await add(v.m, 2);
      await add(v.other);
      const view = await describeBag(prisma, bag());
      expect(view).toMatchObject({ ready: true, subtotalMinor: 2 * 380000 + 250000 });
      expect(view.lines.every((l) => !l.priceChanged)).toBe(true);
      expect(await describeBag(prisma, [])).toEqual({ lines: [], subtotalMinor: 0, ready: false });
    });

    it("never exposes stock above the per-line cap", async () => {
      await add(v.l);
      const [line] = (await describeBag(prisma, bag())).lines;
      expect(line.maxQuantity).toBe(5); // stock is 10
      expect(Object.keys(line)).not.toContain("stock");
    });
  });

  describe("isolation from orders and payments", () => {
    it("works with payments disabled, never consults the payment runtime, and creates no orders or payments", async () => {
      await add(v.m, 2);
      await add(v.l);
      await update(v.l, 3);
      await add(v.soldOut);
      await remove(v.m);
      await describeBag(prisma, bag());
      await actions.clearBagAction();
      expect(h.paymentDepsCalls).toBe(0);
      expect(await prisma.order.count()).toBe(0);
      expect(await prisma.orderItem.count()).toBe(0);
      expect(await prisma.paymentAttempt.count()).toBe(0);
      expect(await prisma.webhookEvent.count()).toBe(0);
      expect(await prisma.emailNotification.count()).toBe(0);
    });

    it("never changes stock", async () => {
      await add(v.m, 3);
      await update(v.m, 1);
      await remove(v.m);
      expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: v.m } })).stock).toBe(3);
    });
  });
});
