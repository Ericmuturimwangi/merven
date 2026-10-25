import { PaystackError, type InitializeInput, type PaystackClient, type PaystackTransaction } from "@/server/payments/paystack";
import { TEST_DB_TOKEN } from "./test-db-guard";

// In-memory stand-in for Paystack. Tests decide what initialize and verify return.
export function fakePaystack() {
  const initialized: InitializeInput[] = [];
  const verified: string[] = [];
  const transactions = new Map<string, PaystackTransaction>();
  let nextId = 1000;
  let initBehaviour: (input: InitializeInput) => void = () => {};
  let verifyBehaviour: (reference: string) => void = () => {};

  const client: PaystackClient = {
    async initialize(input) {
      initialized.push(input);
      initBehaviour(input);
      transactions.set(input.reference, {
        id: String(nextId++),
        domain: "test",
        status: "ongoing",
        reference: input.reference,
        amount: input.amountMinor,
        currency: input.currency,
        channel: null,
        paidAt: null,
        gatewayResponse: null,
      });
      return { authorizationUrl: `https://checkout.paystack.com/${input.reference.toLowerCase()}`, reference: input.reference };
    },
    async verify(reference) {
      verified.push(reference);
      verifyBehaviour(reference);
      const tx = transactions.get(reference);
      if (!tx) throw new PaystackError("not_found", "Transaction not found", 404);
      return { ...tx };
    },
  };

  return {
    client,
    initialized,
    verified,
    /** Simulate the customer finishing (or not) on Paystack's side. */
    settle(reference: string, patch: Partial<PaystackTransaction>) {
      const tx = transactions.get(reference);
      if (!tx) throw new Error(`no transaction ${reference}`);
      transactions.set(reference, {
        ...tx,
        ...(patch.status === "success" ? { paidAt: "2026-10-22T10:00:00.000Z", channel: "mobile_money", gatewayResponse: "Approved" } : {}),
        ...patch,
      });
    },
    /** A transaction that exists at Paystack although our initialize call failed. */
    create(reference: string, amount: number, status = "ongoing") {
      transactions.set(reference, { id: String(nextId++), domain: "test", status, reference, amount, currency: "KES", channel: null, paidAt: null, gatewayResponse: null });
    },
    failInitialize(error: PaystackError | null) {
      initBehaviour = error ? () => { throw error; } : () => {};
    },
    failVerify(error: PaystackError | null) {
      verifyBehaviour = error ? () => { throw error; } : () => {};
    },
  };
}

/** Token the test database is marked with (see tests/support/test-db-guard.ts). Not a secret. */
export { TEST_DB_TOKEN };

export const testPaymentConfig = {
  enabled: true as const,
  mode: "test" as const,
  environment: "local" as const,
  testDatabaseToken: TEST_DB_TOKEN,
  secretKey: "sk_test_0123456789abcdef0123",
  callbackUrl: "http://localhost:3000/checkout/callback",
  channels: ["card" as const, "mobile_money" as const],
};

export const testOrderOpts = { testMode: true, testDatabaseToken: TEST_DB_TOKEN };
