-- SELECT ... FOR UPDATE also requires UPDATE privilege on the locked row.
-- The processor role is NOLOGIN and is used only as SECURITY DEFINER owner;
-- tenant RLS still limits its rows to the active request context.
GRANT UPDATE ON app.tickets TO rf_claim_processor;
