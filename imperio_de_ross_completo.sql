-- =====================================================================
-- EL IMPERIO DE ROSS — Base de datos PostgreSQL 15+ (instalación completa en UN solo archivo)
-- Incluye: esquema + lógica de negocio + datos de arranque/demostración.
-- Úsalo en una base de datos NUEVA y VACÍA. Crea el esquema "app" y los roles rf_api_admin / rf_api_staff.
-- Antes de producción reemplaza los hashes de contraseña marcadores y revisa los datos DEMO del final.
-- =====================================================================
-- =====================================================================
-- EL IMPERIO DE ROSS — PostgreSQL 15+ — 01_schema.sql
-- Multitenant (tenant_id + RLS), dinero en centavos (bigint), números
-- jugados siempre TEXT de longitud fija, sin borrado físico.
-- Orden de ejecución: 01_schema.sql -> 02_logic.sql -> 03_seed.sql
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS app;
SET search_path = app, public;

-- ---------- Tipos ----------
CREATE TYPE user_role              AS ENUM ('admin','worker','seller','client');
CREATE TYPE sale_origin            AS ENUM ('direct','worker','seller','contrata','scheduled_play');
CREATE TYPE order_status           AS ENUM ('pending_review','approved','rejected','cancelled','expired','refunded');
CREATE TYPE payment_method         AS ENUM ('wallet','bank_transfer','payphone','card','qr_wallet','cash_point','cash_counter');
CREATE TYPE payment_status         AS ENUM ('pending','in_review','approved','rejected','cancelled','expired','refunded');
CREATE TYPE reconciliation_status  AS ENUM ('not_applicable','pending','reconciled');
CREATE TYPE session_status         AS ENUM ('scheduled','open','closed','resulted','cancelled');
CREATE TYPE ticket_status          AS ENUM ('active','winner','non_winner','voided');
CREATE TYPE item_status            AS ENUM ('active','voided','rejected');
CREATE TYPE prize_status           AS ENUM ('generated','pending','credited_to_wallet','withdrawal_requested','paid','expired','superseded');
CREATE TYPE withdrawal_status      AS ENUM ('requested','in_review','approved','paid','rejected','cancelled');
CREATE TYPE recharge_status        AS ENUM ('pending','in_review','approved','rejected');
CREATE TYPE ledger_type            AS ENUM ('recharge','purchase_reserve','purchase_release','purchase_settle','prize_credit','withdrawal_reserve','withdrawal_release','withdrawal_paid','refund','adjustment');
CREATE TYPE refund_reason          AS ENUM ('out_of_hours','duplicate_payment','technical_error','operation_not_executed','other_authorized');
CREATE TYPE commission_base        AS ENUM ('sales_percent','fixed_amount','monthly_profit_percent');
CREATE TYPE contrata_status        AS ENUM ('active','paused','cancelled','finished');
CREATE TYPE slot_status            AS ENUM ('reserved','sold','cancelled');
CREATE TYPE collection_mode        AS ENUM ('cash','transfer','wallet','credit');
CREATE TYPE receivable_status      AS ENUM ('open','partial','collected','written_off');
CREATE TYPE scheduled_status       AS ENUM ('active','paused','cancelled','executed','not_executed_insufficient_balance');
CREATE TYPE raffle_status          AS ENUM ('draft','open','sold_out','closed','drawn','cancelled');
CREATE TYPE raffle_close_mode      AS ENUM ('date','sold_out','manual');
CREATE TYPE raffle_purchase_status AS ENUM ('pending_payment','approved','rejected','cancelled');
CREATE TYPE fin_direction          AS ENUM ('in','out');
CREATE TYPE fin_category           AS ENUM ('sales','recharge','prize','expense','withdrawal','refund','internal_transfer','adjustment');
CREATE TYPE fin_line               AS ENUM ('daily','special','general');
CREATE TYPE fin_account_kind       AS ENUM ('income','payout');
CREATE TYPE otp_purpose            AS ENUM ('guest_lookup','password_reset','admin_2fa','phone_verify');
CREATE TYPE push_platform          AS ENUM ('ios','android','web');

-- ---------- Utilidades puras ----------
CREATE FUNCTION fn_norm_phone(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN d = '' THEN NULL
    WHEN d LIKE '593%' THEN '+' || d
    WHEN d LIKE '0%'   THEN '+593' || substr(d, 2)
    ELSE '+593' || d END
  FROM (SELECT regexp_replace(coalesce(p,''), '\D', '', 'g') AS d) x
$$;

CREATE FUNCTION current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION current_actor() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- =====================================================================
-- 1. TENANTS, USUARIOS, SEGURIDAD, CONFIGURACIÓN
-- =====================================================================
CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        citext NOT NULL UNIQUE,
  name        text NOT NULL,
  tagline     text,
  domain      text UNIQUE,
  timezone    text NOT NULL DEFAULT 'America/Guayaquil',
  currency    char(3) NOT NULL DEFAULT 'USD',
  locale      text NOT NULL DEFAULT 'es-EC',
  branding    jsonb NOT NULL DEFAULT '{}',   -- logos, paleta (tokens)
  modules     jsonb NOT NULL DEFAULT '{}',   -- feature flags por tenant
  social      jsonb NOT NULL DEFAULT '{}',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL, city text, address text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  role user_role NOT NULL,
  full_name text NOT NULL,
  phone text NOT NULL,
  phone_norm text GENERATED ALWAYS AS (fn_norm_phone(phone)) STORED,
  email citext,
  password_hash text NOT NULL,                 -- bcrypt/argon2, nunca texto claro
  location_id uuid REFERENCES locations(id),
  is_active boolean NOT NULL DEFAULT true,
  adult_confirmed_at timestamptz,
  terms_accepted_at timestamptz,
  two_factor_enabled boolean NOT NULL DEFAULT false,
  two_factor_secret_ref text,                  -- referencia a gestor de secretos
  failed_logins int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone_norm)
);
CREATE UNIQUE INDEX ux_users_email ON users (tenant_id, email) WHERE email IS NOT NULL;
CREATE INDEX ix_users_role ON users (tenant_id, role);

-- Autorizaciones finas de trabajador/vendedor
CREATE TABLE staff_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  can_pay_prizes boolean NOT NULL DEFAULT false,
  can_review_receipts_until_close boolean NOT NULL DEFAULT false,
  void_window_minutes int NOT NULL DEFAULT 30 CHECK (void_window_minutes >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  refresh_token_hash text NOT NULL UNIQUE,     -- solo hash, nunca el token
  user_agent text, ip inet,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_auth_sessions_user ON auth_sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  purpose otp_purpose NOT NULL,
  target text NOT NULL,                        -- teléfono normalizado o user_id
  code_hash text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_otp_target ON otp_codes (tenant_id, purpose, target, created_at DESC);

-- Matriz de permisos editable (Administrador / Trabajador / Vendedor)
CREATE TABLE role_permissions (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  role user_role NOT NULL,
  action text NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  scope text NOT NULL DEFAULT 'all' CHECK (scope IN ('all','own','before_close','authorized_only')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, role, action)
);

CREATE TABLE app_settings (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE counters (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  value bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, name)
);

CREATE TABLE idempotency_keys (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  scope text NOT NULL,
  key text NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, scope, key)
);

-- =====================================================================
-- 2. SORTEOS, MODALIDADES, SESIONES, PLANES
-- =====================================================================
CREATE TABLE draws (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL,
  name text NOT NULL,
  country_code char(2),
  reference_lottery text NOT NULL,
  reference_abbr text NOT NULL,                -- ej. "LTT", se muestra en el ticket
  draw_time time NOT NULL,                     -- hora local del sorteo
  close_offset_minutes int NOT NULL DEFAULT 15 CHECK (close_offset_minutes >= 0),
  days_of_week smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6}',  -- ISO 1=lun..7=dom
  ticket_note text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

-- Lotería de referencia por día (ej. Noche: Lun Lotería, Mar Lotto…)
CREATE TABLE draw_day_references (
  draw_id uuid NOT NULL REFERENCES draws(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  dow smallint NOT NULL CHECK (dow BETWEEN 1 AND 7),
  reference_lottery text,                      -- NULL = sin definir (editable)
  reference_abbr text,
  PRIMARY KEY (draw_id, dow)
);

CREATE TABLE draw_modalities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  draw_id uuid NOT NULL REFERENCES draws(id),
  digits smallint NOT NULL CHECK (digits IN (2,3,4)),
  enabled boolean NOT NULL DEFAULT true,
  min_cents bigint NOT NULL DEFAULT 25 CHECK (min_cents >= 25),
  step_cents bigint NOT NULL DEFAULT 25 CHECK (step_cents >= 25),
  -- Cupo total por número y por sorteo (2 cifras ref. $30; 3 cifras $2; 4 cifras $1). NULL = sin tope
  quota_per_number_cents bigint CHECK (quota_per_number_cents IS NULL OR quota_per_number_cents >= 25),
  max_suertes smallint NOT NULL CHECK (max_suertes >= 1),   -- 2c:7, 3c:10, 4c: configurable
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draw_id, digits)
);

-- Instancia concreta de un sorteo en una fecha (cada una con su cierre propio)
CREATE TABLE draw_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  draw_id uuid NOT NULL REFERENCES draws(id),
  draw_date date NOT NULL,
  closes_at timestamptz NOT NULL,
  draws_at timestamptz NOT NULL,
  status session_status NOT NULL DEFAULT 'scheduled',
  reference_lottery text, reference_abbr text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draw_id, draw_date),
  CHECK (closes_at <= draws_at)
);
CREATE INDEX ix_sessions_open ON draw_sessions (tenant_id, closes_at) WHERE status IN ('scheduled','open');

CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  draw_id uuid NOT NULL REFERENCES draws(id),
  digits smallint NOT NULL CHECK (digits IN (2,3,4)),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draw_id, digits, name)
);

-- Cada edición crea una versión nueva: modificar un plan NUNCA cambia tickets anteriores
CREATE TABLE plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  plan_id uuid NOT NULL REFERENCES plans(id),
  version int NOT NULL CHECK (version >= 1),
  is_current boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, version)
);
CREATE UNIQUE INDEX ux_plan_current ON plan_versions (plan_id) WHERE is_current;

CREATE TABLE plan_prizes (
  plan_version_id uuid NOT NULL REFERENCES plan_versions(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  suerte_no smallint NOT NULL CHECK (suerte_no >= 1),
  suerte_name text NOT NULL DEFAULT 'Suerte',
  payout_per_dollar_cents bigint NOT NULL CHECK (payout_per_dollar_cents >= 0),  -- pago por cada $1 jugado
  PRIMARY KEY (plan_version_id, suerte_no)
);

-- =====================================================================
-- 3. CUENTAS BANCARIAS Y MÉTODOS DE PAGO (PASARELA)
-- =====================================================================
CREATE TABLE bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  bank_name text NOT NULL, holder text NOT NULL,
  account_type text NOT NULL DEFAULT 'ahorros',
  account_number text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_methods_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  method payment_method NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  is_sandbox boolean NOT NULL DEFAULT true,
  min_cents bigint NOT NULL DEFAULT 0 CHECK (min_cents >= 0),
  max_cents bigint CHECK (max_cents IS NULL OR max_cents >= min_cents),
  fee_bp int NOT NULL DEFAULT 0 CHECK (fee_bp >= 0),          -- comisión % en puntos base
  fee_fixed_cents bigint NOT NULL DEFAULT 0 CHECK (fee_fixed_cents >= 0),
  fee_message text, help_text text,
  credentials_ref text,                                        -- referencia a gestor de secretos; JAMÁS la credencial
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, method)
);

-- =====================================================================
-- 4. BILLETERA
-- =====================================================================
CREATE TABLE wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  available_cents bigint NOT NULL DEFAULT 0 CHECK (available_cents >= 0),
  reserved_cents  bigint NOT NULL DEFAULT 0 CHECK (reserved_cents >= 0),
  version bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Libro inmutable: el saldo nunca se sobrescribe; cada movimiento guarda saldo anterior y posterior
CREATE TABLE wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  wallet_id uuid NOT NULL REFERENCES wallets(id),
  type ledger_type NOT NULL,
  available_delta bigint NOT NULL,
  reserved_delta  bigint NOT NULL,
  available_before bigint NOT NULL, available_after bigint NOT NULL,
  reserved_before  bigint NOT NULL, reserved_after  bigint NOT NULL,
  ref_type text, ref_id uuid, origin text, reason text,
  created_by uuid REFERENCES users(id),
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (available_after = available_before + available_delta),
  CHECK (reserved_after  = reserved_before  + reserved_delta)
);
CREATE INDEX ix_ledger_wallet ON wallet_ledger (wallet_id, created_at DESC);
CREATE UNIQUE INDEX ux_ledger_idem ON wallet_ledger (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE recharges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  wallet_id uuid NOT NULL REFERENCES wallets(id),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 25),
  status recharge_status NOT NULL DEFAULT 'pending',
  bank_account_id uuid REFERENCES bank_accounts(id),
  resubmitted_from uuid REFERENCES recharges(id),             -- "Corregir y reenviar"
  rejection_reason text, correction_hint text,
  reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz,
  ledger_id uuid REFERENCES wallet_ledger(id),
  idempotency_key text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_recharges_idem ON recharges (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_recharges_wallet ON recharges (wallet_id, requested_at DESC);
CREATE INDEX ix_recharges_pending ON recharges (tenant_id, status) WHERE status IN ('pending','in_review');

-- =====================================================================
-- 5. RIFAS ESPECIALES Y NÚMEROS FORTUNA
-- =====================================================================
CREATE TABLE special_raffles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL, description text, prize_description text,
  prize_value_cents bigint CHECK (prize_value_cents >= 0),
  photos jsonb NOT NULL DEFAULT '[]',
  number_digits smallint NOT NULL DEFAULT 5 CHECK (number_digits BETWEEN 1 AND 9),
  range_start bigint NOT NULL DEFAULT 0 CHECK (range_start >= 0),
  range_end bigint NOT NULL CHECK (range_end >= range_start),
  price_cents bigint NOT NULL CHECK (price_cents >= 25 AND price_cents % 5 = 0),   -- desde $0.25 en pasos de $0.05
  opens_at timestamptz NOT NULL,
  close_mode raffle_close_mode NOT NULL DEFAULT 'sold_out',
  closes_at timestamptz,
  draw_method text, rules text,
  status raffle_status NOT NULL DEFAULT 'draft',
  sold_count bigint NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (close_mode <> 'date' OR closes_at IS NOT NULL)
);

CREATE TABLE raffle_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  raffle_id uuid NOT NULL REFERENCES special_raffles(id),
  label text NOT NULL,
  price_cents bigint NOT NULL CHECK (price_cents > 0),
  chances int NOT NULL CHECK (chances >= 1),
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE raffle_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  raffle_id uuid NOT NULL REFERENCES special_raffles(id),
  purchase_no bigint NOT NULL,
  purchase_code text GENERATED ALWAYS AS ('RF-' || lpad(purchase_no::text, 4, '0')) STORED,
  user_id uuid REFERENCES users(id),
  buyer_name text NOT NULL, buyer_phone text NOT NULL,
  buyer_phone_norm text GENERATED ALWAYS AS (fn_norm_phone(buyer_phone)) STORED,
  buyer_email citext,
  package_id uuid REFERENCES raffle_packages(id),
  quantity int NOT NULL CHECK (quantity >= 1),
  total_cents bigint NOT NULL CHECK (total_cents > 0),
  status raffle_purchase_status NOT NULL DEFAULT 'pending_payment',
  approved_by uuid REFERENCES users(id), approved_at timestamptz,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, purchase_no)
);
CREATE UNIQUE INDEX ux_rp_idem ON raffle_purchases (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Solo existen filas para números efectivamente vendidos (se calcula bajo demanda). PK = sin duplicados.
CREATE TABLE raffle_numbers (
  raffle_id uuid NOT NULL REFERENCES special_raffles(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  number text NOT NULL CHECK (number ~ '^[0-9]+$'),
  purchase_id uuid NOT NULL REFERENCES raffle_purchases(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (raffle_id, number)
);
CREATE INDEX ix_raffle_numbers_purchase ON raffle_numbers (purchase_id);

-- Administración define QUÉ números son Fortuna, nunca A QUÉ cliente (matched_* solo lo escribe el sistema)
CREATE TABLE fortune_numbers (
  raffle_id uuid NOT NULL REFERENCES special_raffles(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  number text NOT NULL CHECK (number ~ '^[0-9]+$'),
  prize_cents bigint NOT NULL CHECK (prize_cents > 0),
  matched_purchase_id uuid REFERENCES raffle_purchases(id),
  matched_at timestamptz,
  PRIMARY KEY (raffle_id, number)
);

-- =====================================================================
-- 6. COMPRAS, TICKETS, PAGOS
-- =====================================================================
CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  order_no bigint NOT NULL,
  purchase_code text GENERATED ALWAYS AS ('#' || lpad(order_no::text, 6, '0')) STORED,
  user_id uuid REFERENCES users(id),                -- NULL = invitado
  buyer_name text NOT NULL,
  buyer_phone text NOT NULL,
  buyer_phone_norm text GENERATED ALWAYS AS (fn_norm_phone(buyer_phone)) STORED,
  buyer_email citext, buyer_document text,
  origin sale_origin NOT NULL DEFAULT 'direct',
  seller_id uuid REFERENCES users(id),
  worker_id uuid REFERENCES users(id),
  location_id uuid REFERENCES locations(id),
  status order_status NOT NULL DEFAULT 'pending_review',
  payment_method payment_method NOT NULL,
  total_cents bigint NOT NULL CHECK (total_cents >= 25),
  terms_confirmed_at timestamptz,
  adult_confirmed boolean NOT NULL DEFAULT false,
  idempotency_key text,
  approved_by uuid REFERENCES users(id), approved_at timestamptz,
  approval_after_close boolean NOT NULL DEFAULT false,
  approval_after_results boolean NOT NULL DEFAULT false,
  approval_reason text,
  rejection_reason text,
  on_credit boolean NOT NULL DEFAULT false,         -- venta a crédito de Contrata: no cuenta como cobrada
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, order_no),
  CHECK (origin <> 'seller' OR seller_id IS NOT NULL),
  CHECK (origin <> 'worker' OR worker_id IS NOT NULL)
);
CREATE UNIQUE INDEX ux_orders_idem ON orders (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_orders_user ON orders (user_id, created_at DESC);
CREATE INDEX ix_orders_lookup ON orders (tenant_id, purchase_code, buyer_phone_norm);   -- recuperación de invitado
CREATE INDEX ix_orders_status ON orders (tenant_id, status, created_at DESC);
CREATE INDEX ix_orders_seller ON orders (seller_id, created_at DESC) WHERE seller_id IS NOT NULL;
CREATE INDEX ix_orders_worker ON orders (worker_id, created_at DESC) WHERE worker_id IS NOT NULL;
CREATE INDEX ix_orders_name_trgm ON orders USING gin (buyer_name gin_trgm_ops);

CREATE TABLE tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  session_id uuid NOT NULL REFERENCES draw_sessions(id),
  digits smallint NOT NULL CHECK (digits IN (2,3,4)),
  code text NOT NULL CHECK (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$'),
  status ticket_status NOT NULL DEFAULT 'active',
  total_cents bigint NOT NULL CHECK (total_cents >= 25),
  voided_at timestamptz, voided_by uuid REFERENCES users(id),
  void_reason text, void_after_result boolean NOT NULL DEFAULT false,
  void_financial_effect text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  UNIQUE (order_id, session_id, digits)
);
CREATE INDEX ix_tickets_session ON tickets (session_id, digits, status);

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  order_id uuid NOT NULL REFERENCES orders(id),
  ticket_id uuid REFERENCES tickets(id),            -- se asigna al aprobar el pago
  session_id uuid NOT NULL REFERENCES draw_sessions(id),
  draw_id uuid NOT NULL REFERENCES draws(id),
  digits smallint NOT NULL CHECK (digits IN (2,3,4)),
  number text NOT NULL,                              -- SIEMPRE texto: 07, 007, 0007 nunca son 7
  amount_cents bigint NOT NULL CHECK (amount_cents >= 25 AND amount_cents % 25 = 0),
  plan_version_id uuid NOT NULL REFERENCES plan_versions(id),
  status item_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (number ~ '^[0-9]+$' AND length(number) = digits)
);
CREATE INDEX ix_items_order ON order_items (order_id);
CREATE INDEX ix_items_quota ON order_items (session_id, digits, number) WHERE status = 'active';
CREATE INDEX ix_items_ticket ON order_items (ticket_id);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  order_id uuid REFERENCES orders(id),
  recharge_id uuid REFERENCES recharges(id),
  raffle_purchase_id uuid REFERENCES raffle_purchases(id),
  method payment_method NOT NULL,
  status payment_status NOT NULL DEFAULT 'pending',
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  fee_cents bigint NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  provider text, provider_txn_id text,               -- ej. PayPhone / PP-… (ID de transacción)
  reference_code text,
  bank_account_id uuid REFERENCES bank_accounts(id),
  is_sandbox boolean NOT NULL DEFAULT false,
  proof_uploaded_at timestamptz,
  verified_transfer_at timestamptz,                  -- hora de pago verificada (≠ hora de aprobación)
  reviewed_at timestamptz, reviewed_by uuid REFERENCES users(id),
  rejection_reason text, rejection_hint text,
  reconciliation reconciliation_status NOT NULL DEFAULT 'not_applicable',
  expires_at timestamptz,                            -- vencimiento del código QR / efectivo
  gateway_payload jsonb,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(order_id, recharge_id, raffle_purchase_id) = 1)
);
CREATE UNIQUE INDEX ux_payments_idem ON payments (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX ux_payments_txn ON payments (tenant_id, provider, provider_txn_id) WHERE provider_txn_id IS NOT NULL;
CREATE INDEX ix_payments_order ON payments (order_id);
CREATE INDEX ix_payments_queue ON payments (tenant_id, status, created_at) WHERE status IN ('pending','in_review');

CREATE TABLE payment_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  payment_id uuid NOT NULL REFERENCES payments(id),
  storage_key text NOT NULL,                         -- objeto en almacenamiento S3 (acceso controlado)
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','application/pdf')),
  size_bytes int NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),   -- máx. 5 MB
  sha256 text NOT NULL,
  uploaded_by uuid REFERENCES users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_proof_payment ON payment_proofs (payment_id);
