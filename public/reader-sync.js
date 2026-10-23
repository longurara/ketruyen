(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./reader-journal") : root.ReaderJournal);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ReaderSync = api;
})(globalThis, function (journalCore) {
  "use strict";
  const AUTH_KEY = "ketruyen-auth-v1", LINK_KEY = "ketruyen-sync-link-v1";
  const object = (value) => value && typeof value === "object" && !Array.isArray(value);
  const equal = (a, b) => canonical(a ?? null) === canonical(b ?? null);
  function canonical(value) {
    if (Array.isArray(value)) return JSON.stringify(value.map((v) => JSON.parse(canonical(v))));
    if (object(value)) return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map((key) => [key, JSON.parse(canonical(value[key]))])));
    return JSON.stringify(value);
  }
  function validRecord(key, value) {
    if (typeof key === "string" && key.startsWith("journal/")) return Boolean(journalCore?.valid(key.slice(8), value));
    if (key === "goal/current") return value === null || object(value) && Object.keys(value).every((k) => ["id", "kind", "target", "startedAt"].includes(k)) && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value.id) && ["minutes", "chapters"].includes(value.kind) && Number.isInteger(value.target) && value.target >= 1 && value.target <= (value.kind === "minutes" ? 240 : 50) && Number.isFinite(value.startedAt);
    if (typeof key !== "string" || key.length > 300 || !/^(progress|chapter|history|favorite|status|groups|mark)\/[a-z\d_:/-]+$/i.test(key)) return false;
    if (value === undefined) return false;
    if (JSON.stringify(value).length > 524288) return false;
    const type = key.split("/")[0], slug = /^[a-z\d_-]{1,100}$/i;
    if (key.split("/").length !== (["chapter", "history"].includes(type) ? 3 : 2)) return false;
    if (["favorite", "status", "groups", "mark"].includes(type) && (!slug.test(key.split("/")[1]) || ["__proto__", "constructor", "prototype"].includes(key.split("/")[1]))) return false;
    if (!["favorite", "status", "groups", "mark"].includes(type) && !/^tenshi(?:-[a-z\d_-]{1,100})?$/i.test(key.split("/")[1])) return false;
    if (["chapter", "history"].includes(type) && !/^\d+:\d+$/.test(key.split("/")[2])) return false;
    if (value === null) return true;
    if (type === "favorite") return typeof value === "boolean";
    if (type === "status") return ["", "want", "reading", "done"].includes(value);
    if (type === "groups") return Array.isArray(value) && value.length <= 10 && value.every((v) => typeof v === "string" && v.length <= 60);
    if (type === "mark") return object(value) && value.id === key.slice(5) && slug.test(value.slug) && Number.isInteger(value.volIdx) && value.volIdx >= 0 && Number.isInteger(value.chapIdx) && value.chapIdx >= 0 && (!value.note || typeof value.note === "string");
    if (!object(value)) return false;
    if (type === "chapter") return /^\d+:\d+$/.test(key.split("/")[2]) && (value.pct === undefined || (Number.isFinite(value.pct) && value.pct >= 0 && value.pct <= 100));
    return Number.isInteger(value.volIdx) && value.volIdx >= 0 && Number.isInteger(value.chapIdx) && value.chapIdx >= 0 && Number.isFinite(value.timestamp) && (type !== "history" || key.split("/")[2] === `${value.volIdx}:${value.chapIdx}`);
  }
  function readLocal(storage) {
    const records = {};
    const add = (key, value) => { if (!validRecord(key, value)) throw new Error("Dữ liệu đọc trên máy chưa hợp lệ; chưa gửi lên đám mây."); records[key] = value; };
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i), match = /^(tenshi(?:-[a-z\d_-]{1,100})?)-(progress|chapters|history)$/i.exec(key);
      if (!match) continue;
      const value = JSON.parse(storage.getItem(key));
      if (value === null) continue;
      const [, prefix, type] = match;
      if (type === "progress") add(`progress/${prefix}`, value);
      if (type === "chapters") {
        if (!object(value)) throw new Error("Tiến độ chương trên máy chưa hợp lệ.");
        for (const [id, row] of Object.entries(value)) add(`chapter/${prefix}/${id}`, row);
      }
      if (type === "history") {
        if (!Array.isArray(value)) throw new Error("Lịch sử đọc trên máy chưa hợp lệ.");
        for (const row of value) add(`history/${prefix}/${row.volIdx}:${row.chapIdx}`, row);
      }
    }
    const library = JSON.parse(storage.getItem("tenshi-library-v1") || "null");
    if (library) {
      if (library.version !== 1 || !object(library.books) || !Array.isArray(library.marks)) throw new Error("Kệ sách trên máy chưa hợp lệ.");
      for (const [slug, book] of Object.entries(library.books)) {
        add(`favorite/${slug}`, book.favorite === true); add(`status/${slug}`, book.status === null ? null : book.status || ""); add(`groups/${slug}`, book.groups || []);
      }
      for (const mark of library.marks) add(`mark/${mark.id}`, mark);
    }
    const goal = storage.getItem("tenshi-cloud-goal-v1"); if (goal) add("goal/current", JSON.parse(goal));
    return records;
  }
  function applyLocal(storage, updates, preserve = {}) {
    const writes = new Map(), previous = new Map();
    const get = (key, fallback) => {
      if (!writes.has(key)) writes.set(key, JSON.parse(storage.getItem(key) || "null") ?? fallback);
      return writes.get(key);
    };
    for (const [key, value] of Object.entries(updates)) {
      if (!validRecord(key, value)) throw new Error("Dữ liệu đồng bộ không đúng định dạng.");
      const [type, prefix, id] = key.split("/");
      if (type === "goal") writes.set("tenshi-cloud-goal-v1", value);
      else if (type === "progress") writes.set(`${prefix}-progress`, value);
      else if (type === "chapter") {
        const chapters = get(`${prefix}-chapters`, {});
        if (value === null) delete chapters[id]; else chapters[id] = value;
      } else if (type === "history") {
        const name = `${prefix}-history`, history = get(name, []).filter((r) => `${r.volIdx}:${r.chapIdx}` !== id);
        if (value !== null) history.push(value);
        writes.set(name, history.sort((a, b) => b.timestamp - a.timestamp).slice(0, 8));
      } else {
        const library = get("tenshi-library-v1", { version: 1, books: {}, marks: [] });
        if (type === "mark") {
          if (preserve[key]) (library.versions ||= []).push({ id: crypto.randomUUID(), markId: prefix, value: preserve[key], deleted: false, at: Date.now(), uploaded: false });
          library.marks = library.marks.filter((m) => m.id !== prefix);
          if (value !== null) library.marks.push(value);
        } else {
          if (!Object.hasOwn(library.books, prefix)) library.books[prefix] = { favorite: false, status: "", groups: [] };
          const book = library.books[prefix];
          book[type] = type === "status" && value === null ? null : value ?? (type === "favorite" ? false : type === "groups" ? [] : "");
        }
      }
    }
    try {
      for (const [key, value] of writes) {
        previous.set(key, storage.getItem(key));
        if (value === null) storage.removeItem(key); else storage.setItem(key, JSON.stringify(value));
      }
    } catch (error) {
      for (const key of previous.keys()) storage.removeItem(key);
      for (const [key, value] of previous) if (value !== null) storage.setItem(key, value);
      throw error;
    }
    return writes.size > 0;
  }
  function newState(owner) { return { owner, baseline: {}, pending: {}, conflicts: {} }; }
  function stage(state, local) {
    for (const key of new Set([...Object.keys(local), ...Object.keys(state.baseline)])) {
      const value = local[key] ?? null, base = state.baseline[key];
      if (equal(value, base?.value) && (base || !Object.hasOwn(local, key) || value !== null)) { delete state.pending[key]; delete state.conflicts[key]; }
      else state.pending[key] = { value, expected_revision: base?.revision || 0 };
    }
  }
  function mergeReading(key, local, remote, base, hasBase = true) {
    const type = key.split("/")[0];
    if (!["progress", "chapter", "history"].includes(type)) return undefined;
    // A tombstone is an intentional reset, not a smaller reading percentage.
    // Reading may start again after a device has actually seen that reset.
    if (local === null || remote === null) {
      if (local === null && remote === null) return null;
      return hasBase && base === null ? (local ?? remote) : null;
    }
    const number = (v) => Number.isFinite(v) ? v : 0;
    const rank = (v) => type === "chapter" ? [number(v.pct), number(v.block), number(v.textOffset), number(v.offset)] : [v.volIdx, v.chapIdx];
    const a = rank(local), b = rank(remote);
    let order = 0;
    for (let i = 0; i < a.length && !order; i++) order = Math.sign(a[i] - b[i]);
    const winner = order > 0 ? local : order < 0 ? remote : canonical(local) > canonical(remote) ? local : remote;
    if (type === "chapter") return local.done === true || remote.done === true ? { ...winner, done: true } : winner;
    return { ...winner, timestamp: Math.max(local.timestamp, remote.timestamp) };
  }
  async function synchronize(state, io) {
    const merge = io.merge || mergeReading;
    const capture = () => stage(state, io.read());
    capture(); await io.save(state); // Durable outbox before attempting the network.
    const rows = await io.pull();
    capture();
    const updates = {}, accepted = [], local = io.read();
    for (const row of rows) {
      if (!validRecord(row.record_key, row.value) || !Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error("Dữ liệu đồng bộ không đúng định dạng.");
      const pending = state.pending[row.record_key];
      if (pending || Object.hasOwn(local, row.record_key)) {
        const merged = merge(row.record_key, local[row.record_key] ?? null, row.value, state.baseline[row.record_key]?.value, Object.hasOwn(state.baseline, row.record_key));
        if (merged !== undefined) {
          if (!equal(local[row.record_key], merged)) updates[row.record_key] = merged;
          accepted.push(row); continue;
        }
      }
      if (pending && !equal(pending.value, row.value)) {
        if (pending.expected_revision !== row.revision) state.conflicts[row.record_key] = row;
        continue;
      }
      if (!Object.hasOwn(state.baseline, row.record_key) || !equal(state.baseline[row.record_key]?.value, row.value)) updates[row.record_key] = row.value;
      accepted.push(row);
    }
    if (Object.keys(updates).length) io.apply(updates);
    for (const row of accepted) { state.baseline[row.record_key] = row; delete state.pending[row.record_key]; delete state.conflicts[row.record_key]; }
    capture();
    await io.save(state);
    let changes = Object.entries(state.pending).filter(([key]) => !state.conflicts[key]).map(([key, value]) => ({ key, ...value }));
    let uploaded = 0;
    for (let round = 0; round < 3 && changes.length; round++) {
      const retry = new Set();
      for (let offset = 0; offset < changes.length; offset += 100) {
        const replies = await io.push(changes.slice(offset, offset + 100));
        for (const row of replies) {
          if (!validRecord(row.record_key, row.value) || !Number.isSafeInteger(row.revision) || row.revision < 0) throw new Error("Phản hồi đồng bộ không hợp lệ.");
          if (row.applied || equal(state.pending[row.record_key]?.value, row.value)) {
            if (row.applied) uploaded++;
            state.baseline[row.record_key] = row; delete state.pending[row.record_key]; delete state.conflicts[row.record_key];
          } else {
            const current = io.read()[row.record_key] ?? null;
            const merged = row.revision > 0 ? merge(row.record_key, current, row.value, state.baseline[row.record_key]?.value, Object.hasOwn(state.baseline, row.record_key)) : undefined;
            if (merged === undefined) state.conflicts[row.record_key] = row;
            else {
              if (!equal(current, merged)) { io.apply({ [row.record_key]: merged }); updates[row.record_key] = merged; }
              state.baseline[row.record_key] = row; delete state.pending[row.record_key]; delete state.conflicts[row.record_key]; retry.add(row.record_key);
            }
          }
        }
        capture(); await io.save(state);
      }
      changes = [...retry].filter((key) => state.pending[key] && !state.conflicts[key]).map((key) => ({ key, ...state.pending[key] }));
    }
    const pending = Object.keys(state.pending).length, conflicts = Object.keys(state.conflicts).length, downloaded = Object.keys(updates).length;
    state.lastCheckedAt = Date.now(); state.lastTransfer = { uploaded, downloaded };
    if (!pending && !conflicts) state.lastSyncedAt = state.lastCheckedAt;
    await io.save(state);
    return { pending, conflicts, uploaded, downloaded, changed: downloaded > 0 };
  }
  function journal() {
    let db;
    async function open() {
      if (!db) db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("ketruyen-sync-v1", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("state");
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      return db;
    }
    return async (owner, value) => {
      const database = await open();
      return new Promise((resolve, reject) => {
        const tx = database.transaction("state", value ? "readwrite" : "readonly"), store = tx.objectStore("state");
        const request = value ? store.put(value, owner) : store.get(owner);
        tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
    };
  }
  return { AUTH_KEY, LINK_KEY, canonical, validRecord, readLocal, applyLocal, newState, stage, mergeReading, synchronize, journal };
});
