export function getSupabaseConnection() {
  const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();
  const connectionString = process.env.SUPABASE_DB_URL?.trim();
  if (!projectRef || !connectionString) {
    throw new Error('Define SUPABASE_PROJECT_REF y SUPABASE_DB_URL en .local/supabase.env.');
  }

  const url = new URL(connectionString);
  if (!/^[a-z0-9-]+$/i.test(projectRef)
    || !url.hostname.endsWith('.pooler.supabase.com')
    || url.port !== '5432'
    || url.pathname !== '/postgres'
    || decodeURIComponent(url.username) !== `postgres.${projectRef}`
    || !url.password
    || url.searchParams.get('sslmode') !== 'require') {
    throw new Error('Usa la cadena Session Pooler de Supabase: usuario postgres.<PROJECT_REF>, puerto 5432, base postgres y sslmode=require.');
  }

  return { projectRef, connectionString, url };
}
