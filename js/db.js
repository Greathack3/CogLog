/* Cognitive Evolution Tracker — storage layer.
   Architecture: local-first. Primary store is IndexedDB (supports large data + image data URLs).
   If IndexedDB is unavailable (e.g. some file:// contexts), falls back to localStorage with a
   smaller quota. Both are device-local: data is NOT protected against device failure — export
   backups regularly (Data & Backup menu). */
window.DB = (function () {
  'use strict';

  const DB_NAME = 'cognitive-evolution-tracker';
  const DB_VERSION = 2;   // v2: added wm* stores for the WM Assessment Platform
  const STORES = ['meta', 'tickets', 'modes', 'metrics', 'sessions', 'observations', 'assessments', 'attachments',
    'wmSessions', 'wmBlocks', 'wmTrials', 'wmConfigVersions'];
  const LS_COLLECTION_PREFIX = 'cet:store:';

  let db = null;
  let mode = 'idb';

  function openIDB() {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const s of STORES) {
          if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: s === 'meta' ? 'key' : 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
      setTimeout(() => reject(new Error('IndexedDB open timeout')), 4000);
    });
  }

  async function open() {
    mode = 'idb';
    try {
      if (!window.indexedDB) throw new Error('IndexedDB not present');
      db = await openIDB();
    } catch (e) {
      console.warn('[CET] IndexedDB unavailable, using localStorage fallback.', e);
      mode = 'ls';
      db = null;
    }
    return mode;
  }

  /* Synchronous: opens a transaction and returns its ObjectStore. Only valid once DB is open. */
  function idbStore(store, write) {
    const tx = db.transaction(store, write ? 'readwrite' : 'readonly');
    return tx.objectStore(store);
  }

  function reqToPromise(req) {
    return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  }

  function lsReadAll(store) {
    try { return JSON.parse(localStorage.getItem(LS_COLLECTION_PREFIX + store) || '[]'); }
    catch (e) { console.warn('[CET] corrupt localStorage collection', store, e); return []; }
  }

  function lsWriteAll(store, arr) {
    localStorage.setItem(LS_COLLECTION_PREFIX + store, JSON.stringify(arr));
  }

  async function all(store) {
    if (mode === 'ls') return lsReadAll(store);
    const os = idbStore(store, false);
    return reqToPromise(os.getAll());
  }

  async function get(store, id) {
    if (mode === 'ls') return lsReadAll(store).find((r) => r.id === id) || null;
    const os = idbStore(store, false);
    return reqToPromise(os.get(id));
  }

  async function put(store, obj) {
    if (mode === 'ls') {
      const arr = lsReadAll(store);
      const i = arr.findIndex((r) => (store === 'meta' ? r.key : r.id) === (store === 'meta' ? obj.key : obj.id));
      if (i >= 0) arr[i] = obj; else arr.push(obj);
      lsWriteAll(store, arr);
      return obj;
    }
    const os = idbStore(store, true);
    await reqToPromise(os.put(obj));
    return obj;
  }

  async function putMany(store, objs) {
    if (mode === 'ls') {
      const arr = lsReadAll(store);
      for (const obj of objs) {
        const i = arr.findIndex((r) => (store === 'meta' ? r.key : r.id) === (store === 'meta' ? obj.key : obj.id));
        if (i >= 0) arr[i] = obj; else arr.push(obj);
      }
      lsWriteAll(store, arr);
      return objs;
    }
    const os = idbStore(store, true);
    // Issue all requests synchronously so the transaction never auto-commits between them,
    // then await completion of the batch.
    const reqs = objs.map((o) => os.put(o));
    await Promise.all(reqs.map(reqToPromise));
    return objs;
  }

  async function del(store, id) {
    if (mode === 'ls') {
      const arr = lsReadAll(store).filter((r) => (store === 'meta' ? r.key : r.id) !== id);
      lsWriteAll(store, arr);
      return;
    }
    const os = idbStore(store, true);
    await reqToPromise(os.delete(id));
  }

  async function clear(store) {
    if (mode === 'ls') { lsWriteAll(store, []); return; }
    const os = idbStore(store, true);
    await reqToPromise(os.clear());
  }

  async function clearAll() { for (const s of STORES) await clear(s); }

  async function getMeta(key) {
    if (mode === 'ls') {
      const arr = lsReadAll('meta');
      const r = arr.find((x) => x.key === key);
      return r ? r.value : undefined;
    }
    const os = idbStore('meta', false);
    const r = await reqToPromise(os.get(key));
    return r ? r.value : undefined;
  }

  async function setMeta(key, value) {
    return put('meta', { key, value });
  }

  return {
    open, all, get, put, putMany, del, clear, clearAll, getMeta, setMeta,
    get storageMode() { return mode; },
    STORES
  };
})();
