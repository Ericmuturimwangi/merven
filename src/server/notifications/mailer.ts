// Email delivery adapter. No provider is assumed:
//
//   EMAIL_PROVIDER=resend   send through Resend's HTTP API (needs RESEND_API_KEY, EMAIL_FROM)
//   EMAIL_PROVIDER=gmail    send through Gmail's SMTP server with a Google app password
//                           (needs SMTP_USER, SMTP_PASSWORD; EMAIL_FROM is optional)
//   EMAIL_PROVIDER=log      development only: log that a message would be sent (no content, no address)
//   (unset)                 disabled: receipts stay queued and visible in the admin
//
// The idempotency key (the notification id) lets Resend drop a duplicate send if
// we retry after a send whose response we never saw (keys last 24 hours). Over
// SMTP it becomes the Message-ID, so Gmail treats a repeat as the same message.

import { createTransport } from "nodemailer";

export type OutgoingEmail = { to: string; subject: string; html: string; text: string; idempotencyKey: string };
export type SendResult = { messageId: string | null };

export interface Mailer {
  readonly name: string;
  send(email: OutgoingEmail): Promise<SendResult>;
}

export class MailerError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "MailerError";
  }
}

export function maskEmail(address: string): string {
  const [user, domain] = address.split("@");
  return domain ? `${user.slice(0, 1)}***@${domain}` : "***";
}

export function createResendMailer(opts: { apiKey: string; from: string; fetch?: typeof fetch; timeoutMs?: number }): Mailer {
  const doFetch = opts.fetch ?? fetch;
  return {
    name: "resend",
    async send(email) {
      let res: Response;
      try {
        res = await doFetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": email.idempotencyKey,
          },
          body: JSON.stringify({ from: opts.from, to: [email.to], subject: email.subject, html: email.html, text: email.text }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
          cache: "no-store",
        });
      } catch {
        throw new MailerError("Email provider unreachable", true);
      }
      if (!res.ok) throw new MailerError(`Email provider responded with HTTP ${res.status}`, res.status === 429 || res.status >= 500);
      const body = (await res.json().catch(() => ({}))) as { id?: unknown };
      return { messageId: typeof body.id === "string" ? body.id : null };
    },
  };
}

type SmtpTransport = { sendMail(message: Record<string, unknown>): Promise<{ messageId?: string }> };

/** Transient SMTP failures (network, 4xx replies) are retried; rejections (5xx, bad login) are not. */
function smtpRetryable(e: unknown): boolean {
  const err = e as { code?: unknown; responseCode?: unknown };
  if (typeof err.responseCode === "number") return err.responseCode >= 400 && err.responseCode < 500;
  return err.code === "ECONNECTION" || err.code === "ETIMEDOUT" || err.code === "ESOCKET" || err.code === "EDNS";
}

/** Gmail (or any SMTP server) over TLS on port 465. `transport` is for tests. */
export function createSmtpMailer(opts: { user: string; password: string; from: string; host?: string; transport?: SmtpTransport }): Mailer {
  const transport: SmtpTransport =
    opts.transport ??
    createTransport({
      host: opts.host ?? "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: opts.user, pass: opts.password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  return {
    name: "gmail",
    async send(email) {
      try {
        const info = await transport.sendMail({
          from: opts.from,
          to: email.to,
          subject: email.subject,
          html: email.html,
          text: email.text,
          messageId: `<${email.idempotencyKey}@merven.receipts>`,
        });
        return { messageId: info.messageId ?? null };
      } catch (e) {
        // Never echo the server's reply: it can contain the address or account details.
        const code = (e as { responseCode?: unknown; code?: unknown }).responseCode ?? (e as { code?: unknown }).code ?? "unknown";
        throw new MailerError(`Email server refused or was unreachable (${String(code).slice(0, 20)})`, smtpRetryable(e));
      }
    },
  };
}

/** A Google app password: 16 letters, shown by Google in groups of four (spaces are ignored). */
function appPassword(raw: string | undefined): string | null {
  const value = raw?.replace(/\s+/g, "") ?? "";
  return /^[a-z]{16}$/i.test(value) ? value : null;
}

export const logMailer: Mailer = {
  name: "log",
  async send(email) {
    console.info(JSON.stringify({ level: "info", event: "email_logged", to: maskEmail(email.to), subject: email.subject }));
    return { messageId: null };
  },
};

/** The configured mailer, or null when email is not set up (receipts then stay queued). */
export function configuredMailer(env: Record<string, string | undefined> = process.env): Mailer | null {
  const provider = env.EMAIL_PROVIDER?.trim();
  if (provider === "resend") {
    const apiKey = env.RESEND_API_KEY?.trim();
    const from = env.EMAIL_FROM?.trim();
    if (!apiKey?.startsWith("re_") || !from) return null;
    return createResendMailer({ apiKey, from });
  }
  if (provider === "gmail") {
    const user = env.SMTP_USER?.trim().toLowerCase();
    const password = appPassword(env.SMTP_PASSWORD);
    if (!user || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user) || !password) return null;
    // Gmail sends as the signed-in account; another From address needs a verified "Send mail as" alias.
    return createSmtpMailer({ user, password, from: env.EMAIL_FROM?.trim() || `Merven Fashions <${user}>` });
  }
  if (provider === "log" && env.VERCEL_ENV !== "production") return logMailer;
  return null;
}
