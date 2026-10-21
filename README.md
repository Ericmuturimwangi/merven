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
