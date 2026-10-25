export type CheckoutState = {
  ok: boolean;
  message?: string;
  errors?: Partial<Record<"name" | "email" | "phone" | "items" | "expectedTotalMinor", string[]>>;
  /** The server re-priced or found unavailable items: the page must be reviewed again. */
  reviewAgain?: boolean;
  /** What the customer typed, so fields refill after React resets the form. */
  values?: { name: string; email: string; phone: string };
};

export const initialCheckoutState: CheckoutState = { ok: false };
