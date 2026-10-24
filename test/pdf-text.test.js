const {test}=require("node:test"), assert=require("node:assert/strict");
const {pageLines,build}=require("../public/pdf-text");
const {validateBook}=require("../public/library-backup");
const line=(text,y,x=50,right=550,h=12)=>({text,y,x,right,h});
const page=(lines,extras={})=>({width:600,height:800,lines,...extras});
test("PDF geometry reconstructs split Vietnamese glyphs, spaces and punctuation without rewriting words",()=>{
  const result=pageLines([{str:"Tie",x:50,y:50,w:15,h:12},{str:"\u0302\u0301ng",x:65,y:50,w:12,h:12},{str:"Việt",x:82,y:50,w:25,h:12},{str:",",x:107,y:50,w:2,h:12}],600,800);
  assert.equal(result.lines[0].text,"Tiếng Việt,");
});
test("PDF paragraphs cross page boundaries but preserve dialogue, indents and scene breaks",()=>{
  const result=build([page([line("Chương 1: Khởi đầu",80),line("Một đoạn chưa kết thúc",700)]),page([line("vẫn tiếp tục ở trang sau.",100),line("“Một câu thoại.”",115),line("Đoạn thụt đầu dòng.",130,70),line("***",160)])]);
  assert.equal(result.chapters.length,1);
  assert.deepEqual(result.chapters[0].paragraphs,["Một đoạn chưa kết thúc vẫn tiếp tục ở trang sau.","“Một câu thoại.”","Đoạn thụt đầu dòng.","***"]);
  assert.equal(build([page([line("Chương 1",80),line("Dòng thứ nhất",100),line("dòng thứ hai",114)])],[],{joinLines:false}).chapters[0].paragraphs.length,2);
});
test("repeated edge noise is optional; body numbers and chapter headings survive",()=>{
  const pages=[0,1,2].map(i=>page([line("Tên sách",20),line("Chương "+(i+1),50),line("2026",100),line("Nội dung.",120),line(String(i+1),780)]));
  const cleaned=build(pages);
  assert.equal(cleaned.removed.length,6); assert.equal(cleaned.chapters.length,3);
  assert.ok(cleaned.chapters[0].content.includes("2026"));
  assert.equal(build(pages,[],{removeRepeated:false}).removed.length,0);
});
test("outline destinations split within a page; no heading falls back to pages, single remains available",()=>{
  const pages=[page([line("Phần đầu",90),line("Nội dung đầu.",120),line("Phần sau",400),line("Nội dung sau.",430)])];
  const result=build(pages,[{title:"Phần đầu",page:0,y:90},{title:"Phần sau",page:0,y:400}]);
  assert.equal(result.chapters.length,2); assert.equal(result.chapters[1].content,"Nội dung sau.");
  assert.equal(build([page([line("Một trang.",100)]),page([line("Trang nữa.",100)])]).chapters.length,2);
  assert.equal(build([page([line("Một trang.",100)]),page([line("Trang nữa.",100)])],[],{chapterMode:"single"}).chapters.length,1);
});
test("columns warn and read left column before right; textless pages are explicit, never invented",()=>{
  const items=[0,1,2,3].flatMap(i=>[{str:"Trái "+i,x:50,y:100+i*15,w:100,h:12},{str:"Phải "+i,x:350,y:100+i*15,w:100,h:12}]);
  const p=pageLines(items,600,800), result=build([p,page([])]);
  assert.ok(p.columns); assert.match(result.warnings.join(" "),/nhiều cột/); assert.deepEqual(result.emptyPages,[2]);
  assert.deepEqual(p.lines.map(l=>l.text),["Trái 0","Trái 1","Trái 2","Trái 3","Phải 0","Phải 1","Phải 2","Phải 3"]);
  assert.throws(()=>build([page([])]),/không có lớp chữ/);
});
test("converted books keep provenance through backup sanitization, without PDF page rendering",()=>{
  const digest="a".repeat(64), sourceDigest="b".repeat(64);
  const book=validateBook({slug:`ebook-${digest.slice(0,24)}`,digest,sourceDigest,sourceFormat:"PDF-TEXT",titleVi:"Chữ",pdfConversion:{version:1,pages:2,joinLines:true,removeRepeated:false},assets:[],volumesData:[{chapters:[{title:"Chương 1",content:"Tiếng Việt.",paragraphs:["Tiếng Việt."],images:[]}]}]});
  assert.equal(book.sourceFormat,"PDF-TEXT"); assert.equal(book.sourceDigest,sourceDigest); assert.equal(book.pdfConversion.removeRepeated,false);
  assert.equal(book.volumesData[0].chapters[0].isIllustration,false);
});
