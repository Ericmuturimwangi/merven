# Merven Fashions — Catalogue

A mobile-first catalogue for Merven Fashions, a Kenyan women's boutique. Customers browse and then enquire on WhatsApp. This release has no cart, checkout, payments or customer accounts.

**Stack:** Next.js 16.4 (App Router, Cache Components) · React 19 · TypeScript · Tailwind CSS 4 · PostgreSQL · Prisma 7 (`@prisma/adapter-pg`) · Better Auth 1.7 · Zod 4 · Vitest 5 · pnpm 11

## Local setup

```bash
pnpm install                  # also runs `prisma generate`
cp .env.example .env          # then fill in values (see below)
pnpm db:migrate               # apply migrations to DATABASE_URL
pnpm placeholders:generate    # placeholder product images → public/placeholders
pnpm db:seed                  # 6 categories, 30 placeholder products
pnpm admin:create --email you@example.com --name "Your Name"   # prompts for password
pnpm dev
```

The admin area is at `/admin`. There is no public sign-up. Admins can only be created with `pnpm admin:create`, which needs database access. Running it again for an existing email resets that admin's password, re-activates the account and signs out all of its sessions. To deactivate an admin, set `isActive = false` on `admin_user`.

## Scripts

| Script | Purpose |
|---|---|
| `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` | Quality gates |
| `pnpm db:migrate` | Create and apply migrations in development |
| `pnpm db:deploy` | Apply committed migrations (production) |
| `pnpm db:seed` | Idempotent placeholder seed. Refuses to run in production unless `SEED_ALLOW_PRODUCTION=1` |
| `pnpm admin:create` | Create or reset an administrator |
| `pnpm db:backup` | `pg_dump` (custom format) to `./backups`, verified with `pg_restore --list`, keeps 14 |
| `pnpm db:restore-test [file]` | Restores a backup into a scratch database, compares row counts and constraints, then drops it |
| `pnpm storage:setup` | Creates or updates the Supabase `product-images` bucket (idempotent) |
| `pnpm storage:verify` | Live check of the Supabase bucket: secret-key upload, public read, anonymous writes refused, delete |

The integration tests use `TEST_DATABASE_URL`, a separate disposable database whose tables are **truncated** on every run. If that variable is unset, the integration tests are skipped.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Runtime connection. On Vercel use a pooled URL (e.g. Neon `-pooler`) |
| `BETTER_AUTH_SECRET` | yes | ≥ 32 chars. `openssl rand -base64 32`. Changing it signs everyone out |
| `BETTER_AUTH_URL` | yes | Public origin, e.g. `https://mervenfashions.co.ke`. Used for CSRF and origin checks |
| `NEXT_PUBLIC_SITE_URL` | yes | Same origin. Used for canonical URLs, sitemap and WhatsApp product links |
| `WHATSAPP_NUMBER` | yes | Digits only, international format (Kenya: `2547XXXXXXXX`) |
| `IMAGE_STORAGE` | yes | `supabase` in production. `local` is for local development only and is rejected on Vercel |
| `SUPABASE_URL` | when `supabase` | Project URL, `https://<project-ref>.supabase.co`. Also needed **at build time** (it scopes `next/image`) |
| `SUPABASE_SECRET_KEY` | when `supabase` | **Server-only** secret key (`sb_secret_…`). Publishable and legacy JWT keys are rejected. Never prefix with `NEXT_PUBLIC_` |
| `SUPABASE_STORAGE_BUCKET` | no | Default `product-images`. Also read at build time |
| `SUPABASE_PUBLISHABLE_KEY` | no | Only used by `pnpm storage:verify`, to prove browser keys can't write |
| `LOCAL_UPLOAD_DIR` | no | Default `./uploads` (local driver only) |
| `TEST_DATABASE_URL` | tests | Disposable database. Must differ from `DATABASE_URL` |
| `BACKUP_DATABASE_URL` | backups | Direct (non-pooled) URL for `pg_dump`. Falls back to `DATABASE_URL` |

