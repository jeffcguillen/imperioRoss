DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rf_claim_processor') THEN
    CREATE ROLE rf_claim_processor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;

ALTER ROLE rf_claim_processor NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA app TO rf_claim_processor;

CREATE TABLE IF NOT EXISTS app.ticket_claim_attempts (
  ticket_id uuid PRIMARY KEY REFERENCES app.tickets(id),
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  failed_attempts smallint NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.ticket_claim_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON app.ticket_claim_attempts;
CREATE POLICY tenant_isolation ON app.ticket_claim_attempts
  USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant());

GRANT SELECT ON app.ticket_claim_codes, app.tickets, app.orders, app.prizes,
  app.users, app.staff_profiles, app.role_permissions, app.locations, app.financial_accounts
  TO rf_claim_processor;
GRANT INSERT, UPDATE ON app.ticket_claim_codes, app.ticket_claim_attempts, app.prizes
  TO rf_claim_processor;
GRANT SELECT ON app.ticket_claim_attempts TO rf_claim_processor;
GRANT INSERT ON app.prize_payments, app.financial_transactions, app.audit_log TO rf_claim_processor;
GRANT EXECUTE ON FUNCTION app.current_tenant(), app.current_actor(), app.fn_can(uuid, text),
  app.fn_norm_phone(text), app.fn_make_claim(uuid, uuid), app.fn_expire_prizes(uuid),
  app.fn_audit(uuid, uuid, text, text, text, jsonb, jsonb, text)
  TO rf_claim_processor;

CREATE OR REPLACE FUNCTION app.fn_make_claim(p_ticket uuid, p_tenant uuid) RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  v_bytes bytea := public.gen_random_bytes(4);
  v_code text;
  v_key text := NULLIF(current_setting('app.claim_key', true), '');
BEGIN
  IF v_key IS NULL OR length(v_key) < 32 THEN RAISE EXCEPTION 'CLAIM_CODE_KEY_MISSING'; END IF;
  v_code := lpad(((get_byte(v_bytes,0)::bigint * 16777216 + get_byte(v_bytes,1) * 65536 +
                   get_byte(v_bytes,2) * 256 + get_byte(v_bytes,3)) % 1000000)::text, 6, '0');
  INSERT INTO app.ticket_claim_codes (ticket_id, tenant_id, code_hash, code_enc)
  VALUES (p_ticket, p_tenant, encode(public.digest(v_code || p_ticket::text, 'sha256'), 'hex'),
          public.pgp_sym_encrypt(v_code, v_key))
  ON CONFLICT (ticket_id) DO UPDATE
    SET tenant_id = EXCLUDED.tenant_id, code_hash = EXCLUDED.code_hash,
        code_enc = EXCLUDED.code_enc, created_at = now()
    WHERE app.ticket_claim_codes.code_enc IS NULL;
END $$;
ALTER FUNCTION app.fn_make_claim(uuid, uuid) OWNER TO rf_claim_processor;
GRANT EXECUTE ON FUNCTION app.fn_make_claim(uuid, uuid) TO rf_api_admin;
GRANT EXECUTE ON FUNCTION app.fn_make_claim(uuid, uuid) TO rf_claim_processor;

CREATE OR REPLACE FUNCTION app.fn_get_my_claim_code(p_ticket uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE v_code text; v_key text := NULLIF(current_setting('app.claim_key', true), '');
BEGIN
  IF app.current_actor() IS NULL OR app.current_tenant() IS NULL THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM app.tickets t JOIN app.orders o ON o.id = t.order_id AND o.tenant_id = t.tenant_id
     WHERE t.id = p_ticket AND t.tenant_id = app.current_tenant() AND o.user_id = app.current_actor()
       AND EXISTS (SELECT 1 FROM app.prizes p WHERE p.ticket_id = t.id AND p.tenant_id = t.tenant_id
                    AND p.status IN ('pending','generated'))
  ) THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  IF v_key IS NULL OR length(v_key) < 32 THEN RAISE EXCEPTION 'CLAIM_CODE_KEY_MISSING'; END IF;
  PERFORM app.fn_make_claim(p_ticket, app.current_tenant());
  SELECT public.pgp_sym_decrypt(c.code_enc, v_key) INTO v_code
    FROM app.ticket_claim_codes c WHERE c.ticket_id = p_ticket AND c.tenant_id = app.current_tenant();
  PERFORM app.fn_audit(app.current_tenant(), app.current_actor(), 'prize.claim_code_viewed_by_owner',
                       'ticket', p_ticket::text, NULL, NULL, NULL);
  RETURN v_code;
