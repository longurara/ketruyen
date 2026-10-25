(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./reader-sync") : root.ReaderSync);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WorkbenchSync = api;
})(globalThis, function (sync) {
  "use strict";
  const KEY = "tenshi-workbench-v1", TYPES = { glossary: "glossary", vocabulary: "vocabulary", profile: "profiles" };
  const LIMITS = { glossary: 1000, vocabulary: 1000, profiles: 12 };
  const object = (v) => v && typeof v === "object" && !Array.isArray(v);
  const idValid = (v) => typeof v === "string" && /^[a-z\d_-]{1,80}$/i.test(v) && !["__proto__", "constructor", "prototype"].includes(v);
  const exact = (v, keys) => object(v) && Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key));
  const text = (v, min, max) => typeof v === "string" && v.length >= min && v.length <= max && (min === 0 || v.trim().length > 0);
  const number = (v, min, max) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  const integer = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;
  function valid(key, value) {
    if (typeof key !== "string") return false;
    const [type, id, extra] = key.split("/");
    if (!Object.hasOwn(TYPES, type) || !idValid(id) || extra !== undefined) return false;
    if (value === null) return true;
    if (!object(value) || value.id !== id) return false;
    if (type === "profile") {
      const s = value.settings;
      return exact(value, ["id", "name", "settings"]) && text(value.name, 1, 60)
        && exact(s, ["fontSize", "lineHeight", "fontFamily", "theme", "imageMode", "eink", "continuous", "tap", "layout"])
        && number(s.fontSize, 16, 28) && number(s.lineHeight, 1.4, 2.6) && ["serif", "sans", "system"].includes(s.fontFamily)
        && ["light", "sepia", "dark"].includes(s.theme) && ["color", "mono"].includes(s.imageMode)
        && [s.eink, s.continuous, s.tap].every((v) => typeof v === "boolean")
        && exact(s.layout, ["width", "margin", "gap"]) && number(s.layout.width, 460, 1100) && number(s.layout.margin, 12, 64) && number(s.layout.gap, 0.4, 2);
    }
    return exact(value, ["id", "slug", "term", "meaning", "sentence", "volIdx", "chapIdx", "p", ...(type === "vocabulary" ? ["level", "due", "added"] : [])])
      && typeof value.slug === "string" && /^[a-z\d_-]{1,100}$/i.test(value.slug) && !["__proto__", "constructor", "prototype"].includes(value.slug)
      && text(value.term, 1, 80) && text(value.meaning, 1, 1000) && text(value.sentence, 0, 1200)
      && integer(value.volIdx, 3000) && integer(value.chapIdx, 3000) && integer(value.p, 100000)
      && (type !== "vocabulary" || integer(value.level, 6) && number(value.due, 0, 1e15) && number(value.added, 0, 1e15));
  }
  function readState(storage) {
    const value = JSON.parse(storage.getItem(KEY) || '{"version":1,"glossary":[],"vocabulary":[],"profiles":[]}');
    if (!object(value) || value.version !== 1) throw new Error("Dữ liệu sổ từ và hồ sơ đọc chưa hợp lệ.");
    return value;
  }
  function records(state) {
    const result = {};
    for (const [type, field] of Object.entries(TYPES)) {
      if (!Array.isArray(state[field]) || state[field].length > LIMITS[field]) throw new Error("Vượt giới hạn 1.000 chú giải, 1.000 từ hoặc 12 hồ sơ. Hãy xuất dữ liệu và giảm số mục trước khi đồng bộ.");
      for (const value of state[field]) {
        const key = type + "/" + value?.id;
        if (!valid(key, value) || Object.hasOwn(result, key)) throw new Error("Dữ liệu sổ từ và hồ sơ đọc chưa hợp lệ; bản trên máy vẫn được giữ.");
        result[key] = value;
      }
    }
    return result;
  }
  const read = (storage) => records(readState(storage));
  function initialize(storage, normalize) {
    const raw = storage.getItem(KEY), previous = raw === null ? null : JSON.parse(raw), state = normalize(previous);
    for (const field of Object.values(TYPES)) {
      if (previous && Object.hasOwn(previous, field) && (!Array.isArray(previous[field]) || previous[field].length !== state[field].length)) throw new Error("Dữ liệu tiện ích cần kiểm tra. Hãy xuất ZIP trước khi sửa; bản gốc trên máy vẫn được giữ.");
      const ids = new Set();
      for (const value of state[field]) { if (!idValid(value.id) || ids.has(value.id)) value.id = crypto.randomUUID(); ids.add(value.id); }
    }
    records(state);
    const serialized = JSON.stringify(state); if (serialized !== raw) storage.setItem(KEY, serialized);
    return state;
  }
  function apply(storage, updates) {
    const state = readState(storage);
    for (const [key, value] of Object.entries(updates)) {
      if (!valid(key, value)) throw new Error("Dữ liệu tiện ích đồng bộ không đúng định dạng.");
      const [type, id] = key.split("/"), field = TYPES[type];
      state[field] = (state[field] || []).filter((v) => v.id !== id);
      if (value !== null) state[field].push(value);
    }
    records(state); // Validate the entire result before the single atomic localStorage write.
    storage.setItem(KEY, JSON.stringify(state));
  }
  // Merge only edits made by this view, keeping records received while a form was open.
  function commit(storage, previous, next) {
    const before = records(previous), after = records(next), current = read(storage), updates = {};
    let copied = false;
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (sync.canonical(before[key] ?? null) === sync.canonical(after[key] ?? null)) continue;
      const value = after[key] ?? null;
      if (sync.canonical(current[key] ?? null) !== sync.canonical(before[key] ?? null) && sync.canonical(current[key] ?? null) !== sync.canonical(value)) {
        if (value === null) throw new Error("Mục này đã thay đổi trên máy khác. Hãy kiểm tra lại trước khi xóa.");
        const id = crypto.randomUUID(); updates[key.split("/")[0] + "/" + id] = { ...value, id }; copied = true;
      } else updates[key] = value;
    }
    const latest = readState(storage);
    for (const field of ["inline", "quick", "footer"]) if (sync.canonical(previous[field] ?? null) !== sync.canonical(next[field] ?? null)) latest[field] = next[field];
    for (const [key, value] of Object.entries(updates)) {
      const [type, id] = key.split("/"), field = TYPES[type];
      latest[field] = latest[field].filter((v) => v.id !== id);
      if (value !== null) latest[field].push(value);
    }
    records(latest); storage.setItem(KEY, JSON.stringify(latest));
    return { state: latest, copied };
  }
  function create(options) {
    const storage = options.storage, journal = options.journal || sync.journal();
    let owner = "", session = "", epoch = 0, state = null, busy = false, cloud, message = "Lưu trên máy. Bật đồng bộ để dùng sổ từ và hồ sơ trên các máy.";
    const snapshot = () => ({ owner, busy, message, pending: Object.keys(state?.pending || {}).length, conflicts: structuredClone(state?.conflicts || {}) });
    const paint = () => options.onStatus?.(snapshot());
    function setContext(id = "", key = "") {
      if (owner === id && session === key) return;
      owner = id; session = key; epoch++; state = null; busy = false;
      message = owner ? "Đang chờ đồng bộ sổ từ, chú giải và hồ sơ đọc…" : "Lưu trên máy. Bật đồng bộ để dùng sổ từ và hồ sơ trên các máy."; paint();
    }
    function changed(online = true) {
      if (!owner) return;
      if (state) sync.stage(state, read(storage));
      message = online ? "Đã lưu trên máy · Đang chờ kiểm tra đồng bộ tiện ích." : "Đã lưu trên máy · Đang offline; sẽ đồng bộ sổ từ và hồ sơ khi có mạng."; paint();
    }
    async function flush(api) {
      const own = owner, token = epoch;
      if (!own || own !== api.owner) return { pending: 0, conflicts: 0 };
      const guard = () => { api.guard(); if (own !== owner || token !== epoch) throw new Error("sync-cancelled"); };
      busy = true; paint();
      try {
        const saved = await journal(own + ":workbench"); guard(); state = saved || sync.newState(own);
        if (state.owner !== own) throw new Error("Nhật ký tiện ích không khớp tài khoản.");
        const result = await sync.synchronize(state, {
          valid, merge: () => undefined,
          read: () => { guard(); return read(storage); },
          save: (value) => { guard(); return journal(own + ":workbench", value); },
          apply: (updates) => { guard(); apply(storage, updates); options.onApplied?.(); },
          pull: async () => {
            const rows = [];
            for (let from = 0; ; from += 500) {
              guard(); const data = await api.request(api.client.from("reader_workbench_records").select("record_key,value,revision").eq("user_id", own).order("record_key").range(from, from + 499)); guard();
              rows.push(...data); if (data.length < 500) return rows;
            }
          },
          push: async (changes) => { guard(); const data = await api.request(api.client.rpc("reader_workbench_apply", { changes })); guard(); return data; }
        });
        guard(); message = result.conflicts ? `${result.conflicts} mục có hai bản thay đổi. Chọn bản giữ lại bên dưới.` : result.pending ? "Còn tiện ích chờ gửi; sẽ tự thử lại." : "Đã đồng bộ sổ từ, chú giải và hồ sơ đọc. Hồ sơ chỉ áp dụng khi bạn chọn.";
        return result;
      } catch (error) {
        if (token !== epoch || error.message === "sync-cancelled") return { pending: 0, conflicts: 0 };
        if (/device-revoked/.test(error.message || "")) throw error;
        message = ["PGRST202", "PGRST205", "42P01"].includes(error.code)
          ? "Đã lưu trên máy. Máy chủ chưa bật đồng bộ sổ từ và hồ sơ; cần migration 0007. Dữ liệu đọc khác vẫn đồng bộ."
          : `Đã lưu trên máy · ${error.message || "Sẽ đồng bộ lại khi có mạng."}`;
        return { pending: Object.keys(state?.pending || {}).length, conflicts: Object.keys(state?.conflicts || {}).length, unavailable: true };
      } finally { if (token === epoch) { busy = false; paint(); } }
    }
    async function resolve(key, remoteChoice) {
      const token = epoch, own = owner;
      if (!own || !cloud || busy) return;
      try {
        await cloud.exclusive(async () => {
          const guard = () => { if (token !== epoch || own !== owner) throw new Error("sync-cancelled"); };
          guard(); const saved = await journal(own + ":workbench"); guard();
          const remote = saved?.conflicts[key]; if (!remote) return;
          if (saved.owner !== own) throw new Error("Nhật ký tiện ích không khớp tài khoản.");
          if (remoteChoice) { apply(storage, { [key]: remote.value }); options.onApplied?.(); }
          saved.baseline[key] = remote; delete saved.conflicts[key]; sync.stage(saved, read(storage));
          guard(); await journal(own + ":workbench", saved); guard(); state = saved;
        });
        if (token === epoch) { paint(); cloud.schedule(0); }
      } catch (error) { if (token === epoch && error.message !== "sync-cancelled") { message = error.message; paint(); } }
    }
    return { setContext, flush, resolve, snapshot, changed, connect: (api) => { cloud = api; } };
  }
  return { KEY, TYPES, valid, read, initialize, records, apply, commit, create, idValid };
});