CREATE INDEX ix_proof_hash ON payment_proofs (tenant_id, sha256);   -- detectar comprobantes reutilizados

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  payment_id uuid NOT NULL REFERENCES payments(id),
  ticket_id uuid REFERENCES tickets(id),
  order_id uuid REFERENCES orders(id),
  reason refund_reason NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','rejected')),
  method text, proof_key text, notes text,
  original_ledger_id uuid REFERENCES wallet_ledger(id),   -- el movimiento original NUNCA desaparece
  refund_ledger_id uuid REFERENCES wallet_ledger(id),
  approved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX ix_refunds_payment ON refunds (payment_id);

CREATE TABLE gateway_events (                          -- bitácora de webhooks de pasarela (para conciliar)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  provider text NOT NULL, event_id text NOT NULL,
  payload jsonb NOT NULL, processed_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, event_id)
);

CREATE TABLE carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid REFERENCES users(id),
  guest_token text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR guest_token IS NOT NULL)
);
CREATE UNIQUE INDEX ux_carts_user ON carts (user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX ux_carts_guest ON carts (tenant_id, guest_token) WHERE guest_token IS NOT NULL;

CREATE TABLE cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  draw_id uuid NOT NULL REFERENCES draws(id),
  digits smallint NOT NULL CHECK (digits IN (2,3,4)),
  number text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 25 AND amount_cents % 25 = 0),
  plan_id uuid REFERENCES plans(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (number ~ '^[0-9]+$' AND length(number) = digits)
);
CREATE INDEX ix_cart_items_cart ON cart_items (cart_id);

-- =====================================================================
-- 7. RESULTADOS Y PREMIOS
-- =====================================================================
CREATE TABLE results (                                  -- versionado: nunca se sobrescribe
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  session_id uuid NOT NULL REFERENCES draw_sessions(id),
  digits smallint NOT NULL CHECK (digits IN (2,3,4)),
  version int NOT NULL CHECK (version >= 1),
  is_current boolean NOT NULL DEFAULT true,
  published_by uuid NOT NULL REFERENCES users(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, digits, version)
);
CREATE UNIQUE INDEX ux_results_current ON results (session_id, digits) WHERE is_current;

CREATE TABLE result_positions (
  result_id uuid NOT NULL REFERENCES results(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  digits smallint NOT NULL,
  suerte_no smallint NOT NULL CHECK (suerte_no >= 1),
  winning_number text NOT NULL,
  PRIMARY KEY (result_id, suerte_no),
  CHECK (winning_number ~ '^[0-9]+$' AND length(winning_number) = digits)
);

CREATE TABLE result_changes (                           -- historial de modificaciones de resultados
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  session_id uuid NOT NULL REFERENCES draw_sessions(id),
  digits smallint NOT NULL,
  previous_result_id uuid NOT NULL REFERENCES results(id),
  new_result_id uuid NOT NULL REFERENCES results(id),
  changed_by uuid NOT NULL REFERENCES users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (length(trim(reason)) >= 5),
  old_positions jsonb NOT NULL, new_positions jsonb NOT NULL,
  prizes_superseded int NOT NULL DEFAULT 0,
  conflicts_already_paid int NOT NULL DEFAULT 0
);

CREATE TABLE prizes (                                   -- una fila por CADA coincidencia (premios acumulativos)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  ticket_id uuid NOT NULL REFERENCES tickets(id),
  order_item_id uuid NOT NULL REFERENCES order_items(id),
  result_id uuid NOT NULL REFERENCES results(id),
  suerte_no smallint NOT NULL,
  suerte_name text NOT NULL,
  number text NOT NULL,
  amount_played_cents bigint NOT NULL,
  payout_per_dollar_cents bigint NOT NULL,            -- snapshot de la versión del plan del ticket
  prize_cents bigint NOT NULL CHECK (prize_cents >= 0),
  status prize_status NOT NULL DEFAULT 'pending',
  expires_on date NOT NULL,                           -- solo fecha límite; la hora de corte está por confirmar
  credited_ledger_id uuid REFERENCES wallet_ledger(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_item_id, result_id, suerte_no)
);
CREATE INDEX ix_prizes_ticket ON prizes (ticket_id);
CREATE INDEX ix_prizes_status ON prizes (tenant_id, status, expires_on);

-- Código secreto de cobro: tabla aparte, sin acceso para Trabajador/Vendedor (ni siquiera por API)
CREATE TABLE ticket_claim_codes (
  ticket_id uuid PRIMARY KEY REFERENCES tickets(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code_hash text NOT NULL,
  code_enc bytea,                                       -- cifrado simétrico; lo descifra solo el Administrador autorizado
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE prize_validations (                       -- validar NO paga: queda bitácora
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  ticket_id uuid NOT NULL REFERENCES tickets(id),
  validated_by uuid NOT NULL REFERENCES users(id),
  total_cents bigint NOT NULL, outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE prize_payments (                          -- UNIQUE(prize_id) = imposible pagar dos veces
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  prize_id uuid NOT NULL UNIQUE REFERENCES prizes(id),
  paid_by uuid NOT NULL REFERENCES users(id),
  location_id uuid REFERENCES locations(id),
  method text NOT NULL CHECK (method IN ('cash','transfer')),
  proof_key text,
  paid_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  wallet_id uuid REFERENCES wallets(id),
  source_prize_id uuid REFERENCES prizes(id),          -- si viene de "RETIRAR" sobre un premio
  amount_cents bigint NOT NULL CHECK (amount_cents >= 25),
  status withdrawal_status NOT NULL DEFAULT 'requested',
  reserve_ledger_id uuid REFERENCES wallet_ledger(id),
  reviewed_by uuid REFERENCES users(id), approved_by uuid REFERENCES users(id),
  paid_at timestamptz, proof_key text, rejection_reason text,
  idempotency_key text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ux_wd_idem ON withdrawals (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- un solo retiro activo por premio
CREATE UNIQUE INDEX ux_wd_prize_active ON withdrawals (source_prize_id)
  WHERE source_prize_id IS NOT NULL AND status IN ('requested','in_review','approved','paid');

-- =====================================================================
-- 8. VENDEDORES Y COMISIONES
-- =====================================================================
CREATE TABLE commission_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  seller_id uuid REFERENCES users(id),                 -- NULL = aplica a todos los vendedores
  draw_id uuid REFERENCES draws(id),                   -- NULL = todos los sorteos
  digits smallint CHECK (digits IN (2,3,4)),           -- NULL = todas las modalidades
  base commission_base NOT NULL,
  percent_bp int CHECK (percent_bp BETWEEN 0 AND 10000),   -- 600 = 6 %
  fixed_cents bigint CHECK (fixed_cents >= 0),
  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((base = 'fixed_amount' AND fixed_cents IS NOT NULL) OR (base <> 'fixed_amount' AND percent_bp IS NOT NULL))
);

CREATE TABLE commissions (                              -- solo ventas registradas personalmente por el vendedor
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  seller_id uuid NOT NULL REFERENCES users(id),
  order_id uuid REFERENCES orders(id),
  draw_id uuid REFERENCES draws(id), digits smallint,
  commission_plan_id uuid NOT NULL REFERENCES commission_plans(id),
  base_amount_cents bigint NOT NULL,
  commission_cents bigint NOT NULL CHECK (commission_cents >= 0),
  period_month date,                                    -- para comisiones sobre ganancia mensual positiva
  status text NOT NULL DEFAULT 'generated' CHECK (status IN ('generated','paid','void')),
  generated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz, paid_by uuid REFERENCES users(id)
);
CREATE UNIQUE INDEX ux_comm_order ON commissions (order_id, draw_id, digits) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX ux_comm_month ON commissions (seller_id, commission_plan_id, period_month) WHERE period_month IS NOT NULL;
CREATE INDEX ix_comm_seller ON commissions (seller_id, generated_at DESC);

-- =====================================================================
-- 9. CONTRATAS, CRÉDITO, JUGADAS PROGRAMADAS, FAVORITOS
-- =====================================================================
CREATE TABLE contratas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  client_name text NOT NULL, client_phone text, client_user_id uuid REFERENCES users(id),
  draw_id uuid NOT NULL REFERENCES draws(id),
  digits smallint NOT NULL CHECK (digits IN (2,3,4)),
  number text NOT NULL,
  plan_id uuid REFERENCES plans(id),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 25 AND amount_cents % 25 = 0),
  days_of_week smallint[] NOT NULL,
  start_date date NOT NULL,
  end_date date,                                        -- NULL = indefinida
  collection collection_mode NOT NULL DEFAULT 'cash',
  credit_authorized_by uuid REFERENCES users(id),       -- el crédito solo lo autoriza Administración
  credit_authorized_at timestamptz,
  status contrata_status NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (number ~ '^[0-9]+$' AND length(number) = digits),
  CHECK (collection <> 'credit' OR credit_authorized_by IS NOT NULL),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE TABLE contrata_slots (                           -- "CUPO RESERVADO": no es venta ni dinero cobrado
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  contrata_id uuid NOT NULL REFERENCES contratas(id),
  session_id uuid NOT NULL REFERENCES draw_sessions(id),
  status slot_status NOT NULL DEFAULT 'reserved',
  order_id uuid REFERENCES orders(id),
  sold_by uuid REFERENCES users(id), sold_at timestamptz,
  UNIQUE (contrata_id, session_id)
);
CREATE INDEX ix_slots_session ON contrata_slots (session_id, status);

CREATE TABLE receivables (                              -- cuentas por cobrar (crédito de Contratas)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  contrata_id uuid REFERENCES contratas(id),
  contrata_slot_id uuid REFERENCES contrata_slots(id),
  order_id uuid REFERENCES orders(id),
  debtor_name text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  collected_cents bigint NOT NULL DEFAULT 0 CHECK (collected_cents >= 0 AND collected_cents <= amount_cents),
  status receivable_status NOT NULL DEFAULT 'open',
  due_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE receivable_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  receivable_id uuid NOT NULL REFERENCES receivables(id),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  received_by uuid REFERENCES users(id),
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE scheduled_plays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  draw_id uuid NOT NULL REFERENCES draws(id),
  digits smallint NOT NULL CHECK (digits IN (2,3,4)),
  number text NOT NULL,
  plan_id uuid REFERENCES plans(id),
  amount_cents bigint NOT NULL CHECK (amount_cents >= 25 AND amount_cents % 25 = 0),
  days_of_week smallint[] NOT NULL,
  status scheduled_status NOT NULL DEFAULT 'active',
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (number ~ '^[0-9]+$' AND length(number) = digits)
);

CREATE TABLE scheduled_play_history (                   -- los cambios conservan historial
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  scheduled_play_id uuid NOT NULL REFERENCES scheduled_plays(id),
  changed_by uuid REFERENCES users(id),
  old_value jsonb, new_value jsonb, reason text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE scheduled_play_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  scheduled_play_id uuid NOT NULL REFERENCES scheduled_plays(id),
  session_id uuid NOT NULL REFERENCES draw_sessions(id),
  outcome scheduled_status NOT NULL CHECK (outcome IN ('executed','not_executed_insufficient_balance')),
  order_id uuid REFERENCES orders(id),                  -- NULL si no se ejecutó: sin ticket, sin venta, sin descuento parcial
  run_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scheduled_play_id, session_id)
);

CREATE TABLE favorite_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  digits smallint NOT NULL CHECK (digits IN (2,3,4)),
  number text NOT NULL, label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (number ~ '^[0-9]+$' AND length(number) = digits),
  UNIQUE (user_id, digits, number)
);

-- =====================================================================
-- 10. CONTABILIDAD, CAJA, NOTIFICACIONES, AUDITORÍA
-- =====================================================================
CREATE TABLE financial_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  kind fin_account_kind NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE financial_transactions (                    -- inmutable; la salida de un premio se fecha el día que se paga
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  account_id uuid NOT NULL REFERENCES financial_accounts(id),
  location_id uuid REFERENCES locations(id),
  direction fin_direction NOT NULL,
  category fin_category NOT NULL,
  line fin_line NOT NULL DEFAULT 'general',
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  method payment_method,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  origin_session_id uuid REFERENCES draw_sessions(id), -- "Premio → Sorteo del martes · Salida financiera → miércoles"
  transfer_ref uuid,                                    -- referencia compartida de transferencias internas
  ref_type text, ref_id uuid, note text,
  created_by uuid REFERENCES users(id)
);
CREATE INDEX ix_fin_day ON financial_transactions (tenant_id, occurred_at, category);
CREATE INDEX ix_fin_transfer ON financial_transactions (transfer_ref) WHERE transfer_ref IS NOT NULL;

CREATE TABLE cash_closings (                             -- la diferencia queda registrada, nunca se corrige sobrescribiendo
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  location_id uuid REFERENCES locations(id),
  closing_date date NOT NULL,
  opening_cents bigint NOT NULL DEFAULT 0,
  income_cents bigint NOT NULL DEFAULT 0,
  transfers_in_cents bigint NOT NULL DEFAULT 0,
  prizes_paid_cents bigint NOT NULL DEFAULT 0,
  expenses_cents bigint NOT NULL DEFAULT 0,
  withdrawals_cents bigint NOT NULL DEFAULT 0,
  transfers_out_cents bigint NOT NULL DEFAULT 0,
  expected_cents bigint GENERATED ALWAYS AS
    (opening_cents + income_cents + transfers_in_cents - prizes_paid_cents - expenses_cents - withdrawals_cents - transfers_out_cents) STORED,
  counted_cents bigint NOT NULL,
  difference_cents bigint GENERATED ALWAYS AS
    (counted_cents - (opening_cents + income_cents + transfers_in_cents - prizes_paid_cents - expenses_cents - withdrawals_cents - transfers_out_cents)) STORED,
  notes text,
  closed_by uuid NOT NULL REFERENCES users(id),
  closed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, location_id, closing_date)
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid REFERENCES users(id),
  audience_role user_role,
  type text NOT NULL, title text NOT NULL, body text,
  data jsonb NOT NULL DEFAULT '{}',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR audience_role IS NOT NULL)
);
CREATE INDEX ix_notif_user ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  platform push_platform NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_preferences (
  user_id uuid NOT NULL REFERENCES users(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  type text NOT NULL,
  push boolean NOT NULL DEFAULT true,
  in_app boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, type)
);

-- Auditoría inmutable: quién → qué → cuándo → valor anterior → valor nuevo → motivo
-- (Producción: particionar por mes con PARTITION BY RANGE (created_at))
CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  actor_id uuid, actor_role user_role,
  action text NOT NULL,
  entity_type text NOT NULL, entity_id text,
  old_value jsonb, new_value jsonb, reason text,
  ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_entity ON audit_log (tenant_id, entity_type, entity_id, created_at DESC);
CREATE INDEX ix_audit_actor ON audit_log (tenant_id, actor_id, created_at DESC);
CREATE INDEX ix_audit_action ON audit_log (tenant_id, action, created_at DESC);
-- =====================================================================
-- EL IMPERIO DE ROSS — 02_logic.sql
-- Funciones atómicas, triggers de integridad, vistas, RLS y permisos.
-- Convención: el backend ejecuta, por cada petición y dentro de una transacción:
--   SELECT set_config('app.tenant_id', '<uuid>', true);
--   SELECT set_config('app.user_id',   '<uuid>', true);
--   SELECT set_config('app.audit_reason', '<motivo>', true);   -- opcional
-- Las funciones *_core las usa solo el rol de sistema (rf_api_admin).
-- =====================================================================
SET search_path = app, public;

ALTER TABLE special_raffles ADD CONSTRAINT ck_raffle_range_digits CHECK (range_end < power(10, number_digits));

-- ---------- Triggers genéricos ----------
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

CREATE FUNCTION fn_default_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.tenant_id := COALESCE(NEW.tenant_id, current_tenant()); RETURN NEW; END $$;

CREATE FUNCTION fn_deny_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'REGISTRO_INMUTABLE: % no admite UPDATE ni DELETE', TG_TABLE_NAME USING ERRCODE = 'P0001'; END $$;

CREATE FUNCTION fn_deny_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'SIN_ELIMINACION_FISICA: % solo admite anulación con motivo', TG_TABLE_NAME USING ERRCODE = 'P0001'; END $$;

CREATE FUNCTION fn_results_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'SIN_ELIMINACION_FISICA: results'; END IF;
  IF (to_jsonb(NEW) - 'is_current') <> (to_jsonb(OLD) - 'is_current') THEN
    RAISE EXCEPTION 'REGISTRO_INMUTABLE: un resultado publicado solo cambia is_current; registre una nueva versión';
  END IF;
  RETURN NEW;
END $$;

-- ---------- Auditoría ----------
CREATE FUNCTION fn_audit(p_tenant uuid, p_actor uuid, p_action text, p_entity text, p_entity_id text,
                         p_old jsonb, p_new jsonb, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO audit_log (tenant_id, actor_id, actor_role, action, entity_type, entity_id, old_value, new_value, reason)
  VALUES (p_tenant, p_actor, (SELECT role FROM users WHERE id = p_actor), p_action, p_entity, p_entity_id, p_old, p_new,
          COALESCE(p_reason, NULLIF(current_setting('app.audit_reason', true), '')));
$$;

CREATE FUNCTION fn_audit_row() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_old jsonb; v_new jsonb; v_src jsonb;
BEGIN
  v_old := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) - 'password_hash' - 'two_factor_secret_ref' END;
  v_new := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) - 'password_hash' - 'two_factor_secret_ref' END;
  IF TG_OP = 'UPDATE' AND v_old = v_new THEN RETURN NEW; END IF;
  v_src := COALESCE(v_new, v_old);
  PERFORM fn_audit((v_src->>'tenant_id')::uuid, current_actor(), lower(TG_OP) || '.' || TG_TABLE_NAME, TG_TABLE_NAME,
                   COALESCE(v_src->>'id', concat_ws(':', v_src->>'role', v_src->>'action', v_src->>'key', v_src->>'draw_id', v_src->>'dow')),
                   v_old, v_new);
  RETURN COALESCE(NEW, OLD);
END $$;

-- ---------- Helpers ----------
CREATE FUNCTION fn_setting(p_tenant uuid, p_key text, p_default jsonb) RETURNS jsonb
LANGUAGE sql STABLE AS $$ SELECT COALESCE((SELECT value FROM app_settings WHERE tenant_id = p_tenant AND key = p_key), p_default) $$;

CREATE FUNCTION fn_can(p_user uuid, p_action text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT rp.allowed FROM users u
                   JOIN role_permissions rp ON rp.tenant_id = u.tenant_id AND rp.role = u.role AND rp.action = p_action
                   WHERE u.id = p_user AND u.is_active), false)
$$;

