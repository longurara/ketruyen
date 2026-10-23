(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ReaderJournal = api;
})(globalThis, function () {
  "use strict";
  const PREFIX = "tenshi-journal-", UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
  const SLUG = /^[a-z\d_-]{1,100}$/i, PHASES = { expectation: "Kỳ vọng", during: "Khi đang đọc", finished: "Sau khi đọc" };
  const STATES = { reading: "Đang đọc", paused: "Tạm dừng", abandoned: "Bỏ dở", completed: "Hoàn thành" };
  const object = (v) => v && typeof v === "object" && !Array.isArray(v);
  const string = (v, max) => typeof v === "string" && v.length <= max;
  function dayKey(at = Date.now()) { return new Date(at + 7 * 3600000).toISOString().slice(0, 10); }
  function date(v) { return v === "" || typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v; }
  function valid(id, v) {
    if (!UUID.test(id)) return false;
    if (v === null) return true;
    if (!object(v) || v.id !== id || !SLUG.test(v.slug) || !string(v.title, 250) || !v.title.trim() || !string(v.author, 150) || !["book", "volume"].includes(v.scope)
      || (v.scope === "book" ? v.volIdx !== null : !Number.isInteger(v.volIdx) || v.volIdx < 0 || v.volIdx > 5000) || !string(v.volume, 200)
      || !Number.isFinite(v.createdAt) || v.createdAt < 0 || !Number.isFinite(v.updatedAt) || v.updatedAt < 0 || JSON.stringify(v).length > 200000) return false;
    if (v.kind === "run") return Number.isInteger(v.round) && v.round > 0 && v.round <= 100000 && date(v.startedOn) && date(v.completedOn) && !(v.startedOn && v.completedOn && v.completedOn < v.startedOn) && Object.hasOwn(STATES, v.status) && string(v.reason, 2000)
      && Array.isArray(v.completed) && v.completed.length <= 20000 && v.completed.every((id) => typeof id === "string" && /^\d{1,4}:\d{1,6}$/.test(id));
    if (v.kind === "event") return UUID.test(v.runId) && ["paused", "abandoned", "resumed"].includes(v.event) && date(v.on) && v.on !== "" && string(v.reason, 2000);
    return v.kind === "entry" && UUID.test(v.runId) && Object.hasOwn(PHASES, v.phase) && date(v.on) && v.on !== "" && (v.rating === null || Number.isInteger(v.rating) && v.rating >= 1 && v.rating <= 5)
      && string(v.text, 12000) && Array.isArray(v.moods) && v.moods.length <= 8 && v.moods.every((s) => string(s, 40) && s.trim())
      && Array.isArray(v.attachments) && v.attachments.length <= 12 && v.attachments.every((a) => object(a) && ["quote", "note", "character"].includes(a.type) && string(a.label, 160) && string(a.text, 2000)
        && (a.volIdx === null || Number.isInteger(a.volIdx) && a.volIdx >= 0) && (a.chapIdx === null || Number.isInteger(a.chapIdx) && a.chapIdx >= 0))
      && (v.location === null || object(v.location) && Number.isInteger(v.location.volIdx) && v.location.volIdx >= 0 && Number.isInteger(v.location.chapIdx) && v.location.chapIdx >= 0 && Number.isInteger(v.location.p) && v.location.p >= 0);
  }
  function records(storage) {
    const result = {};
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i), id = key.startsWith(PREFIX) ? key.slice(PREFIX.length) : "";
      if (!UUID.test(id)) continue;
      const value = JSON.parse(storage.getItem(key));
      if (!valid(id, value)) throw new Error("Nhật ký trên máy chưa đúng định dạng. Hãy khôi phục bản sao lưu hợp lệ.");
      result["journal/" + id] = value;
    }
    return result;
  }
  function apply(storage, updates) {
    const previous = new Map();
    for (const [key, value] of Object.entries(updates)) if (!key.startsWith("journal/") || !valid(key.slice(8), value)) throw new Error("Nội dung nhật ký không hợp lệ.");
    try {
      for (const [key, value] of Object.entries(updates)) { const name = PREFIX + key.slice(8); previous.set(name, storage.getItem(name)); storage.setItem(name, JSON.stringify(value)); }
    } catch (error) {
      for (const key of previous.keys()) storage.removeItem(key);
      for (const [key, value] of previous) if (value !== null) storage.setItem(key, value);
      throw error;
    }
  }
  function values(storage) { return Object.values(records(storage)).filter(Boolean); }
  async function defaultId(slug, scope, volIdx) {
    const bytes = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(`ketruyen-journal:${slug}:${scope}:${volIdx ?? "all"}:1`))).slice(0, 16);
    bytes[6] = (bytes[6] & 15) | 80; bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  function newRun(book, scope, volIdx, id, round = 1, now = Date.now()) {
    return { id, kind: "run", slug: book.slug, title: book.titleVi, author: book.author || "", scope, volIdx: scope === "book" ? null : volIdx,
      volume: scope === "volume" ? String(book.volumesData?.[volIdx]?.name || book.volumesData?.[volIdx]?.title || `Tập ${volIdx + 1}`).slice(0, 200) : "Cả bộ", round, startedOn: dayKey(now), completedOn: "", completed: [], status: "reading", reason: "", createdAt: now, updatedAt: now };
  }
  function mergeRun(key, local, remote, base) {
    if (!key.startsWith("journal/") || local?.kind !== "run" || remote?.kind !== "run") return undefined;
    const out = {}, equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    for (const field of new Set([...Object.keys(local), ...Object.keys(remote)])) {
      const a = local[field], b = remote[field], original = base?.[field];
      if (field === "completed") out[field] = [...new Set([...a, ...b])].sort();
      else if (equal(a, b)) out[field] = a;
      else if (equal(a, original)) out[field] = b;
      else if (equal(b, original)) out[field] = a;
      else if (field === "createdAt") out[field] = Math.min(a, b);
      else if (field === "updatedAt") out[field] = Math.max(a, b);
      else if (!base && ["startedOn", "completedOn"].includes(field)) out[field] = [a, b].filter(Boolean).sort()[0] || "";
      else if (!base && field === "status" && [a, b].includes("reading")) out[field] = a === "reading" ? b : a;
      else if (!base && field === "reason" && (!a || !b)) out[field] = a || b;
      else return undefined;
    }
    return valid(out.id, out) ? out : undefined;
  }
  function timeline(items) {
    const result = [];
    for (const v of items) {
      if (v.kind === "entry") result.push({ ...v, event: "entry", on: v.on });
      else if (v.kind === "event") result.push(v);
      else {
        if (v.startedOn) result.push({ ...v, event: v.round > 1 ? "reread" : "start", on: v.startedOn, reason: "" });
        if (v.completedOn) result.push({ ...v, event: "complete", on: v.completedOn, reason: "" });
      }
    }
    return result.sort((a, b) => b.on.localeCompare(a.on) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }
  function advanceRun(run, book, chapters, finished, now = Date.now()) {
    if (run.completedOn || ["paused", "abandoned"].includes(run.status) || !finished.length) return run;
    const volumes = run.scope === "book" ? book.volumesData : [book.volumesData[run.volIdx]];
    const ids = volumes.flatMap((v, i) => v.chapters.map((c, ci) => c.isIllustration ? null : `${run.scope === "book" ? i : run.volIdx}:${ci}`)).filter(Boolean);
    const valid = new Set(ids), completed = [...new Set([...run.completed, ...finished.filter((id) => valid.has(id))])].sort();
    const done = ids.length > 0 && ids.every((id) => run.round === 1 ? chapters[id]?.done : completed.includes(id));
    if (!done && completed.length === run.completed.length) return run;
    return { ...run, completed, ...(done ? { status: "completed", completedOn: dayKey(now) } : {}), updatedAt: now };
  }
  function summary(items, period) {
    const entries = items.filter((v) => v.kind === "entry" && v.on.startsWith(period)), completed = items.filter((v) => v.kind === "run" && v.completedOn.startsWith(period) && v.completedOn);
    const rated = entries.filter((v) => v.rating !== null), moods = {};
    for (const v of entries) for (const mood of v.moods) moods[mood] = (moods[mood] || 0) + 1;
    return { entries, books: completed.filter((r) => r.scope === "book").length, volumes: completed.filter((r) => r.scope === "volume").length,
      rating: rated.length ? rated.reduce((sum, v) => sum + v.rating, 0) / rated.length : null, moods: Object.entries(moods).sort((a, b) => b[1] - a[1]), quotes: entries.flatMap((v) => v.attachments.filter((a) => a.type === "quote").map((a) => ({ ...a, title: v.title }))) };
  }
  function memories(items, now = Date.now()) {
    const today = dayKey(now), anniversary = (on) => on < today && on.slice(0, 4) < today.slice(0, 4) && (on.slice(5) === today.slice(5) || on.slice(5) === "02-29" && today.slice(5) === "03-01" && !date(today.slice(0, 4) + "-02-29"));
    return timeline(items).filter((v) => anniversary(v.on) && ["entry", "complete"].includes(v.event));
  }
  function markdown(entries, options = {}) {
    const lines = ["# Nhật ký đọc · Kệ truyện", ""];
    for (const v of entries.filter((r) => r.kind === "entry")) {
      const safe = (s) => String(s).replace(/[\r\n]/g, " ").replace(/([\\`*_{}<>#])/g, "\\$1").replaceAll("[", "\\[").replaceAll("]", "\\]");
      lines.push(`## ${safe(v.title)} · ${safe(v.volume)}`, "", `${v.on} · ${PHASES[v.phase]}${v.rating ? ` · ${v.rating}/5 sao` : ""}`, "");
      if (v.moods.length) lines.push(v.moods.map(safe).join(" · "), "");
      lines.push(v.text, "");
      if (options.attachments) for (const a of v.attachments) lines.push(`### ${safe(a.label)}`, "", ...a.text.split("\n").map((line) => "> " + safe(line)), "");
    }
    return lines.join("\n");
  }
  return { PREFIX, UUID, PHASES, STATES, dayKey, date, valid, records, apply, values, defaultId, newRun, advanceRun, mergeRun, timeline, summary, memories, markdown };
});
