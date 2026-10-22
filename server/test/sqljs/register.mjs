// `npm run test:sqljs`: the whole server test suite against the in-browser SQLite the standalone Android app uses,
// to keep it behaving like better-sqlite3.
import { register } from 'node:module';

register('./hooks.mjs', import.meta.url);
const { initSqlite } = await import('../../../client/src/standalone/shims/better-sqlite3.ts');
await initSqlite();
