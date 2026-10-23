(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ReaderWorkspace = api;
})(globalThis, function () {
  "use strict";
  const DAY = 86400000, ZONE = "Asia/Ho_Chi_Minh";
  const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
  const dayKey = (time) => new Date(time + 7 * 3600000).toISOString().slice(0, 10);
  const isOnline = (device, presence = new Set(), now = Date.now()) => !device.revoked_at && (now - Date.parse(device.last_seen) < 90000 || presence.has(device.device_id));
  function validEvent(e) {
    return e && UUID.test(e.id) && ["read", "listen", "chapter"].includes(e.kind) && /^[a-z\d_-]{1,100}$/i.test(e.slug)
      && Number.isFinite(e.start) && Number.isFinite(e.end) && e.start >= 0 && e.end >= e.start && e.end - e.start <= 30000
      && Number.isFinite(e.interaction) && (!e.goalId || UUID.test(e.goalId)) && (e.kind !== "chapter" || typeof e.chapter === "string" && e.chapter.length <= 1024);
  }
  // Sweep interval boundaries once; the most recent interaction owns overlap.
  // A heap keeps this O(n log n), even for a whole year of offline activity.
  function aggregate(input, legacy = null, cutoff = 0, now = Date.now()) {
    const windowStart = Date.parse(dayKey(now) + "T00:00:00Z") - 7 * 3600000 - 365 * DAY;
    const days = {}, completed = new Set(), legacyCompleted = new Set(), goals = {}, seen = new Map(), points = [], active = new Set(), heap = [];
    const day = (key) => days[key] ||= { read: 0, listen: 0, series: {}, completed: [] };
    const goal = (id) => goals[id] ||= { seconds: 0, chapters: [] };
    for (const [key, value] of Object.entries(legacy?.days || {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key < dayKey(windowStart) || key > dayKey(now)) continue;
      const row = day(key); row.read = Math.max(0, Number(value.read) || 0); row.listen = Math.max(0, Number(value.listen) || 0);
      row.series = Object.fromEntries(Object.entries(value.series || {}).filter(([id, seconds]) => /^[a-z\d_-]{1,100}$/i.test(id) && Number.isFinite(seconds) && seconds >= 0));
      row.completed = [...new Set((value.completed || []).filter((v) => typeof v === "string"))]; row.completed.forEach((id) => { completed.add(id); legacyCompleted.add(id); });
    }
    for (const e of input) if (validEvent(e) && e.end >= Math.max(cutoff, windowStart) && e.end <= now + 300000) {
      if (!seen.has(e.id) || seen.get(e.id).end < e.end) seen.set(e.id, e);
    }
    const addChapter = (e) => {
      const row = day(dayKey(e.end)); if (!row.completed.includes(e.chapter)) row.completed.push(e.chapter); completed.add(e.chapter);
      if (e.goalId && !goal(e.goalId).chapters.includes(e.chapter)) goal(e.goalId).chapters.push(e.chapter);
    };
    for (const e of seen.values()) {
      if (e.kind === "chapter") { if (e.end <= now) addChapter(e); continue; }
      const start = Math.max(e.start, cutoff, windowStart), end = Math.min(e.end, now);
      if (end > start) { points.push({ time: start, add: e }, { time: end, remove: e.id }); }
    }
    points.sort((a, b) => a.time - b.time);
    const higher = (a, b) => a.interaction !== b.interaction ? a.interaction > b.interaction : a.id > b.id;
    const push = (e) => { heap.push(e); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (!higher(heap[i], heap[p])) break; [heap[i], heap[p]] = [heap[p], heap[i]]; i = p; } };
    const pop = () => {
      const last = heap.pop(); if (!heap.length) return; heap[0] = last;
      let i = 0; while (true) { let j = i, l = i * 2 + 1, r = l + 1; if (l < heap.length && higher(heap[l], heap[j])) j = l; if (r < heap.length && higher(heap[r], heap[j])) j = r; if (j === i) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; }
    };
    let previous = points[0]?.time;
    for (let i = 0; i < points.length;) {
      const time = points[i].time; while (heap.length && !active.has(heap[0].id)) pop();
      const winner = heap[0];
      if (winner && time > previous) {
        let start = previous;
        while (start < time) {
          const key = dayKey(start), end = Math.min(time, Date.parse(key + "T00:00:00Z") - 7 * 3600000 + DAY), seconds = (end - start) / 1000, row = day(key);
          row[winner.kind] += seconds; row.series[winner.slug] = (row.series[winner.slug] || 0) + seconds;
          if (winner.goalId) goal(winner.goalId).seconds += seconds;
          start = end;
        }
      }
      while (i < points.length && points[i].time === time) { const p = points[i++]; if (p.remove) active.delete(p.remove); else { active.add(p.add.id); push(p.add); } }
      previous = time;
    }
    const today = dayKey(now), qualifying = (key) => (days[key]?.read || 0) + (days[key]?.listen || 0) >= 60;
    let streak = 0, cursor = Date.parse(today + "T00:00:00Z") - 7 * 3600000;
    if (!qualifying(today)) cursor -= DAY;
    while (qualifying(dayKey(cursor))) { streak++; cursor -= DAY; }
    const total = Object.values(days).reduce((sum, d) => sum + d.read + d.listen, 0);
    return { days, goals, streak, completed: Math.max(legacyCompleted.size, Number(legacy?.completedTotal) || 0) + [...completed].filter((id) => !legacyCompleted.has(id)).length, total, zone: ZONE, legacy: Boolean(legacy) };
  }
  function createJournal() {
    let database, queue = Promise.resolve();
    const open = async () => database ||= await new Promise((resolve, reject) => {
      const request = indexedDB.open("ketruyen-workspace-v1", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("state"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const access = async (owner, update) => {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("state", update ? "readwrite" : "readonly"), store = tx.objectStore("state"), request = store.get(owner); let value;
        request.onsuccess = () => {
          try { value = request.result || { events: {}, pending: {}, revision: 0, meta: null }; if (update) { update(value); store.put(value, owner); } }
          catch (error) { reject(error); tx.abort(); }
        };
        tx.oncomplete = () => resolve(value); tx.onerror = tx.onabort = () => reject(tx.error || new Error("Không lưu được hoạt động đọc."));
      });
    };
    return (owner, update) => { const result = queue.then(() => access(owner, update)); queue = result.catch(() => {}); return result; };
  }
  let owner = null, summary = null;
  const journal = typeof indexedDB === "undefined" ? null : createJournal();
  async function record(event) {
    if (!owner || !journal || !validEvent(event)) return;
    const target = owner;
    const state = await journal(target, (s) => { s.events[event.id] = event; s.pending[event.id] = event; });
    if (target === owner) {
      summary = aggregate(Object.values(state.events), state.meta?.legacy, state.meta?.cutover_ms || 0);
      globalThis.dispatchEvent(new Event("ketruyen-stats-updated"));
      globalThis.dispatchEvent(new Event("ketruyen-workspace-change"));
    }
  }
  return { DAY, ZONE, UUID, dayKey, isOnline, aggregate, validEvent, journal, record,
    setOwner(value) { if (owner !== value) summary = null; owner = value; }, owner: () => owner,
    setSummary(value) { summary = value; globalThis.dispatchEvent(new Event("ketruyen-stats-updated")); }, summary: () => summary };
});
