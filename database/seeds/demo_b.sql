DO $$
BEGIN
  IF current_setting('app.environment', true) IS DISTINCT FROM 'development' THEN
    RAISE EXCEPTION 'DEMO_SEED_REQUIRES_DEVELOPMENT';
  END IF;
END $$;

INSERT INTO app.tenants (id, slug, name, tagline, domain, timezone, currency, locale, branding, modules)
VALUES (
  'a0000000-0000-0000-0000-000000000002', 'demo-b', 'DEMO B', 'Tenant de demostración', 'demo-b.localhost',
  'America/Guayaquil', 'USD', 'es-EC',
  '{"logos":{"horizontal":"logo-horizontal.png","monogram":"logo-monogram.png"},"palette":{"gold":"#7cd6bd","emerald":"#123d3b"}}'::jsonb,
  '{"contratas":false,"jugadasProgramadas":false,"rifasEspeciales":false,"comisiones":false,"pasarelaPagos":false}'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name, tagline = EXCLUDED.tagline, domain = EXCLUDED.domain,
  timezone = EXCLUDED.timezone, currency = EXCLUDED.currency, locale = EXCLUDED.locale,
  branding = EXCLUDED.branding, modules = EXCLUDED.modules;