CREATE FUNCTION fn_next_counter(p_tenant uuid, p_name text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
  INSERT INTO counters (tenant_id, name, value) VALUES (p_tenant, p_name, 1)
  ON CONFLICT (tenant_id, name) DO UPDATE SET value = counters.value + 1 RETURNING value INTO v;
  RETURN v;
END $$;

-- Código de ticket: 8 caracteres sin ambiguos (sin 0/O/1/I), único por tenant, nunca con prefijo repetido
CREATE FUNCTION fn_gen_ticket_code(p_tenant uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v_b bytea; v_code text; i int;
BEGIN
  LOOP
    v_b := gen_random_bytes(8); v_code := '';
    FOR i IN 0..7 LOOP v_code := v_code || substr(v_alpha, (get_byte(v_b, i) % 32) + 1, 1); END LOOP;
    IF NOT EXISTS (SELECT 1 FROM tickets WHERE tenant_id = p_tenant AND code = v_code) THEN RETURN v_code; END IF;
  END LOOP;
END $$;

CREATE FUNCTION fn_notify(p_tenant uuid, p_user uuid, p_type text, p_title text, p_body text DEFAULT NULL,
                          p_data jsonb DEFAULT '{}', p_role user_role DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO notifications (tenant_id, user_id, audience_role, type, title, body, data)
  SELECT p_tenant, p_user, p_role, p_type, p_title, p_body, p_data WHERE p_user IS NOT NULL OR p_role IS NOT NULL;
$$;

-- ---------- Sesiones de sorteo (cada sorteo con su cierre propio) ----------
CREATE FUNCTION fn_ensure_sessions(p_tenant uuid, p_from date, p_to date) RETURNS int LANGUAGE plpgsql AS $$
DECLARE d draws%ROWTYPE; v_date date; v_tz text; v_n int := 0; v_c int; v_draws timestamptz; v_ref record;
BEGIN
  SELECT timezone INTO v_tz FROM tenants WHERE id = p_tenant;
  FOR d IN SELECT * FROM draws WHERE tenant_id = p_tenant AND is_active LOOP
    FOR v_date IN SELECT x::date FROM generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') x LOOP
      IF extract(isodow FROM v_date)::int = ANY (d.days_of_week) THEN
        v_draws := (v_date + d.draw_time)::timestamp AT TIME ZONE v_tz;
        SELECT reference_lottery, reference_abbr INTO v_ref FROM draw_day_references
          WHERE draw_id = d.id AND dow = extract(isodow FROM v_date)::int;
        INSERT INTO draw_sessions (tenant_id, draw_id, draw_date, closes_at, draws_at, status, reference_lottery, reference_abbr)
        VALUES (p_tenant, d.id, v_date, v_draws - make_interval(mins => d.close_offset_minutes), v_draws,
                CASE WHEN v_draws - make_interval(mins => d.close_offset_minutes) > now() THEN 'open'::session_status ELSE 'closed'::session_status END,
                COALESCE(v_ref.reference_lottery, d.reference_lottery), COALESCE(v_ref.reference_abbr, d.reference_abbr))
        ON CONFLICT (draw_id, draw_date) DO NOTHING;
        GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n + v_c;
      END IF;
    END LOOP;
  END LOOP;
  RETURN v_n;
END $$;

CREATE FUNCTION fn_close_sessions(p_tenant uuid) RETURNS int LANGUAGE sql AS $$   -- tarea programada
  WITH u AS (UPDATE draw_sessions SET status = 'closed' WHERE tenant_id = p_tenant AND status IN ('scheduled','open') AND closes_at <= now() RETURNING 1)
  SELECT count(*)::int FROM u
$$;

CREATE FUNCTION fn_next_session(p_draw uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM draw_sessions WHERE draw_id = p_draw AND status IN ('scheduled','open') AND closes_at > now()
  ORDER BY closes_at LIMIT 1
$$;

-- ---------- Guardas de integridad ----------
-- Cupo por número y cierre: cada sorteo cierra por separado; pendientes de revisión consumen cupo (no reservan números)
CREATE FUNCTION trg_order_items_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_s draw_sessions%ROWTYPE; v_m draw_modalities%ROWTYPE; v_used bigint;
BEGIN
  SELECT * INTO v_s FROM draw_sessions WHERE id = NEW.session_id;
  IF NOT FOUND OR v_s.draw_id <> NEW.draw_id THEN RAISE EXCEPTION 'SESION_INVALIDA'; END IF;
  IF v_s.status NOT IN ('scheduled','open') OR now() >= v_s.closes_at THEN RAISE EXCEPTION 'SORTEO_CERRADO'; END IF;
  SELECT * INTO v_m FROM draw_modalities WHERE draw_id = NEW.draw_id AND digits = NEW.digits AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'MODALIDAD_NO_DISPONIBLE'; END IF;
  IF NEW.amount_cents < v_m.min_cents OR NEW.amount_cents % v_m.step_cents <> 0 THEN
    RAISE EXCEPTION 'VALOR_INVALIDO: mínimo % y múltiplos de %', v_m.min_cents, v_m.step_cents;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM plan_versions pv JOIN plans p ON p.id = pv.plan_id
                 WHERE pv.id = NEW.plan_version_id AND p.draw_id = NEW.draw_id AND p.digits = NEW.digits) THEN
    RAISE EXCEPTION 'PLAN_INVALIDO';
  END IF;
  IF v_m.quota_per_number_cents IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.session_id::text || ':' || NEW.digits || ':' || NEW.number, 0));
    SELECT COALESCE(SUM(oi.amount_cents), 0) INTO v_used
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE oi.session_id = NEW.session_id AND oi.digits = NEW.digits AND oi.number = NEW.number
       AND oi.status = 'active' AND o.status IN ('pending_review','approved') AND oi.id <> NEW.id;
    IF v_used + NEW.amount_cents > v_m.quota_per_number_cents THEN
      RAISE EXCEPTION 'CUPO_EXCEDIDO: disponible % centavos para el %', v_m.quota_per_number_cents - v_used, NEW.number;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_order_items_guard BEFORE INSERT ON order_items FOR EACH ROW EXECUTE FUNCTION trg_order_items_guard();

CREATE FUNCTION trg_plan_prizes_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_max smallint;
BEGIN
  SELECT m.max_suertes INTO v_max FROM plan_versions pv JOIN plans p ON p.id = pv.plan_id
    JOIN draw_modalities m ON m.draw_id = p.draw_id AND m.digits = p.digits WHERE pv.id = NEW.plan_version_id;
  IF v_max IS NULL OR NEW.suerte_no > v_max THEN RAISE EXCEPTION 'SUERTE_FUERA_DE_RANGO (máx. %)', v_max; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_plan_prizes_guard BEFORE INSERT OR UPDATE ON plan_prizes FOR EACH ROW EXECUTE FUNCTION trg_plan_prizes_guard();

-- Una versión de plan ya usada por tickets no se edita: se crea otra versión
CREATE FUNCTION trg_plan_prizes_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v uuid := COALESCE(NEW.plan_version_id, OLD.plan_version_id);
BEGIN
  IF TG_OP <> 'INSERT' AND EXISTS (SELECT 1 FROM order_items WHERE plan_version_id = v) THEN
    RAISE EXCEPTION 'PLAN_CONGELADO: modificar un plan nunca cambia tickets anteriores; cree una nueva versión';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER trg_plan_prizes_frozen BEFORE UPDATE OR DELETE ON plan_prizes FOR EACH ROW EXECUTE FUNCTION trg_plan_prizes_frozen();

-- Números Fortuna: Administración define cuáles; el cliente que los recibe solo lo asigna el sistema
CREATE FUNCTION trg_fortune_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.matched_purchase_id IS DISTINCT FROM OLD.matched_purchase_id OR NEW.matched_at IS DISTINCT FROM OLD.matched_at)
     AND COALESCE(current_setting('app.fortune_internal', true), '') <> 'on' THEN
    RAISE EXCEPTION 'No se puede asignar un Número Fortuna a un cliente: lo asigna el sistema al vender el número';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_fortune_guard BEFORE UPDATE ON fortune_numbers FOR EACH ROW EXECUTE FUNCTION trg_fortune_guard();
CREATE FUNCTION trg_fortune_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.matched_purchase_id IS NOT NULL THEN RAISE EXCEPTION 'matched_purchase_id solo lo escribe el sistema'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_fortune_insert_guard BEFORE INSERT ON fortune_numbers FOR EACH ROW EXECUTE FUNCTION trg_fortune_insert_guard();

