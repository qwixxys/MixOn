// The part of better-sqlite3's API the soundFy server uses, implemented over sql.js (SQLite compiled to WebAssembly),
// so the server's own code can run inside the standalone Android app. The database lives in memory; the app saves
// its bytes (serialize()) to the device and opens them again on start (new Database(bytes)).
import initSqlJs from 'sql.js';
import type { BindParams, Database as SqlJsDatabase, SqlJsStatic, SqlValue, Statement as SqlJsStatement } from 'sql.js';

let SQL: SqlJsStatic | null = null;

/** Loads the WebAssembly module; must finish before the first `new Database()`. */
export async function initSqlite(config?: Parameters<typeof initSqlJs>[0]): Promise<void> {
  SQL ??= await initSqlJs(config);
}

type Row = Record<string, SqlValue>;
interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

function value(v: unknown): SqlValue {
  if (v === undefined) throw new TypeError('better-sqlite3 shim: undefined cannot be bound; use null');
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'bigint') return Number(v);
  return v as SqlValue;
}

/** better-sqlite3 takes positional values, an array, or one object for named parameters (@name, :name, $name). */
function bindParams(args: unknown[]): BindParams | undefined {
  if (args.length === 0) return undefined;
  const [first] = args;
  if (args.length === 1 && first && typeof first === 'object' && !Array.isArray(first) && !(first instanceof Uint8Array)) {
    const named: Record<string, SqlValue> = {};
    for (const [key, v] of Object.entries(first)) {
      const bound = value(v);
      named[`@${key}`] = bound;
      named[`:${key}`] = bound;
      named[`$${key}`] = bound;
    }
    return named;
  }
  const list = args.length === 1 && Array.isArray(first) ? first : args;
  return list.map(value);
}

class Statement {
  constructor(
    private db: Database,
    private sql: string,
  ) {
    // Like better-sqlite3, report SQL errors when preparing rather than on first use.
    db.withStatement(sql, [], () => undefined);
  }

  get(...args: unknown[]): Row | undefined {
    return this.db.withStatement(this.sql, args, (s) => (s.step() ? (s.getAsObject() as Row) : undefined));
  }

  all(...args: unknown[]): Row[] {
    return this.db.withStatement(this.sql, args, (s) => {
      const rows: Row[] = [];
      while (s.step()) rows.push(s.getAsObject() as Row);
      return rows;
    });
  }

  run(...args: unknown[]): RunResult {
    return this.db.withStatement(this.sql, args, (s) => {
      while (s.step()) {
        // drain RETURNING rows, if any
      }
      return this.db.lastRun();
    });
  }
}

type SqlFunction = (...args: SqlValue[]) => SqlValue;

export default class Database {
  private db: SqlJsDatabase;
  private depth = 0;
  /** Settings and functions to re-apply after serialize(), which reopens the connection. */
  private pragmas: string[] = [];
  private functions = new Map<string, SqlFunction>();
  /** Called after anything may have changed, so the app can schedule saving the database. */
  onChange: (() => void) | null = null;

  constructor(source?: string | Uint8Array) {
    if (!SQL) throw new Error('better-sqlite3 shim: call initSqlite() first');
    this.db = new SQL.Database(source instanceof Uint8Array ? source : undefined);
  }

  get inTransaction() {
    return this.depth > 0;
  }

  /** Runs `use` on a fresh compiled statement and always frees it. */
  withStatement<T>(sql: string, args: unknown[], use: (s: SqlJsStatement) => T): T {
    const stmt = this.db.prepare(sql);
    try {
      const params = bindParams(args);
      if (params) stmt.bind(params);
      return use(stmt);
    } finally {
      stmt.free();
    }
  }

  lastRun(): RunResult {
    const changes = this.db.getRowsModified();
    const id = this.db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0];
    if (changes > 0) this.changed();
    return { changes, lastInsertRowid: Number(id ?? 0) };
  }

  private changed() {
    if (this.depth === 0) this.onChange?.();
  }

  prepare(sql: string) {
    return new Statement(this, sql);
  }

  exec(sql: string) {
    this.db.exec(sql);
    this.changed();
    return this;
  }

  pragma(source: string, options?: { simple?: boolean }) {
    const rows = this.withStatement(`PRAGMA ${source}`, [], (s) => {
      const out: Row[] = [];
      while (s.step()) out.push(s.getAsObject() as Row);
      return out;
    });
    if (/=/.test(source) && !/^\s*user_version/i.test(source)) this.pragmas.push(source);
    if (/^\s*user_version\s*=/i.test(source)) this.changed();
    if (options?.simple) return rows[0] ? Object.values(rows[0])[0] : undefined;
    return rows;
  }

  function(name: string, optionsOrFn: object | SqlFunction, maybeFn?: SqlFunction) {
    const fn = (typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn) as SqlFunction;
    this.functions.set(name, fn);
    this.db.create_function(name, fn);
    return this;
  }

  /** better-sqlite3's transaction(): BEGIN/COMMIT, or a savepoint when already inside a transaction. */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args: A) => {
      const nested = this.depth > 0;
      const savepoint = `sp${this.depth}`;
      this.db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN');
      this.depth++;
      try {
        const result = fn(...args);
        this.depth--;
        this.db.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
        this.changed();
        return result;
      } catch (err) {
        this.depth--;
        this.db.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
        throw err;
      }
    };
  }

  /** The whole database as bytes, for saving. sql.js reopens the connection here, so settings are re-applied. */
  serialize(): Uint8Array {
    if (this.depth > 0) throw new Error('better-sqlite3 shim: cannot serialize inside a transaction');
    const bytes = this.db.export();
    for (const pragma of this.pragmas) this.db.exec(`PRAGMA ${pragma}`);
    for (const [name, fn] of this.functions) this.db.create_function(name, fn);
    return bytes;
  }

  close() {
    this.db.close();
  }
}