## Deploying to Vercel

1. Create a PostgreSQL database (Neon, Supabase or Vercel Postgres) in a region close to Kenya, e.g. `eu-central`. Note the pooled and direct URLs.
2. Set up Supabase Storage for product images (see [Supabase Storage setup](#supabase-storage-setup)). The local image driver **does not work on Vercel**, because its filesystem is not persistent, so env validation rejects it there.
3. Import the project into Vercel and set every variable in the table above for Production (and Preview, pointing at a separate database).
4. Apply migrations against production before the first deploy, using the direct URL:
   `DATABASE_URL=<direct-url> pnpm db:deploy`
5. Create the owner's admin account:
   `DATABASE_URL=<direct-url> pnpm admin:create --email … --name …`
6. In **Project Settings → Functions**, set the region to **Dublin (`dub1`)** to sit next to Supabase `eu-west-1`. Each database round trip from far away costs about 300 ms; from the same region it's 1–2 ms.
7. Deploy. **The build reads the database:** catalogue pages are prerendered from cached queries, so `DATABASE_URL` must be reachable at build time.
8. Load products through the admin, or seed placeholders deliberately with `SEED_ALLOW_PRODUCTION=1` and replace them.

### Supabase Postgres setup

Create the tables with Prisma migrations, never by hand in the Table Editor.

1. In the Supabase dashboard, click **Connect** and copy two connection strings. URL-encode any special characters in the password.
   - **Session pooler** (port 5432, IPv4): used for migrations, `admin:create`, seeding and backups from your machine.
   - **Transaction pooler** (port 6543): used as `DATABASE_URL` on Vercel, for both the build and runtime. The session pooler allows only 15 clients, and parallel build workers exceed that (`EMAXCONNSESSION`). Each process is also capped at 3 connections (`src/server/prisma-client.ts`).
   Append the TLS settings to **both** URLs. The app refuses unencrypted connections to remote databases, and these settings make it verify Supabase's certificate against `certs/supabase-ca-2021.crt` (Supabase Root 2021 CA, from **Database → Settings → SSL Configuration**; it is also bundled in `src/server/certs/supabase-root-ca.ts`):
   ```
   ?sslmode=require&sslcert=certs/supabase-ca-2021.crt&sslaccept=strict
   ```
2. Apply the migrations:
   ```bash
   DATABASE_URL='<session pooler URL>' pnpm db:deploy
   ```
3. Check that the Data API exposes nothing. Both of these must fail or return `[]`:
   ```bash
   curl -s "https://<ref>.supabase.co/rest/v1/admin_account?select=*" -H "apikey: <publishable key>"
   curl -s "https://<ref>.supabase.co/rest/v1/product?select=*"       -H "apikey: <publishable key>"
   ```
   The migration `lock_down_supabase_data_api` enables RLS (no policies) on every table and revokes `anon`/`authenticated` access. For extra safety you can also turn the Data API off in **Project Settings → Data API**, since this app doesn't use it.
4. Create the owner's admin account: `DATABASE_URL='<session pooler URL>' pnpm admin:create --email … --name …`
5. Optional placeholder catalogue: `DATABASE_URL='<session pooler URL>' pnpm db:seed`
6. Backups: `BACKUP_DATABASE_URL='<session pooler URL>' pnpm db:backup`

Keep `.env`'s `DATABASE_URL` pointed at your local database, so development never writes to production. Every future migration that adds a table must also enable RLS on it; `tests/integration/row-level-security.test.ts` fails if one doesn't.

### Supabase Storage setup

Only Supabase **Storage** is used. The PostgreSQL database stays where it is.

1. Create a Supabase project (or use an existing one) in a region close to Kenya.
2. In **Project Settings → API Keys**, create a **secret key** (`sb_secret_…`). Put it in `SUPABASE_SECRET_KEY` in `.env` and in Vercel, scoped to Production and Preview. Never paste it into client code or a `NEXT_PUBLIC_` variable.
3. Set `SUPABASE_URL` (and optionally `SUPABASE_PUBLISHABLE_KEY` for the verify script), then run:
   ```bash
   pnpm storage:setup     # creates/updates the bucket
   pnpm storage:verify    # live checks; exits non-zero on any failure
   ```
4. Check that no policy grants writes to the bucket. In the SQL editor, this should return **no rows**:
   ```sql
   select policyname, roles, cmd from pg_policies
   where schemaname = 'storage' and tablename = 'objects';
   ```
   If other buckets need policies, make sure none of them apply to `bucket_id = 'product-images'` for `anon` or `authenticated`.
5. Set `IMAGE_STORAGE=supabase` and redeploy.

**Bucket policy**
- Public read: product photos are fetched by URL (`/storage/v1/object/public/product-images/…`). Only published products' image URLs are ever rendered. A draft's image is readable only by someone who already knows its random URL.
- Only `image/webp` files, at most 5 MB. The app re-encodes every upload to WebP before storing it.
- No `storage.objects` RLS policies, so anonymous and signed-in Supabase users can't list, upload, overwrite or delete anything. Only the server, using the secret key behind `requireAdmin()`, can write.
- Object paths are `products/<productId>/<uuid>.webp`. They are generated server-side, validated against a strict pattern on upload and delete, and uploaded with `upsert: false` so they are never overwritten.

**Consistency.** If storage fails, no database row is written. If the database write fails after an upload, the uploaded object is removed. Deleting an image removes the database row first and then the file. If the file delete fails, the error is logged and an unreferenced object remains, which is never shown. Seeded `placeholder:` images live in `public/` and are never sent to Supabase.

### Backups

- Turn on your provider's point-in-time recovery (e.g. Neon's history retention).
- Also take independent logical backups: run `pnpm db:backup` on a schedule (e.g. a daily cron or GitHub Action with `BACKUP_DATABASE_URL`), and copy `./backups` to separate storage.
- Run `pnpm db:restore-test` after setting up backups and at least monthly. It needs a role with `CREATE DATABASE` (set `RESTORE_SERVER_URL` if that differs from the source server).

## Online payments (Paystack)

Online checkout is **off by default**. Local and preview deployments only ever use Paystack **test mode**. Real-money (**live**) checkout runs only on the Vercel production deployment, and only when every live setting is present (see [Live mode](#live-mode-production) below). The WhatsApp ordering flow is unchanged and remains the primary way to order.

**How it works**
- **Checkout:** "Buy now" on a product page opens `/checkout`. The server re-prices the basket from the database, checking publication, active variants, stock and quantity limits (1–5 per line). If the server total differs from what the customer reviewed, they are sent back to review.
- **Order creation:** the order is created with its first payment attempt (a unique reference) *before* Paystack is called. Paystack's checkout URL is only accepted from `https://checkout.paystack.com`.
- **What marks an order paid:** only a server-side `GET /transaction/verify/:reference`, after checking the reference, amount, currency `KES` and environment (`domain: "test"`). A redirect, a webhook payload or a client message never does.
- **Callback and webhook:** both `/checkout/callback` and the webhook (`/api/webhooks/paystack`, HMAC-SHA512 of the raw body, timing-safe compare) go through the same idempotent, row-locked update.
- **Duplicates:** duplicate and concurrent webhooks are deduplicated, and a second successful payment is flagged for a manual refund.
- **Stock:** nothing is reserved at checkout. Stock is deducted once when payment is confirmed; an oversell is flagged ("stock shortfall") rather than refused or auto-refunded.
- **Order pages:** `/checkout/order/<reference>?token=…` uses an HMAC token derived from `BETTER_AUTH_SECRET`. Without the right token the order "doesn't exist".
- **Receipts:** queued in the same transaction that marks the order paid (one per order). They are sent after the response; failures retry with backoff up to 5 times, and a daily Vercel Cron (`/api/cron/receipts`, `CRON_SECRET`) retries the rest. Sending never affects payment state. Resend's `Idempotency-Key` prevents duplicates within 24 hours.
- **Admin:** `/admin/orders` shows orders, attempts, receipt status and anything flagged, with buttons to re-check a payment or retry a receipt.
- **Payment recovery (lost webhooks):** the daily cron first re-verifies recent attempts that could still have been paid (open ones, and abandoned or failed ones that reached Paystack's checkout page) from the last 7 days, through the same verify-then-apply path as webhooks. Each run checks at most 20 attempts, each at most every 6 hours, stops after two consecutive Paystack or database failures, and claims attempts atomically so overlapping runs never double-check one. A failure changes nothing and the attempt is retried next run. It is skipped while payments are disabled. Admins can run it on demand (*Check recent unpaid attempts* on `/admin/orders`), and *Re-check payment* on an order (and the customer's *check payment*) also re-checks that order's abandoned or failed attempts.
- **Owner alerts:** emailed to `OWNER_ALERT_EMAIL` (sent with the configured email provider, retried by the same daily cron) for a possible duplicate payment, a stock shortfall, a verification mismatch, a Paystack transaction already linked to another payment, a confirmed payment on an order no longer awaiting payment, a confirmed payment later reported reversed, and refunds and disputes reported by Paystack. One alert per order and problem: repeated deliveries don't repeat it, a new attempt or a new refund or dispute stage does. Alerts name the order and link to the admin page; they never include the customer's name, email or phone.
- **Refunds and disputes:** signed `refund.*` and `charge.dispute.*` webhooks add a dated note to the matching order (*Needs attention*) and alert the owner: for a refund when it is first reported and again if it fails or needs attention; for a dispute when it is opened, at most once a day for Paystack's reminders, and when it is resolved. Redeliveries of the same event are ignored (they are recognised by a digest of the event data, since these payloads carry no documented event id). They never change order status, payment status or stock: the app has no refund or dispute state yet, and refunds are made in the Paystack dashboard. An event whose transaction can't be matched exactly to one of our payments is acknowledged and logged (`webhook_follow_up_unmatched`).
- **Logs:** Prisma error messages repeat the failing call's arguments (customer data), so every Prisma error is reduced to its operation, class, code and field names before it can be logged (`src/server/db-errors.ts`); error logs also redact email addresses and Kenyan phone numbers.

**When test checkout is enabled (fail-closed)**

Checkout runs only when **all** of these hold. Otherwise it is off and the product page shows WhatsApp ordering only.
- `PAYMENTS_ENABLED="true"`, `PAYSTACK_MODE="test"` and a `sk_test_…` secret key.
- `PAYMENTS_ENVIRONMENT` is set explicitly. There is no default.
  - **`local`:** no Vercel system variables are present and `NEXT_PUBLIC_SITE_URL` is `http(s)://localhost` or `127.0.0.1`.
  - **`preview`:** `VERCEL=1`, `VERCEL_ENV=preview`, `VERCEL_TARGET_ENV` absent or `preview`, and `VERCEL_PROJECT_PRODUCTION_URL` present. In the Vercel project settings, enable **"Automatically expose System Environment Variables"**. `NEXT_PUBLIC_SITE_URL` must be `https` and must not be the production domain.
- **Test settings are always refused in production:** any `VERCEL_ENV`/`VERCEL_TARGET_ENV` of `production` with `local` or `preview` settings, or any unrecognised value. If the system variables are hidden on production, no environment can be positively identified, so checkout stays off. Production runs only in live mode (below).
- **Database marker:** `PAYMENTS_TEST_DATABASE_TOKEN` (24–128 characters of `A–Z a–z 0–9 _ -`) must match a marker stored on the connected database itself, as the database comment `merven-test-payments:<token>`. To set it safely, follow "Test mode locally" below; don't type the token into a command. The marker is checked:
  - before checkout is shown;
  - when an order is created;
  - before Paystack is called;
  - inside the transaction that marks a test order paid and deducts stock.

  If it is missing or different, nothing is written. A webhook gets a `503` so Paystack retries it later.
- **Previews:** use a separate, non-production database for each preview and mark only that database. Never run the `COMMENT ON DATABASE` command on the production database.

**Limitation:** the marker is an ownership label, not proof of identity. It prevents accidents: a preview or local `.env` pointed at the wrong database (for example production) finds no marker and refuses. It cannot stop someone who can run `COMMENT ON DATABASE` on production from marking it deliberately. A database's name or URL is never used as evidence.

### Live mode (production)

Live checkout takes real money, so it has its own all-or-nothing gate (`src/server/payments/config.ts`). It runs only when **every** one of these holds; anything missing, malformed or contradictory keeps checkout off:
- `PAYMENTS_ENABLED="true"`, `PAYMENTS_ENVIRONMENT="production"`, `PAYSTACK_MODE="live"` and a `sk_live_…` secret key (Production scope only in Vercel).
- Vercel positively reports a production deployment: `VERCEL=1`, `VERCEL_ENV=production`, `VERCEL_TARGET_ENV` absent or `production`, and `VERCEL_PROJECT_PRODUCTION_URL` set ("Automatically expose System Environment Variables" on).
- `NEXT_PUBLIC_SITE_URL` is `https://` on exactly that production domain (no port). Paystack's callback is built from it: `https://<domain>/checkout/callback`.
- No test-only settings: `PAYMENTS_TEST_DATABASE_TOKEN` and `PAYSTACK_API_BASE_URL` must be absent.
- The connected database carries **no** test-payments marker. A production deployment pointed at a test database refuses live payments, and a test deployment pointed at production refuses test payments.

Live keys are refused on local and preview deployments, and test keys on production. Live orders have plain `MRV-…` references; test orders are always `TEST-MRV-…`. A live payment is confirmed only by Paystack's verify API reporting the **live** environment, the expected reference, `KES` and the exact amount. The Paystack webhook for live events is `https://<domain>/api/webhooks/paystack`.

**Late payments.** Whether Paystack can complete a transaction it earlier reported as `abandoned` or `failed` is not confirmed, so the checkout treats any attempt that reached a Paystack page as possibly payable: an order that has used every attempt keeps its bag checkout (the customer is asked to contact the shop) rather than being replaced by a second order that could also be paid. If two paid orders from the same customer share a piece within 14 days, both are marked **"Possible duplicate purchase"** under *Needs attention*: confirm with the customer before fulfilling, and refund one in Paystack if needed (the app never refunds automatically).

**Test mode locally**
1. In the Paystack dashboard, switch to **Test mode**, then go to **Settings → API Keys & Webhooks** and copy the **test** secret key.
2. Open `.env` in your editor and add:
   - `PAYMENTS_ENABLED="true"`
   - `PAYMENTS_ENVIRONMENT="local"`
   - `PAYSTACK_MODE="test"`
   - `PAYSTACK_SECRET_KEY="sk_test_…"` (paste it in the editor; don't `echo` it)

   Leave `EMAIL_PROVIDER` unset (receipts stay queued) or use `"log"` (receipts become log lines).

3. Generate the database token **directly into `.env`**. `.env` is git-ignored, so the token is never committed. It is never printed or passed as a command argument (`printf` is a shell builtin). Your shell history records only this command, not the token. Run from the project folder:
   ```bash
   if grep -q '^PAYMENTS_TEST_DATABASE_TOKEN=' .env; then
     echo "PAYMENTS_TEST_DATABASE_TOKEN is already in .env: keep it, or delete that line to rotate it."
   else
     [ -z "$(tail -c1 .env)" ] || echo >> .env   # make sure the token starts on its own line
     printf 'PAYMENTS_TEST_DATABASE_TOKEN="%s"\n' "$(openssl rand -hex 24)" >> .env
   fi
   ```
   The app reads the token from `.env`. Don't paste it into chats, issues or other files.

4. Mark the **local** `merven_dev` database with **the same token**. The script reads the token from `.env` into psql's environment, where psql's `\getenv` picks it up, so it never appears in arguments, output or history. It connects over the local Unix socket. Before changing anything, the database server must confirm three things:
   - it is `merven_dev`;
   - the connection is local;
   - any existing comment is a test-payments marker.

   Otherwise the script stops with exit code 3 and changes nothing. You must own `merven_dev`; no extra privileges are needed.

   **Copying:** copy the block from the rendered README (for example on GitHub or in an editor's Markdown preview), not from the raw `README.md` file. In the raw file every line is indented by three spaces because it sits inside this list. The block's last two lines, `SQL` and `)`, must each start at column 0 when pasted. The shell only ends the SQL input at a line that is exactly `SQL`. If the shell keeps showing a `>` prompt after you paste, nothing has run yet: press Ctrl-C and copy again from the rendered view.
   ```bash
   ( export PAYMENTS_TEST_DATABASE_TOKEN="$(sed -n 's/^PAYMENTS_TEST_DATABASE_TOKEN="\{0,1\}\([A-Za-z0-9_-]*\)"\{0,1\}$/\1/p' .env)"
     psql -X -q -h /run/postgresql -d merven_dev <<'SQL'
   \set ON_ERROR_STOP on
   \getenv token PAYMENTS_TEST_DATABASE_TOKEN
   SELECT current_database() = 'merven_dev'
      AND inet_server_addr() IS NULL
      AND :'token' ~ '^[A-Za-z0-9_-]{24,128}$'
      AND COALESCE(shobj_description(d.oid, 'pg_database'), 'merven-test-payments:') LIKE 'merven-test-payments:%' AS ok
     FROM pg_database d WHERE d.datname = current_database() \gset
   \if :ok
     SELECT format('COMMENT ON DATABASE %I IS %L', current_database(), 'merven-test-payments:' || :'token') \gexec
     \echo 'Marked the local merven_dev database for test payments.'
   \else
     DO $$ BEGIN RAISE EXCEPTION 'Refused: not the local merven_dev, missing or invalid token, or the database has another comment. Nothing changed.'; END $$;
   \endif
   SQL
   )
   ```
   - **Check it** (prints exactly `t` or `f`, never the comment): `psql -X -At -h /run/postgresql -d merven_dev -c "SELECT COALESCE(shobj_description(oid, 'pg_database') LIKE 'merven-test-payments:%', false) FROM pg_database WHERE datname = current_database()"`.
     - **`t`:** `merven_dev` carries *a* test-payments marker.
     - **`f`:** it has no comment, or a different one.

     This only checks the marker's prefix. It does **not** prove the marker's token matches `.env`; the readiness check in step 5 proves that, because the app compares the full marker with its own token.
   - **Undo:** see "Turning local test payments off" below.
   - **Who can see the comment:** any role that can connect to the local server can read it. It is an ownership label, not a password.
   - **Socket path:** `/run/postgresql` is the usual local socket directory on Linux; adjust it if yours differs.

5. **Readiness check (must pass before any checkout).** Restart `pnpm dev`, open a published product at `http://localhost:3000`, and choose a size and colour that are in stock.
   - **Ready:** a second button, **"Buy now and pay online (test mode)"**, appears under "Enquire on WhatsApp". The server shows it only when the whole payment gate passes for the app's own database connection: the settings in step 2 are valid, and the connected database carries the marker for the token in `.env`.
   - **Not ready:** only "Enquire on WhatsApp" appears. Don't start a checkout. Check, in order:
     1. **The selection.** An out-of-stock choice ("Ask about a restock on WhatsApp") never shows the button.
     2. **The `pnpm dev` log.**
        - **No `payments_disabled` line:** `PAYMENTS_ENABLED` is not exactly `"true"`.
        - **A `payments_disabled` line:** its `reason` names the problem without revealing values. It is logged once per server start, so restart after each fix.
        - **The reason is a setting:** fix that setting in `.env` (step 2). Make sure no `VERCEL*` or `PAYSTACK_API_BASE_URL` variable is set. `NEXT_PUBLIC_SITE_URL` must be `http://localhost:3000`.
        - **The reason is "Database is not approved…":** go to the next check.
     3. **The marker.** Run the check in step 4.
        - **`f`:** run step 4.
        - **`t`, but still not approved:** the token in `.env` differs from the one in the marker. Re-run step 4, which re-marks the database with the token from `.env`, and restart `pnpm dev`.
   - **Stop and investigate:** if a "Buy now" button ever appears **without** "(test mode)" on a local or preview deployment, stop: that would be a live checkout, which only the production deployment may offer.
   - **Keep values private:** never print the token or the secret key while troubleshooting.
6. For webhooks locally, expose the dev server with a tunnel and set the **test** webhook URL to `https://<tunnel>/api/webhooks/paystack`. Without a webhook, the callback and the "Check payment status" button still confirm payments.
7. Use Paystack's published test cards and test mobile-money numbers (see Paystack's "Test Payments" docs). KES amounts are sent in cents; confirm on the first test that Paystack's checkout shows the expected KES amount.

**Turning local test payments off**
1. In your editor, set `PAYMENTS_ENABLED="false"` in the local `.env`.
2. Restart `pnpm dev`. Open a product and choose an in-stock size and colour. Only "Enquire on WhatsApp" should appear, not "Buy now and pay online (test mode)".
3. **Remove the marker only if you're finished with test payments on this database.** Keeping it is harmless while `PAYMENTS_ENABLED` is off; removing it means step 4 must be repeated before testing again. Removing it is a second, independent off switch, because the app refuses test payments on an unmarked database even if `.env` is re-enabled.

   The command connects over the local Unix socket. Before changing anything, the database server must confirm, on the same connection:
   - the connected database is exactly `merven_dev`;
   - the connection is a Unix socket (`inet_server_addr()` is `NULL`), so no TCP or remote server is accepted;
   - the database's comment starts with `merven-test-payments:`, so nothing else is removed.

   Only then does it remove the comment, from the database it is connected to (`current_database()`). If any check fails, it stops with an error and exit code 3, and changes nothing. A database with no marker also refuses, which is harmless.

   **Copying:** as with the marking command ("Test mode locally", step 4), copy the block from the rendered README, not from the raw `README.md` file. The last line, `SQL`, must start at column 0 when pasted. If the shell keeps showing a `>` prompt, nothing has run: press Ctrl-C and copy again from the rendered view.
   ```bash
   psql -X -q -h /run/postgresql -d merven_dev <<'SQL'
   \set ON_ERROR_STOP on
   SELECT current_database() = 'merven_dev'
      AND inet_server_addr() IS NULL
      AND COALESCE(shobj_description(d.oid, 'pg_database'), '') LIKE 'merven-test-payments:%' AS ok
     FROM pg_database d WHERE d.datname = current_database() \gset
   \if :ok
     SELECT format('COMMENT ON DATABASE %I IS NULL', current_database()) \gexec
     \echo 'Removed the test-payments marker from the local merven_dev database.'
   \else
     DO $$ BEGIN RAISE EXCEPTION 'Refused: not the local merven_dev over the Unix socket, or it has no test-payments marker. Nothing changed.'; END $$;
   \endif
   SQL
   ```
   - **Never point it at another database or server.** Don't change `-h /run/postgresql` or `-d merven_dev`. The checks refuse anything else, but don't rely on that alone.
   - **Afterwards,** the marker check in "Test mode locally", step 4, prints `f`.
   - **What it removes:** only the test marker (the database comment). It does **not** delete test orders or restore stock (see the next step).
4. **Test data stays.** Disabling payments doesn't undo anything the test created. Test orders, payment attempts, webhook records, queued receipts and **stock deductions** stay in the local `merven_dev`. Test orders are marked with a `TEST-` reference.
5. **Optional:** in your editor, delete the `PAYSTACK_SECRET_KEY` and `PAYMENTS_TEST_DATABASE_TOKEN` lines from `.env`. To test again later, repeat steps 2–5; step 4 re-marks the database with the new token.

**Paystack dashboard (owner, test mode only — do not change live settings)**
- **Test Callback URL:** `https://<your-site>/checkout/callback`. The app also sends it per transaction.
- **Test Webhook URL:** `https://<your-site>/api/webhooks/paystack`
- **Channels:** confirm Card and M-PESA (mobile money) are enabled for your Kenyan test integration.

**Before live payments (blockers)**
- Delivery options and fees, a returns policy, and approval to go live.
- Live mode is implemented as an explicit opt-in ([Live mode](#live-mode-production)); configure it only after the other items here are settled.
- A verified sender domain for receipts.
- An owner process for "needs attention" orders: duplicate payments, stock shortfalls, reversals.

## How it works

- **Visibility.** All public reads go through `src/server/catalogue/repository.ts`, which applies `status = PUBLISHED` to every query. Draft and archived products are never returned by slug, listing, search, featured or the sitemap. Public responses expose availability and "low stock" flags, never raw stock counts.
- **Caching.** Public queries use `'use cache'` with the `catalogue` tag (`src/server/catalogue/queries.ts`). Every admin mutation calls `updateTag("catalogue")`, so price, stock and status changes show immediately.
- **Admin security.** Every server action in `src/server/admin/actions.ts` calls `requireAdmin()` first and validates input with Zod. Admin read queries also re-check the session. `src/proxy.ts` only does an optimistic redirect. Sign-in is limited to 5 attempts per 15 minutes per IP, counting successful logins, and the limit is stored in Postgres so it holds across serverless instances. Sign-up, password reset, account changes and deletion endpoints are disabled. Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production, with a 12-hour session.
- **Uploads.** Images are identified by magic bytes, never by filename or MIME type. They are limited to 5 MB and 400–8000 px, decoded and **re-encoded to WebP** (which strips EXIF/GPS data and anything appended), and stored in Supabase Storage under a random UUID key (`src/server/images/supabase-driver.ts`). At most 12 images per product.
- **Money and inventory.** Prices are integer minor units (`priceMinor`, KES cents), with an optional per-variant override. Stock lives on `ProductVariant`. Database `CHECK` constraints reject negative stock and prices.
- **WhatsApp.** `src/lib/whatsapp.ts` builds `https://wa.me/<number>?text=…` links. Nothing is sent automatically, and no enquiry is recorded as sent.

## Before launch

- Replace the placeholder products, images and copy (`prisma/seed-data.ts`, `public/placeholders`).
- Confirm the delivery zones, fees and timings in `src/content/site.ts`. They are marked PLACEHOLDER.
- Confirm `WHATSAPP_NUMBER`.

## Extending to orders and M-Pesa later

Products are archived rather than deleted, and variants have stable IDs and unique SKUs. A future `Order` / `OrderItem` model should reference `ProductVariant.id`, snapshot price and name at purchase, and decrement stock in a transaction. The `stock >= 0` constraint already prevents overselling at the database level. An `MpesaTransaction` table (Daraja STK push, callback-verified) can hang off `Order` without changing the catalogue schema.
