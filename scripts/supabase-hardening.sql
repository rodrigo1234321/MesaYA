-- ============================================================================
-- MesaYA: Supabase Hardening Script (P0-06)
-- Revocación estricta de permisos por defecto sobre schema 'public'
-- para roles 'anon' y 'authenticated' de Supabase PostgREST Data API.
-- ============================================================================

DO $$
BEGIN
    -- 1. Revocar permisos de esquema
    REVOKE USAGE ON SCHEMA public FROM anon, authenticated;
    REVOKE CREATE ON SCHEMA public FROM anon, authenticated;

    -- 2. Revocar todos los permisos sobre tablas existentes
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

    -- 3. Revocar permisos sobre secuencias existentes
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

    -- 4. Revocar permisos sobre rutinas y funciones existentes
    REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon, authenticated;

    -- 5. Configurar DEFAULT PRIVILEGES para futuras tablas
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM anon, authenticated;

    RAISE NOTICE 'MesaYA: Hardening aplicado exitosamente. Schema public aislado de PostgREST/anon/authenticated.';
END $$;
