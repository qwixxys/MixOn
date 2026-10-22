// Resolves better-sqlite3 to the standalone app's sql.js implementation.
const adapter = new URL('../../../client/src/standalone/shims/better-sqlite3.ts', import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === 'better-sqlite3') return { url: adapter, shortCircuit: true };
  return next(specifier, context);
}
