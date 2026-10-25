import { describe, expect, it } from "vitest";
import { configuredMailer, createSmtpMailer, MailerError } from "@/server/notifications/mailer";

// Gmail SMTP mailer, with a fake transport: nothing here connects to Gmail.

const email = { to: "amina@example.com", subject: "Your receipt", html: "<p>Thanks</p>", text: "Thanks", idempotencyKey: "receipt-abc123" };
const APP_PASSWORD = "abcd efgh ijkl mnop"; // the shape Google shows; not a real password

describe("Gmail configuration", () => {
  const base = { EMAIL_PROVIDER: "gmail", SMTP_USER: "MervenFashions254@gmail.com", SMTP_PASSWORD: APP_PASSWORD };

  it("is enabled only with an address and a 16-letter app password", () => {
    expect(configuredMailer(base)?.name).toBe("gmail");
    expect(configuredMailer({ ...base, SMTP_PASSWORD: "abcdefghijklmnop" })?.name).toBe("gmail"); // spaces optional
    expect(configuredMailer({ ...base, SMTP_USER: undefined })).toBeNull();
    expect(configuredMailer({ ...base, SMTP_USER: "not-an-email" })).toBeNull();
    expect(configuredMailer({ ...base, SMTP_PASSWORD: undefined })).toBeNull();
    expect(configuredMailer({ ...base, SMTP_PASSWORD: "MyGmailPassword1" })).toBeNull(); // an account password is not an app password
    expect(configuredMailer({ ...base, SMTP_PASSWORD: "abcd efgh ijkl" })).toBeNull();
  });

  it("leaves the other providers as they were", () => {
    expect(configuredMailer({})).toBeNull();
    expect(configuredMailer({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_abc", EMAIL_FROM: "Merven <r@merven.example>" })?.name).toBe("resend");
    expect(configuredMailer({ EMAIL_PROVIDER: "log" })?.name).toBe("log");
  });
});

describe("Gmail SMTP mailer", () => {
  const fakeTransport = (behaviour: (m: Record<string, unknown>) => Promise<{ messageId?: string }>) => {
    const sent: Record<string, unknown>[] = [];
    return { sent, transport: { sendMail: (m: Record<string, unknown>) => (sent.push(m), behaviour(m)) } };
  };

  it("sends the receipt with a stable Message-ID derived from the notification", async () => {
    const t = fakeTransport(async (m) => ({ messageId: m.messageId as string }));
    const mailer = createSmtpMailer({ user: "mervenfashions254@gmail.com", password: "x", from: "Merven Fashions <mervenfashions254@gmail.com>", transport: t.transport });
    expect(await mailer.send(email)).toEqual({ messageId: "<receipt-abc123@merven.receipts>" });
    expect(t.sent[0]).toEqual({
      from: "Merven Fashions <mervenfashions254@gmail.com>",
      to: "amina@example.com",
      subject: "Your receipt",
      html: "<p>Thanks</p>",
      text: "Thanks",
      messageId: "<receipt-abc123@merven.receipts>",
    });
    await mailer.send(email); // a retry carries the same Message-ID
    expect(t.sent[1].messageId).toBe(t.sent[0].messageId);
  });

  it("retries temporary failures and not rejections, without echoing the server's reply", async () => {
    const failWith = (err: object) => createSmtpMailer({ user: "u@gmail.com", password: "x", from: "u@gmail.com", transport: fakeTransport(async () => Promise.reject(Object.assign(new Error("535 5.7.8 Username and Password not accepted for u@gmail.com"), err))).transport });
    const outcome = async (err: object) => {
      try {
        await failWith(err).send(email);
        return null;
      } catch (e) {
        expect(e).toBeInstanceOf(MailerError);
        expect((e as Error).message).not.toMatch(/@|Password/);
        return (e as MailerError).retryable;
      }
    };
    expect(await outcome({ code: "EAUTH", responseCode: 535 })).toBe(false); // wrong app password
    expect(await outcome({ responseCode: 550 })).toBe(false);
    expect(await outcome({ responseCode: 421 })).toBe(true); // server busy
    expect(await outcome({ code: "ETIMEDOUT" })).toBe(true);
    expect(await outcome({ code: "ECONNECTION" })).toBe(true);
  });
});
