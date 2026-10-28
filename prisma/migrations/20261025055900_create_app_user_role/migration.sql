-- T0.3: least-privilege runtime role for the application
-- (PROJECT_ARCHITECTURE.md section 5 and section 15).
--
-- Migrations run as the owner role (dev: docker-compose superuser "businesslens");
-- the application connects as app_user. The password below is the localhost-only
-- compose dev password (owner-approved decision, T0.3) - hosted deployments must
-- override it. Grants and RLS policies are intentionally NOT part of this
-- migration; they arrive with T2.1.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user
      LOGIN
      PASSWORD 'businesslens'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOBYPASSRLS
      NOREPLICATION
      NOINHERIT;
  ELSE
    ALTER ROLE app_user
      LOGIN
      PASSWORD 'businesslens'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOBYPASSRLS
      NOREPLICATION
      NOINHERIT;
  END IF;
END
$$;
