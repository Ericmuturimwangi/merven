import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { buildErrorReport, redact, safeErrorFields } from "@/lib/error-report";
import { sanitizePrismaError } from "@/server/db-errors";
import { ownerAlertEmail, renderOwnerAlert } from "@/server/notifications/owner-alerts";

// Customer data must never reach the logs. Fake data throughout.

const PII = /Amina|Secretname|amina\.secret@example\.com|712345678|0712 ?345 ?678/;
const invocation = (args: string) =>
  `\nInvalid \`prisma.order.create()\` invocation:\n\n{\n  data: {\n    customerName: "Amina Secretname",\n    customerEmail: "amina.secret@example.com",\n    customerPhone: "+254712345678",\n${args}  }\n}\n\nUnknown argument \`notAField\`. Available options are marked with ?.`;
const validationError = () => new Prisma.PrismaClientValidationError(invocation("    notAField: true\n"), { clientVersion: "7.10.1" });
const uniqueError = () =>
  new Prisma.PrismaClientKnownRequestError(`${invocation("")}\nUnique constraint failed on the fields: (\`customerEmail\`) with value amina.secret@example.com`, {
    code: "P2002",
    clientVersion: "7.10.1",
    meta: { modelName: "Order", target: ["checkoutKey"], driverAdapterError: { cause: { originalMessage: "Key (email)=(amina.secret@example.com) already exists" } } },
  });

describe("Prisma errors are made safe at the source", () => {
  it("keeps the operation, class, code and field names, and nothing from the arguments", () => {
    const e = sanitizePrismaError(uniqueError()) as Prisma.PrismaClientKnownRequestError;
    expect(e).toBeInstanceOf(Prisma.PrismaClientKnownRequestError); // instanceof checks still work
    expect(e.code).toBe("P2002"); // so do code checks (unique violations)
    expect(e.message).toBe("Invalid `prisma.order.create()` invocation (PrismaClientKnownRequestError P2002 on checkoutKey)");
    expect(`${e.message}\n${e.stack}\n${JSON.stringify(e.meta)}`).not.toMatch(PII);
    expect(e.meta).toEqual({ modelName: "Order", target: ["checkoutKey"] });
    expect(e.stack?.split("\n")[0]).toBe(`PrismaClientKnownRequestError: ${e.message}`);
  });

  it("keeps a violated constraint's name and SQLSTATE, but not the row values around them", () => {
    const check = new Prisma.PrismaClientKnownRequestError(
      `${invocation("")}\nDatabase error. Code: \`23505\`. Message: \`duplicate key value violates unique constraint "order_reference_key"\` Detail: Key (customerEmail)=(amina.secret@example.com) already exists.`,
      { code: "P2010", clientVersion: "7.10.1" },
    );
    const e = sanitizePrismaError(check) as Error;
    expect(e.message).toBe("Invalid `prisma.order.create()` invocation (PrismaClientKnownRequestError P2010, SQLSTATE 23505, constraint order_reference_key)");
    expect(`${e.message}\n${e.stack}`).not.toMatch(PII);
  });

  it("covers validation errors too", () => {
    const e = sanitizePrismaError(validationError()) as Error;
    expect(e).toBeInstanceOf(Prisma.PrismaClientValidationError);
    expect(`${e.message}\n${e.stack}`).not.toMatch(PII);
  });

  it("leaves other errors alone", () => {
    const plain = new Error("something else");
    expect(sanitizePrismaError(plain)).toBe(plain);
    expect(plain.message).toBe("something else");
  });
});

describe("log lines", () => {
  it("report a Prisma error by class and code only, even if it was never sanitized", () => {
    const report = buildErrorReport(uniqueError(), { path: "/checkout?token=abc", method: "POST" }, { routePath: "/checkout", routeType: "action" });
    expect(report).toMatchObject({ name: "PrismaClientKnownRequestError", message: "PrismaClientKnownRequestError P2002", path: "/checkout" });
    expect(JSON.stringify(report)).not.toMatch(PII);
    expect(JSON.stringify(report)).not.toContain("token=abc");
    expect(safeErrorFields(validationError())).toEqual({ errorName: "PrismaClientValidationError" });
    expect(safeErrorFields(uniqueError())).toEqual({ errorName: "PrismaClientKnownRequestError", code: "P2002" });
  });

  it("redact email addresses and Kenyan phone numbers in other errors", () => {
    for (const phone of ["+254712345678", "254712345678", "0712345678", "+254112345678"]) expect(redact(`call ${phone} now`)).toBe("call [phone] now");
    expect(redact("order 12345678901234 total 3800")).toBe("order 12345678901234 total 3800"); // other numbers stay
    const fields = safeErrorFields(new Error("Could not send to amina.secret@example.com (+254712345678) with Bearer abcdefghijkl"));
    expect(fields.message).toBe("Could not send to [email] ([phone]) with Bearer [redacted]");
    expect(safeErrorFields("not an error")).toEqual({ errorName: "unknown" });
  });
});

describe("owner alerts carry no customer details", () => {
  it("names the order, the problem and the admin link only", () => {
    const alert = renderOwnerAlert({
      kind: "ALERT_DUPLICATE_PAYMENT",
      reference: "MRV-ABCDEFGHJK",
      testMode: false,
      status: "PAID",
      stockStatus: "DEDUCTED",
      totalMinor: 250000,
      needsAttention: "Possible duplicate purchase: order MRV-ZYXWVUTSRQ was also paid by the same customer for the same pieces.",
      adminUrl: "https://mervenfashions.co.ke/admin/orders/cm123",
    });
    expect(alert.subject).toBe("Merven order MRV-ABCDEFGHJK: possible duplicate payment");
    expect(alert.text).toContain("https://mervenfashions.co.ke/admin/orders/cm123");
    expect(alert.text).toContain("KES 2,500");
    expect(alert.text).toContain("Nothing has been refunded or changed automatically.");
    expect(alert.html).not.toMatch(/<script/);
  });

  it("marks test orders and escapes notes in HTML", () => {
    const alert = renderOwnerAlert({ kind: "ALERT_REFUND", reference: "TEST-MRV-ABCDEFGHJK", testMode: true, status: "PAID", stockStatus: "DEDUCTED", totalMinor: 1, needsAttention: "<b>x</b>", adminUrl: "u" });
    expect(alert.subject.startsWith("[TEST] ")).toBe(true);
    expect(alert.html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("reads the recipient only from a valid OWNER_ALERT_EMAIL", () => {
    expect(ownerAlertEmail({ OWNER_ALERT_EMAIL: " owner@example.com " })).toBe("owner@example.com");
    for (const bad of [undefined, "", "not-an-email", "a b@example.com", "<x@example.com>"]) expect(ownerAlertEmail({ OWNER_ALERT_EMAIL: bad })).toBeNull();
  });
});
