const assert=require("node:assert/strict"), fs=require("node:fs"), path=require("node:path");
async function runPdfTextChecks(browser,base) {
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:"block",reducedMotion:"reduce",acceptDownloads:true});
  await context.route(/fonts\.(googleapis|gstatic)\.com/,r=>r.abort());
  const producer=await context.newPage();
  // Print a real, digitally-born PDF in memory. System fonts are embedded by
  // Chromium; extraction must recover Vietnamese from the actual font maps.
  await producer.setContent('<html lang="vi"><head><title>Sách PDF tiếng Việt</title><style>@page{size:A5;margin:18mm}body{font:12pt Arial,sans-serif}h1{font-size:16pt}section+section{break-before:page}footer{position:fixed;bottom:-10mm;font-size:9pt}</style></head><body><footer>Đầu chân trang lặp lại</footer><section><h1>Chương 1: Khởi đầu</h1><p>Tiếng Việt có dấu: ă â ê ô ơ ư đ, tiếng nói và cảm nhận.</p><p>“Một câu thoại riêng.”</p><p>Nội dung của trang đầu.</p></section><section><p>Một đoạn văn ở trang tiếp theo.</p><p>Đọc sách trên mọi thiết bị.</p></section><section><h1>Chương 2: Trở về</h1><p>Chương cuối có nội dung để kiểm tra.</p><p>Kết thúc câu chuyện.</p></section></body></html>');
  await producer.locator("footer").evaluate(el=>el.remove());
  const bytes=await producer.pdf({printBackground:true,preferCSSPageSize:true,displayHeaderFooter:true,headerTemplate:"<span></span>",footerTemplate:'<span style="font-size:9px;margin-left:25px">Đầu chân trang lặp lại</span>'});
  await producer.setContent('<html><body><div style="width:100px;height:100px;background:#555"></div></body></html>');
  const blank=await producer.pdf(); await producer.close();
  const page=await context.newPage(), errors=[]; page.on("pageerror",e=>errors.push(e.message));
  const upload=async (name,buffer=bytes)=>page.locator("#ebook-file").setInputFiles({name,mimeType:"application/pdf",buffer});
  try {
    await page.goto(base); await page.waitForSelector("#btn-import-ebook"); await page.click("#btn-import-ebook");
    await page.selectOption("#ebook-pdf-mode","text"); await upload("sach-tieng-viet.pdf");
    await page.waitForSelector("#ebook-pdf-tools:not([hidden])"); await page.waitForSelector("#ebook-save:not([disabled])");
    assert.match(await page.locator("#ebook-txt-preview").innerText(),/Tiếng Việt có dấu: ă â ê ô ơ ư đ/);
    assert.equal(await page.locator("#ebook-txt-chapter option").count(),2);
    assert.match(await page.locator("#ebook-pdf-report").innerText(),/3 trang · 3 dòng/);
    await page.locator("#ebook-pdf-tools details > summary").click(); await page.click("#ebook-pdf-compare");
    await page.waitForSelector("#ebook-pdf-canvas:not([hidden])");
    assert.ok(await page.locator("#ebook-pdf-canvas").evaluate(c=>c.width>100 && c.height>100));
    assert.match(await page.locator("#ebook-pdf-page-text").innerText(),/Tiếng Việt/);
    await page.locator("#ebook-pdf-clean").uncheck(); await page.waitForFunction(()=>document.querySelector("#ebook-pdf-report").textContent.includes("0 dòng"));
    await page.locator("#ebook-pdf-clean").check();
    await page.locator("#ebook-pdf-editor > summary").click();
    const original=await page.locator("#ebook-pdf-edit").inputValue();
    await page.fill("#ebook-pdf-edit",original+"\n\nCảm nhận đã sửa trong bản nháp."); await page.locator("#ebook-txt-name").fill("Chương một đã sửa");
    await page.locator("#ebook-txt-chapter").selectOption("1"); await page.locator("#ebook-txt-chapter").selectOption("0");
    assert.match(await page.locator("#ebook-pdf-edit").inputValue(),/Cảm nhận đã sửa/);
    await page.locator("#ebook-pdf-join").uncheck(); await page.click(".app-confirm [data-cancel]");
    await page.waitForFunction(()=>document.querySelector("#ebook-pdf-join").checked);
    assert.equal(await page.locator("#ebook-pdf-join").isChecked(),true);
    assert.match(await page.locator("#ebook-pdf-edit").inputValue(),/Cảm nhận đã sửa/);
    const event=page.waitForEvent("download"); await page.click("#ebook-pdf-download"); const download=await event;
    assert.match(fs.readFileSync(await download.path(),"utf8"),/Cảm nhận đã sửa/);
    if (process.env.PDF_PREVIEW_DIR) { fs.mkdirSync(process.env.PDF_PREVIEW_DIR,{recursive:true}); await page.screenshot({path:path.join(process.env.PDF_PREVIEW_DIR,"conversion.png")}); }
    await page.click("#ebook-save"); await page.waitForURL(/\/truyen\/ebook-/); await page.waitForSelector("#view-home.active");
    const saved=await page.evaluate(async()=>{const b=(await globalThis.EbookImport.all())[0];return {slug:b.slug,digest:b.digest,source:b.sourceDigest,format:b.sourceFormat,conversion:b.pdfConversion,assets:b.assets.map(a=>a.key),content:b.volumesData[0].chapters[0].content};});
    assert.equal(saved.format,"PDF-TEXT"); assert.notEqual(saved.digest,saved.source); assert.equal(saved.conversion.pages,3);
    assert.deepEqual(saved.assets,["fallback-cover"]); assert.match(saved.content,/Cảm nhận đã sửa/);
    assert.deepEqual(await page.evaluate(async()=>{const b=(await globalThis.EbookImport.all())[0], zip=await globalThis.LibraryBackup.exportData(()=>{},[b]), restored=await globalThis.LibraryBackup.readBackup(zip);return [restored.books[0].sourceDigest===b.sourceDigest,restored.books[0].sourceFormat,restored.books[0].pdfConversion.pages];}),[true,"PDF-TEXT",3]);
    await page.click("#btn-start-reading"); await page.waitForSelector(".reader-content p");
    assert.match(await page.locator(".reader-content").first().innerText(),/Cảm nhận đã sửa/); assert.equal(await page.locator(".pdf-controls").count(),0);
    const before=await page.evaluate((slug)=>localStorage.getItem(`tenshi-${slug}-progress`),saved.slug);
    await page.goto(base); await page.click("#btn-import-ebook"); await page.selectOption("#ebook-pdf-mode","pages"); await upload("sach-tieng-viet.pdf");
    await page.waitForSelector("#ebook-save:not([disabled])"); assert.match(await page.locator("#ebook-summary").innerText(),/3 trang/);
    await page.click("#ebook-save"); await page.waitForURL(/\/truyen\/ebook-/); await page.waitForSelector("#view-home.active");
    assert.equal(await page.evaluate(async()=>(await globalThis.EbookImport.all()).length),2);
    assert.equal(await page.evaluate((slug)=>localStorage.getItem(`tenshi-${slug}-progress`),saved.slug),before);
    await page.goto(base); await page.click("#btn-import-ebook"); await page.selectOption("#ebook-pdf-mode","text"); await upload("sach-tieng-viet.pdf");
    await page.waitForFunction(()=>document.querySelector("#ebook-queue").textContent.includes("trùng tệp")); assert.equal(await page.locator("#ebook-save").isDisabled(),true);
    await upload("khong-co-chu.pdf",blank); await page.waitForFunction(()=>document.querySelector("#ebook-queue").textContent.includes("không có lớp chữ"));
    assert.equal(await page.locator("#ebook-save").isDisabled(),true);
    await upload("hong.pdf",Buffer.from("not a PDF")); await page.waitForFunction(()=>document.querySelector("#ebook-queue").textContent.includes("bị hỏng"));
    // Cancellation waits on a fixture gate rather than racing CPU speed.
    await page.evaluate(()=>{const original=globalThis.PdfReader.extractText;globalThis.PdfReader.extractText=async(bytes,report,signal)=>{await new Promise((resolve,reject)=>{signal.addEventListener("abort",()=>reject(signal.reason),{once:true});});return original(bytes,report,signal);};});
    await upload("huy.pdf"); await page.waitForSelector("#ebook-cancel-read:not([hidden])"); await page.click("#ebook-cancel-read");
    await page.waitForFunction(()=>document.querySelector("#ebook-status").textContent.includes("Đã hủy xử lý"));
    assert.equal(await page.evaluate(async()=>(await globalThis.EbookImport.all()).length),2);
    assert.deepEqual(errors,[]);
    console.log("  ✔ PDF text: real Vietnamese font extraction, repeated margins, preview rendering, edited drafts, TXT, separate original, duplicate/empty/broken/cancel, durable storage and ZIP roundtrip");
  } catch(error) {
    const folder=path.join(__dirname,"..","..","e2e-screenshots"); fs.mkdirSync(folder,{recursive:true}); await page.screenshot({path:path.join(folder,"pdf-text-failure.png"),fullPage:true}).catch(()=>{}); throw error;
  } finally { await context.close(); }
}
module.exports={runPdfTextChecks};
