(() => {
"use strict";
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const ico = (id, cls = "") => `<svg class="${cls}"><use href="#i-${id}"/></svg>`;
const store = {
  get(k, d) { try { const v = localStorage.getItem("cantam:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("cantam:" + k, JSON.stringify(v)); } catch (e) {} }
};
const COLORS = { mat:"#2848B8", alg:"#1F5FA8", geo:"#3A4BA8", rus:"#B8322B", crh:"#1E6E57", oqu:"#B5651D",
  edb:"#A42A5E", etr:"#2F7A1F", bio:"#3F7F22", eng:"#5E36B0", tar:"#9A4515", cog:"#1F7068", fiz:"#0F6F84", kim:"#7E3AA3", inf:"#44607A", num:"#44607A" };
const wide = matchMedia("(min-width: 900px)");
const BOOKS_CACHE = "cantam-books";

let DATA = { subjects: {}, books: [] };
let grade = store.get("grade", 0);
let view = grade ? "shelf" : "grades";
let query = "";
let downloaded = new Set(store.get("dl", []));

const title = b => (DATA.subjects[b.subject] || b.subject) + (b.part ? ", " + L.part(b.part) : "");
const color = b => COLORS[b.subject] || "#44607A";
const fileUrl = b => b.file ? new URL(b.file, location.href).href : "";
const byId = id => DATA.books.find(b => b.id === id);
const grades = () => [...new Set(DATA.books.map(b => b.grade))].sort((a, b) => a - b);

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2200); }

// ---------- static text
function fillStatic() {
  $("#topName").textContent = L.app;
  $("#sideName").innerHTML = esc(L.app).replace(" ", "<br>");
  $("#sideGradesLabel").textContent = L.grades;
  $("#menuBtn").setAttribute("aria-label", L.menu);
  $("#menuTitle").textContent = L.menu;
  $("#menuClose").setAttribute("aria-label", L.close);
  [["#rBack", L.back], ["#rZoomOut", L.zoomOut], ["#rZoomIn", L.zoomIn], ["#rMark", L.addMark], ["#rDl", L.download], ["#rPrev", L.prev], ["#rNext", L.next]]
    .forEach(([s, t]) => $(s).setAttribute("aria-label", t));
}

// ---------- chrome
function renderChrome() {
  $("#tabs").innerHTML = [["shelf", "shelf", L.tabShelf], ["offline", "down", L.tabOffline], ["marks", "mark", L.tabMarks]]
    .map(([v, i, t]) => `<button class="tab ${view === v ? "on" : ""}" data-view="${v}">${ico(i)}${esc(t)}</button>`).join("");
  $("#sideGrades").innerHTML = grades().map(g => `<button class="chip ${g === grade ? "on" : ""}" data-grade="${g}">${g}</button>`).join("");
  $("#sideLinks").innerHTML = [["shelf", "shelf", L.tabShelf], ["offline", "down", L.tabOffline + (downloaded.size ? ": " + downloaded.size : "")], ["marks", "mark", L.tabMarks], ["help", "help", L.help]]
    .map(([v, i, t]) => `<button class="${view === v ? "on" : ""}" data-view="${v}">${ico(i)}${esc(t)}</button>`).join("");
}

// ---------- views
function coverHtml(b) {
  return `<button class="book" data-open="${esc(b.id)}" aria-label="${esc(title(b) + ", " + L.grade(b.grade))}">
    <div class="cover" style="--c:${color(b)}">
      ${b.file ? "" : `<span class="soon">${esc(L.soon)}</span>`}
      <div><b>${esc(DATA.subjects[b.subject] || b.subject)}</b>${b.part ? `<br><em>${esc(L.part(b.part))}</em>` : ""}</div>
      <span class="g">${b.grade}</span>
      ${downloaded.has(b.id) ? `<span class="ok">${ico("check")}</span>` : ""}
    </div></button>`;
}
function shelvesHtml(list) {
  const W = $("#view").clientWidth - 24;
  const bw = wide.matches ? 124 : 98, gap = wide.matches ? 22 : 14;
  const per = Math.max(2, Math.floor((W + gap) / (bw + gap)));
  let out = "";
  for (let i = 0; i < list.length; i += per) {
    const row = list.slice(i, i + per);
    out += `<div class="shelf" style="--bw:${bw}px;--gap:${gap}px"><div class="row">${row.map(coverHtml).join("")}</div><div class="plank"></div>
      <div class="names">${row.map(b => `<span>${esc(b.author || "")}</span>`).join("")}</div></div>`;
  }
  return out;
}
function contHtml() {
  const rec = store.get("recent", []).map(r => ({ ...r, b: byId(r.id) })).filter(r => r.b && r.b.file).slice(0, 2);
  if (!rec.length) return "";
  return `<div class="conts">${rec.map(r => {
    const pct = r.total ? Math.round(r.page / r.total * 100) : 0;
    return `<button class="cont" data-open="${esc(r.id)}"><div class="mini" style="--c:${color(r.b)}"></div><div class="t">
      <small>${esc(L.cont)}</small><b>${esc(title(r.b))}</b><div class="bar"><i style="width:${pct}%"></i></div>
      <small>${esc(L.page)} ${r.page}${r.total ? " / " + r.total : ""}</small></div></button>`;
  }).join("")}</div>`;
}
function installHtml() {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (standalone) return "";
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (deferredPrompt) return `<div class="install"><svg class="logo"><use href="#logo"/></svg><div class="t">${esc(L.install)}</div><button class="btn" data-install>${esc(L.install)}</button></div>`;
  if (ios) return `<div class="install"><svg class="logo"><use href="#logo"/></svg><div class="t"><b>${esc(L.install)}</b><br><span class="muted">${esc(L.installIos)}</span></div></div>`;
  return "";
}

function renderShelf() {
  const q = query.trim().toLowerCase();
  const list = DATA.books.filter(b => q ? (title(b) + " " + b.author + " " + b.grade).toLowerCase().includes(q) : b.grade === grade);
  const count = DATA.books.filter(b => b.grade === grade).length;
  const head = wide.matches
    ? `<div class="hello"><div><h1>${esc(L.grade(grade))}</h1><p>${esc(L.books(count))}</p></div>${searchHtml()}</div>`
    : `<div class="hello"><div><h1>${esc(L.hello)}</h1><p>${esc(L.grade(grade) + ", " + L.books(count))}</p></div>${searchHtml()}</div>`;
  const chips = `<div class="chips">${grades().map(g => `<button class="chip ${g === grade ? "on" : ""}" data-grade="${g}">${g === grade ? esc(L.grade(g)) : g}</button>`).join("")}</div>`;
  $("#view").innerHTML = head + chips + (q ? "" : contHtml()) + (list.length ? shelvesHtml(list) : `<p class="empty">${esc(L.nothing)}</p>`) + installHtml();
  const inp = $("#q"); if (inp && document.activeElement !== inp && renderShelf.focus) { inp.focus(); inp.setSelectionRange(99, 99); }
  const chipOn = $(".chips .chip.on"); if (chipOn) chipOn.scrollIntoView({ inline: "center", block: "nearest" });
}
const searchHtml = () => `<label class="search">${ico("search")}<input id="q" type="search" value="${esc(query)}" placeholder="${esc(L.search)}" aria-label="${esc(L.search)}" autocomplete="off"></label>`;

function renderGrades() {
  $("#view").innerHTML = `<div class="headrow">${grade ? `<button class="ib white" data-view="shelf" aria-label="${esc(L.back)}">${ico("back")}</button>` : ""}<h1>${esc(L.grades)}</h1></div>
    <p class="muted" style="margin:0">${esc(L.pickGrade)}</p>
    <div class="gtiles">${grades().map(g => `<button class="gtile ${g === grade ? "on" : ""}" data-grade="${g}"><b>${g}</b><small>${esc(L.gradeWord)}</small></button>`).join("")}</div>`;
}
function renderOffline() {
  const list = DATA.books.filter(b => downloaded.has(b.id));
  $("#view").innerHTML = `<h1>${esc(L.tabOffline)}</h1>` + (list.length ? `<div class="list">${list.map(b => `
    <div class="item"><div class="mini" style="--c:${color(b)}"></div><button class="t" data-open="${esc(b.id)}">${esc(title(b))}<small>${esc(L.grade(b.grade))}</small></button>
    <button class="ib" data-undl="${esc(b.id)}" aria-label="${esc(L.remove)}">${ico("trash")}</button></div>`).join("")}</div>`
    : `<p class="empty">${esc(L.offlineEmpty)}</p>`);
}
function renderMarks() {
  const marks = store.get("marks", []).map(m => ({ ...m, b: byId(m.id) })).filter(m => m.b);
  $("#view").innerHTML = `<h1>${esc(L.tabMarks)}</h1>` + (marks.length ? `<div class="list">${marks.map((m, i) => `
    <div class="item"><div class="mini" style="--c:${color(m.b)}"></div><button class="t" data-open="${esc(m.id)}" data-page="${m.page}">${esc(title(m.b))}<small>${esc(L.grade(m.b.grade))}, ${esc(L.page)} ${m.page}</small></button>
    <button class="ib" data-unmark="${i}" aria-label="${esc(L.delMark)}">${ico("trash")}</button></div>`).join("")}</div>`
    : `<p class="empty">${esc(L.marksEmpty)}</p>`);
}
function renderHelp() {
  $("#view").innerHTML = `<h1>${esc(L.help)}</h1><div class="list">${L.helpText.map(t => `<div class="item"><div class="t">${esc(t)}</div></div>`).join("")}</div>${installHtml()}
    <p class="muted">${esc(L.app)} — ${esc(L.slogan)}</p>`;
}
function render() {
  renderChrome();
  ({ shelf: renderShelf, grades: renderGrades, offline: renderOffline, marks: renderMarks, help: renderHelp }[view] || renderShelf)();
}
function go(v) { view = v; query = ""; render(); window.scrollTo(0, 0); $(".main").scrollTop = 0; }
function setGrade(g) { grade = g; store.set("grade", g); go("shelf"); }

// ---------- menu
function openMenu() {
  const rec = store.get("recent", [])[0], rb = rec && byId(rec.id);
  const row = (act, i, t, sub, on) => `<button class="mrow ${on ? "on" : ""}" ${act}><span class="ic">${ico(i)}</span><span class="t">${esc(t)}${sub ? `<small>${esc(sub)}</small>` : ""}</span>${ico("next")}</button>`;
  $("#menuBody").innerHTML = (grade ? `<div class="gcard"><div class="n">${grade}</div><div class="t"><b>${esc(L.grade(grade))}</b><small>${esc(L.books(DATA.books.filter(b => b.grade === grade).length))}${downloaded.size ? ", " + downloaded.size + " " + esc(L.tabOffline.toLowerCase()) : ""}</small></div><button data-mview="grades">${esc(L.change)}</button></div>` : "") +
    row('data-mview="shelf"', "shelf", L.tabShelf, "", view === "shelf") +
    row('data-mview="grades"', "grid", L.grades, grades()[0] + " – " + grades().slice(-1)[0], view === "grades") +
    (rb && rb.file ? row(`data-mopen="${esc(rb.id)}"`, "book", L.cont, title(rb) + ", " + L.page + " " + rec.page) : "") +
    row('data-mview="offline"', "down", L.tabOffline, "", view === "offline") +
    row('data-mview="marks"', "mark", L.tabMarks, "", view === "marks") +
    row('data-mview="help"', "lang", L.lang, L.langName) +
    row('data-mview="help"', "help", L.help, "", view === "help");
  $("#menu").hidden = false;
}
function closeMenu() { $("#menu").hidden = true; }

// ---------- reader
const R = { book: null, pdf: null, page: 1, zoom: 1, task: [] };
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "pdfjs/pdf.worker.min.js";
const spreadMode = () => wide.matches && innerWidth > innerHeight;

function openBook(id, page) {
  const b = byId(id); if (!b) return;
  closeMenu();
  R.book = b; R.pdf = null; R.zoom = 1;
  $("#rTitle").textContent = title(b);
  $("#rSub").textContent = L.grade(b.grade) + (b.author ? ", " + b.author : "");
  $("#reader").hidden = false; document.body.style.overflow = "hidden";
  history.pushState({ reader: 1 }, "");
  updateDl(); $("#rMark").hidden = $("#rDl").hidden = !b.file;
  if (!b.file) {
    $("#rFoot").hidden = true;
    $("#stage").innerHTML = `<div class="placeholder"><div class="big" style="--c:${color(b)}"></div><h2>${esc(title(b))}</h2><p class="muted">${esc(L.soonText)}</p></div>`;
    return;
  }
  $("#rFoot").hidden = false;
  $("#stage").innerHTML = `<p class="placeholder muted">${esc(L.loading)}</p>`;
  pdfjsLib.getDocument({ url: fileUrl(b), cMapUrl: "pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "pdfjs/standard_fonts/", disableRange: true, disableStream: true })
    .promise.then(pdf => {
      if (R.book !== b) return;
      R.pdf = pdf;
      R.page = Math.min(page || store.get("page:" + b.id, 1), pdf.numPages);
      $("#rRange").max = pdf.numPages;
      draw();
    }).catch(() => { $("#stage").innerHTML = `<p class="placeholder">${esc(L.error)}</p>`; });
}
function pagesShown() {
  const n = R.pdf.numPages, p = R.page;
  if (!spreadMode() || n < 2) return [p];
  if (p === 1) return [1];
  const s = p % 2 === 0 ? p : p - 1;
  return s + 1 <= n ? [s, s + 1] : [s];
}
async function draw() {
  if (!R.pdf) return;
  const shown = pagesShown(); R.page = shown[0];
  R.task.forEach(t => { try { t.cancel(); } catch (e) {} }); R.task = [];
  const stage = $("#stage"), sw = stage.clientWidth - 32, sh = stage.clientHeight - 32;
  const pages = await Promise.all(shown.map(n => R.pdf.getPage(n)));
  const base = pages[0].getViewport({ scale: 1 });
  const fit = Math.min(sw / (base.width * shown.length), sh / base.height);
  const scale = fit * R.zoom, dpr = Math.min(window.devicePixelRatio || 1, 2);
  const wrap = document.createElement("div"); wrap.className = "spread";
  for (const p of pages) {
    const vp = p.getViewport({ scale: scale * dpr }), c = document.createElement("canvas");
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    c.style.width = Math.floor(vp.width / dpr) + "px"; c.style.height = Math.floor(vp.height / dpr) + "px";
    wrap.appendChild(c);
    R.task.push(p.render({ canvasContext: c.getContext("2d"), viewport: vp }));
  }
  stage.innerHTML = ""; stage.appendChild(wrap); stage.scrollTo(0, 0);
  const n = R.pdf.numPages;
  $("#rRange").value = R.page;
  $("#rNum").innerHTML = `<b>${shown.join("–")}</b> / ${n}`;
  $("#rMark").classList.toggle("on", isMarked());
  $("#rMark").setAttribute("aria-label", isMarked() ? L.delMark : L.addMark);
  saveProgress();
  Promise.all(R.task.map(t => t.promise)).catch(() => {});
}
function step(dir) {
  if (!R.pdf) return;
  const shown = pagesShown(), n = R.pdf.numPages;
  let p = dir > 0 ? shown[shown.length - 1] + 1 : shown[0] - 1;
  p = Math.max(1, Math.min(n, p));
  if (p !== R.page || shown.length > 1) { R.page = p; draw(); }
}
function saveProgress() {
  const b = R.book; if (!b) return;
  store.set("page:" + b.id, R.page);
  const rec = store.get("recent", []).filter(r => r.id !== b.id);
  rec.unshift({ id: b.id, page: R.page, total: R.pdf.numPages });
  store.set("recent", rec.slice(0, 6));
}
function closeReader(fromPop) {
  if ($("#reader").hidden) return;
  $("#reader").hidden = true; document.body.style.overflow = "";
  R.task.forEach(t => { try { t.cancel(); } catch (e) {} });
  if (R.pdf) R.pdf.destroy(); R.pdf = null; R.book = null;
  if (!fromPop) history.back();
  render();
}
const isMarked = () => R.book && store.get("marks", []).some(m => m.id === R.book.id && m.page === R.page);
function toggleMark() {
  if (!R.pdf) return;
  let marks = store.get("marks", []);
  if (isMarked()) marks = marks.filter(m => !(m.id === R.book.id && m.page === R.page));
  else { marks.unshift({ id: R.book.id, page: R.page }); toast(L.addMark + " ✓"); }
  store.set("marks", marks); draw();
}

// ---------- offline downloads
function updateDl() {
  const b = R.book, btn = $("#rDl"); if (!b) return;
  const done = downloaded.has(b.id);
  btn.classList.toggle("done", done);
  btn.innerHTML = ico(done ? "check" : "down") + `<span>${wide.matches ? esc(done ? L.downloaded : L.download) : ""}</span>`;
}
async function download(b) {
  if (!b || !b.file || !("caches" in window)) return;
  if (downloaded.has(b.id)) { toast(L.downloaded); return; }
  const btn = $("#rDl"); btn.querySelector("span").textContent = "…";
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    const res = await fetch(fileUrl(b), { cache: "no-store" });
    if (!res.ok) throw 0;
    await (await caches.open(BOOKS_CACHE)).put(fileUrl(b), res);
    downloaded.add(b.id); store.set("dl", [...downloaded]); toast(L.downloaded + ": " + title(b));
  } catch (e) { toast(L.error); }
  updateDl();
}
async function undownload(id) {
  const b = byId(id); if (!b) return;
  try { await (await caches.open(BOOKS_CACHE)).delete(fileUrl(b)); } catch (e) {}
  downloaded.delete(id); store.set("dl", [...downloaded]); render();
}
async function syncDownloads() {
  if (!("caches" in window)) return;
  try {
    const c = await caches.open(BOOKS_CACHE), keys = new Set((await c.keys()).map(r => r.url));
    downloaded = new Set(DATA.books.filter(b => b.file && keys.has(fileUrl(b))).map(b => b.id));
    store.set("dl", [...downloaded]);
  } catch (e) {}
}

// ---------- events
let deferredPrompt = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; render(); });
document.addEventListener("click", e => {
  const t = e.target.closest("button,[data-open]"); if (!t) return;
  const d = t.dataset;
  if (d.open) openBook(d.open, d.page ? +d.page : 0);
  else if (d.grade) setGrade(+d.grade);
  else if (d.view) go(d.view);
  else if (d.mview) { closeMenu(); go(d.mview); }
  else if (d.mopen) openBook(d.mopen);
  else if (d.undl) undownload(d.undl);
  else if (d.unmark) { const m = store.get("marks", []); m.splice(+d.unmark, 1); store.set("marks", m); render(); }
  else if (d.install !== undefined && deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; }
});
document.addEventListener("input", e => { if (e.target.id === "q") { query = e.target.value; renderShelf.focus = true; renderShelf(); renderShelf.focus = false; } });
$("#menuBtn").onclick = openMenu; $("#menuClose").onclick = closeMenu;
$("#rBack").onclick = () => closeReader(false);
$("#rPrev").onclick = () => step(-1); $("#rNext").onclick = () => step(1);
$("#rRange").oninput = e => { $("#rNum").innerHTML = `<b>${e.target.value}</b> / ${R.pdf ? R.pdf.numPages : ""}`; };
$("#rRange").onchange = e => { R.page = +e.target.value; draw(); };
$("#rZoomIn").onclick = () => { R.zoom = Math.min(R.zoom * 1.25, 4); draw(); };
$("#rZoomOut").onclick = () => { R.zoom = Math.max(R.zoom / 1.25, 1); draw(); };
$("#rMark").onclick = toggleMark;
$("#rDl").onclick = () => download(R.book);
addEventListener("popstate", () => closeReader(true));
addEventListener("keydown", e => {
  if ($("#reader").hidden) { if (e.key === "Escape") closeMenu(); return; }
  if (e.key === "ArrowRight" || e.key === "PageDown") step(1);
  if (e.key === "ArrowLeft" || e.key === "PageUp") step(-1);
  if (e.key === "Escape") closeReader(false);
});
let sx = null, sy = 0;
$("#stage").addEventListener("touchstart", e => { sx = e.touches.length === 1 && R.zoom === 1 ? e.touches[0].clientX : null; sy = e.touches[0].clientY; }, { passive: true });
$("#stage").addEventListener("touchend", e => {
  if (sx === null) return;
  const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
});
let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (!$("#reader").hidden) { draw(); updateDl(); } else render(); }, 150); });

// ---------- start
fillStatic();
fetch("books.json").then(r => r.json()).then(async d => {
  DATA = d;
  if (grade && !grades().includes(grade)) { grade = 0; view = "grades"; }
  await syncDownloads();
  render();
}).catch(() => { $("#view").innerHTML = `<p class="empty">${esc(L.error)}</p>`; });
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js"));
})();
