import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasTestDb, makeCategory, makeProduct, resetDb, testPrisma } from "../support/db";

// Product page to header count, against the test database: the fields the
// rendered Add to bag form submits are accepted by the real action, and the bag
// count the header renders afterwards reflects the new cookie. (In the browser,
// Next.js re-renders the page and layout after a Server Action sets a cookie.)

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ prefetch: async () => {} }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => h("a", { href, ...rest }, children) }));
vi.mock("@/server/db", async () => ({ db: (await import("../support/db")).testPrisma() }));

const { AddToBag } = await import("@/components/cart/add-to-bag");
const { BagCount } = await import("@/components/cart/bag-count");
const { addToBagAction } = await import("@/server/cart/actions");
const { initialBagState } = await import("@/server/cart/state");

describe.skipIf(!hasTestDb)("add to bag, then the header count", () => {
  const prisma = testPrisma();
  let white: string;
  let black: string;

  beforeEach(async () => {
    await resetDb(prisma);
    jar.clear();
    const cat = await makeCategory(prisma, "Dresses");
    await makeProduct(prisma, { categoryId: cat.id, slug: "tie-dress", priceMinor: 380000, variants: [{ size: "M", colour: "White", stock: 3 }, { size: "M", colour: "Black", stock: 1 }] });
    white = (await prisma.productVariant.findFirstOrThrow({ where: { colour: "White" } })).id;
    black = (await prisma.productVariant.findFirstOrThrow({ where: { colour: "Black" } })).id;
  });
  afterAll(() => prisma.$disconnect());

  /** Submits exactly what the rendered form would send. */
  async function submitRenderedForm(variantId: string) {
    const html = renderToStaticMarkup(h(AddToBag, { variantId }));
    const form = new FormData();
    for (const [, name, value] of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)) form.set(name, value);
    return addToBagAction(initialBagState, form);
  }
  const headerLabel = async () => renderToStaticMarkup(await BagCount({})).match(/aria-label="([^"]+)"/)?.[1];

  it("updates the count after each confirmed add, totalling units across lines", async () => {
    expect(await headerLabel()).toBe("Bag, empty");
    expect(await submitRenderedForm(white)).toMatchObject({ ok: true, outcome: "added", count: { lines: 1, items: 1 } });
    expect(await headerLabel()).toBe("Bag, 1 item");
    await submitRenderedForm(white);
    await submitRenderedForm(black);
    expect(await headerLabel()).toBe("Bag, 3 items");
  });

  it("leaves the count alone when the server refuses the add", async () => {
    await submitRenderedForm(black);
    expect(await submitRenderedForm(black)).toMatchObject({ ok: false, outcome: "at_limit" }); // only 1 in stock
    await prisma.productVariant.update({ where: { id: white }, data: { stock: 0 } });
    expect(await submitRenderedForm(white)).toMatchObject({ ok: false, outcome: "sold_out" });
    expect(await headerLabel()).toBe("Bag, 1 item");
    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.paymentAttempt.count()).toBe(0);
  });
});
