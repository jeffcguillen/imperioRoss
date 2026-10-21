-- Prize expiry reads the tenant time zone before updating prizes.
-- The SECURITY DEFINER processor needs this read for the current tenant only;
-- RLS on tenants remains enabled and scoped by app.current_tenant().
GRANT SELECT ON app.tenants TO rf_claim_processor;
