INSERT INTO app.role_permissions (tenant_id, role, action, allowed, scope)
SELECT t.id, p.role::app.user_role, 'sale.register', p.allowed, p.scope
  FROM app.tenants t
 CROSS JOIN (VALUES
   ('admin', true, 'all'),
   ('worker', true, 'own'),
   ('seller', true, 'own'),
   ('client', false, 'own')
 ) AS p(role, allowed, scope)
ON CONFLICT (tenant_id, role, action) DO NOTHING;
