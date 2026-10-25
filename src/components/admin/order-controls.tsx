"use client";

import { recheckPaymentAction, recoverPaymentsAction, retryReceiptAction } from "@/server/admin/actions";
import { FormMessage, SubmitButton, useAdminForm } from "./form-bits";

export function OrderControls({ id, canRecheck, canRetryReceipt }: { id: string; canRecheck: boolean; canRetryReceipt: boolean }) {
  const recheck = useAdminForm(recheckPaymentAction);
  const receipt = useAdminForm(retryReceiptAction);
  return (
    <div className="flex flex-wrap gap-6">
      {canRecheck && (
        <form {...recheck.formProps} className="space-y-2">
          <input type="hidden" name="id" value={id} />
          <SubmitButton pending={recheck.pending} variant="secondary">{recheck.pending ? "Checking…" : "Re-check payment with Paystack"}</SubmitButton>
          <FormMessage state={recheck.state} />
        </form>
      )}
      {canRetryReceipt && (
        <form {...receipt.formProps} className="space-y-2">
          <input type="hidden" name="id" value={id} />
          <SubmitButton pending={receipt.pending} variant="secondary">{receipt.pending ? "Sending…" : "Retry receipt email"}</SubmitButton>
          <FormMessage state={receipt.state} />
        </form>
      )}
    </div>
  );
}

/** Orders list: run payment recovery now instead of waiting for the daily cron. */
export function RecoverPaymentsControl() {
  const recover = useAdminForm(recoverPaymentsAction);
  return (
    <form {...recover.formProps} className="space-y-2">
      <SubmitButton pending={recover.pending} variant="secondary">{recover.pending ? "Checking…" : "Check recent unpaid attempts with Paystack"}</SubmitButton>
      <FormMessage state={recover.state} />
    </form>
  );
}
