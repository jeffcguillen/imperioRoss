import { readFile, writeFile } from 'node:fs/promises';

const apiGuide = await readFile(new URL('../../docs/API.md', import.meta.url), 'utf8');
const operations = [];
for (const line of apiGuide.split(/\r?\n/)) {
  const match = line.match(/^\|\s*(GET|POST|PATCH|DELETE)\s*\|\s*`([^`]+)`\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/);
  if (!match || !match[2].startsWith('/api/')) continue;
  const [, method, legacyPath, access, description] = match;
  const path = legacyPath.replace(/^\/api(?=\/|$)/, '/api/v1').replace(/:([A-Za-z0-9_]+)/g, '{$1}');
  const tag = path.split('/')[3] || 'general';
  const operationId = `${method.toLowerCase()}_${path.replace(/^\/api\/v1\/?/, '').replace(/[{}]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'root'}`;
  const pathParameters = [...path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => ({
    name, in: 'path', required: true, schema: { type: 'string' },
  }));
  const publicRoute = /Público|Invitado|sin sesión/i.test(access);
  const responses = {
    '200': { description: description.trim() || 'Solicitud completada.' },
    '400': { description: 'Datos de entrada no válidos.' },
    '401': { description: 'Sesión requerida.' },
    '403': { description: 'Permiso insuficiente.' },
    '500': { description: 'Error interno con requestId.' },
  };
  if (method === 'POST') responses['201'] = { description: 'Registro creado.' };
  operations.push([path, method.toLowerCase(), {
    operationId, tags: [tag], summary: description.trim() || `${method} ${legacyPath}`,
    description: `Acceso: ${access.trim()}. Ruta de compatibilidad original: ${legacyPath}.`,
    ...(pathParameters.length ? { parameters: pathParameters } : {}),
    ...(publicRoute ? {} : { security: [{ cookieAuth: [] }] }), responses,
  }]);
}
operations.push(['/api/v1/openapi.json', 'get', {
  operationId: 'get_openapi_document', tags: ['docs'], summary: 'Documento OpenAPI (solo desarrollo)',
  responses: { '200': { description: 'Documento OpenAPI 3.1.' }, '404': { description: 'Fuera del modo desarrollo.' } },
}]);

const paths = {};
for (const [path, method, operation] of operations) (paths[path] ??= {})[method] = operation;
const spec = {
  openapi: '3.1.0',
  info: { title: 'El Imperio de Ross API', version: '1.0.0', description: 'Rutas documentadas en docs/API.md. Las rutas versionadas usan /api/v1; /api permanece como alias compatible.' },
  servers: [{ url: 'http://127.0.0.1:3000', description: 'Desarrollo local' }],
  tags: [...new Set(operations.map(([, , operation]) => operation.tags[0]))].map((name) => ({ name })),
  components: { securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'ross_session' } } },
  paths,
};
await writeFile(new URL('../../docs/openapi.json', import.meta.url), `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
console.log(`OpenAPI ${spec.openapi}: ${operations.length} operaciones documentadas.`);
