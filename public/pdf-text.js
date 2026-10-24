(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PdfText = api;
})(globalThis, function () {
  "use strict";
  const median = (values) => { const sorted = values.filter((v) => v > 0).sort((a,b) => a-b); return sorted[Math.floor(sorted.length / 2)] || 12; };
  const clean = (value) => String(value || "").normalize("NFC").replace(/\u0000/g, "").replace(/[\t \u00a0]+/g, " ").trim();
  const heading = (text) => text.length < 160 && /^(?:(?:chương|chapter|phần|part)\s+(?:\d+[a-z]?|[ivxlcdm]+)(?=$|[\s.:：–—-])|lời (?:mở đầu|kết|bạt)$|prologue$|epilogue$)/iu.test(text);
  const scene = (text) => /^(?:[★☆*◇❖✦✧•·]\s*){3,}$|^[-—_~]{3,}$/.test(text);
  function pageLines(items, width, height) {
    const rows = [];
    for (const item of [...items].filter((v) => typeof v.str === "string" && v.str.trim()).sort((a,b) => a.y-b.y || a.x-b.x)) {
      const h = Math.max(1, item.h || 12);
      let row = rows.at(-1);
      if (!row || Math.abs(row.y - item.y) > Math.min(row.h, h) * .35) { row = { y:item.y, h, items:[], segments:0 }; rows.push(row); }
      row.items.push(item); row.h = Math.max(row.h, h);
    }
    const lines = [];
    for (const row of rows) {
      row.items.sort((a,b) => a.x-b.x); let line = null, previous = null;
      for (const item of row.items) {
        const gap = previous ? item.x - (previous.x + previous.w) : 0;
        if (!line || gap > Math.max(width * .12, row.h * 4)) {
          line = { text:"", x:item.x, right:item.x, y:row.y, h:row.h }; lines.push(line); previous = null;
          row.segments++;
        }
        const str = item.str.replace(/[\t\r\n\u00a0]+/g," ");
        const space = previous && gap > row.h * .12 && !/\s$/.test(line.text) && !/^[\s\p{M},.;:!?%)\]”’]/u.test(str);
        line.text += (space ? " " : "") + str; line.right = Math.max(line.right, item.x + item.w); previous = item;
      }
    }
    const paired = rows.filter((row) => row.segments > 1).length;
    const columns = paired >= 3 && paired >= rows.length * .25;
    if (columns) {
      // Preserve full-width headings above the columns. Complex mixed layouts
      // remain flagged in the preview rather than silently claiming accuracy.
      const split = width / 2;
      const spanning = lines.filter((l) => l.x < split && l.right > split + width * .08), spanningSet=new Set(spanning);
      const columnLines = lines.filter((l) => !spanningSet.has(l));
      const top = spanning.filter((l) => l.y < (columnLines[0]?.y ?? Infinity));
      const rest = spanning.filter((l) => !top.includes(l));
      lines.splice(0, lines.length, ...top, ...columnLines.filter((l) => l.x < split), ...columnLines.filter((l) => l.x >= split), ...rest);
    }
    return { width, height, columns, lines:lines.map((l) => ({ ...l, text:clean(l.text) })).filter((l) => l.text) };
  }
  function build(pages, outline = [], options = {}) {
    const joinLines = options.joinLines !== false, removeRepeated = options.removeRepeated !== false;
    const keys = new Map(), key = (text) => text.toLocaleLowerCase("vi").replace(/\d+/g,"#");
    pages.forEach((page, pi) => page.lines.forEach((line) => {
      if ((line.y < page.height * .09 || line.y > page.height * .91) && line.text.length < 160 && !heading(line.text)) {
        const id = key(line.text); if (!keys.has(id)) keys.set(id, new Set()); keys.get(id).add(pi);
      }
    }));
    const removed = [], emptyPages = [], warnings = [], filtered = pages.map((page, pi) => ({ ...page, lines:page.lines.filter((line) => {
      const edge = line.y < page.height * .09 || line.y > page.height * .91;
      const repeated = keys.get(key(line.text))?.size >= Math.max(3, Math.ceil(pages.length * .5));
      const number = /^[-–—\s]*(?:\d{1,5}|[ivxlcdm]{1,8})[-–—\s]*$/i.test(line.text);
      if (removeRepeated && edge && !heading(line.text) && (repeated || number)) { removed.push({ page:pi+1, text:line.text }); return false; }
      return true;
    }) }));
    pages.forEach((page, pi) => { if (!page.lines.length) emptyPages.push(pi+1); });
    if (emptyPages.length) warnings.push(`Trang không có chữ: ${emptyPages.join(", ")}. Nội dung ảnh không được chuyển thành chữ.`);
    if (pages.some((p) => p.columns)) warnings.push("Có bố cục nhiều cột. Hãy so sánh thứ tự chữ với trang gốc trước khi lưu.");
    filtered.forEach((p) => { p.left=p.lines.reduce((min,l)=>Math.min(min,l.x),Infinity); });
    const all = filtered.flatMap((p, pi) => p.lines.map((l) => ({ ...l, page:pi, columns:p.columns })));
    if (!all.some((line) => /[\p{L}\p{N}]/u.test(line.text))) throw new Error("PDF không có lớp chữ phù hợp để chuyển đổi. Hãy chọn Giữ trang gốc; chưa hỗ trợ OCR.");
    if (all.some((l) => /\uFFFD|[\uE000-\uF8FF]/u.test(l.text))) warnings.push("Một số chữ có mã font không chuẩn. Kiểm tra dấu tiếng Việt trong bản xem trước.");
    const breaks = new Map(), byPage=new Map();
    all.forEach((l,i)=>{if (!byPage.has(l.page)) byPage.set(l.page,[]); byPage.get(l.page).push({l,i});});
    if (options.chapterMode !== "pages" && options.chapterMode !== "single") {
      for (const entry of outline) {
        if (!Number.isInteger(entry.page) || entry.page < 0 || entry.page >= pages.length) continue;
        const candidates = byPage.get(entry.page) || [];
        const chosen = candidates.find(({l}) => Number.isFinite(entry.y) && l.y >= entry.y - l.h) || candidates[0];
        if (chosen && !breaks.has(chosen.i)) breaks.set(chosen.i, clean(entry.title));
      }
      if (!breaks.size) all.forEach((line,i) => { if (heading(line.text)) breaks.set(i,line.text); });
    }
    const perPage = options.chapterMode === "pages" || (!breaks.size && options.chapterMode !== "single");
    const chapters = [], pageTexts = filtered.map(() => []); let current = null, previous = null;
    const font = median(all.map((l) => l.h));
    const chapter = (title) => { current = { title:title || "Mở đầu", paragraphs:[], images:[], isIllustration:false }; chapters.push(current); previous = null; };
    for (let i=0; i<all.length; i++) {
      const line = all[i], boundary = breaks.get(i), newPage = previous?.page !== line.page;
      pageTexts[line.page].push(line.text);
      if (boundary || !current || (perPage && newPage)) chapter(boundary || (perPage ? `Trang ${line.page+1}` : options.title || "Mở đầu"));
      if (boundary && clean(boundary).toLowerCase() === line.text.toLowerCase()) continue;
      const last = current.paragraphs.at(-1);
      const gap = previous && previous.page === line.page ? line.y - previous.y : font * 1.2;
      const page = filtered[line.page];
      const indented = line.x > page.left + font * .8;
      const canJoin = joinLines && last && previous && !line.columns && !previous.columns &&
        !scene(line.text) && !scene(previous.text) && !heading(line.text) && !heading(previous.text) &&
        gap > 0 && gap < font * 1.65 && Math.abs(line.h-previous.h) < font * .25 && !indented &&
        !/^[“"‘「『•●]/.test(line.text) && !(newPage && /[.!?…:;”’」』]$/.test(last)) &&
        (newPage || previous.right >= page.width * .75 || !/[.!?…:;”’」』]$/.test(last));
      if (canJoin) current.paragraphs[current.paragraphs.length-1] = clean(last + " " + line.text);
      else current.paragraphs.push(line.text);
      previous = line;
    }
    // A standalone chapter heading is still meaningful content.
    chapters.forEach((c) => { if (!c.paragraphs.length) c.paragraphs.push(c.title); c.content=c.paragraphs.join("\n\n"); c.words=c.content.split(/\s+/u).filter(Boolean).length; });
    return { chapters, pageTexts:pageTexts.map((p) => p.join("\n")), emptyPages, removed, warnings,
      text:chapters.map((c) => `${c.title}\n\n${c.content}`).join("\n\n"), chapterMethod:perPage ? "pages" : breaks.size ? "headings" : "single" };
  }
  return { pageLines, build };
});