END $$;
ALTER FUNCTION app.fn_get_my_claim_code(uuid) OWNER TO rf_claim_processor;
REVOKE ALL ON FUNCTION app.fn_get_my_claim_code(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.fn_get_my_claim_code(uuid) TO rf_api_staff, rf_api_admin;

CREATE OR REPLACE FUNCTION app.fn_get_guest_claim_code(p_ticket uuid, p_order uuid, p_phone text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE v_code text; v_key text := NULLIF(current_setting('app.claim_key', true), '');
BEGIN
  IF app.current_tenant() IS NULL OR NOT EXISTS (
    SELECT 1 FROM app.tickets t
    JOIN app.orders o ON o.id = t.order_id AND o.tenant_id = t.tenant_id
     WHERE t.id = p_ticket AND t.order_id = p_order AND t.tenant_id = app.current_tenant()
       AND o.user_id IS NULL AND o.buyer_phone_norm = app.fn_norm_phone(p_phone)
       AND EXISTS (SELECT 1 FROM app.prizes p WHERE p.ticket_id = t.id AND p.tenant_id = t.tenant_id
                    AND p.status IN ('pending','generated'))
  ) THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  IF v_key IS NULL OR length(v_key) < 32 THEN RAISE EXCEPTION 'CLAIM_CODE_KEY_MISSING'; END IF;
  PERFORM app.fn_make_claim(p_ticket, app.current_tenant());
  SELECT public.pgp_sym_decrypt(c.code_enc, v_key) INTO v_code
    FROM app.ticket_claim_codes c WHERE c.ticket_id = p_ticket AND c.tenant_id = app.current_tenant();
  RETURN v_code;
END $$;
ALTER FUNCTION app.fn_get_guest_claim_code(uuid, uuid, text) OWNER TO rf_claim_processor;
REVOKE ALL ON FUNCTION app.fn_get_guest_claim_code(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.fn_get_guest_claim_code(uuid, uuid, text) TO rf_api_staff;

CREATE OR REPLACE FUNCTION app.fn_get_admin_claim_code(p_ticket uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE v_code text; v_key text := NULLIF(current_setting('app.claim_key', true), '');
BEGIN
  IF app.current_actor() IS NULL OR app.current_tenant() IS NULL
     OR NOT app.fn_can(app.current_actor(), 'prize.see_claim_code')
     OR NOT EXISTS (SELECT 1 FROM app.users u WHERE u.id = app.current_actor()
                    AND u.tenant_id = app.current_tenant() AND u.role = 'admin' AND u.is_active) THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.tickets t WHERE t.id = p_ticket AND t.tenant_id = app.current_tenant()) THEN
    RAISE EXCEPTION 'TICKET_NO_ENCONTRADO';
  END IF;
  IF v_key IS NULL OR length(v_key) < 32 THEN RAISE EXCEPTION 'CLAIM_CODE_KEY_MISSING'; END IF;
  PERFORM app.fn_make_claim(p_ticket, app.current_tenant());
  SELECT public.pgp_sym_decrypt(c.code_enc, v_key) INTO v_code
    FROM app.ticket_claim_codes c WHERE c.ticket_id = p_ticket AND c.tenant_id = app.current_tenant();
  PERFORM app.fn_audit(app.current_tenant(), app.current_actor(), 'prize.claim_code_viewed',
                       'ticket', p_ticket::text, NULL, NULL, NULL);
  RETURN v_code;
END $$;
ALTER FUNCTION app.fn_get_admin_claim_code(uuid) OWNER TO rf_claim_processor;
REVOKE ALL ON FUNCTION app.fn_get_admin_claim_code(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.fn_get_admin_claim_code(uuid) TO rf_api_admin;

CREATE OR REPLACE FUNCTION app.fn_confirm_prize_payment(
  p_ticket uuid, p_payer uuid, p_location uuid, p_method text, p_proof text, p_claim_code text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, app, pg_temp
AS $$
DECLARE
  tk app.tickets%ROWTYPE;
  p app.prizes%ROWTYPE;
  v_total bigint := 0;
  v_n int := 0;
  v_account uuid;
  v_claim app.ticket_claim_codes%ROWTYPE;
  v_attempt app.ticket_claim_attempts%ROWTYPE;
  v_failed smallint;
BEGIN
  IF p_payer IS DISTINCT FROM app.current_actor() OR app.current_tenant() IS NULL
     OR NOT app.fn_can(p_payer, 'prize.pay') THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  IF EXISTS (SELECT 1 FROM app.users u WHERE u.id = p_payer AND u.tenant_id = app.current_tenant() AND u.role = 'worker')
     AND NOT COALESCE((SELECT sp.can_pay_prizes FROM app.staff_profiles sp
                        WHERE sp.user_id = p_payer AND sp.tenant_id = app.current_tenant()), false) THEN
    RAISE EXCEPTION 'SIN_PERMISO';
  END IF;
  SELECT * INTO tk FROM app.tickets WHERE id = p_ticket AND tenant_id = app.current_tenant() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TICKET_NO_ENCONTRADO'; END IF;
  IF p_location IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app.locations l WHERE l.id = p_location AND l.tenant_id = app.current_tenant() AND l.is_active
  ) THEN RAISE EXCEPTION 'INVALID_LOCATION'; END IF;

  IF NOT EXISTS (SELECT 1 FROM app.ticket_claim_codes c WHERE c.ticket_id = p_ticket AND c.tenant_id = app.current_tenant()) THEN
    PERFORM app.fn_make_claim(p_ticket, app.current_tenant());
  END IF;
  SELECT * INTO v_claim FROM app.ticket_claim_codes c
   WHERE c.ticket_id = p_ticket AND c.tenant_id = app.current_tenant() FOR UPDATE;
  INSERT INTO app.ticket_claim_attempts (ticket_id, tenant_id)
  VALUES (p_ticket, app.current_tenant()) ON CONFLICT (ticket_id) DO NOTHING;
  SELECT * INTO v_attempt FROM app.ticket_claim_attempts a
   WHERE a.ticket_id = p_ticket AND a.tenant_id = app.current_tenant() FOR UPDATE;
  IF v_attempt.locked_until > now() THEN RETURN -2; END IF;
  IF p_claim_code !~ '^[0-9]{6}$' OR v_claim.code_hash IS NULL
     OR v_claim.code_hash <> encode(public.digest(COALESCE(p_claim_code, '') || p_ticket::text, 'sha256'), 'hex') THEN
    v_failed := CASE WHEN v_attempt.locked_until IS NOT NULL AND v_attempt.locked_until <= now()
                     THEN 1 ELSE LEAST(v_attempt.failed_attempts + 1, 5) END;
    UPDATE app.ticket_claim_attempts
       SET failed_attempts = v_failed,
           locked_until = CASE WHEN v_failed >= 5 THEN now() + interval '15 minutes' ELSE NULL END,
           updated_at = now()
     WHERE ticket_id = p_ticket AND tenant_id = app.current_tenant();
    PERFORM app.fn_audit(app.current_tenant(), p_payer, 'prize.claim_code_failed', 'ticket', p_ticket::text,
                         NULL, jsonb_build_object('failed_attempts', v_failed), NULL);
    RETURN -1;
  END IF;
  UPDATE app.ticket_claim_attempts SET failed_attempts = 0, locked_until = NULL, updated_at = now()
   WHERE ticket_id = p_ticket AND tenant_id = app.current_tenant();

  PERFORM app.fn_expire_prizes(tk.tenant_id);
  PERFORM 1 FROM app.prizes WHERE ticket_id = p_ticket AND tenant_id = app.current_tenant() FOR UPDATE;
  FOR p IN SELECT * FROM app.prizes
            WHERE ticket_id = p_ticket AND tenant_id = app.current_tenant() AND status IN ('pending','generated')
            ORDER BY suerte_no LOOP
    INSERT INTO app.prize_payments (tenant_id, prize_id, paid_by, location_id, method, proof_key)
    VALUES (p.tenant_id, p.id, p_payer, p_location, p_method, p_proof);
    UPDATE app.prizes SET status = 'paid' WHERE id = p.id AND tenant_id = p.tenant_id;
    v_total := v_total + p.prize_cents;
    v_n := v_n + 1;
  END LOOP;
  IF v_n = 0 THEN
    IF EXISTS (SELECT 1 FROM app.prizes WHERE ticket_id = p_ticket AND tenant_id = app.current_tenant() AND status = 'paid') THEN RAISE EXCEPTION 'ESTE PREMIO YA FUE PAGADO'; END IF;
    IF EXISTS (SELECT 1 FROM app.prizes WHERE ticket_id = p_ticket AND tenant_id = app.current_tenant() AND status = 'expired') THEN RAISE EXCEPTION 'PREMIO VENCIDO'; END IF;
    RAISE EXCEPTION 'SIN_PREMIO_PAGABLE';
  END IF;
  SELECT id INTO v_account FROM app.financial_accounts
   WHERE tenant_id = app.current_tenant() AND kind = 'payout' AND is_active ORDER BY created_at LIMIT 1;
  IF v_account IS NOT NULL THEN
    INSERT INTO app.financial_transactions (tenant_id, account_id, location_id, direction, category, line,
      amount_cents, method, origin_session_id, ref_type, ref_id, created_by)
    VALUES (tk.tenant_id, v_account, p_location, 'out', 'prize', 'daily', v_total,
      CASE p_method WHEN 'cash' THEN 'cash_counter' ELSE 'bank_transfer' END::app.payment_method,
      tk.session_id, 'ticket', tk.id, p_payer);
  END IF;
  PERFORM app.fn_audit(tk.tenant_id, p_payer, 'prize.paid', 'ticket', tk.id::text, NULL,
    jsonb_build_object('total_cents', v_total, 'prizes', v_n, 'method', p_method, 'location_id', p_location));
  RETURN v_total;
END $$;
ALTER FUNCTION app.fn_confirm_prize_payment(uuid, uuid, uuid, text, text, text) OWNER TO rf_claim_processor;
REVOKE ALL ON FUNCTION app.fn_confirm_prize_payment(uuid, uuid, uuid, text, text) FROM PUBLIC, rf_api_staff, rf_api_admin;
REVOKE ALL ON FUNCTION app.fn_confirm_prize_payment(uuid, uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.fn_confirm_prize_payment(uuid, uuid, uuid, text, text, text) TO rf_api_staff, rf_api_admin;