-- =====================================================================
-- BILLETERA (libro inmutable, saldo anterior/posterior, idempotente)
-- =====================================================================
CREATE FUNCTION fn_get_wallet(p_user uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid; v_tenant uuid;
BEGIN
  SELECT id INTO v FROM wallets WHERE user_id = p_user;
  IF v IS NULL THEN
    SELECT tenant_id INTO v_tenant FROM users WHERE id = p_user;
    INSERT INTO wallets (tenant_id, user_id) VALUES (v_tenant, p_user) ON CONFLICT (user_id) DO NOTHING;
    SELECT id INTO v FROM wallets WHERE user_id = p_user;
  END IF;
  RETURN v;
END $$;

CREATE FUNCTION fn_wallet_apply(p_wallet uuid, p_type ledger_type, p_avail bigint, p_res bigint, p_ref_type text,
                                p_ref uuid, p_reason text, p_actor uuid, p_idem text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE w wallets%ROWTYPE; v_id uuid; v_av bigint; v_rs bigint;
BEGIN
  SELECT * INTO w FROM wallets WHERE id = p_wallet FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BILLETERA_NO_ENCONTRADA'; END IF;
  IF p_idem IS NOT NULL THEN
    SELECT id INTO v_id FROM wallet_ledger WHERE tenant_id = w.tenant_id AND idempotency_key = p_idem;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;
  v_av := w.available_cents + p_avail; v_rs := w.reserved_cents + p_res;
  IF v_av < 0 THEN RAISE EXCEPTION 'SALDO_INSUFICIENTE'; END IF;
  IF v_rs < 0 THEN RAISE EXCEPTION 'RESERVA_INVALIDA'; END IF;
  UPDATE wallets SET available_cents = v_av, reserved_cents = v_rs, version = version + 1 WHERE id = p_wallet;
  INSERT INTO wallet_ledger (tenant_id, wallet_id, type, available_delta, reserved_delta, available_before, available_after,
                             reserved_before, reserved_after, ref_type, ref_id, reason, created_by, idempotency_key)
  VALUES (w.tenant_id, p_wallet, p_type, p_avail, p_res, w.available_cents, v_av, w.reserved_cents, v_rs,
          p_ref_type, p_ref, p_reason, p_actor, p_idem) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- =====================================================================
-- COMPRA: envío atómico (idempotente) → revisión → tickets
-- =====================================================================
-- p_items = [{"draw_id":"…","digits":2,"number":"07","amount_cents":100,"plan_id":"…"(opcional),"session_id":"…"(opcional)}]
CREATE FUNCTION fn_submit_order(
  p_user uuid, p_buyer jsonb, p_items jsonb, p_method payment_method,
  p_origin sale_origin DEFAULT 'direct', p_seller uuid DEFAULT NULL, p_worker uuid DEFAULT NULL,
  p_location uuid DEFAULT NULL, p_idem text DEFAULT NULL, p_auto_approve boolean DEFAULT NULL,
  p_bank uuid DEFAULT NULL, p_on_credit boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_tenant uuid := current_tenant(); v_order uuid; v_no bigint; v_total bigint; i jsonb;
  v_draw uuid; v_digits int; v_sess uuid; v_plan uuid; v_cnt int; v_cfg payment_methods_config%ROWTYPE;
  v_has_cfg boolean; v_auto boolean; v_adult boolean; v_wallet uuid; v_code text;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'TENANT_REQUERIDO'; END IF;
  IF p_idem IS NOT NULL THEN
    SELECT id INTO v_order FROM orders WHERE tenant_id = v_tenant AND idempotency_key = p_idem;
    IF FOUND THEN RETURN v_order; END IF;                       -- doble toque / reintento: misma compra
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'CARRITO_VACIO'; END IF;
  SELECT SUM((e->>'amount_cents')::bigint) INTO v_total FROM jsonb_array_elements(p_items) e;

  SELECT * INTO v_cfg FROM payment_methods_config WHERE tenant_id = v_tenant AND method = p_method;
  v_has_cfg := FOUND;
  IF p_method NOT IN ('wallet','bank_transfer','cash_counter') AND (NOT v_has_cfg OR NOT v_cfg.enabled) THEN
    RAISE EXCEPTION 'METODO_NO_DISPONIBLE';
  END IF;
  IF v_has_cfg AND (v_total < v_cfg.min_cents OR (v_cfg.max_cents IS NOT NULL AND v_total > v_cfg.max_cents)) THEN
    RAISE EXCEPTION 'MONTO_FUERA_DE_RANGO_METODO';
  END IF;
  IF p_method = 'wallet' AND p_user IS NULL THEN RAISE EXCEPTION 'SALDO_REQUIERE_SESION'; END IF;

  v_adult := COALESCE((p_buyer->>'adult')::boolean, false)
             OR EXISTS (SELECT 1 FROM users WHERE id = p_user AND adult_confirmed_at IS NOT NULL);
  IF p_origin IN ('direct') AND NOT v_adult THEN RAISE EXCEPTION 'DEBE_SER_MAYOR_DE_EDAD'; END IF;

  v_no := fn_next_counter(v_tenant, 'order');
  INSERT INTO orders (tenant_id, order_no, user_id, buyer_name, buyer_phone, buyer_email, buyer_document, origin, seller_id,
                      worker_id, location_id, payment_method, total_cents, terms_confirmed_at, adult_confirmed, idempotency_key, on_credit)
  VALUES (v_tenant, v_no, p_user, p_buyer->>'name', p_buyer->>'phone', NULLIF(p_buyer->>'email',''), NULLIF(p_buyer->>'document',''),
          p_origin, p_seller, p_worker, p_location, p_method, v_total,
          CASE WHEN COALESCE((p_buyer->>'terms')::boolean, false) OR p_origin <> 'direct' THEN now() END, v_adult, p_idem, p_on_credit)
  RETURNING id INTO v_order;

  FOR i IN SELECT e FROM jsonb_array_elements(p_items) e LOOP
    v_draw := (i->>'draw_id')::uuid; v_digits := (i->>'digits')::int;
    v_sess := COALESCE((i->>'session_id')::uuid, fn_next_session(v_draw));
    IF v_sess IS NULL THEN RAISE EXCEPTION 'SORTEO_CERRADO'; END IF;
    IF i ? 'plan_id' THEN
      SELECT pv.id INTO v_plan FROM plan_versions pv WHERE pv.plan_id = (i->>'plan_id')::uuid AND pv.is_current;
    ELSE
      SELECT count(*) INTO v_cnt FROM plans WHERE draw_id = v_draw AND digits = v_digits AND is_active;
      IF v_cnt = 0 THEN RAISE EXCEPTION 'SIN_PLAN_ACTIVO'; END IF;
      IF v_cnt > 1 THEN RAISE EXCEPTION 'PLAN_REQUERIDO'; END IF;
      SELECT pv.id INTO v_plan FROM plans p JOIN plan_versions pv ON pv.plan_id = p.id AND pv.is_current
       WHERE p.draw_id = v_draw AND p.digits = v_digits AND p.is_active;
    END IF;
    INSERT INTO order_items (tenant_id, order_id, session_id, draw_id, digits, number, amount_cents, plan_version_id)
    VALUES (v_tenant, v_order, v_sess, v_draw, v_digits, i->>'number', (i->>'amount_cents')::bigint, v_plan);
  END LOOP;

  INSERT INTO payments (tenant_id, order_id, method, status, amount_cents, reference_code, bank_account_id, is_sandbox,
                        reconciliation, expires_at, idempotency_key)
  SELECT v_tenant, v_order, p_method, 'pending', v_total, o.purchase_code, p_bank,
         COALESCE(v_cfg.is_sandbox, false) AND p_method NOT IN ('wallet','bank_transfer','cash_counter'),
         CASE WHEN p_method IN ('payphone','card','qr_wallet','cash_point') THEN 'pending'::reconciliation_status ELSE 'not_applicable' END,
         CASE WHEN p_method IN ('qr_wallet','cash_point') THEN now() + interval '30 minutes' END,
         CASE WHEN p_idem IS NULL THEN NULL ELSE 'pay:' || p_idem END
    FROM orders o WHERE o.id = v_order;

  IF p_method = 'wallet' THEN                                   -- se aparta el importe hasta aprobar
    v_wallet := fn_get_wallet(p_user);
    PERFORM fn_wallet_apply(v_wallet, 'purchase_reserve', -v_total, v_total, 'order', v_order, 'Compra pendiente', p_user,
                            CASE WHEN p_idem IS NULL THEN NULL ELSE 'reserve:' || p_idem END);
  END IF;

  v_auto := COALESCE(p_auto_approve,
              CASE p_method WHEN 'cash_counter' THEN true
                            WHEN 'wallet' THEN COALESCE(fn_setting(v_tenant, 'wallet_auto_approve', 'false'::jsonb)::text::boolean, false)
                            ELSE false END);
  PERFORM fn_audit(v_tenant, COALESCE(p_worker, p_seller, p_user), 'order.submitted', 'order', v_order::text, NULL,
                   jsonb_build_object('total_cents', v_total, 'method', p_method, 'origin', p_origin));
  IF v_auto THEN
    PERFORM fn_issue_tickets(v_order, COALESCE(p_worker, p_seller), NULL);
  ELSE
    PERFORM fn_notify(v_tenant, NULL, 'order.new_receipt', 'Nueva compra por revisar', NULL, jsonb_build_object('order_id', v_order), 'admin');
  END IF;
  RETURN v_order;
END $$;

-- NÚCLEO: aprueba el pago, emite un ticket por (sorteo, modalidad), liquida saldo, comisión y contabilidad
CREATE FUNCTION fn_issue_tickets(p_order uuid, p_actor uuid DEFAULT NULL, p_reason text DEFAULT NULL)
RETURNS SETOF uuid LANGUAGE plpgsql AS $$
DECLARE
  o orders%ROWTYPE; pay payments%ROWTYPE; r record; v_ticket uuid; v_issued int := 0;
  v_issued_cents bigint := 0; v_late_cents bigint := 0; v_pay_time timestamptz;
  v_after_close boolean; v_after_results boolean; v_wallet uuid; v_ledger uuid; v_account uuid; v_action text;
BEGIN
  SELECT * INTO o FROM orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDEN_NO_ENCONTRADA'; END IF;
  IF o.status <> 'pending_review' THEN RAISE EXCEPTION 'ORDEN_NO_PENDIENTE'; END IF;
  SELECT * INTO pay FROM payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  -- Hora de pago ≠ hora de aprobación administrativa
  v_pay_time := COALESCE(pay.verified_transfer_at, pay.proof_uploaded_at, pay.created_at);
  SELECT COALESCE(bool_or(now() >= s.closes_at), false), COALESCE(bool_or(s.status = 'resulted'), false)
    INTO v_after_close, v_after_results
    FROM draw_sessions s WHERE s.id IN (SELECT session_id FROM order_items WHERE order_id = o.id AND status = 'active');
  IF v_after_results AND (p_reason IS NULL OR length(trim(p_reason)) < 5) THEN
    RAISE EXCEPTION 'MOTIVO_REQUERIDO: aprobación posterior a publicación de resultados';
  END IF;

  FOR r IN SELECT oi.session_id, oi.digits, s.closes_at, SUM(oi.amount_cents) AS total
             FROM order_items oi JOIN draw_sessions s ON s.id = oi.session_id
            WHERE oi.order_id = o.id AND oi.status = 'active'
            GROUP BY oi.session_id, oi.digits, s.closes_at ORDER BY oi.session_id, oi.digits LOOP
    IF v_pay_time >= r.closes_at THEN                            -- pagó tras el cierre: el ticket NO participa
      UPDATE order_items SET status = 'voided' WHERE order_id = o.id AND session_id = r.session_id AND digits = r.digits AND status = 'active';
      INSERT INTO refunds (tenant_id, payment_id, order_id, reason, amount_cents, status, notes)
      VALUES (o.tenant_id, pay.id, o.id, 'out_of_hours', r.total, 'pending', 'REEMBOLSO POR PAGO FUERA DE HORARIO');
      v_late_cents := v_late_cents + r.total;
    ELSE
      INSERT INTO tickets (tenant_id, order_id, session_id, digits, code, total_cents)
      VALUES (o.tenant_id, o.id, r.session_id, r.digits, fn_gen_ticket_code(o.tenant_id), r.total) RETURNING id INTO v_ticket;
      UPDATE order_items SET ticket_id = v_ticket WHERE order_id = o.id AND session_id = r.session_id AND digits = r.digits AND status = 'active';
      v_issued := v_issued + 1; v_issued_cents := v_issued_cents + r.total;
      RETURN NEXT v_ticket;
    END IF;
  END LOOP;

  IF o.payment_method = 'wallet' THEN
    SELECT id INTO v_wallet FROM wallets WHERE user_id = o.user_id;
    IF v_issued_cents > 0 THEN
      PERFORM fn_wallet_apply(v_wallet, 'purchase_settle', 0, -v_issued_cents, 'order', o.id, 'Compra aprobada', p_actor, 'settle:' || o.id);
    END IF;
    IF v_late_cents > 0 THEN
      v_ledger := fn_wallet_apply(v_wallet, 'purchase_release', v_late_cents, -v_late_cents, 'order', o.id,
                                  'REEMBOLSO POR PAGO FUERA DE HORARIO', p_actor, 'release:' || o.id);
      UPDATE refunds SET status = 'completed', refund_ledger_id = v_ledger, completed_at = now()
       WHERE order_id = o.id AND reason = 'out_of_hours' AND status = 'pending';
    END IF;
  ELSIF v_issued_cents > 0 AND NOT o.on_credit THEN
    -- Dinero recibido ≠ uso de saldo ≠ venta: las compras con saldo NO suman ingreso (ya entró como recarga)
    SELECT id INTO v_account FROM financial_accounts WHERE tenant_id = o.tenant_id AND kind = 'income' AND is_active ORDER BY created_at LIMIT 1;
    IF v_account IS NOT NULL THEN
      INSERT INTO financial_transactions (tenant_id, account_id, location_id, direction, category, line, amount_cents, method, ref_type, ref_id, created_by)
      VALUES (o.tenant_id, v_account, o.location_id, 'in', 'sales', 'daily', v_issued_cents, o.payment_method, 'order', o.id, p_actor);
    END IF;
  END IF;

  UPDATE orders SET status = CASE WHEN v_issued > 0 THEN 'approved' ELSE 'refunded' END::order_status, approved_by = p_actor, approved_at = now(),
         approval_after_close = v_after_close, approval_after_results = v_after_results, approval_reason = p_reason
   WHERE id = o.id;
  UPDATE payments SET status = CASE WHEN v_issued > 0 THEN 'approved' ELSE 'refunded' END::payment_status,
         reviewed_at = now(), reviewed_by = p_actor WHERE id = pay.id;

  IF o.origin = 'seller' AND v_issued > 0 THEN PERFORM fn_generate_commissions(o.id); END IF;

  v_action := CASE WHEN v_after_results THEN 'order.approved_after_results' WHEN v_after_close THEN 'order.approved_after_close' ELSE 'order.approved' END;
  PERFORM fn_audit(o.tenant_id, p_actor, v_action, 'order', o.id::text, jsonb_build_object('status', 'pending_review'),
                   jsonb_build_object('status', CASE WHEN v_issued > 0 THEN 'approved' ELSE 'refunded' END, 'tickets', v_issued,
                                      'payment_time', v_pay_time, 'issued_cents', v_issued_cents, 'late_cents', v_late_cents), p_reason);
  IF o.user_id IS NOT NULL THEN
    PERFORM fn_notify(o.tenant_id, o.user_id, 'ticket.confirmed',
                      CASE WHEN v_issued > 0 THEN '¡Tu ticket está activo!' ELSE 'Pago fuera de horario' END, o.purchase_code,
                      jsonb_build_object('order_id', o.id));
  END IF;
  RETURN;
END $$;

-- Aprobar desde la cola de comprobantes (con permisos). Trabajador: solo antes del cierre y si está autorizado.
CREATE FUNCTION fn_review_order(p_order uuid, p_reviewer uuid, p_reason text DEFAULT NULL) RETURNS SETOF uuid
LANGUAGE plpgsql AS $$
DECLARE u users%ROWTYPE; v_closed boolean; sp staff_profiles%ROWTYPE;
BEGIN
  SELECT * INTO u FROM users WHERE id = p_reviewer AND is_active;
  IF NOT FOUND OR NOT fn_can(p_reviewer, 'order.approve') THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  IF u.role <> 'admin' THEN
    SELECT COALESCE(bool_or(now() >= s.closes_at), false) INTO v_closed FROM draw_sessions s
     WHERE s.id IN (SELECT session_id FROM order_items WHERE order_id = p_order AND status = 'active');
    SELECT * INTO sp FROM staff_profiles WHERE user_id = u.id;
    IF v_closed OR NOT COALESCE(sp.can_review_receipts_until_close, false) THEN
      RAISE EXCEPTION 'SOLO_ADMIN: Solo un Administrador autorizado puede verificar esta participación.';
    END IF;
  END IF;
  RETURN QUERY SELECT * FROM fn_issue_tickets(p_order, p_reviewer, p_reason);
END $$;

CREATE FUNCTION fn_reject_order_core(p_order uuid, p_actor uuid, p_reason text, p_hint text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE o orders%ROWTYPE; v_wallet uuid;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN RAISE EXCEPTION 'MOTIVO_REQUERIDO'; END IF;
  SELECT * INTO o FROM orders WHERE id = p_order FOR UPDATE;
  IF NOT FOUND OR o.status <> 'pending_review' THEN RAISE EXCEPTION 'ORDEN_NO_PENDIENTE'; END IF;
  UPDATE orders SET status = 'rejected', rejection_reason = p_reason WHERE id = o.id;
  UPDATE order_items SET status = 'rejected' WHERE order_id = o.id AND status = 'active';
  UPDATE payments SET status = 'rejected', rejection_reason = p_reason, rejection_hint = p_hint, reviewed_at = now(), reviewed_by = p_actor
   WHERE order_id = o.id AND status IN ('pending','in_review');
  IF o.payment_method = 'wallet' THEN
    SELECT id INTO v_wallet FROM wallets WHERE user_id = o.user_id;
    PERFORM fn_wallet_apply(v_wallet, 'purchase_release', o.total_cents, -o.total_cents, 'order', o.id, 'Compra rechazada: ' || p_reason, p_actor, 'release:' || o.id);
  END IF;
  PERFORM fn_audit(o.tenant_id, p_actor, 'order.rejected', 'order', o.id::text, jsonb_build_object('status', 'pending_review'), jsonb_build_object('status', 'rejected'), p_reason);
  IF o.user_id IS NOT NULL THEN
    PERFORM fn_notify(o.tenant_id, o.user_id, 'payment.rejected', 'Pago rechazado', p_reason, jsonb_build_object('order_id', o.id, 'hint', p_hint));
  END IF;
END $$;

CREATE FUNCTION fn_reject_order(p_order uuid, p_reviewer uuid, p_reason text, p_hint text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE u users%ROWTYPE; v_closed boolean; sp staff_profiles%ROWTYPE;
BEGIN
  SELECT * INTO u FROM users WHERE id = p_reviewer AND is_active;
  IF NOT FOUND OR NOT fn_can(p_reviewer, 'order.approve') THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  IF u.role <> 'admin' THEN
    SELECT COALESCE(bool_or(now() >= s.closes_at), false) INTO v_closed FROM draw_sessions s
     WHERE s.id IN (SELECT session_id FROM order_items WHERE order_id = p_order);
    SELECT * INTO sp FROM staff_profiles WHERE user_id = u.id;
    IF v_closed OR NOT COALESCE(sp.can_review_receipts_until_close, false) THEN
      RAISE EXCEPTION 'SOLO_ADMIN: Solo un Administrador autorizado puede verificar esta participación.';
    END IF;
  END IF;
  PERFORM fn_reject_order_core(p_order, p_reviewer, p_reason, p_hint);
END $$;

CREATE FUNCTION fn_attach_proof(p_payment uuid, p_key text, p_mime text, p_size int, p_sha text, p_actor uuid DEFAULT NULL,
                                p_transfer_at timestamptz DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE pay payments%ROWTYPE;
BEGIN
  SELECT * INTO pay FROM payments WHERE id = p_payment FOR UPDATE;
  IF NOT FOUND OR pay.status NOT IN ('pending','in_review') THEN RAISE EXCEPTION 'PAGO_NO_EDITABLE'; END IF;
  INSERT INTO payment_proofs (tenant_id, payment_id, storage_key, mime_type, size_bytes, sha256, uploaded_by)
  VALUES (pay.tenant_id, p_payment, p_key, p_mime, p_size, p_sha, p_actor);
  UPDATE payments SET proof_uploaded_at = now(), verified_transfer_at = COALESCE(p_transfer_at, verified_transfer_at), status = 'in_review'
   WHERE id = p_payment;
END $$;

-- Pasarela: confirmación (webhook) idempotente. Pago confirmado tras el cierre ⇒ el ticket no participa.
CREATE FUNCTION fn_confirm_gateway_payment(p_payment uuid, p_provider_txn text, p_ok boolean, p_reason text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE pay payments%ROWTYPE;
BEGIN
  SELECT * INTO pay FROM payments WHERE id = p_payment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAGO_NO_ENCONTRADO'; END IF;
  IF pay.status NOT IN ('pending','in_review') THEN RETURN; END IF;
  IF p_ok THEN
    UPDATE payments SET provider_txn_id = p_provider_txn, verified_transfer_at = now(), reconciliation = 'pending' WHERE id = p_payment;
    IF pay.order_id IS NOT NULL THEN PERFORM fn_issue_tickets(pay.order_id, NULL, 'Pago confirmado por pasarela');
    ELSIF pay.recharge_id IS NOT NULL THEN PERFORM fn_recharge_decide_core(pay.recharge_id, NULL, true, NULL, NULL);
    ELSE PERFORM fn_approve_raffle_core(pay.raffle_purchase_id, NULL); END IF;
  ELSE
    UPDATE payments SET provider_txn_id = p_provider_txn WHERE id = p_payment;
    IF pay.order_id IS NOT NULL THEN PERFORM fn_reject_order_core(pay.order_id, NULL, COALESCE(p_reason, 'Pago no aprobado por la pasarela'));
    ELSIF pay.recharge_id IS NOT NULL THEN PERFORM fn_recharge_decide_core(pay.recharge_id, NULL, false, COALESCE(p_reason, 'Pago no aprobado'), 'Intenta con otro método');
    ELSE
      UPDATE raffle_purchases SET status = 'rejected' WHERE id = pay.raffle_purchase_id AND status = 'pending_payment';
      UPDATE payments SET status = 'rejected', rejection_reason = p_reason WHERE id = p_payment;
    END IF;
  END IF;
END $$;

-- =====================================================================
-- ANULACIONES (nunca se elimina)
-- =====================================================================
CREATE FUNCTION fn_void_ticket(p_ticket uuid, p_actor uuid, p_reason text, p_effect text DEFAULT 'none') RETURNS void
LANGUAGE plpgsql AS $$
DECLARE t tickets%ROWTYPE; o orders%ROWTYPE; s draw_sessions%ROWTYPE; u users%ROWTYPE; sp staff_profiles%ROWTYPE; v_after boolean; v_pay uuid;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN RAISE EXCEPTION 'MOTIVO_REQUERIDO'; END IF;
  SELECT * INTO t FROM tickets WHERE id = p_ticket FOR UPDATE;
  IF NOT FOUND OR t.status = 'voided' THEN RAISE EXCEPTION 'TICKET_NO_ANULABLE'; END IF;
  SELECT * INTO o FROM orders WHERE id = t.order_id;
  SELECT * INTO s FROM draw_sessions WHERE id = t.session_id;
  SELECT * INTO u FROM users WHERE id = p_actor AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  v_after := s.status = 'resulted';
  IF u.role = 'admin' THEN NULL;
  ELSIF u.role = 'worker' THEN               -- solo sus propias ventas, dentro del horario permitido y antes del cierre
    SELECT * INTO sp FROM staff_profiles WHERE user_id = u.id;
    IF NOT fn_can(u.id, 'ticket.void_own') OR o.worker_id IS DISTINCT FROM u.id OR v_after OR now() >= s.closes_at
       OR now() > t.created_at + make_interval(mins => COALESCE(sp.void_window_minutes, 30)) THEN
      RAISE EXCEPTION 'SIN_PERMISO: solo puede anular sus propias ventas dentro del horario permitido';
    END IF;
  ELSE RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  IF EXISTS (SELECT 1 FROM prizes WHERE ticket_id = t.id AND status IN ('paid','credited_to_wallet','withdrawal_requested')) THEN
    RAISE EXCEPTION 'PREMIO_YA_PAGADO: el ticket tiene premios pagados o en trámite';
  END IF;
  UPDATE tickets SET status = 'voided', voided_at = now(), voided_by = p_actor, void_reason = p_reason,
         void_after_result = v_after, void_financial_effect = p_effect WHERE id = t.id;
  UPDATE order_items SET status = 'voided' WHERE ticket_id = t.id AND status = 'active';
  UPDATE prizes SET status = 'superseded' WHERE ticket_id = t.id AND status IN ('pending','generated');
  IF p_effect = 'refund' THEN
    SELECT id INTO v_pay FROM payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1;
    INSERT INTO refunds (tenant_id, payment_id, ticket_id, order_id, reason, amount_cents, status, notes)
    VALUES (o.tenant_id, v_pay, t.id, o.id, 'other_authorized', t.total_cents, 'pending', 'Anulación: ' || p_reason);
  END IF;
  PERFORM fn_audit(o.tenant_id, p_actor, CASE WHEN v_after THEN 'ticket.voided_after_result' ELSE 'ticket.voided' END, 'ticket', t.id::text,
                   jsonb_build_object('status', t.status),
                   jsonb_build_object('status', 'voided', 'total_cents', t.total_cents, 'financial_effect', p_effect), p_reason);
END $$;

-- =====================================================================
-- COMISIONES
-- =====================================================================
CREATE FUNCTION fn_generate_commissions(p_order uuid) RETURNS int LANGUAGE plpgsql AS $$
DECLARE o orders%ROWTYPE; r record; cp commission_plans%ROWTYPE; v_n int := 0; v_c int;
BEGIN
  SELECT * INTO o FROM orders WHERE id = p_order;
  IF o.origin <> 'seller' OR o.seller_id IS NULL THEN RETURN 0; END IF;     -- venta directa / trabajador: sin comisión
  FOR r IN SELECT oi.draw_id, oi.digits, SUM(oi.amount_cents) AS total FROM order_items oi
            WHERE oi.order_id = p_order AND oi.status = 'active' GROUP BY oi.draw_id, oi.digits LOOP
    SELECT * INTO cp FROM commission_plans c
     WHERE c.tenant_id = o.tenant_id AND c.is_active AND c.base <> 'monthly_profit_percent'
       AND (c.seller_id = o.seller_id OR c.seller_id IS NULL) AND (c.draw_id = r.draw_id OR c.draw_id IS NULL)
       AND (c.digits = r.digits OR c.digits IS NULL) AND c.effective_from <= current_date AND (c.effective_to IS NULL OR c.effective_to >= current_date)
     ORDER BY (c.seller_id IS NOT NULL) DESC, (c.draw_id IS NOT NULL) DESC, (c.digits IS NOT NULL) DESC LIMIT 1;
    IF FOUND THEN
      INSERT INTO commissions (tenant_id, seller_id, order_id, draw_id, digits, commission_plan_id, base_amount_cents, commission_cents)
      VALUES (o.tenant_id, o.seller_id, p_order, r.draw_id, r.digits, cp.id, r.total,
              CASE cp.base WHEN 'sales_percent' THEN round(r.total * cp.percent_bp / 10000.0)::bigint ELSE cp.fixed_cents END)
      ON CONFLICT (order_id, draw_id, digits) WHERE order_id IS NOT NULL DO NOTHING;
      GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n + v_c;
    END IF;
  END LOOP;
  RETURN v_n;
END $$;

-- Comisión sobre ganancia mensual POSITIVA (ventas − premios). Sin ganancia positiva, sin comisión.
CREATE FUNCTION fn_settle_monthly_commissions(p_tenant uuid, p_month date) RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_m date := date_trunc('month', p_month)::date; v_n int;
BEGIN
  WITH sales AS (
    SELECT o.seller_id, SUM(oi.amount_cents) AS s FROM orders o
      JOIN order_items oi ON oi.order_id = o.id AND oi.status = 'active'
      JOIN draw_sessions ds ON ds.id = oi.session_id
     WHERE o.tenant_id = p_tenant AND o.origin = 'seller' AND o.status = 'approved'
       AND ds.draw_date >= v_m AND ds.draw_date < v_m + interval '1 month' GROUP BY o.seller_id),
  prz AS (
    SELECT o.seller_id, SUM(p.prize_cents) AS z FROM prizes p JOIN tickets t ON t.id = p.ticket_id
      JOIN orders o ON o.id = t.order_id JOIN draw_sessions ds ON ds.id = t.session_id
     WHERE o.tenant_id = p_tenant AND o.origin = 'seller' AND p.status <> 'superseded'
       AND ds.draw_date >= v_m AND ds.draw_date < v_m + interval '1 month' GROUP BY o.seller_id)
  INSERT INTO commissions (tenant_id, seller_id, commission_plan_id, base_amount_cents, commission_cents, period_month)
  SELECT p_tenant, s.seller_id, cp.id, s.s - COALESCE(z.z, 0), round((s.s - COALESCE(z.z, 0)) * cp.percent_bp / 10000.0)::bigint, v_m
    FROM sales s LEFT JOIN prz z USING (seller_id)
    JOIN LATERAL (SELECT c.* FROM commission_plans c WHERE c.tenant_id = p_tenant AND c.is_active AND c.base = 'monthly_profit_percent'
                     AND (c.seller_id = s.seller_id OR c.seller_id IS NULL)
                   ORDER BY (c.seller_id IS NOT NULL) DESC LIMIT 1) cp ON true
   WHERE s.s - COALESCE(z.z, 0) > 0
  ON CONFLICT (seller_id, commission_plan_id, period_month) WHERE period_month IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
-- =====================================================================
-- EL IMPERIO DE ROSS — 02b_logic.sql
-- Resultados, premios, retiros, recargas, reembolsos, rifas especiales,
-- contratas, jugadas programadas, caja, vistas, triggers, RLS y permisos.
-- =====================================================================
SET search_path = app, public;

-- =====================================================================
-- RESULTADOS Y PREMIOS
-- =====================================================================
CREATE FUNCTION fn_make_claim(p_ticket uuid, p_tenant uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_b bytea := gen_random_bytes(4); v_code text; v_key text := NULLIF(current_setting('app.claim_key', true), '');
BEGIN
  v_code := lpad(((get_byte(v_b,0)::bigint * 16777216 + get_byte(v_b,1) * 65536 + get_byte(v_b,2) * 256 + get_byte(v_b,3)) % 1000000)::text, 6, '0');
  INSERT INTO ticket_claim_codes (ticket_id, tenant_id, code_hash, code_enc)
  VALUES (p_ticket, p_tenant, encode(digest(v_code || p_ticket::text, 'sha256'), 'hex'),
          CASE WHEN v_key IS NULL THEN NULL ELSE pgp_sym_encrypt(v_code, v_key) END)
  ON CONFLICT (ticket_id) DO NOTHING;
END $$;

-- Calcula premios por CADA coincidencia (acumulativos). El plan es el de la versión usada al comprar.
CREATE FUNCTION fn_calculate_prizes(p_result uuid) RETURNS int LANGUAGE plpgsql AS $$
DECLARE r results%ROWTYPE; s draw_sessions%ROWTYPE; v_days int; v_n int; t record;
BEGIN
  SELECT * INTO r FROM results WHERE id = p_result;
  SELECT * INTO s FROM draw_sessions WHERE id = r.session_id;
  v_days := COALESCE(fn_setting(r.tenant_id, 'prize_expiry_days', '8'::jsonb)::text::int, 8);
  INSERT INTO prizes (tenant_id, ticket_id, order_item_id, result_id, suerte_no, suerte_name, number, amount_played_cents,
                      payout_per_dollar_cents, prize_cents, status, expires_on)
  SELECT oi.tenant_id, oi.ticket_id, oi.id, r.id, pos.suerte_no, pp.suerte_name, oi.number, oi.amount_cents,
         pp.payout_per_dollar_cents, round(oi.amount_cents * pp.payout_per_dollar_cents / 100.0)::bigint, 'pending',
         s.draw_date + v_days                                   -- fecha límite en días calendario (sin hora de corte)
    FROM order_items oi
    JOIN tickets tk ON tk.id = oi.ticket_id AND tk.status <> 'voided'
    JOIN result_positions pos ON pos.result_id = r.id AND pos.winning_number = oi.number
    JOIN plan_prizes pp ON pp.plan_version_id = oi.plan_version_id AND pp.suerte_no = pos.suerte_no
   WHERE oi.session_id = r.session_id AND oi.digits = r.digits AND oi.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM prizes p2 WHERE p2.order_item_id = oi.id AND p2.suerte_no = pos.suerte_no
                       AND p2.status IN ('paid','credited_to_wallet','withdrawal_requested'))
  ON CONFLICT (order_item_id, result_id, suerte_no) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE tickets tk SET status = CASE WHEN EXISTS (SELECT 1 FROM prizes p WHERE p.ticket_id = tk.id AND p.status <> 'superseded')
                                      THEN 'winner' ELSE 'non_winner' END::ticket_status
   WHERE tk.session_id = r.session_id AND tk.digits = r.digits AND tk.status <> 'voided';

  FOR t IN SELECT tk.id, o.user_id, o.tenant_id FROM tickets tk JOIN orders o ON o.id = tk.order_id
            WHERE tk.session_id = r.session_id AND tk.digits = r.digits AND tk.status = 'winner' LOOP
    IF NOT EXISTS (SELECT 1 FROM ticket_claim_codes WHERE ticket_id = t.id) THEN
      PERFORM fn_make_claim(t.id, t.tenant_id);
      PERFORM fn_notify(t.tenant_id, t.user_id, 'ticket.winner', '¡Ganaste!', 'Tienes un ticket ganador', jsonb_build_object('ticket_id', t.id));
    END IF;
  END LOOP;
  RETURN v_n;
END $$;

-- p_positions = ["12","48","07",...] en orden de suerte (1ª, 2ª, …). Cada modificación crea una versión y deja historial.
CREATE FUNCTION fn_register_result(p_session uuid, p_digits int, p_positions jsonb, p_admin uuid, p_reason text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  s draw_sessions%ROWTYPE; m draw_modalities%ROWTYPE; prev results%ROWTYPE; v_new uuid; v_ver int := 1;
  v_old jsonb; v_sup int := 0; v_conf int := 0; e record;
BEGIN
  IF NOT fn_can(p_admin, 'result.edit') THEN RAISE EXCEPTION 'SIN_PERMISO: solo Administración registra o edita resultados'; END IF;
  SELECT * INTO s FROM draw_sessions WHERE id = p_session FOR UPDATE;
  IF NOT FOUND OR s.status = 'cancelled' THEN RAISE EXCEPTION 'SESION_INVALIDA'; END IF;
  SELECT * INTO m FROM draw_modalities WHERE draw_id = s.draw_id AND digits = p_digits AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'MODALIDAD_NO_DISPONIBLE'; END IF;
  IF jsonb_typeof(p_positions) <> 'array' OR jsonb_array_length(p_positions) NOT BETWEEN 1 AND m.max_suertes THEN
    RAISE EXCEPTION 'SUERTES_INVALIDAS (máx. %)', m.max_suertes;
  END IF;
  SELECT * INTO prev FROM results WHERE session_id = p_session AND digits = p_digits AND is_current FOR UPDATE;
  IF FOUND THEN
    IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN RAISE EXCEPTION 'MOTIVO_REQUERIDO: modificar un resultado exige motivo'; END IF;
    v_ver := prev.version + 1;
    SELECT jsonb_agg(winning_number ORDER BY suerte_no) INTO v_old FROM result_positions WHERE result_id = prev.id;
    UPDATE results SET is_current = false WHERE id = prev.id;
  END IF;
  INSERT INTO results (tenant_id, session_id, digits, version, published_by) VALUES (s.tenant_id, p_session, p_digits, v_ver, p_admin)
  RETURNING id INTO v_new;
  FOR e IN SELECT value AS num, ordinality AS n FROM jsonb_array_elements_text(p_positions) WITH ORDINALITY LOOP
    INSERT INTO result_positions (result_id, tenant_id, digits, suerte_no, winning_number) VALUES (v_new, s.tenant_id, p_digits, e.n, e.num);
  END LOOP;
  UPDATE draw_sessions SET status = 'resulted' WHERE id = p_session;
  IF prev.id IS NOT NULL THEN
    SELECT count(*) INTO v_conf FROM prizes WHERE result_id = prev.id AND status IN ('paid','credited_to_wallet','withdrawal_requested');
    WITH u AS (UPDATE prizes SET status = 'superseded' WHERE result_id = prev.id AND status IN ('pending','generated') RETURNING 1)
      SELECT count(*) INTO v_sup FROM u;
    INSERT INTO result_changes (tenant_id, session_id, digits, previous_result_id, new_result_id, changed_by, reason,
                                old_positions, new_positions, prizes_superseded, conflicts_already_paid)
    VALUES (s.tenant_id, p_session, p_digits, prev.id, v_new, p_admin, p_reason, v_old, p_positions, v_sup, v_conf);
  END IF;
  PERFORM fn_calculate_prizes(v_new);
  PERFORM fn_audit(s.tenant_id, p_admin, CASE WHEN prev.id IS NULL THEN 'result.registered' ELSE 'result.modified' END, 'result', v_new::text,
                   v_old, p_positions, p_reason);
  RETURN v_new;
END $$;

-- Vencimiento: pasa a EXPIRADO cuando la fecha local supera la fecha límite (hora de corte por confirmar)
CREATE FUNCTION fn_expire_prizes(p_tenant uuid) RETURNS int LANGUAGE sql AS $$
  WITH u AS (UPDATE prizes SET status = 'expired'
              WHERE tenant_id = p_tenant AND status IN ('pending','generated')
                AND expires_on < (now() AT TIME ZONE (SELECT timezone FROM tenants WHERE id = p_tenant))::date RETURNING 1)
  SELECT count(*)::int FROM u
$$;

-- Validar NO paga. Mensajes exactos de la interfaz.
CREATE FUNCTION fn_validate_prize(p_ticket_code text, p_validator uuid)
RETURNS TABLE (tkt_id uuid, prz_id uuid, suerte int, suerte_label text, num text, amount bigint, prz_status prize_status, msg text)
LANGUAGE plpgsql AS $$
DECLARE tk tickets%ROWTYPE; v_total bigint;
BEGIN
  IF NOT fn_can(p_validator, 'prize.validate') THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  IF EXISTS (SELECT 1 FROM users u WHERE u.id = p_validator AND u.role = 'worker')
     AND NOT COALESCE((SELECT sp.can_pay_prizes FROM staff_profiles sp WHERE sp.user_id = p_validator), false) THEN
    RAISE EXCEPTION 'SIN_PERMISO: no autorizado para validar premios';
  END IF;
  SELECT * INTO tk FROM tickets WHERE tenant_id = current_tenant() AND code = upper(p_ticket_code);
  IF NOT FOUND THEN RAISE EXCEPTION 'TICKET_NO_ENCONTRADO'; END IF;
  PERFORM fn_expire_prizes(tk.tenant_id);
  SELECT COALESCE(SUM(p.prize_cents), 0) INTO v_total FROM prizes p WHERE p.ticket_id = tk.id AND p.status IN ('pending','generated');
  INSERT INTO prize_validations (tenant_id, ticket_id, validated_by, total_cents, outcome)
  VALUES (tk.tenant_id, tk.id, p_validator, v_total,
          CASE WHEN tk.status = 'voided' THEN 'voided' WHEN v_total > 0 THEN 'valid' WHEN EXISTS (SELECT 1 FROM prizes p WHERE p.ticket_id = tk.id) THEN 'not_payable' ELSE 'no_prize' END);
  RETURN QUERY
    SELECT p.ticket_id, p.id, p.suerte_no::int, p.suerte_name, p.number, p.prize_cents, p.status,
           CASE p.status WHEN 'paid' THEN 'ESTE PREMIO YA FUE PAGADO'
                         WHEN 'expired' THEN 'PREMIO VENCIDO'
                         WHEN 'superseded' THEN 'Premio anulado por modificación de resultado'
                         WHEN 'credited_to_wallet' THEN 'Premio acreditado a saldo'
                         WHEN 'withdrawal_requested' THEN 'Retiro solicitado'
                         ELSE 'Premio válido — $' || to_char(p.prize_cents / 100.0, 'FM999999990.00') || ' — Pendiente de pago' END
      FROM prizes p WHERE p.ticket_id = tk.id ORDER BY p.suerte_no;
END $$;

CREATE FUNCTION fn_confirm_prize_payment(p_ticket uuid, p_payer uuid, p_location uuid, p_method text, p_proof text DEFAULT NULL) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE tk tickets%ROWTYPE; p prizes%ROWTYPE; v_total bigint := 0; v_n int := 0; v_account uuid;
BEGIN
  IF NOT fn_can(p_payer, 'prize.pay') THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  IF EXISTS (SELECT 1 FROM users u WHERE u.id = p_payer AND u.role = 'worker')
     AND NOT COALESCE((SELECT sp.can_pay_prizes FROM staff_profiles sp WHERE sp.user_id = p_payer), false) THEN
    RAISE EXCEPTION 'SIN_PERMISO: no autorizado para pagar premios';
  END IF;
  SELECT * INTO tk FROM tickets WHERE id = p_ticket FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TICKET_NO_ENCONTRADO'; END IF;
  PERFORM fn_expire_prizes(tk.tenant_id);
  PERFORM 1 FROM prizes WHERE ticket_id = p_ticket FOR UPDATE;
  FOR p IN SELECT * FROM prizes WHERE ticket_id = p_ticket AND status IN ('pending','generated') ORDER BY suerte_no LOOP
    INSERT INTO prize_payments (tenant_id, prize_id, paid_by, location_id, method, proof_key) VALUES (p.tenant_id, p.id, p_payer, p_location, p_method, p_proof);
    UPDATE prizes SET status = 'paid' WHERE id = p.id;
    v_total := v_total + p.prize_cents; v_n := v_n + 1;
  END LOOP;
  IF v_n = 0 THEN
    IF EXISTS (SELECT 1 FROM prizes WHERE ticket_id = p_ticket AND status = 'paid') THEN RAISE EXCEPTION 'ESTE PREMIO YA FUE PAGADO'; END IF;
    IF EXISTS (SELECT 1 FROM prizes WHERE ticket_id = p_ticket AND status = 'expired') THEN RAISE EXCEPTION 'PREMIO VENCIDO'; END IF;
    RAISE EXCEPTION 'SIN_PREMIO_PAGABLE';
  END IF;
  SELECT id INTO v_account FROM financial_accounts WHERE tenant_id = tk.tenant_id AND kind = 'payout' AND is_active ORDER BY created_at LIMIT 1;
  IF v_account IS NOT NULL THEN       -- la salida financiera se fecha HOY (ej. premio del martes pagado el miércoles)
    INSERT INTO financial_transactions (tenant_id, account_id, location_id, direction, category, line, amount_cents, method, origin_session_id, ref_type, ref_id, created_by)
    VALUES (tk.tenant_id, v_account, p_location, 'out', 'prize', 'daily', v_total,
            CASE p_method WHEN 'cash' THEN 'cash_counter' ELSE 'bank_transfer' END::payment_method, tk.session_id, 'ticket', tk.id, p_payer);
  END IF;
  PERFORM fn_audit(tk.tenant_id, p_payer, 'prize.paid', 'ticket', tk.id::text, NULL,
                   jsonb_build_object('total_cents', v_total, 'prizes', v_n, 'method', p_method, 'location_id', p_location));
  RETURN v_total;
END $$;

-- Código secreto de cobro: solo Administrador autorizado
CREATE FUNCTION fn_get_claim_code(p_ticket uuid, p_admin uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_enc bytea; v_key text := NULLIF(current_setting('app.claim_key', true), ''); v_t uuid;
BEGIN
  IF NOT fn_can(p_admin, 'prize.see_claim_code') THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  SELECT code_enc, tenant_id INTO v_enc, v_t FROM ticket_claim_codes WHERE ticket_id = p_ticket;
  IF v_enc IS NULL OR v_key IS NULL THEN RETURN NULL; END IF;
  PERFORM fn_audit(v_t, p_admin, 'prize.claim_code_viewed', 'ticket', p_ticket::text, NULL, NULL);
  RETURN pgp_sym_decrypt(v_enc, v_key);
END $$;

-- "DEJAR EN MI SALDO": el invitado debe crear/verificar una cuenta (no es una nueva entrada bancaria)
CREATE FUNCTION fn_credit_prize_to_wallet(p_prize uuid, p_user uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE p prizes%ROWTYPE; o orders%ROWTYPE; v_l uuid;
BEGIN
  SELECT * INTO p FROM prizes WHERE id = p_prize FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PREMIO_NO_ENCONTRADO'; END IF;
  IF p.status = 'paid' THEN RAISE EXCEPTION 'ESTE PREMIO YA FUE PAGADO'; END IF;
  IF p.status = 'expired' THEN RAISE EXCEPTION 'PREMIO VENCIDO'; END IF;
  IF p.status NOT IN ('pending','generated') THEN RAISE EXCEPTION 'PREMIO_NO_DISPONIBLE'; END IF;
  SELECT ord.* INTO o FROM tickets t JOIN orders ord ON ord.id = t.order_id WHERE t.id = p.ticket_id;
  IF o.user_id IS NULL THEN RAISE EXCEPTION 'INVITADO_DEBE_CREAR_CUENTA'; END IF;
  IF o.user_id <> p_user THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  v_l := fn_wallet_apply(fn_get_wallet(p_user), 'prize_credit', p.prize_cents, 0, 'prize', p.id, 'Premio acreditado a saldo', p_user, 'prize:' || p.id);
  UPDATE prizes SET status = 'credited_to_wallet', credited_ledger_id = v_l WHERE id = p.id;
  PERFORM fn_audit(p.tenant_id, p_user, 'prize.credited_to_wallet', 'prize', p.id::text, NULL, jsonb_build_object('cents', p.prize_cents));
  RETURN v_l;
END $$;

-- =====================================================================
-- RETIROS
-- =====================================================================
CREATE FUNCTION fn_request_withdrawal(p_user uuid, p_amount bigint, p_prize uuid DEFAULT NULL, p_idem text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_tenant uuid := current_tenant(); p prizes%ROWTYPE; v_w uuid; v_l uuid; v_amt bigint := p_amount;
BEGIN
  IF p_idem IS NOT NULL THEN SELECT id INTO v_id FROM withdrawals WHERE tenant_id = v_tenant AND idempotency_key = p_idem; IF FOUND THEN RETURN v_id; END IF; END IF;
  IF p_prize IS NOT NULL THEN
    SELECT * INTO p FROM prizes WHERE id = p_prize FOR UPDATE;
    IF NOT FOUND OR p.status NOT IN ('pending','generated') THEN RAISE EXCEPTION 'PREMIO_NO_DISPONIBLE'; END IF;
    IF NOT EXISTS (SELECT 1 FROM tickets t JOIN orders o ON o.id = t.order_id WHERE t.id = p.ticket_id AND o.user_id = p_user) THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
    v_amt := p.prize_cents;
    UPDATE prizes SET status = 'withdrawal_requested' WHERE id = p.id;
    INSERT INTO withdrawals (tenant_id, user_id, source_prize_id, amount_cents, idempotency_key) VALUES (v_tenant, p_user, p_prize, v_amt, p_idem) RETURNING id INTO v_id;
  ELSE
    v_w := fn_get_wallet(p_user);
    INSERT INTO withdrawals (tenant_id, user_id, wallet_id, amount_cents, idempotency_key) VALUES (v_tenant, p_user, v_w, v_amt, p_idem) RETURNING id INTO v_id;
    -- mientras haya solicitud activa el importe queda reservado y no se puede usar en una compra
    v_l := fn_wallet_apply(v_w, 'withdrawal_reserve', -v_amt, v_amt, 'withdrawal', v_id, 'Retiro solicitado', p_user, 'wdres:' || v_id);
    UPDATE withdrawals SET reserve_ledger_id = v_l WHERE id = v_id;
  END IF;
  PERFORM fn_audit(v_tenant, p_user, 'withdrawal.requested', 'withdrawal', v_id::text, NULL, jsonb_build_object('cents', v_amt));
  PERFORM fn_notify(v_tenant, NULL, 'withdrawal.requested', 'Retiro solicitado', NULL, jsonb_build_object('withdrawal_id', v_id), 'admin');
  RETURN v_id;
END $$;

CREATE FUNCTION fn_advance_withdrawal(p_wd uuid, p_actor uuid, p_to withdrawal_status, p_reason text DEFAULT NULL, p_proof text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE w withdrawals%ROWTYPE; v_account uuid; v_ok boolean;
BEGIN
  IF NOT fn_can(p_actor, 'withdrawal.manage') THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  SELECT * INTO w FROM withdrawals WHERE id = p_wd FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RETIRO_NO_ENCONTRADO'; END IF;
  v_ok := (w.status = 'requested' AND p_to IN ('in_review','rejected','cancelled'))
       OR (w.status = 'in_review' AND p_to IN ('approved','rejected','cancelled'))
       OR (w.status = 'approved' AND p_to IN ('paid','rejected'));
  IF NOT v_ok THEN RAISE EXCEPTION 'TRANSICION_INVALIDA: % → %', w.status, p_to; END IF;
  IF p_to IN ('rejected','cancelled') THEN
    IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN RAISE EXCEPTION 'MOTIVO_REQUERIDO'; END IF;
    IF w.source_prize_id IS NULL THEN
      PERFORM fn_wallet_apply(w.wallet_id, 'withdrawal_release', w.amount_cents, -w.amount_cents, 'withdrawal', w.id, 'Retiro ' || p_to, p_actor, 'wdrel:' || w.id);
    ELSE UPDATE prizes SET status = 'pending' WHERE id = w.source_prize_id AND status = 'withdrawal_requested'; END IF;
  ELSIF p_to = 'paid' THEN
    IF w.source_prize_id IS NULL THEN
      PERFORM fn_wallet_apply(w.wallet_id, 'withdrawal_paid', 0, -w.amount_cents, 'withdrawal', w.id, 'Retiro pagado', p_actor, 'wdpaid:' || w.id);
    ELSE
      INSERT INTO prize_payments (tenant_id, prize_id, paid_by, method, proof_key) VALUES (w.tenant_id, w.source_prize_id, p_actor, 'transfer', p_proof);
      UPDATE prizes SET status = 'paid' WHERE id = w.source_prize_id;
    END IF;
    SELECT id INTO v_account FROM financial_accounts WHERE tenant_id = w.tenant_id AND kind = 'payout' AND is_active ORDER BY created_at LIMIT 1;
    IF v_account IS NOT NULL THEN
      INSERT INTO financial_transactions (tenant_id, account_id, direction, category, line, amount_cents, method, ref_type, ref_id, created_by)
      VALUES (w.tenant_id, v_account, 'out', CASE WHEN w.source_prize_id IS NULL THEN 'withdrawal' ELSE 'prize' END::fin_category,
              'daily', w.amount_cents, 'bank_transfer', 'withdrawal', w.id, p_actor);
    END IF;
  END IF;
  UPDATE withdrawals SET status = p_to, rejection_reason = CASE WHEN p_to IN ('rejected','cancelled') THEN p_reason END,
         reviewed_by = COALESCE(reviewed_by, p_actor), approved_by = CASE WHEN p_to = 'approved' THEN p_actor ELSE approved_by END,
         paid_at = CASE WHEN p_to = 'paid' THEN now() ELSE paid_at END, proof_key = COALESCE(p_proof, proof_key) WHERE id = w.id;
  PERFORM fn_audit(w.tenant_id, p_actor, 'withdrawal.' || p_to, 'withdrawal', w.id::text, jsonb_build_object('status', w.status), jsonb_build_object('status', p_to), p_reason);
  PERFORM fn_notify(w.tenant_id, w.user_id, 'withdrawal.' || p_to, 'Retiro ' || p_to, p_reason, jsonb_build_object('withdrawal_id', w.id));
END $$;

-- =====================================================================
-- RECARGAS (no suman saldo hasta aprobar; rechazo con motivo y cómo corregir)
-- =====================================================================
CREATE FUNCTION fn_request_recharge(p_user uuid, p_amount bigint, p_bank uuid, p_key text, p_mime text, p_size int, p_sha text,
                                    p_idem text DEFAULT NULL, p_resubmitted_from uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_tenant uuid := current_tenant(); v_id uuid; v_w uuid := fn_get_wallet(p_user); v_pay uuid;
BEGIN
  IF p_idem IS NOT NULL THEN SELECT id INTO v_id FROM recharges WHERE tenant_id = v_tenant AND idempotency_key = p_idem; IF FOUND THEN RETURN v_id; END IF; END IF;
  IF p_key IS NULL THEN RAISE EXCEPTION 'COMPROBANTE_REQUERIDO'; END IF;
  IF p_resubmitted_from IS NOT NULL AND NOT EXISTS (SELECT 1 FROM recharges WHERE id = p_resubmitted_from AND wallet_id = v_w AND status = 'rejected') THEN
    RAISE EXCEPTION 'RECARGA_ORIGINAL_INVALIDA';
  END IF;
  INSERT INTO recharges (tenant_id, wallet_id, amount_cents, bank_account_id, resubmitted_from, idempotency_key)
  VALUES (v_tenant, v_w, p_amount, p_bank, p_resubmitted_from, p_idem) RETURNING id INTO v_id;
  INSERT INTO payments (tenant_id, recharge_id, method, status, amount_cents, bank_account_id, reference_code, proof_uploaded_at, idempotency_key)
  VALUES (v_tenant, v_id, 'bank_transfer', 'in_review', p_amount, p_bank, 'REC-' || substr(v_id::text, 1, 8), now(), CASE WHEN p_idem IS NULL THEN NULL ELSE 'pay:' || p_idem END)
  RETURNING id INTO v_pay;
  INSERT INTO payment_proofs (tenant_id, payment_id, storage_key, mime_type, size_bytes, sha256, uploaded_by) VALUES (v_tenant, v_pay, p_key, p_mime, p_size, p_sha, p_user);
  UPDATE recharges SET status = 'in_review' WHERE id = v_id;
  PERFORM fn_notify(v_tenant, NULL, 'recharge.new', 'Nueva recarga por revisar', NULL, jsonb_build_object('recharge_id', v_id), 'admin');
  RETURN v_id;
END $$;

CREATE FUNCTION fn_recharge_decide_core(p_recharge uuid, p_actor uuid, p_approve boolean, p_reason text, p_hint text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r recharges%ROWTYPE; w wallets%ROWTYPE; v_l uuid; v_account uuid;
BEGIN
  SELECT * INTO r FROM recharges WHERE id = p_recharge FOR UPDATE;
  IF NOT FOUND OR r.status NOT IN ('pending','in_review') THEN RAISE EXCEPTION 'RECARGA_NO_PENDIENTE'; END IF;
  SELECT * INTO w FROM wallets WHERE id = r.wallet_id;
  IF p_approve THEN
    v_l := fn_wallet_apply(r.wallet_id, 'recharge', r.amount_cents, 0, 'recharge', r.id, 'Recarga aprobada', p_actor, 'recharge:' || r.id);
    SELECT id INTO v_account FROM financial_accounts WHERE tenant_id = r.tenant_id AND kind = 'income' AND is_active ORDER BY created_at LIMIT 1;
    IF v_account IS NOT NULL THEN
      INSERT INTO financial_transactions (tenant_id, account_id, direction, category, line, amount_cents, method, ref_type, ref_id, created_by)
      VALUES (r.tenant_id, v_account, 'in', 'recharge', 'general', r.amount_cents, 'bank_transfer', 'recharge', r.id, p_actor);
    END IF;
    UPDATE recharges SET status = 'approved', reviewed_by = p_actor, reviewed_at = now(), ledger_id = v_l WHERE id = r.id;
    UPDATE payments SET status = 'approved', reviewed_by = p_actor, reviewed_at = now() WHERE recharge_id = r.id;
    PERFORM fn_notify(r.tenant_id, w.user_id, 'recharge.approved', 'Recarga aprobada', NULL, jsonb_build_object('recharge_id', r.id));
  ELSE
    IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN RAISE EXCEPTION 'MOTIVO_REQUERIDO'; END IF;
    UPDATE recharges SET status = 'rejected', reviewed_by = p_actor, reviewed_at = now(), rejection_reason = p_reason, correction_hint = p_hint WHERE id = r.id;
    UPDATE payments SET status = 'rejected', reviewed_by = p_actor, reviewed_at = now(), rejection_reason = p_reason, rejection_hint = p_hint WHERE recharge_id = r.id;
    PERFORM fn_notify(r.tenant_id, w.user_id, 'recharge.rejected', 'Recarga rechazada', p_reason, jsonb_build_object('recharge_id', r.id, 'hint', p_hint));
  END IF;
  PERFORM fn_audit(r.tenant_id, p_actor, CASE WHEN p_approve THEN 'recharge.approved' ELSE 'recharge.rejected' END, 'recharge', r.id::text,
                   jsonb_build_object('status', r.status), jsonb_build_object('status', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END, 'cents', r.amount_cents), p_reason);
END $$;

CREATE FUNCTION fn_review_recharge(p_recharge uuid, p_admin uuid, p_approve boolean, p_reason text DEFAULT NULL, p_hint text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT fn_can(p_admin, 'recharge.approve') THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  PERFORM fn_recharge_decide_core(p_recharge, p_admin, p_approve, p_reason, p_hint);
END $$;

-- =====================================================================
-- REEMBOLSOS (solo causa justificada; el movimiento original nunca desaparece)
-- =====================================================================
CREATE FUNCTION fn_complete_refund(p_refund uuid, p_admin uuid, p_method text DEFAULT NULL, p_proof text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE f refunds%ROWTYPE; pay payments%ROWTYPE; o orders%ROWTYPE; v_l uuid; v_orig uuid; v_account uuid; v_done bigint;
BEGIN
  IF NOT fn_can(p_admin, 'refund.manage') THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  SELECT * INTO f FROM refunds WHERE id = p_refund FOR UPDATE;
  IF NOT FOUND OR f.status <> 'pending' THEN RAISE EXCEPTION 'REEMBOLSO_NO_PENDIENTE'; END IF;
  SELECT * INTO pay FROM payments WHERE id = f.payment_id;
  IF pay.order_id IS NOT NULL THEN SELECT * INTO o FROM orders WHERE id = pay.order_id; END IF;
  IF pay.method = 'wallet' AND o.user_id IS NOT NULL THEN
    SELECT id INTO v_orig FROM wallet_ledger WHERE ref_type = 'order' AND ref_id = o.id AND type = 'purchase_reserve' LIMIT 1;
    v_l := fn_wallet_apply(fn_get_wallet(o.user_id), 'refund', f.amount_cents, 0, 'refund', f.id, 'Reembolso: ' || f.reason, p_admin, 'refund:' || f.id);
  ELSE
    SELECT id INTO v_account FROM financial_accounts WHERE tenant_id = f.tenant_id AND kind = 'payout' AND is_active ORDER BY created_at LIMIT 1;
    IF v_account IS NOT NULL THEN
      INSERT INTO financial_transactions (tenant_id, account_id, direction, category, line, amount_cents, method, ref_type, ref_id, created_by, note)
      VALUES (f.tenant_id, v_account, 'out', 'refund', 'daily', f.amount_cents, pay.method, 'refund', f.id, p_admin, f.reason::text);
    END IF;
  END IF;
  UPDATE refunds SET status = 'completed', completed_at = now(), approved_by = p_admin, method = COALESCE(p_method, method),
         proof_key = COALESCE(p_proof, proof_key), original_ledger_id = v_orig, refund_ledger_id = v_l WHERE id = f.id;
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_done FROM refunds WHERE payment_id = pay.id AND status = 'completed';
  IF v_done >= pay.amount_cents THEN UPDATE payments SET status = 'refunded' WHERE id = pay.id; END IF;
  PERFORM fn_audit(f.tenant_id, p_admin, 'refund.completed', 'refund', f.id::text, jsonb_build_object('status', 'pending'),
                   jsonb_build_object('status', 'completed', 'cents', f.amount_cents, 'reason', f.reason, 'method', p_method));
END $$;

CREATE FUNCTION fn_issue_refund(p_payment uuid, p_reason refund_reason, p_amount bigint, p_admin uuid, p_method text DEFAULT NULL,
                                p_proof text DEFAULT NULL, p_notes text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE pay payments%ROWTYPE; v_prev bigint; v_id uuid;
BEGIN
  IF NOT fn_can(p_admin, 'refund.manage') THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  SELECT * INTO pay FROM payments WHERE id = p_payment FOR UPDATE;
  IF NOT FOUND OR pay.status NOT IN ('approved','refunded') THEN RAISE EXCEPTION 'PAGO_NO_REEMBOLSABLE'; END IF;
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_prev FROM refunds WHERE payment_id = p_payment AND status IN ('pending','completed');
  IF v_prev + p_amount > pay.amount_cents THEN RAISE EXCEPTION 'REEMBOLSO_EXCEDE_PAGO'; END IF;
  INSERT INTO refunds (tenant_id, payment_id, order_id, reason, amount_cents, notes) VALUES (pay.tenant_id, p_payment, pay.order_id, p_reason, p_amount, p_notes) RETURNING id INTO v_id;
  PERFORM fn_complete_refund(v_id, p_admin, p_method, p_proof);
  RETURN v_id;
END $$;

-- =====================================================================
-- RIFAS ESPECIALES (números aleatorios sin duplicados, ocultos hasta aprobar)
-- =====================================================================
CREATE FUNCTION fn_submit_raffle_purchase(p_raffle uuid, p_user uuid, p_buyer jsonb, p_package uuid, p_quantity int, p_method payment_method,
                                          p_idem text DEFAULT NULL, p_bank uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_t uuid := current_tenant(); r special_raffles%ROWTYPE; pk raffle_packages%ROWTYPE; v_q int; v_total bigint; v_id uuid; v_no bigint; v_remaining bigint;
BEGIN
  IF p_idem IS NOT NULL THEN SELECT id INTO v_id FROM raffle_purchases WHERE tenant_id = v_t AND idempotency_key = p_idem; IF FOUND THEN RETURN v_id; END IF; END IF;
  SELECT * INTO r FROM special_raffles WHERE id = p_raffle;
  IF NOT FOUND OR r.status <> 'open' OR now() < r.opens_at OR (r.close_mode = 'date' AND now() >= r.closes_at) THEN RAISE EXCEPTION 'RIFA_NO_DISPONIBLE'; END IF;
  IF p_package IS NOT NULL THEN
    SELECT * INTO pk FROM raffle_packages WHERE id = p_package AND raffle_id = p_raffle AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAQUETE_INVALIDO'; END IF;
    v_q := pk.chances * GREATEST(COALESCE(p_quantity, 1), 1); v_total := pk.price_cents * GREATEST(COALESCE(p_quantity, 1), 1);
  ELSE
    IF p_quantity IS NULL OR p_quantity < 1 THEN RAISE EXCEPTION 'CANTIDAD_INVALIDA'; END IF;
    v_q := p_quantity; v_total := p_quantity * r.price_cents;
  END IF;
  v_remaining := (r.range_end - r.range_start + 1) - r.sold_count;
  IF v_q > v_remaining THEN RAISE EXCEPTION 'RIFA_SIN_CUPO: quedan %', v_remaining; END IF;
  IF p_method = 'wallet' AND p_user IS NULL THEN RAISE EXCEPTION 'SALDO_REQUIERE_SESION'; END IF;
  v_no := fn_next_counter(v_t, 'raffle_purchase');
  INSERT INTO raffle_purchases (tenant_id, raffle_id, purchase_no, user_id, buyer_name, buyer_phone, buyer_email, package_id, quantity, total_cents, idempotency_key)
  VALUES (v_t, p_raffle, v_no, p_user, p_buyer->>'name', p_buyer->>'phone', NULLIF(p_buyer->>'email',''), p_package, v_q, v_total, p_idem) RETURNING id INTO v_id;
  INSERT INTO payments (tenant_id, raffle_purchase_id, method, status, amount_cents, bank_account_id, reconciliation, idempotency_key)
  VALUES (v_t, v_id, p_method, 'pending', v_total, p_bank,
          CASE WHEN p_method IN ('payphone','card','qr_wallet','cash_point') THEN 'pending'::reconciliation_status ELSE 'not_applicable' END,
          CASE WHEN p_idem IS NULL THEN NULL ELSE 'pay:' || p_idem END);
  IF p_method = 'wallet' THEN
    PERFORM fn_wallet_apply(fn_get_wallet(p_user), 'purchase_reserve', -v_total, v_total, 'raffle_purchase', v_id, 'Compra de rifa pendiente', p_user, 'rsv:' || v_id);
    PERFORM fn_approve_raffle_core(v_id, NULL);                   -- saldo ya verificado: pasa directo a números revelados
  END IF;
  RETURN v_id;
END $$;

CREATE FUNCTION fn_approve_raffle_core(p_purchase uuid, p_actor uuid) RETURNS int LANGUAGE plpgsql AS $$
DECLARE p raffle_purchases%ROWTYPE; r special_raffles%ROWTYPE; v_n int := 0; v_try int := 0; v_c int; v_total bigint; v_pay payments%ROWTYPE; v_account uuid; v_hit int;
BEGIN
  SELECT * INTO p FROM raffle_purchases WHERE id = p_purchase FOR UPDATE;
  IF NOT FOUND OR p.status <> 'pending_payment' THEN RAISE EXCEPTION 'COMPRA_NO_PENDIENTE'; END IF;
  SELECT * INTO r FROM special_raffles WHERE id = p.raffle_id FOR UPDATE;           -- serializa la asignación por rifa
  v_total := r.range_end - r.range_start + 1;
  IF r.sold_count + p.quantity > v_total THEN RAISE EXCEPTION 'RIFA_SIN_CUPO'; END IF;
  IF v_total <= 2000000 THEN
    INSERT INTO raffle_numbers (raffle_id, tenant_id, number, purchase_id)
    SELECT r.id, r.tenant_id, lpad(n::text, r.number_digits, '0'), p.id
      FROM generate_series(r.range_start, r.range_end) n
     WHERE NOT EXISTS (SELECT 1 FROM raffle_numbers rn WHERE rn.raffle_id = r.id AND rn.number = lpad(n::text, r.number_digits, '0'))
     ORDER BY random() LIMIT p.quantity;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSE                                                                               -- rangos enormes: muestreo aleatorio
    WHILE v_n < p.quantity AND v_try < p.quantity * 50 LOOP
      INSERT INTO raffle_numbers (raffle_id, tenant_id, number, purchase_id)
      VALUES (r.id, r.tenant_id, lpad((r.range_start + floor(random() * v_total))::bigint::text, r.number_digits, '0'), p.id)
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n + v_c; v_try := v_try + 1;
    END LOOP;
  END IF;
  IF v_n < p.quantity THEN RAISE EXCEPTION 'ASIGNACION_INCOMPLETA'; END IF;
  UPDATE special_raffles SET sold_count = sold_count + p.quantity,
         status = CASE WHEN sold_count + p.quantity >= v_total THEN 'sold_out' ELSE status END::raffle_status WHERE id = r.id;
  PERFORM set_config('app.fortune_internal', 'on', true);
  UPDATE fortune_numbers f SET matched_purchase_id = p.id, matched_at = now()
   WHERE f.raffle_id = r.id AND f.matched_purchase_id IS NULL AND f.number IN (SELECT number FROM raffle_numbers WHERE purchase_id = p.id);
  GET DIAGNOSTICS v_hit = ROW_COUNT;
  PERFORM set_config('app.fortune_internal', 'off', true);
  UPDATE raffle_purchases SET status = 'approved', approved_by = p_actor, approved_at = now() WHERE id = p.id;
  SELECT * INTO v_pay FROM payments WHERE raffle_purchase_id = p.id ORDER BY created_at DESC LIMIT 1;
  UPDATE payments SET status = 'approved', reviewed_by = p_actor, reviewed_at = now() WHERE id = v_pay.id;
  IF v_pay.method = 'wallet' THEN
    PERFORM fn_wallet_apply(fn_get_wallet(p.user_id), 'purchase_settle', 0, -p.total_cents, 'raffle_purchase', p.id, 'Compra de rifa aprobada', p_actor, 'rset:' || p.id);
  ELSE
    SELECT id INTO v_account FROM financial_accounts WHERE tenant_id = p.tenant_id AND kind = 'income' AND is_active ORDER BY created_at LIMIT 1;
    IF v_account IS NOT NULL THEN
      INSERT INTO financial_transactions (tenant_id, account_id, direction, category, line, amount_cents, method, ref_type, ref_id, created_by)
      VALUES (p.tenant_id, v_account, 'in', 'sales', 'special', p.total_cents, v_pay.method, 'raffle_purchase', p.id, p_actor);
    END IF;
  END IF;
  PERFORM fn_audit(p.tenant_id, p_actor, 'raffle.purchase_approved', 'raffle_purchase', p.id::text, NULL,
                   jsonb_build_object('quantity', p.quantity, 'fortune_hits', v_hit, 'sold_out', r.sold_count + p.quantity >= v_total));
  IF p.user_id IS NOT NULL THEN
    PERFORM fn_notify(p.tenant_id, p.user_id, CASE WHEN v_hit > 0 THEN 'fortune.number' ELSE 'raffle.numbers_revealed' END,
                      CASE WHEN v_hit > 0 THEN '🍀 ¡FELICIDADES! TIENES UN NÚMERO FORTUNA' ELSE 'Tus números ya fueron revelados' END, p.purchase_code,
                      jsonb_build_object('purchase_id', p.id));
  END IF;
  IF r.sold_count + p.quantity >= v_total THEN
    PERFORM fn_notify(p.tenant_id, NULL, 'raffle.sold_out', 'RIFA COMPLETAMENTE VENDIDA — LISTA PARA SORTEO', r.name, jsonb_build_object('raffle_id', r.id), 'admin');
  END IF;
  RETURN v_n;
END $$;

CREATE FUNCTION fn_approve_raffle_purchase(p_purchase uuid, p_admin uuid) RETURNS int LANGUAGE plpgsql AS $$
BEGIN
  IF NOT fn_can(p_admin, 'order.approve') THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  RETURN fn_approve_raffle_core(p_purchase, p_admin);
END $$;

-- =====================================================================
-- CONTRATAS, CRÉDITO, JUGADAS PROGRAMADAS
-- =====================================================================
CREATE FUNCTION fn_materialize_contrata_slots(p_tenant uuid, p_from date, p_to date) RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_n int;
BEGIN
  INSERT INTO contrata_slots (tenant_id, contrata_id, session_id)
  SELECT c.tenant_id, c.id, s.id FROM contratas c JOIN draw_sessions s ON s.draw_id = c.draw_id AND s.tenant_id = c.tenant_id
   WHERE c.tenant_id = p_tenant AND c.status = 'active' AND s.draw_date BETWEEN p_from AND p_to
     AND s.draw_date >= c.start_date AND (c.end_date IS NULL OR s.draw_date <= c.end_date)
     AND extract(isodow FROM s.draw_date)::int = ANY (c.days_of_week)
  ON CONFLICT (contrata_id, session_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- VENDER / SACAR TICKET: convierte el cupo reservado en venta. Crédito ⇒ cuenta por cobrar (no cuenta como cobrado).
CREATE FUNCTION fn_sell_contrata_slot(p_slot uuid, p_actor uuid, p_location uuid, p_idem text DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE sl contrata_slots%ROWTYPE; c contratas%ROWTYPE; v_order uuid; v_method payment_method; v_credit boolean;
BEGIN
  SELECT * INTO sl FROM contrata_slots WHERE id = p_slot FOR UPDATE;
  IF NOT FOUND OR sl.status <> 'reserved' THEN RAISE EXCEPTION 'CUPO_NO_DISPONIBLE'; END IF;
  SELECT * INTO c FROM contratas WHERE id = sl.contrata_id;
  v_credit := c.collection = 'credit';
  IF v_credit AND c.credit_authorized_by IS NULL THEN RAISE EXCEPTION 'CREDITO_NO_AUTORIZADO'; END IF;
  v_method := CASE c.collection WHEN 'transfer' THEN 'bank_transfer' WHEN 'wallet' THEN 'wallet' ELSE 'cash_counter' END;
  v_order := fn_submit_order(c.client_user_id, jsonb_build_object('name', c.client_name, 'phone', COALESCE(c.client_phone, '0000000000'), 'adult', true, 'terms', true),
      jsonb_build_array(jsonb_build_object('draw_id', c.draw_id, 'digits', c.digits, 'number', c.number, 'amount_cents', c.amount_cents,
                        'session_id', sl.session_id, 'plan_id', c.plan_id)),
      v_method, 'contrata', NULL, p_actor, p_location, COALESCE(p_idem, 'contrata:' || p_slot), NULL, NULL, v_credit);
  UPDATE contrata_slots SET status = 'sold', order_id = v_order, sold_by = p_actor, sold_at = now() WHERE id = p_slot;
  IF v_credit THEN
    INSERT INTO receivables (tenant_id, contrata_id, contrata_slot_id, order_id, debtor_name, amount_cents)
    VALUES (c.tenant_id, c.id, sl.id, v_order, c.client_name, c.amount_cents);
  END IF;
  RETURN v_order;
END $$;

CREATE FUNCTION fn_receive_receivable_payment(p_receivable uuid, p_amount bigint, p_actor uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r receivables%ROWTYPE; v_account uuid;
BEGIN
  SELECT * INTO r FROM receivables WHERE id = p_receivable FOR UPDATE;
  IF NOT FOUND OR r.status IN ('collected','written_off') THEN RAISE EXCEPTION 'CUENTA_NO_COBRABLE'; END IF;
  IF p_amount <= 0 OR r.collected_cents + p_amount > r.amount_cents THEN RAISE EXCEPTION 'MONTO_INVALIDO'; END IF;
  INSERT INTO receivable_payments (tenant_id, receivable_id, amount_cents, received_by) VALUES (r.tenant_id, r.id, p_amount, p_actor);
  UPDATE receivables SET collected_cents = collected_cents + p_amount,
         status = CASE WHEN collected_cents + p_amount >= amount_cents THEN 'collected' ELSE 'partial' END::receivable_status WHERE id = r.id;
  SELECT id INTO v_account FROM financial_accounts WHERE tenant_id = r.tenant_id AND kind = 'income' AND is_active ORDER BY created_at LIMIT 1;
  IF v_account IS NOT NULL THEN
    INSERT INTO financial_transactions (tenant_id, account_id, direction, category, line, amount_cents, method, ref_type, ref_id, created_by)
    VALUES (r.tenant_id, v_account, 'in', 'sales', 'daily', p_amount, 'cash_counter', 'receivable', r.id, p_actor);
  END IF;
  PERFORM fn_audit(r.tenant_id, p_actor, 'receivable.collected', 'receivable', r.id::text, jsonb_build_object('collected', r.collected_cents), jsonb_build_object('collected', r.collected_cents + p_amount));
END $$;

-- Sin saldo suficiente: NO ejecutada (sin ticket, sin venta, sin descuento parcial, sin saldo negativo)
CREATE FUNCTION fn_execute_scheduled_play(p_play uuid, p_session uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE sp scheduled_plays%ROWTYPE; u users%ROWTYPE; w wallets%ROWTYPE; v_order uuid; v_thr bigint;
BEGIN
  SELECT * INTO sp FROM scheduled_plays WHERE id = p_play FOR UPDATE;
  IF NOT FOUND OR sp.status <> 'active' THEN RAISE EXCEPTION 'JUGADA_NO_ACTIVA'; END IF;
  IF EXISTS (SELECT 1 FROM scheduled_play_runs WHERE scheduled_play_id = p_play AND session_id = p_session) THEN RETURN NULL; END IF;
  SELECT * INTO u FROM users WHERE id = sp.user_id;
  SELECT * INTO w FROM wallets WHERE id = fn_get_wallet(sp.user_id);
  IF w.available_cents >= sp.amount_cents THEN
    v_order := fn_submit_order(sp.user_id, jsonb_build_object('name', u.full_name, 'phone', u.phone, 'email', u.email, 'adult', true, 'terms', true),
        jsonb_build_array(jsonb_build_object('draw_id', sp.draw_id, 'digits', sp.digits, 'number', sp.number, 'amount_cents', sp.amount_cents,
                          'session_id', p_session, 'plan_id', sp.plan_id)),
        'wallet', 'scheduled_play', NULL, NULL, NULL, 'sched:' || p_play || ':' || p_session, true);
    INSERT INTO scheduled_play_runs (tenant_id, scheduled_play_id, session_id, outcome, order_id) VALUES (sp.tenant_id, p_play, p_session, 'executed', v_order);
    PERFORM fn_notify(sp.tenant_id, sp.user_id, 'scheduled.executed', 'Jugada programada ejecutada', sp.number, jsonb_build_object('order_id', v_order));
  ELSE
    INSERT INTO scheduled_play_runs (tenant_id, scheduled_play_id, session_id, outcome) VALUES (sp.tenant_id, p_play, p_session, 'not_executed_insufficient_balance');
    PERFORM fn_notify(sp.tenant_id, sp.user_id, 'scheduled.not_executed', 'NO EJECUTADA — SALDO INSUFICIENTE', sp.number, jsonb_build_object('scheduled_play_id', p_play));
  END IF;
  v_thr := COALESCE(fn_setting(sp.tenant_id, 'low_balance_threshold_cents', '2000'::jsonb)::text::bigint, 2000);
  IF w.available_cents < v_thr THEN
    PERFORM fn_notify(sp.tenant_id, sp.user_id, 'wallet.low_balance', 'Saldo bajo', 'Tu saldo está por debajo de $' || to_char(v_thr / 100.0, 'FM990') || '. Agrega fondos para mantener activas tus jugadas programadas.', '{}');
  END IF;
  RETURN v_order;
END $$;

CREATE FUNCTION trg_scheduled_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF to_jsonb(NEW) - 'updated_at' - 'version' <> to_jsonb(OLD) - 'updated_at' - 'version' THEN
    NEW.version := OLD.version + 1;
    INSERT INTO scheduled_play_history (tenant_id, scheduled_play_id, changed_by, old_value, new_value, reason)
    VALUES (NEW.tenant_id, NEW.id, current_actor(), to_jsonb(OLD), to_jsonb(NEW), NULLIF(current_setting('app.audit_reason', true), ''));
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_scheduled_history BEFORE UPDATE ON scheduled_plays FOR EACH ROW EXECUTE FUNCTION trg_scheduled_history();

-- Nueva versión de plan (jamás se edita una versión usada)
CREATE FUNCTION fn_new_plan_version(p_plan uuid, p_prizes jsonb, p_admin uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE pl plans%ROWTYPE; v_ver int; v_new uuid; e jsonb;
BEGIN
  IF NOT fn_can(p_admin, 'plan.edit') THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  SELECT * INTO pl FROM plans WHERE id = p_plan FOR UPDATE;
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_ver FROM plan_versions WHERE plan_id = p_plan;
  UPDATE plan_versions SET is_current = false WHERE plan_id = p_plan AND is_current;
  INSERT INTO plan_versions (tenant_id, plan_id, version, created_by) VALUES (pl.tenant_id, p_plan, v_ver, p_admin) RETURNING id INTO v_new;
  FOR e IN SELECT x FROM jsonb_array_elements(p_prizes) x LOOP
    INSERT INTO plan_prizes (plan_version_id, tenant_id, suerte_no, suerte_name, payout_per_dollar_cents)
    VALUES (v_new, pl.tenant_id, (e->>'suerte_no')::int, COALESCE(e->>'name', 'Suerte'), (e->>'payout_per_dollar_cents')::bigint);
  END LOOP;
  PERFORM fn_audit(pl.tenant_id, p_admin, 'plan.new_version', 'plan', p_plan::text, NULL, jsonb_build_object('version', v_ver, 'prizes', p_prizes));
  RETURN v_new;
END $$;

-- =====================================================================
-- CONTABILIDAD Y CAJA
-- =====================================================================
CREATE FUNCTION fn_internal_transfer(p_from uuid, p_to uuid, p_amount bigint, p_admin uuid, p_note text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_ref uuid := gen_random_uuid(); v_t uuid;
BEGIN
  IF NOT fn_can(p_admin, 'finance.manage') THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  IF p_from = p_to THEN RAISE EXCEPTION 'CUENTAS_IGUALES'; END IF;
  SELECT tenant_id INTO v_t FROM financial_accounts WHERE id = p_from;
  INSERT INTO financial_transactions (tenant_id, account_id, direction, category, amount_cents, transfer_ref, note, created_by) VALUES (v_t, p_from, 'out', 'internal_transfer', p_amount, v_ref, p_note, p_admin);
  INSERT INTO financial_transactions (tenant_id, account_id, direction, category, amount_cents, transfer_ref, note, created_by) VALUES (v_t, p_to, 'in', 'internal_transfer', p_amount, v_ref, p_note, p_admin);
  PERFORM fn_audit(v_t, p_admin, 'finance.internal_transfer', 'transfer', v_ref::text, NULL, jsonb_build_object('from', p_from, 'to', p_to, 'cents', p_amount), p_note);
  RETURN v_ref;
END $$;

CREATE FUNCTION fn_cash_preview(p_location uuid, p_date date)
RETURNS TABLE (opening bigint, income bigint, transfers_in bigint, prizes_paid bigint, expenses bigint, withdrawals bigint, transfers_out bigint, expected bigint)
LANGUAGE plpgsql STABLE AS $$
DECLARE v_t uuid := current_tenant(); v_tz text; v_open bigint;
BEGIN
  SELECT timezone INTO v_tz FROM tenants WHERE id = v_t;
  SELECT COALESCE((SELECT c.counted_cents FROM cash_closings c WHERE c.tenant_id = v_t AND c.location_id IS NOT DISTINCT FROM p_location AND c.closing_date < p_date
                    ORDER BY c.closing_date DESC LIMIT 1), 0) INTO v_open;
  RETURN QUERY
  WITH f AS (SELECT * FROM financial_transactions ft WHERE ft.tenant_id = v_t AND ft.location_id IS NOT DISTINCT FROM p_location
                AND (ft.occurred_at AT TIME ZONE v_tz)::date = p_date)
  SELECT v_open,
    COALESCE(SUM(amount_cents) FILTER (WHERE direction = 'in'  AND category IN ('sales','recharge')), 0)::bigint,
    COALESCE(SUM(amount_cents) FILTER (WHERE direction = 'in'  AND category = 'internal_transfer'), 0)::bigint,
    COALESCE(SUM(amount_cents) FILTER (WHERE direction = 'out' AND category = 'prize'), 0)::bigint,
    COALESCE(SUM(amount_cents) FILTER (WHERE direction = 'out' AND category IN ('expense','refund')), 0)::bigint,
    COALESCE(SUM(amount_cents) FILTER (WHERE direction = 'out' AND category = 'withdrawal'), 0)::bigint,
    COALESCE(SUM(amount_cents) FILTER (WHERE direction = 'out' AND category = 'internal_transfer'), 0)::bigint,
    (v_open + COALESCE(SUM(amount_cents) FILTER (WHERE direction = 'in' AND category IN ('sales','recharge','internal_transfer')), 0)
            - COALESCE(SUM(amount_cents) FILTER (WHERE direction = 'out' AND category IN ('prize','expense','refund','withdrawal','internal_transfer')), 0))::bigint
  FROM f;
END $$;

-- Cierre: la diferencia (real − esperado) queda registrada; el cierre no se corrige sobrescribiendo
CREATE FUNCTION fn_close_cash(p_location uuid, p_date date, p_counted bigint, p_admin uuid, p_notes text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v record; v_id uuid;
BEGIN
  IF NOT fn_can(p_admin, 'cash.close') THEN RAISE EXCEPTION 'SIN_PERMISO'; END IF;
  SELECT * INTO v FROM fn_cash_preview(p_location, p_date);
  INSERT INTO cash_closings (tenant_id, location_id, closing_date, opening_cents, income_cents, transfers_in_cents, prizes_paid_cents,
                             expenses_cents, withdrawals_cents, transfers_out_cents, counted_cents, notes, closed_by)
  VALUES (current_tenant(), p_location, p_date, v.opening, v.income, v.transfers_in, v.prizes_paid, v.expenses, v.withdrawals, v.transfers_out, p_counted, p_notes, p_admin)
  RETURNING id INTO v_id;
  PERFORM fn_audit(current_tenant(), p_admin, 'cash.closed', 'cash_closing', v_id::text, NULL,
                   jsonb_build_object('expected', v.expected, 'counted', p_counted, 'difference', p_counted - v.expected), p_notes);
  IF p_counted <> v.expected THEN
    PERFORM fn_notify(current_tenant(), NULL, 'cash.difference', 'Diferencia de caja', (p_counted - v.expected)::text, jsonb_build_object('closing_id', v_id), 'admin');
  END IF;
  RETURN v_id;
END $$;

-- =====================================================================
-- CONSULTAS PÚBLICAS / INVITADOS
-- =====================================================================
CREATE FUNCTION fn_verify_ticket(p_code text) RETURNS jsonb LANGUAGE sql STABLE AS $$       -- /verificar/:codigo (sin datos personales)
  SELECT jsonb_build_object('code', t.code, 'draw', d.name, 'draw_date', s.draw_date, 'digits', t.digits, 'status', t.status,
           'total_cents', t.total_cents, 'created_at', t.created_at,
           'numbers', (SELECT jsonb_agg(jsonb_build_object('number', oi.number, 'amount_cents', oi.amount_cents) ORDER BY oi.number)
                         FROM order_items oi WHERE oi.ticket_id = t.id AND oi.status = 'active'))
    FROM tickets t JOIN draw_sessions s ON s.id = t.session_id JOIN draws d ON d.id = s.draw_id
   WHERE t.tenant_id = current_tenant() AND t.code = upper(p_code)
$$;

-- Paso 1 de la recuperación de invitado: código de compra o ticket + teléfono (el paso 2 es el OTP)
CREATE FUNCTION fn_find_guest_order(p_code text, p_phone text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT o.id FROM orders o
   WHERE o.tenant_id = current_tenant() AND o.user_id IS NULL AND o.buyer_phone_norm = fn_norm_phone(p_phone)
     AND (o.purchase_code = upper(p_code) OR EXISTS (SELECT 1 FROM tickets t WHERE t.order_id = o.id AND t.code = upper(p_code)))
   LIMIT 1
$$;

CREATE FUNCTION fn_check_otp(p_purpose otp_purpose, p_target text, p_code_hash text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE o otp_codes%ROWTYPE;
BEGIN
  SELECT * INTO o FROM otp_codes WHERE tenant_id = current_tenant() AND purpose = p_purpose AND target = p_target
     AND consumed_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR o.attempts >= 5 THEN RETURN false; END IF;
  IF o.code_hash = p_code_hash THEN UPDATE otp_codes SET consumed_at = now() WHERE id = o.id; RETURN true; END IF;
  UPDATE otp_codes SET attempts = attempts + 1 WHERE id = o.id;
  RETURN false;
END $$;

-- =====================================================================
-- VISTAS (security_invoker: respetan RLS)
-- =====================================================================
CREATE VIEW v_session_quota WITH (security_invoker = true) AS
SELECT oi.tenant_id, oi.session_id, oi.digits, oi.number, SUM(oi.amount_cents) AS used_cents,
       m.quota_per_number_cents, m.quota_per_number_cents - SUM(oi.amount_cents) AS available_cents
  FROM order_items oi JOIN orders o ON o.id = oi.order_id AND o.status IN ('pending_review','approved')
  JOIN draw_sessions s ON s.id = oi.session_id JOIN draw_modalities m ON m.draw_id = s.draw_id AND m.digits = oi.digits
 WHERE oi.status = 'active' GROUP BY oi.tenant_id, oi.session_id, oi.digits, oi.number, m.quota_per_number_cents;

CREATE VIEW v_wallet_statement WITH (security_invoker = true) AS
SELECT l.id, l.tenant_id, w.user_id, l.created_at, l.type, l.available_delta AS amount_cents,
       l.available_before AS balance_before_cents, l.available_after AS balance_after_cents, l.ref_type, l.ref_id, l.origin, l.reason
  FROM wallet_ledger l JOIN wallets w ON w.id = l.wallet_id;

CREATE VIEW v_pending_counts WITH (security_invoker = true) AS      -- los contadores salen de datos reales, nunca de un número suelto
SELECT w.user_id, w.tenant_id,
       (SELECT count(*) FROM recharges r WHERE r.wallet_id = w.id AND r.status IN ('pending','in_review')) AS recharges_in_review,
       (SELECT count(*) FROM orders o WHERE o.user_id = w.user_id AND o.status = 'pending_review') AS orders_pending,
       (SELECT count(*) FROM notifications n WHERE n.user_id = w.user_id AND n.read_at IS NULL) AS unread_notifications
  FROM wallets w;

CREATE VIEW v_prizes_public WITH (security_invoker = true) AS        -- sin código secreto: apto para Trabajador/Vendedor
SELECT p.id, p.tenant_id, p.ticket_id, t.code AS ticket_code, p.suerte_no, p.suerte_name, p.number, p.prize_cents, p.status, p.expires_on,
       (p.expires_on < current_date) AS past_deadline
  FROM prizes p JOIN tickets t ON t.id = p.ticket_id;

CREATE VIEW v_sales_daily WITH (security_invoker = true) AS
SELECT o.tenant_id, (o.approved_at AT TIME ZONE tn.timezone)::date AS day, o.origin, o.payment_method, o.location_id, o.seller_id, o.worker_id,
       count(*) AS orders, SUM(o.total_cents) AS total_cents
  FROM orders o JOIN tenants tn ON tn.id = o.tenant_id WHERE o.status = 'approved' GROUP BY 1, 2, 3, 4, 5, 6, 7;

CREATE VIEW v_raffle_progress WITH (security_invoker = true) AS
SELECT r.id, r.tenant_id, r.name, r.sold_count, (r.range_end - r.range_start + 1) AS total_numbers,
       round(100.0 * r.sold_count / (r.range_end - r.range_start + 1))::int AS percent, r.status
  FROM special_raffles r;

CREATE VIEW v_receivables_open WITH (security_invoker = true) AS
SELECT r.*, r.amount_cents - r.collected_cents AS pending_cents FROM receivables r WHERE r.status IN ('open','partial');

-- =====================================================================
-- TRIGGERS ADJUNTOS (tenant por defecto, updated_at, inmutabilidad, auditoría)
-- =====================================================================
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables tb
             ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
            WHERE c.table_schema = 'app' AND c.column_name = 'tenant_id' LOOP
    EXECUTE format('CREATE TRIGGER trg_default_tenant BEFORE INSERT ON app.%I FOR EACH ROW EXECUTE FUNCTION app.fn_default_tenant()', t.table_name);
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t.table_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON app.%I USING (tenant_id = app.current_tenant()) WITH CHECK (tenant_id = app.current_tenant())', t.table_name);
  END LOOP;
  FOR t IN SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables tb
             ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
            WHERE c.table_schema = 'app' AND c.column_name = 'updated_at' LOOP
    EXECUTE format('CREATE TRIGGER trg_updated_at BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()', t.table_name);
  END LOOP;
END $$;

-- Libros y registros inmutables
CREATE TRIGGER trg_immutable BEFORE UPDATE OR DELETE ON wallet_ledger          FOR EACH ROW EXECUTE FUNCTION fn_deny_mutation();
CREATE TRIGGER trg_immutable BEFORE UPDATE OR DELETE ON audit_log              FOR EACH ROW EXECUTE FUNCTION fn_deny_mutation();
CREATE TRIGGER trg_immutable BEFORE UPDATE OR DELETE ON financial_transactions FOR EACH ROW EXECUTE FUNCTION fn_deny_mutation();
CREATE TRIGGER trg_immutable BEFORE UPDATE OR DELETE ON prize_payments         FOR EACH ROW EXECUTE FUNCTION fn_deny_mutation();
CREATE TRIGGER trg_immutable BEFORE UPDATE OR DELETE ON cash_closings          FOR EACH ROW EXECUTE FUNCTION fn_deny_mutation();
CREATE TRIGGER trg_immutable BEFORE UPDATE OR DELETE ON result_positions       FOR EACH ROW EXECUTE FUNCTION fn_deny_mutation();
CREATE TRIGGER trg_immutable BEFORE UPDATE OR DELETE ON result_changes         FOR EACH ROW EXECUTE FUNCTION fn_deny_mutation();
CREATE TRIGGER trg_immutable BEFORE UPDATE OR DELETE ON prize_validations      FOR EACH ROW EXECUTE FUNCTION fn_deny_mutation();
CREATE TRIGGER trg_immutable BEFORE UPDATE OR DELETE ON payment_proofs         FOR EACH ROW EXECUTE FUNCTION fn_deny_mutation();
CREATE TRIGGER trg_immutable BEFORE UPDATE OR DELETE ON scheduled_play_history FOR EACH ROW EXECUTE FUNCTION fn_deny_mutation();
CREATE TRIGGER trg_immutable BEFORE UPDATE OR DELETE ON receivable_payments    FOR EACH ROW EXECUTE FUNCTION fn_deny_mutation();
CREATE TRIGGER trg_results_guard BEFORE UPDATE OR DELETE ON results FOR EACH ROW EXECUTE FUNCTION fn_results_guard();

-- Sin eliminación física (solo anulación con usuario, fecha y motivo)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','orders','order_items','tickets','payments','refunds','prizes','withdrawals','recharges','wallets',
                           'contratas','contrata_slots','receivables','scheduled_plays','special_raffles','raffle_purchases','raffle_numbers',
                           'draws','draw_sessions','plans','plan_versions','plan_prizes','commissions','commission_plans'] LOOP
    EXECUTE format('CREATE TRIGGER trg_no_delete BEFORE DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.fn_deny_delete()', t);
  END LOOP;
  -- Auditoría automática de configuración sensible
  FOREACH t IN ARRAY ARRAY['draws','draw_modalities','draw_day_references','plans','plan_prizes','bank_accounts','payment_methods_config',
                           'role_permissions','commission_plans','app_settings','special_raffles','fortune_numbers','users','staff_profiles','contratas'] LOOP
    EXECUTE format('CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.fn_audit_row()', t);
  END LOOP;
END $$;

-- =====================================================================
-- ROLES Y PERMISOS DE BASE DE DATOS
-- rf_api_admin : backend para Administración y tareas de sistema (accede a todo)
-- rf_api_staff : backend para cliente/trabajador/vendedor (SIN acceso al código secreto de cobro ni a funciones *_core)
-- Ambos están sujetos a RLS por tenant. Crea los usuarios LOGIN y hazlos miembros de estos roles.
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rf_api_admin') THEN CREATE ROLE rf_api_admin NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rf_api_staff') THEN CREATE ROLE rf_api_staff NOLOGIN; END IF;
END $$;
GRANT USAGE ON SCHEMA app TO rf_api_admin, rf_api_staff;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO rf_api_admin, rf_api_staff;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO rf_api_admin, rf_api_staff;
REVOKE ALL ON app.ticket_claim_codes FROM rf_api_staff;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT  EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO rf_api_admin;
GRANT  EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO rf_api_staff;
REVOKE EXECUTE ON FUNCTION fn_recharge_decide_core(uuid, uuid, boolean, text, text), fn_confirm_gateway_payment(uuid, text, boolean, text),
       fn_get_claim_code(uuid, uuid), fn_make_claim(uuid, uuid), fn_calculate_prizes(uuid)
  FROM rf_api_staff;
-- Nota: fn_issue_tickets, fn_reject_order_core, fn_approve_raffle_core y fn_wallet_apply las invocan flujos accesibles al rol staff
-- (compra de mostrador, pago con saldo); el API NO las expone como endpoints directos y las funciones públicas validan permisos.
-- =====================================================================
-- EL IMPERIO DE ROSS — 03_seed.sql
-- Datos de ARRANQUE y de DEMOSTRACIÓN (is_demo = true / textos DEMO).
-- Los hashes de contraseña son marcadores: REEMPLAZAR por hashes reales (bcrypt/argon2) desde el backend.
-- Los valores de premios, cuentas bancarias, saldos y horarios de cierre son EJEMPLOS hasta que Administración los configure.
-- =====================================================================
SET search_path = app, public;
SELECT set_config('app.tenant_id', 'a0000000-0000-0000-0000-000000000001', false);

INSERT INTO tenants (id, slug, name, tagline, domain, branding, modules, social) VALUES
 ('a0000000-0000-0000-0000-000000000001', 'imperio-de-ross', 'EL IMPERIO DE ROSS', 'Tu momento. Tu suerte. Tu fortuna.', NULL,
  '{"logos":{"horizontal":"logo-horizontal.png","full_slogan":"logo-full-slogan.png","full":"logo-full.png","monogram":"logo-monogram.png"},
    "palette":{"emerald":"oklch(0.38 0.09 160)","gold":"oklch(0.76 0.12 85)"}}',
  '{"contratas":true,"jugadasProgramadas":true,"rifasEspeciales":true,"comisiones":true,"pasarelaPagos":false,"promociones":false}',
  '{"instagram":null,"domain":null}');

INSERT INTO locations (id, tenant_id, name, city) VALUES
 ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Local Chone Centro', 'Chone'),
 ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Local Quito Norte', 'Quito'),
 ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Local Guayaquil Sur', 'Guayaquil');

-- Usuarios DEMO (hash = marcador)
INSERT INTO users (id, tenant_id, role, full_name, phone, email, password_hash, location_id, adult_confirmed_at, terms_accepted_at, two_factor_enabled, is_demo) VALUES
 ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'admin',  'Administrador Demo', '0990000001', 'admin@demo.local',  '$2b$12$REEMPLAZAR_HASH_REAL', NULL, now(), now(), true,  true),
 ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'worker', 'Trabajadora Demo',   '0990000002', 'worker@demo.local', '$2b$12$REEMPLAZAR_HASH_REAL', 'b0000000-0000-0000-0000-000000000001', now(), now(), false, true),
 ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'seller', 'Vendedora Demo',     '0990000003', 'seller@demo.local', '$2b$12$REEMPLAZAR_HASH_REAL', 'b0000000-0000-0000-0000-000000000002', now(), now(), false, true),
 ('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'client', 'Cliente Demo',       '0990000004', 'cliente@demo.local','$2b$12$REEMPLAZAR_HASH_REAL', NULL, now(), now(), false, true);

INSERT INTO staff_profiles (user_id, tenant_id, can_pay_prizes, can_review_receipts_until_close, void_window_minutes) VALUES
 ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', true, true, 30),
 ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', false, false, 0);

INSERT INTO financial_accounts (tenant_id, kind, name) VALUES
 ('a0000000-0000-0000-0000-000000000001', 'income', 'Cuenta de ingresos'),
 ('a0000000-0000-0000-0000-000000000001', 'payout', 'Cuenta de pagos / egresos');

-- Matriz de permisos (editable en Administración)
INSERT INTO role_permissions (tenant_id, role, action, allowed, scope)
SELECT 'a0000000-0000-0000-0000-000000000001', r::user_role, a, v.allowed, v.scope
FROM (VALUES
  ('admin','order.approve',true,'all'), ('worker','order.approve',true,'before_close'), ('seller','order.approve',false,'all'),
  ('admin','ticket.void',true,'all'),   ('worker','ticket.void',false,'all'),          ('seller','ticket.void',false,'all'),
  ('admin','ticket.void_own',true,'all'),('worker','ticket.void_own',true,'own'),      ('seller','ticket.void_own',false,'all'),
  ('admin','result.edit',true,'all'),   ('worker','result.edit',false,'all'),          ('seller','result.edit',false,'all'),
  ('admin','sale.modify',false,'all'),  ('worker','sale.modify',false,'all'),          ('seller','sale.modify',false,'all'),   -- nadie edita ventas: solo anulación con motivo
  ('admin','prize.validate',true,'all'),('worker','prize.validate',true,'authorized_only'),('seller','prize.validate',false,'all'),
  ('admin','prize.pay',true,'all'),     ('worker','prize.pay',true,'authorized_only'),  ('seller','prize.pay',false,'all'),
  ('admin','prize.see_claim_code',true,'all'),('worker','prize.see_claim_code',false,'all'),('seller','prize.see_claim_code',false,'all'),
  ('admin','draw.create',true,'all'),   ('worker','draw.create',false,'all'),          ('seller','draw.create',false,'all'),
  ('admin','plan.edit',true,'all'),     ('worker','plan.edit',false,'all'),             ('seller','plan.edit',false,'all'),
  ('admin','recharge.approve',true,'all'),('worker','recharge.approve',false,'all'),   ('seller','recharge.approve',false,'all'),
  ('admin','withdrawal.manage',true,'all'),('worker','withdrawal.manage',false,'all'), ('seller','withdrawal.manage',false,'all'),
  ('admin','refund.manage',true,'all'), ('worker','refund.manage',false,'all'),        ('seller','refund.manage',false,'all'),
  ('admin','finance.manage',true,'all'),('worker','finance.manage',false,'all'),       ('seller','finance.manage',false,'all'),
  ('admin','cash.close',true,'all'),    ('worker','cash.close',false,'all'),            ('seller','cash.close',false,'all'),
  ('admin','report.view',true,'all'),   ('worker','report.view',false,'all'),          ('seller','report.view',false,'all')
) AS v(r, a, allowed, scope);

INSERT INTO app_settings (tenant_id, key, value) VALUES
 ('a0000000-0000-0000-0000-000000000001', 'prize_expiry_days', '8'),
 ('a0000000-0000-0000-0000-000000000001', 'wallet_auto_approve', 'false'),
 ('a0000000-0000-0000-0000-000000000001', 'low_balance_threshold_cents', '2000'),
 ('a0000000-0000-0000-0000-000000000001', 'second_authorization_required', 'false'),
 ('a0000000-0000-0000-0000-000000000001', 'estimated_review_minutes', '{"min":5,"max":15,"demo":true}'),
 ('a0000000-0000-0000-0000-000000000001', 'ticket_note', '"El equivalente en electrodomésticos y víveres"');

-- Sorteos: Argentina Matutina 1:00 PM, Argentina Vespertina 4:00 PM, Ecuador 8:00 PM (cierre de ejemplo: 15 min antes, DEMO)
INSERT INTO draws (id, tenant_id, code, name, country_code, reference_lottery, reference_abbr, draw_time, close_offset_minutes, days_of_week, sort_order, ticket_note) VALUES
 ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'ar-matutina',   'Argentina · Matutina',   'AR', 'Lotería de la Ciudad Matutina',   'ARM', '13:00', 15, '{1,2,3,4,5,6}', 1, 'El equivalente en electrodomésticos y víveres'),
 ('d0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'ar-vespertina', 'Argentina · Vespertina', 'AR', 'Lotería de la Ciudad Vespertina', 'ARV', '16:00', 15, '{1,2,3,4,5,6}', 2, 'El equivalente en electrodomésticos y víveres'),
 ('d0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'ec-nacional',   'Ecuador · Lotería Nacional', 'EC', 'Lotería Nacional', 'LTT', '20:00', 15, '{1,2,3,4,5,6}', 3, 'El equivalente en electrodomésticos y víveres');

-- Lotería de referencia por día para Ecuador (Domingo sin definir, editable)
INSERT INTO draw_day_references (draw_id, tenant_id, dow, reference_lottery, reference_abbr) VALUES
 ('d0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 1, 'Lotería',  'LTT'),
 ('d0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 2, 'Lotto',    'LTO'),
 ('d0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 3, 'Lotería',  'LTT'),
 ('d0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 4, 'Lotto',    'LTO'),
 ('d0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 5, 'Lotería',  'LTT'),
 ('d0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 6, 'Lotto',    'LTO'),
 ('d0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 7, NULL,       NULL);

-- Modalidades: cupo por número 2c ref. $30 · 3c $2 · 4c $1 (configurables). Suertes: 2c→7, 3c→10, 4c→4 (configurable)
INSERT INTO draw_modalities (tenant_id, draw_id, digits, quota_per_number_cents, max_suertes)
SELECT 'a0000000-0000-0000-0000-000000000001', d.id, m.digits, m.quota, m.suertes
  FROM draws d CROSS JOIN (VALUES (2::smallint, 3000::bigint, 7::smallint), (3, 200, 10), (4, 100, 4)) AS m(digits, quota, suertes);

-- Planes: Matutina y Vespertina con UN plan por modalidad; Ecuador con dos (ejemplo). Premios = DEMO.
INSERT INTO plans (id, tenant_id, draw_id, digits, name)
SELECT gen_random_uuid(), 'a0000000-0000-0000-0000-000000000001', d.id, m.digits, p.name
  FROM draws d CROSS JOIN (VALUES (2::smallint), (3), (4)) AS m(digits)
  JOIN (VALUES ('ar-matutina','Plan 1'), ('ar-vespertina','Plan 1'), ('ec-nacional','Plan 1'), ('ec-nacional','Plan 2')) AS p(code, name) ON p.code = d.code;

DO $$
DECLARE pl record; v_prizes jsonb;
BEGIN
  FOR pl IN SELECT p.id, p.digits, p.name FROM plans p LOOP
    v_prizes := CASE
      WHEN pl.digits = 2 AND pl.name = 'Plan 1' THEN '[{"suerte_no":1,"name":"Suerte Víveres","payout_per_dollar_cents":6000},{"suerte_no":2,"name":"Suerte Víveres","payout_per_dollar_cents":1000},{"suerte_no":3,"name":"Suerte Víveres","payout_per_dollar_cents":500},{"suerte_no":4,"name":"Suerte Víveres","payout_per_dollar_cents":500},{"suerte_no":5,"name":"Suerte Víveres","payout_per_dollar_cents":500},{"suerte_no":6,"name":"Suerte Víveres","payout_per_dollar_cents":200},{"suerte_no":7,"name":"Suerte Víveres","payout_per_dollar_cents":100}]'
      WHEN pl.digits = 2 THEN '[{"suerte_no":1,"name":"Suerte Víveres","payout_per_dollar_cents":8000},{"suerte_no":2,"name":"Suerte Víveres","payout_per_dollar_cents":3000},{"suerte_no":3,"name":"Suerte Víveres","payout_per_dollar_cents":2500},{"suerte_no":4,"name":"Suerte Víveres","payout_per_dollar_cents":2000},{"suerte_no":5,"name":"Suerte Víveres","payout_per_dollar_cents":1500},{"suerte_no":6,"name":"Suerte Víveres","payout_per_dollar_cents":600},{"suerte_no":7,"name":"Suerte Víveres","payout_per_dollar_cents":300}]'
      WHEN pl.digits = 3 THEN (SELECT jsonb_agg(jsonb_build_object('suerte_no', n, 'name', 'Suerte ' || n, 'payout_per_dollar_cents', 50000 / n)) FROM generate_series(1, 10) n)
      ELSE (SELECT jsonb_agg(jsonb_build_object('suerte_no', n, 'name', 'Suerte ' || n, 'payout_per_dollar_cents', 300000 / n)) FROM generate_series(1, 4) n) END;
    PERFORM fn_new_plan_version(pl.id, v_prizes, 'c0000000-0000-0000-0000-000000000001');
  END LOOP;
END $$;

-- Cuentas bancarias de EJEMPLO (DEMO, editables; no son datos oficiales)
INSERT INTO bank_accounts (tenant_id, bank_name, holder, account_type, account_number, sort_order) VALUES
 ('a0000000-0000-0000-0000-000000000001', 'Banco Pichincha (DEMO)',  'EL IMPERIO DE ROSS', 'ahorros', '1234567890', 1),
 ('a0000000-0000-0000-0000-000000000001', 'Banco Guayaquil (DEMO)', 'EL IMPERIO DE ROSS', 'ahorros', '0987654321', 2);

-- Métodos de pago: por defecto Saldo + Transferencia (+ efectivo en mostrador). Pasarela = módulo adicional, apagado.
INSERT INTO payment_methods_config (tenant_id, method, enabled, min_cents, fee_message, help_text) VALUES
 ('a0000000-0000-0000-0000-000000000001', 'wallet',        true,  0,   'Sin comisión por compra', 'Paga con el saldo de tu billetera'),
 ('a0000000-0000-0000-0000-000000000001', 'bank_transfer', true,  0,   'Sin comisión', 'Transfiere y sube tu comprobante'),
 ('a0000000-0000-0000-0000-000000000001', 'cash_counter',  true,  0,   NULL, 'Cobro en mostrador'),
 ('a0000000-0000-0000-0000-000000000001', 'payphone',      false, 100, 'Comisión por definir (DEMO)', NULL),
 ('a0000000-0000-0000-0000-000000000001', 'card',          false, 100, 'Comisión por definir (DEMO)', NULL),
 ('a0000000-0000-0000-0000-000000000001', 'qr_wallet',     false, 100, NULL, NULL),
 ('a0000000-0000-0000-0000-000000000001', 'cash_point',    false, 100, NULL, NULL);

-- Sesiones de los próximos 8 días
SELECT fn_ensure_sessions('a0000000-0000-0000-0000-000000000001', current_date, current_date + 7);

-- Billetera del Cliente Demo ($25.00 de ejemplo; las cuentas nuevas inician en $0.00)
DO $$
DECLARE w uuid := fn_get_wallet('c0000000-0000-0000-0000-000000000004'); u uuid := 'c0000000-0000-0000-0000-000000000004';
BEGIN
  PERFORM fn_wallet_apply(w, 'recharge',   10000, 0, 'demo', NULL, 'Recarga aprobada (DEMO)', u, 'demo1');
  PERFORM fn_wallet_apply(w, 'adjustment',  -500, 0, 'demo', NULL, 'Ticket RF-4587 (DEMO)', u, 'demo2');
  PERFORM fn_wallet_apply(w, 'prize_credit', 2000, 0, 'demo', NULL, 'Premio acreditado (DEMO)', u, 'demo3');
  PERFORM fn_wallet_apply(w, 'withdrawal_paid', -1500, 0, 'demo', NULL, 'Retiro (DEMO)', u, 'demo4');
  PERFORM fn_wallet_apply(w, 'adjustment',   -25, 0, 'demo', NULL, 'Micropago $0.25 (DEMO)', u, 'demo5');
  PERFORM fn_wallet_apply(w, 'adjustment',   -75, 0, 'demo', NULL, 'Micropago $0.75 (DEMO)', u, 'demo6');
  PERFORM fn_wallet_apply(w, 'adjustment', -7400, 0, 'demo', NULL, 'Compras anteriores (DEMO)', u, 'demo7');
END $$;

-- Comisiones (ejemplo): 3 cifras 6 % de ventas · valor fijo para 4 cifras · 40 % de ganancia mensual positiva en 2 cifras
INSERT INTO commission_plans (tenant_id, seller_id, draw_id, digits, base, percent_bp, fixed_cents) VALUES
 ('a0000000-0000-0000-0000-000000000001', NULL, NULL, 3, 'sales_percent', 600, NULL),
 ('a0000000-0000-0000-0000-000000000001', NULL, NULL, 4, 'fixed_amount', NULL, 10),
 ('a0000000-0000-0000-0000-000000000001', NULL, NULL, 2, 'monthly_profit_percent', 4000, NULL);

-- Contrata de ejemplo: Rossmery, #20, 2 cifras, $20, Matutina, lunes a sábado
INSERT INTO contratas (tenant_id, client_name, draw_id, digits, number, plan_id, amount_cents, days_of_week, start_date, collection, created_by)
SELECT 'a0000000-0000-0000-0000-000000000001', 'Rossmery', d.id, 2, '20', p.id, 2000, '{1,2,3,4,5,6}', current_date, 'cash', 'c0000000-0000-0000-0000-000000000001'
  FROM draws d JOIN plans p ON p.draw_id = d.id AND p.digits = 2 WHERE d.code = 'ar-matutina';
SELECT fn_materialize_contrata_slots('a0000000-0000-0000-0000-000000000001', current_date, current_date + 7);

-- Jugada programada de ejemplo: 20, 2 cifras, Matutina, lunes a sábado, $5
INSERT INTO scheduled_plays (tenant_id, user_id, draw_id, digits, number, plan_id, amount_cents, days_of_week)
SELECT 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000004', d.id, 2, '20', p.id, 500, '{1,2,3,4,5,6}'
  FROM draws d JOIN plans p ON p.draw_id = d.id AND p.digits = 2 WHERE d.code = 'ar-matutina';

-- Rifas Especiales (SIN canastas). Precio por número desde $0.25 en pasos de $0.05.
INSERT INTO special_raffles (id, tenant_id, name, description, prize_description, prize_value_cents, number_digits, range_start, range_end, price_cents, opens_at, close_mode, status, draw_method, rules) VALUES
 ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Rifa de Moto',     'Moto 0 km', 'Moto', 250000, 4, 0, 999, 100, now() - interval '10 days', 'sold_out', 'open', 'Último número de la Lotería Nacional', 'Ver bases del sorteo'),
 ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Efectivo $1.000', 'Premio en efectivo', 'Efectivo $1.000', 100000, 4, 0, 999, 25, now() - interval '5 days', 'sold_out', 'open', 'Último número de la Lotería Nacional', 'Ver bases del sorteo'),
 ('e0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Rifa Fortuna 5 cifras', 'Con Números Fortuna', 'Celular de gama alta', 120000, 5, 0, 99999, 100, now() - interval '1 day', 'sold_out', 'open', 'Último número de la Lotería Nacional', 'Ver bases del sorteo');
INSERT INTO raffle_packages (tenant_id, raffle_id, label, price_cents, chances) VALUES
 ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', '$1 = 1 oportunidad', 100, 1),
 ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', '$2 = 1 oportunidad', 200, 1),
 ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001', '$1 = 5 oportunidades', 100, 5);
INSERT INTO fortune_numbers (tenant_id, raffle_id, number, prize_cents) VALUES
 ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000003', '02746', 10000),
 ('a0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000003', '34872', 50000);

-- Avance DEMO de rifas (750/1.000 y 900/1.000) con una compra aprobada de demostración
DO $$
DECLARE r record; v_p uuid; v_no bigint;
BEGIN
  FOR r IN SELECT * FROM (VALUES ('e0000000-0000-0000-0000-000000000001'::uuid, 750), ('e0000000-0000-0000-0000-000000000002'::uuid, 900)) v(id, n) LOOP
    v_no := fn_next_counter('a0000000-0000-0000-0000-000000000001', 'raffle_purchase');
    INSERT INTO raffle_purchases (tenant_id, raffle_id, purchase_no, buyer_name, buyer_phone, quantity, total_cents, status, approved_at)
    SELECT 'a0000000-0000-0000-0000-000000000001', r.id, v_no, 'Compra DEMO acumulada', '0990000099', r.n, r.n * sr.price_cents, 'approved', now()
      FROM special_raffles sr WHERE sr.id = r.id RETURNING id INTO v_p;
    INSERT INTO raffle_numbers (raffle_id, tenant_id, number, purchase_id)
    SELECT r.id, 'a0000000-0000-0000-0000-000000000001', lpad(n::text, 4, '0'), v_p FROM generate_series(0, r.n - 1) n;
    UPDATE special_raffles SET sold_count = r.n WHERE id = r.id;
  END LOOP;
END $$;
