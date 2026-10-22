// The standalone app keeps its whole SQLite database as one value in IndexedDB, which the Android WebView stores in
// the app's private data.

const DB_NAME = 'soundfy';
const STORE = 'files';
const KEY = 'soundfy.db';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(mode: IDBTransactionMode, use: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = use(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error ?? request.error);
        };
      }),
  );
}

export async function loadDatabase(): Promise<Uint8Array | null> {
  const value = await run<unknown>('readonly', (store) => store.get(KEY));
  return value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : null;
}

export async function saveDatabase(bytes: Uint8Array): Promise<void> {
  await run('readwrite', (store) => store.put(bytes, KEY));
}
