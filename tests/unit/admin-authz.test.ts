import { beforeEach, describe, expect, it, vi } from "vitest";

// Every server action is a public POST endpoint. These tests call each exported
// action directly (as an attacker could) and assert that nothing touches the
// database or cache unless an active administrator session exists.

class RedirectError extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT:${url}`);
  }
}

const state = vi.hoisted(() => ({
  session: null as null | { user: { id: string } },
  adminRow: null as null | { id: string; name: string; email: string; isActive: boolean },
  dbCalls: [] as string[],
  cacheCalls: [] as string[],
  storageCalls: [] as string[],
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));
vi.mock("next/cache", () => ({
  updateTag: (t: string) => state.cacheCalls.push(`updateTag:${t}`),
  refresh: () => state.cacheCalls.push("refresh"),
  cacheTag: () => undefined,
  cacheLife: () => undefined,
}));
vi.mock("@/server/auth/auth", () => ({ auth: { api: { getSession: async () => state.session } } }));
vi.mock("@/server/images/storage", () => ({
  imageStorage: () => ({
    put: async () => {
      state.storageCalls.push("put");
      return { key: "k", url: "/u" };
    },
    remove: async () => void state.storageCalls.push("remove"),
  }),
}));
vi.mock("@/server/db", () => {
  // Records every model access; only the admin lookup used by getAdmin() is answered.
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => async () => {
          if (name === "adminUser" && method === "findUnique") return state.adminRow;
          state.dbCalls.push(`${name}.${method}`);
          return null;
        },
      },
    );
  return { db: new Proxy({}, { get: (_t, prop: string) => model(prop) }) };
});

const actions = await import("@/server/admin/actions");
const adminQueries = await import("@/server/admin/queries");
const actionEntries = Object.entries(actions).filter(([, v]) => typeof v === "function") as [
  string,
  (prev: unknown, form: FormData) => Promise<unknown>,
][];

function plausibleForm(): FormData {
  const f = new FormData();
  const fields: Record<string, string> = {
    id: "abc123",
    productId: "abc123",
    variantId: "abc123",
    imageId: "abc123",
    categoryId: "abc123",
    name: "Valid Name",
    description: "A valid description for testing.",
    price: "4500",
    size: "M",
    colour: "Black",
    stock: "5",
    status: "PUBLISHED",
    featured: "true",
    direction: "up",
    alt: "Valid alt text",
  };
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  f.set("file", new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0])], { type: "image/jpeg" }));
  return f;
}

beforeEach(() => {
  state.session = null;
  state.adminRow = null;
  state.dbCalls = [];
  state.cacheCalls = [];
  state.storageCalls = [];
});

describe("admin server action authorisation", () => {
  it("covers every exported action", () => {
    expect(actionEntries.length).toBeGreaterThanOrEqual(14);
  });

  const scenarios = [
    ["no session", () => {}],
    [
      "a session whose admin was deleted",
      () => {
        state.session = { user: { id: "u1" } };
        state.adminRow = null;
      },
    ],
    [
      "a session for a deactivated admin",
      () => {
        state.session = { user: { id: "u1" } };
        state.adminRow = { id: "u1", name: "x", email: "x@y.z", isActive: false };
      },
    ],
  ] as const;

  for (const [label, arrange] of scenarios) {
    describe(`with ${label}`, () => {
      it.each(actionEntries.map(([name, fn]) => [name, fn] as const))("%s redirects to login without side effects", async (_name, fn) => {
        arrange();
        await expect(fn({ ok: false }, plausibleForm())).rejects.toMatchObject({ url: "/admin/login" });
        expect(state.dbCalls).toEqual([]);
        expect(state.cacheCalls).toEqual([]);
        expect(state.storageCalls).toEqual([]);
      });
    });
  }

  it("lets an active admin through to validation and the database", async () => {
    state.session = { user: { id: "u1" } };
    state.adminRow = { id: "u1", name: "Admin", email: "a@b.c", isActive: true };
    const invalid = await actions.setVariantStockAction({ ok: false }, Object.assign(new FormData(), {}));
    expect(invalid).toMatchObject({ ok: false });
    expect(state.dbCalls).toEqual([]);

    const form = new FormData();
    form.set("variantId", "abc123");
    form.set("stock", "4");
    await actions.setVariantStockAction({ ok: false }, form);
    expect(state.dbCalls).toContain("productVariant.findUnique");
  });
});

describe("admin read queries", () => {
  const reads: [string, () => Promise<unknown>][] = [
    ["listAdminProducts", () => adminQueries.listAdminProducts({})],
    ["getAdminProduct", () => adminQueries.getAdminProduct("abc123")],
    ["listAdminCategories", () => adminQueries.listAdminCategories()],
    ["getAdminStats", () => adminQueries.getAdminStats()],
  ];

  it("covers every exported admin query", () => {
    expect(Object.keys(adminQueries).sort()).toEqual(reads.map(([n]) => n).sort());
  });

  it.each(reads)("%s exposes nothing (drafts included) without an active admin", async (_name, call) => {
    state.session = { user: { id: "u1" } };
    state.adminRow = { id: "u1", name: "x", email: "x@y.z", isActive: false };
    await expect(call()).rejects.toMatchObject({ url: "/admin/login" });
    expect(state.dbCalls).toEqual([]);
  });
});
