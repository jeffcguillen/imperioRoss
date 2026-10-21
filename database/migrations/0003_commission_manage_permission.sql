INSERT INTO app.role_permissions (tenant_id, role, action, allowed, scope)
SELECT t.id, r.role::app.user_role, 'commission.manage', r.allowed, 'all'
  FROM app.tenants t
 CROSS JOIN (VALUES ('admin', true), ('worker', false), ('seller', false)) AS r(role, allowed)
ON CONFLICT (tenant_id, role, action) DO NOTHING;
