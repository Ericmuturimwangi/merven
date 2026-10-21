-- Supabase exposes the `public` schema through its Data API (PostgREST) to the
-- `anon` and `authenticated` roles. This app never uses that API: it talks to
-- Postgres directly through Prisma as the table owner, which bypasses RLS.
--
-- Enable RLS with no policies on every table (deny-all for API roles) and revoke
-- their privileges, so admin password hashes, sessions and draft products can't
-- be read or written with a publishable key. Safe on plain Postgres too.

ALTER TABLE "category"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_variant"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_image"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_user"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_session"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_account"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admin_verification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rate_limit"         ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Created by Prisma outside the migrations themselves (absent in shadow databases).
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
    -- Tables created by future migrations (run as this same role) start without API grants.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
  END IF;
END $$;
