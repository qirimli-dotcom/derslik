(() => {
"use strict";
const { $, esc, ico, idb, GRADES, subj, title, color, fullName, initials, toast, fld, sel, U_ATTR } = K;
const store = K.makeStore("cantam:");
const wide = matchMedia("(min-width: 900px)");
const BOOKS_CACHE = "cantam-books";

let USERS = { users: [] }, CAT = { kv: {}, books: [] }, SCH = { schools: [] };
let me = null, S = null;          // me — запись из users.json, S — сессия {u, pub, priv, keys:{g:{v,key}}}
let grade = 0, view = "shelf", query = "";
let downloaded = new Set(store.get("dl", []));
const isStaff = () => me && (me.r === "admin" || me.r === "teacher");
const BOOKS = () => CAT.books.filter(b => S && S.keys[b.g]);
const byId = id => CAT.books.find(b => b.id === id);
const schoolName = id => { const x = (SCH.schools || []).find(s => s.id === id); return x ? x.name : ""; };
const clsLine = u => u.r === "student" ? L.cls(u.g, u.l) : L.roles[u.r];

async function loadData() {
  const [u, c, sc] = await Promise.all([K.fetchPublic("data/users.json", null), K.fetchPublic("data/catalog.json", null), K.fetchPublic("data/schools.json", null)]);
  if (u) USERS = u; if (c) CAT = c; if (sc) SCH = sc;
  store.set("cat", CAT); store.set("sch", SCH);
}
async function syncKeys() {
  const u = USERS.users.find(x => x.u === S.u);
  if (u && u.pub !== S.pub) {   // одобрена смена пароля — переходим на новый ключ
    const pw = await idb.get("pwpending").catch(() => null);
    if (pw && pw.pub === u.pub) { S.pub = u.pub; S.priv = pw.priv; S.keys = {}; await idb.del("pwpending"); K.toast(L.passChanged); }
  }
  if (!u || u.pub !== S.pub) return false;
  me = u; store.set("me", me);
  let changed = false;
  for (const g of Object.keys(S.keys)) if (!u.k[g]) { delete S.keys[g]; changed = true; }
  for (const [g, w] of Object.entries(u.k)) if (!S.keys[g] || S.keys[g].v !== w.v) { S.keys[g] = { v: w.v, key: await K.unwrap(w, S.priv, false) }; changed = true; }
  if (changed) await idb.set("session", S);
  return true;
}
async function wipe(msg) {
  S = null; me = null;
  try { await idb.del("session"); await idb.del("pending"); await idb.del("pwpending"); } catch (e) {}
  try { await caches.delete(BOOKS_CACHE); } catch (e) {}
  store.clear(); downloaded = new Set(); CAT = { kv: {}, books: [] };
  closeReaderSilently(); closeMenu();
  showAuth("login", msg);
}

// ============ ВХОД / РЕГИСТРАЦИЯ ============
function authFrame(body) {
  $("#auth").hidden = false; $("#app").hidden = true;
  $("#aTitle").textContent = L.app; $("#aSlogan").textContent = L.slogan;
  $("#authBody").innerHTML = body; $("#auth").scrollTop = 0;
}
function showAuth(mode, msg) {
  authFrame(mode === "register" ? `<form class="form" id="fReg" autocomplete="off">
      <h2 class="ftitle">${esc(L.register)}</h2>
      ${(SCH.schools || []).length ? sel("sc", L.school, [["", L.pickSchool]].concat(SCH.schools.map(x => [x.id, x.name])), "") : ""}
      <div class="two">${fld("n", L.name, 'required maxlength="40"')}${fld("s", L.surname, 'required maxlength="60"')}</div>
      <div class="two">${sel("g", L.gradeLbl, GRADES, 5)}${sel("l", L.letter, LETTERS, "A")}</div>
      ${sel("r", L.iAm, [["student", L.roles.student], ["teacher", L.roles.teacher]], "student")}
      ${fld("u", L.username, U_ATTR, L.usernameHint)}
      ${fld("p", L.password, 'type="password" required minlength="8" autocomplete="new-password"')}
      ${fld("p2", L.password2, 'type="password" required minlength="8" autocomplete="new-password"')}
      <div class="err" id="aErr"></div><button class="btn-main" type="submit">${esc(L.makeApp)}</button></form>
      <p class="alink">${esc(L.haveAcc)} <button type="button" data-auth="login">${esc(L.login)}</button></p>`
    : `<form class="form" id="fLogin">
      ${fld("u", L.username, U_ATTR + ' autocomplete="username"')}
      ${fld("p", L.password, 'type="password" required autocomplete="current-password"')}
      <div class="err" id="aErr">${esc(msg || "")}</div><button class="btn-main" type="submit">${esc(L.doLogin)}</button></form>
      <p class="alink">${esc(L.noAcc)} <button type="button" data-auth="register">${esc(L.register)}</button></p>`);
}
const requestLink = req => K.BASE + "admin/#req=" + K.b64u(K.te.encode(JSON.stringify(req)));
const reqCode = req => K.b64u(K.te.encode(JSON.stringify(req)));
async function sendReq(p, noStore) {   // автоматическая отправка заявки в кабинет (через GitHub Issues)
  try {
    const cfg = await K.config(); if (!cfg.it || !cfg.repo) return false;
    const r = p.req, who = [fullName(r), r.r === "teacher" ? L.roles.teacher : L.cls(r.g, r.l), schoolName(r.sc)].filter(Boolean).join(", ");
    const iss = await K.issuesApi(cfg, "", { method: "POST", body: JSON.stringify({ title: K.REQ_TAG + " " + r.u + " — " + who, body: "req=" + reqCode(r) }) });
    p.sent = iss.number; if (!noStore) await idb.set("pending", p); return true;
  } catch (e) { return false; }
}
async function showPending() {
  const p = await idb.get("pending"); if (!p) return showAuth("register");
  if (!p.sent) await sendReq(p);
  const who = `<p style="margin:0"><b>${esc(fullName(p.req))}</b><br><span class="muted">${esc([schoolName(p.req.sc), p.req.r === "teacher" ? L.roles.teacher : L.cls(p.req.g, p.req.l), p.req.u].filter(Boolean).join(", "))}</span></p>`;
  if (p.sent) {
    authFrame(`<div class="pending"><div class="ico">${ico("clock")}</div><h2>${esc(L.appSent)}</h2><p class="muted" style="margin:0">${esc(L.appSentText)}</p>${who}
      <button class="btn-ghost" data-cancelreq>${esc(L.appCancel)}</button></div>`);
  } else {
    const link = requestLink(p.req);
    let qr = ""; try { const q = qrcode(0, "L"); q.addData(link); q.make(); qr = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) {}
    authFrame(`<div class="pending"><div class="ico">${ico("clock")}</div><h2>${esc(L.appReady)}</h2>
      <p class="muted" style="margin:0">${esc(L.appNotSent)}</p><div class="qrbox">${qr}</div>${who}
      <button class="btn-ghost" data-copylink>${esc(L.copy)}</button><button class="btn-main" data-resend>${esc(L.refresh)}</button>
      <button class="btn-ghost" data-cancelreq>${esc(L.appCancel)}</button></div>`);
  }
  clearInterval(showPending.t); showPending.t = setInterval(checkPending, 30000);
}
async function checkPending() {
  const p = await idb.get("pending"); if (!p) return;
  try { await loadData(); } catch (e) { return; }
  const u = USERS.users.find(x => x.u === p.req.u && x.pub === p.req.pub);
  if (!u) return;
  clearInterval(showPending.t);
  S = { u: u.u, pub: u.pub, priv: p.priv, keys: {} }; me = u;
  await syncKeys(); await idb.set("session", S); await idb.del("pending");
  enterApp();
}
async function doRegister(f) {
  const d = Object.fromEntries(new FormData(f).entries()), err = $("#aErr"), btn = f.querySelector("button[type=submit]");
  d.u = d.u.trim().toLowerCase();
  const bad = K.checkNewUser(d) || ((SCH.schools || []).length && !d.sc ? L.errSchool : ""); if (bad) return err.textContent = bad;
  btn.disabled = true;
  try {
    const id = await K.makeIdentity(d.p);
    const req = { v: 1, u: d.u, n: d.n.trim(), s: d.s.trim(), g: d.r === "teacher" ? 0 : +d.g, l: d.r === "teacher" ? "" : d.l, r: d.r, sc: d.sc || "", salt: id.salt, pub: id.pub, ep: id.ep, t: Date.now() };
    await idb.set("pending", { req, priv: id.priv });
    showPending();
  } catch (e) { err.textContent = String(e.message || e); btn.disabled = false; }
}
async function doLogin(f) {
  const err = $("#aErr"), btn = f.querySelector("button"), u = f.u.value.trim().toLowerCase();
  err.textContent = ""; btn.disabled = true;
  try {
    await loadData();
    const rec = USERS.users.find(x => x.u === u);
    if (!rec) { err.textContent = L.errNoUser; btn.disabled = false; return; }
    let priv;
    try { priv = await K.openIdentity(rec, f.p.value); } catch (e) { err.textContent = L.errLogin; btn.disabled = false; return; }
    S = { u, pub: rec.pub, priv, keys: {} }; me = rec;
    await syncKeys(); await idb.set("session", S); await idb.del("pending");
    enterApp();
  } catch (e) { err.textContent = L.errNet; btn.disabled = false; }
}

// ============ ПРИЛОЖЕНИЕ ============
function enterApp() {
  $("#auth").hidden = true; $("#app").hidden = false;
  grade = isStaff() ? store.get("grade", 5) : me.g;
  syncDownloads().then(render); render();
}
function fillStatic() {
  $("#topName").textContent = L.app;
  $("#sideName").innerHTML = esc(L.app).replace(" ", "<br>");
  $("#sideGradesLabel").textContent = L.grades;
  $("#menuBtn").setAttribute("aria-label", L.profile); $("#menuTitle").textContent = L.menu; $("#menuClose").setAttribute("aria-label", L.close);
  [["#rBack", L.back], ["#rZoomOut", L.zoomOut], ["#rZoomIn", L.zoomIn], ["#rMark", L.addMark], ["#rDl", L.download], ["#rPrev", L.prev], ["#rNext", L.next]].forEach(([s, t]) => $(s).setAttribute("aria-label", t));
}
function renderChrome() {
  if (!me) return;
  const tabs = [["shelf", "shelf", L.tabShelf], ["offline", "down", L.tabOffline], ["marks", "mark", L.tabMarks], ["profile", "user", L.profile]];
  $("#tabs").innerHTML = tabs.map(([v, i, t]) => `<button class="tab ${view === v ? "on" : ""}" data-view="${v}">${ico(i)}${esc(t)}</button>`).join("");
  $("#menuBtn").innerHTML = esc(initials(me)); $("#menuBtn").classList.toggle("on", view === "profile");
  $("#sideUser").innerHTML = `<span class="av">${esc(initials(me))}</span><span class="t"><b>${esc(fullName(me))}</b>${schoolName(me.sc) ? `<small>${esc(schoolName(me.sc))}</small>` : ""}<small>${esc(clsLine(me))}</small></span>`;
  $("#sideUser").classList.toggle("on", view === "profile");
  $("#sideGradesLabel").hidden = $("#sideGrades").hidden = !isStaff();
  $("#sideGrades").innerHTML = isStaff() ? GRADES.map(g => `<button class="chip ${g === grade && view === "shelf" ? "on" : ""}" data-grade="${g}">${g}</button>`).join("") : "";
  const links = tabs.map(t => t[0] === "offline" && downloaded.size ? [t[0], t[1], t[2] + ": " + downloaded.size] : t).concat([["help", "help", L.help]]);
  $("#sideLinks").innerHTML = links.map(([v, i, t]) => `<button class="${view === v ? "on" : ""}" data-view="${v}">${ico(i)}${esc(t)}</button>`).join("") +
    (me.r === "admin" ? `<button data-cabinet>${ico("shield")}${esc(L.cabinet)}</button>` : "") + `<button data-logout>${ico("out")}${esc(L.logout)}</button>`;
}
function coverHtml(b) {
  const src = K.coverSrc(b);   // фото поверх цветной обложки: если картинка не загрузится, останется цветная
  return `<button class="book" data-open="${esc(b.id)}" aria-label="${esc(title(b) + ", " + L.grade(b.g))}"><div class="cover${b.id === lastRead() ? " tagged" : ""}" style="--c:${color(b)}">
    <div><b>${esc(K.name(b))}</b>${b.part ? `<br><em>${esc(L.part(b.part))}</em>` : ""}</div><span class="g">${b.g}</span>
    ${b.id === lastRead() ? `<span class="cont-tag">${esc(L.contShort)}</span>` : ""}${src ? `<img class="cimg" src="${esc(src)}" alt="" decoding="async" onerror="this.remove()">` : ""}${downloaded.has(b.id) ? `<span class="ok">${ico("check")}</span>` : ""}</div></button>`;
}
function shelvesHtml(list) {
  const W = $("#view").clientWidth - 24, bw = wide.matches ? 124 : 98, gap = wide.matches ? 22 : 14;
  const per = Math.max(2, Math.floor((W + gap) / (bw + gap))); let out = "";
  for (let i = 0; i < list.length; i += per) {
    const row = list.slice(i, i + per);
    out += `<div class="shelf" style="--bw:${bw}px;--gap:${gap}px"><div class="row">${row.map(coverHtml).join("")}</div><div class="plank"></div><div class="names">${row.map(b => `<span><b>${esc(K.name(b))}</b><i>${esc([b.t ? subj(b) : "", b.part ? L.part(b.part) : "", b.author].filter(Boolean).join(" · "))}</i>${progHtml(b)}</span>`).join("")}</div></div>`;
  }
  return out;
}
// прогресс чтения под обложкой: полоска и «saife 6 / 158»
function progHtml(b) {
  const page = store.get("page:" + b.id, 0), tot = store.get("tot:" + b.id, 0) || ((store.get("recent", []).find(r => r.id === b.id) || {}).total || 0);
  if (!page || !tot) return "";
  return `<em class="prog"><span class="bar"><i style="width:${Math.max(3, Math.round(page / tot * 100))}%"></i></span>${esc(L.page)} ${page} / ${tot}</em>`;
}
const lastRead = () => (store.get("recent", [])[0] || {}).id;
function contHtml() {
  const rec = store.get("recent", []).map(r => ({ ...r, b: byId(r.id) })).filter(r => r.b && S.keys[r.b.g]).slice(0, 2);
  if (!rec.length) return "";
  return `<div class="conts">${rec.map(r => { const pct = r.total ? Math.round(r.page / r.total * 100) : 0;
    return `<button class="cont" data-open="${esc(r.id)}"><div class="mini" style="--c:${color(r.b)}"></div><div class="t"><small>${esc(L.cont)}</small><b>${esc(title(r.b))}</b><div class="bar"><i style="width:${pct}%"></i></div><small>${esc(L.page)} ${r.page}${r.total ? " / " + r.total : ""}</small></div></button>`; }).join("")}</div>`;
}
let deferredPrompt = null;
const installed = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function installHtml() {
  if (installed()) return "";
  return `<div class="install"><svg class="logo"><use href="#logo"/></svg><div class="t"><b>${esc(L.install)}</b><br><span class="muted">${esc(L.installText)}</span></div>
    <button class="btn" data-install>${esc(L.installBtn)}</button></div>`;
}
// iOS не даёт сайту ставить себя кнопкой — показываем, куда нажать
const SHARE_ICO = `<svg viewBox="0 0 24 24" style="width:20px;height:20px;vertical-align:-4px;fill:none;stroke:#2F5BD3;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M12 3v12M8 7l4-4 4 4M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>`;
function installHelp() {
  const chrome = /crios/i.test(navigator.userAgent);
  const steps = isIOS() ? (chrome ? L.iosChromeSteps : L.iosSafariSteps) : L.otherSteps;
  $("#modalBox").innerHTML = `<h2>${esc(L.install)}</h2><ol class="steps">${steps.map(t => `<li>${esc(t).replace("[share]", SHARE_ICO)}</li>`).join("")}</ol>
    <button class="btn-main" data-closemodal>${esc(L.close)}</button>`;
  $("#modal").hidden = false;
}
const searchHtml = () => `<label class="search">${ico("search")}<input id="q" type="search" value="${esc(query)}" placeholder="${esc(L.search)}" aria-label="${esc(L.search)}" autocomplete="off"></label>`;
function renderShelf() {
  if (!isStaff()) grade = me.g;   // ученик всегда видит свой текущий класс (после перевода — новый)
  const q = query.trim().toLowerCase(), all = BOOKS();
  const list = all.filter(b => q ? (title(b) + " " + (b.author || "") + " " + b.g).toLowerCase().includes(q) : b.g === grade);
  const count = all.filter(b => b.g === grade).length;
  const clsName = isStaff() ? L.grade(grade) : L.cls(me.g, me.l);
  // на планшете и компьютере имя, школа и класс уже в боковой панели — в шапке только раздел
  const head = wide.matches ? `<div class="hello"><div><h1>${esc(isStaff() ? clsName : L.tabShelf)}</h1><p>${esc(L.books(count))}</p></div>${searchHtml()}</div>`
    : `<div class="hello"><div><h1>${esc(L.hello + ", " + (me.n || "") + "!")}</h1><p>${esc(clsName + ", " + L.books(count))}</p></div>${searchHtml()}</div>`;
  const chips = isStaff() ? `<div class="chips">${GRADES.map(g => `<button class="chip ${g === grade ? "on" : ""}" data-grade="${g}">${g === grade ? esc(L.grade(g)) : g}</button>`).join("")}</div>` : "";
  $("#view").innerHTML = head + chips + (list.length ? shelvesHtml(list) : `<p class="empty">${esc(q ? L.nothing : L.soonText)}</p>`);
  const inp = $("#q"); if (inp && renderShelf.focus) { inp.focus(); inp.setSelectionRange(99, 99); }
  const chipOn = $(".chips .chip.on"); if (chipOn) chipOn.scrollIntoView({ inline: "center", block: "nearest" });
}
function renderOffline() {
  const list = BOOKS().filter(b => downloaded.has(b.id));
  $("#view").innerHTML = `<h1>${esc(L.tabOffline)}</h1>` + (list.length ? `<div class="list">${list.map(b => `<div class="item"><div class="mini" style="--c:${color(b)}"></div><button class="t" data-open="${esc(b.id)}">${esc(title(b))}<small>${esc(L.grade(b.g))}</small></button><button class="ib" data-undl="${esc(b.id)}" aria-label="${esc(L.remove)}">${ico("trash")}</button></div>`).join("")}</div>` : `<p class="empty">${esc(L.offlineEmpty)}</p>`);
}
function renderMarks() {
  const marks = store.get("marks", []).map(m => ({ ...m, b: byId(m.id) })).filter(m => m.b);
  $("#view").innerHTML = `<h1>${esc(L.tabMarks)}</h1>` + (marks.length ? `<div class="list">${marks.map((m, i) => `<div class="item"><div class="mini" style="--c:${color(m.b)}"></div><button class="t" data-open="${esc(m.id)}" data-page="${m.page}">${esc(title(m.b))}<small>${esc(L.grade(m.b.g))}, ${esc(L.page)} ${m.page}</small></button><button class="ib" data-unmark="${i}" aria-label="${esc(L.delMark)}">${ico("trash")}</button></div>`).join("")}</div>` : `<p class="empty">${esc(L.marksEmpty)}</p>`);
}
function renderHelp() {
  // инструкции: раскрывающиеся блоки; «Ekranğa qoş» — первым, пока приложение не установлено
  const installed = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  const steps = isIOS() ? (/crios/i.test(navigator.userAgent) ? L.iosChromeSteps : L.iosSafariSteps) : L.otherSteps;
  const block = (icon, t, body, open) => `<details class="form guide" ${open ? "open" : ""}><summary>${ico(icon)}<span>${esc(t)}</span></summary><div class="gbody">${body}</div></details>`;
  const ol = arr => `<ol class="steps">${arr.map(x => `<li>${esc(x).replace("[share]", SHARE_ICO)}</li>`).join("")}</ol>`;
  $("#view").innerHTML = `<h1>${esc(L.help)}</h1>` +
    (installed ? "" : block("down", L.install, `<p class="muted" style="margin:0">${esc(L.installText)}</p>${ol(steps)}${deferredPrompt ? `<button class="btn-main" data-install>${esc(L.install)}</button>` : ""}`, true)) +
    L.guide.map(g => block(g[0], g[1], ol(g[2]))).join("") +
    `<p class="muted" style="text-align:center">${esc(L.app)} — ${esc(L.slogan)} · v${K.VER}</p>`;
}
function renderProfile() {
  const row = (k, v) => v ? `<div class="prow"><span>${esc(k)}</span><b>${esc(v)}</b></div>` : "";
  const mine = BOOKS().filter(b => me.r !== "student" || b.g === me.g).length;
  const item = (icon, text, body, attrs = "", cls = "") => body
    ? `<details class="pitem ${cls}"><summary>${ico(icon)}<span>${esc(text)}</span></summary><div class="pbody">${body}</div></details>`
    : `<button class="pitem ${cls}" ${attrs}>${ico(icon)}<span>${esc(text)}</span></button>`;
  $("#view").innerHTML = `<h1 data-prof>${esc(L.profile)}</h1>
    <div class="pcard"><div class="av big">${esc(initials(me))}</div><div><h2>${esc(fullName(me))}</h2><p class="muted" style="margin:4px 0 0">${esc([L.roles[me.r], schoolName(me.sc)].filter(Boolean).join(" · "))}</p></div></div>
    <div class="form">${me.r === "student" ? row(L.gradeLbl, L.cls(me.g, me.l)) : ""}${row(L.username, me.u)}${row(L.booksAdm, String(mine))}${row(L.tabOffline, String(downloaded.size))}</div>
    <div class="plist">
      ${item("user", L.fixReq, `<form id="fFix" class="pform">
        <div class="two">${fld("n", L.name, `required maxlength="40" value="${esc(me.n || "")}"`)}${fld("s", L.surname, `required maxlength="60" value="${esc(me.s || "")}"`)}</div>
        ${(SCH.schools || []).length ? sel("sc", L.school, [["", L.pickSchool]].concat(SCH.schools.map(x => [x.id, x.name])), me.sc || "") : ""}
        ${me.r === "student" ? `<div class="two">${sel("g", L.gradeLbl, GRADES, me.g)}${sel("l", L.letter, LETTERS, me.l)}</div>` : ""}
        <p class="muted" style="margin:0;font-size:13px">${esc(L.fixHint)}</p>
        <div class="err" id="fixErr"></div><button class="btn-main" type="submit">${esc(L.sendApp)}</button></form>`)}
      ${item("key", L.changePass, `<form id="fPw" class="pform">
        ${fld("p", L.newPass, 'type="password" required minlength="8" autocomplete="new-password"')}${fld("p2", L.password2, 'type="password" required minlength="8" autocomplete="new-password"')}
        <div class="err" id="pwErr"></div><button class="btn-main" type="submit">${esc(L.changePass)}</button></form>`)}
      ${item("help", L.help, "", 'data-view="help"')}
      ${item("lang", L.lang + ": " + L.langName, "", "disabled")}
      ${me.r === "admin" ? item("shield", L.cabinet, "", "data-cabinet") : ""}
    </div>
    <div class="plist">${item("out", L.logout, "", "data-logout", "danger")}</div>`;
}
async function sendFix(f) {   // просьба исправить имя / школу / класс — меняет администратор
  const d = Object.fromEntries(new FormData(f).entries()), err = $("#fixErr"), btn = f.querySelector("button[type=submit]");
  const req = { v: 1, fix: 1, u: me.u, pub: me.pub, n: d.n.trim(), s: d.s.trim(), sc: d.sc != null ? d.sc : me.sc || "", g: d.g ? +d.g : me.g, l: d.l || me.l, r: me.r, t: Date.now() };
  if (!req.n || !req.s) return err.textContent = L.errFill;
  btn.disabled = true;
  if (await sendReq({ req }, true)) { toast(L.fixSent); f.closest("details").open = false; err.textContent = ""; } else err.textContent = L.errNet;
  btn.disabled = false;
}
async function changePassword(f) {
  const err = $("#pwErr"), d = { u: me.u, p: f.p.value, p2: f.p2.value }, bad = K.checkNewUser(d);
  if (bad) return err.textContent = bad;
  const btn = f.querySelector("button"); btn.disabled = true;
  try {
    const id = await K.makeIdentity(d.p);
    const p = { req: { v: 1, u: me.u, n: me.n, s: me.s, g: me.g, l: me.l, r: me.r, sc: me.sc || "", pw: 1, salt: id.salt, pub: id.pub, ep: id.ep, t: Date.now() }, priv: id.priv };
    if (!(await sendReq(p, true))) throw 0;
    await idb.set("pwpending", { pub: id.pub, priv: id.priv });
    f.reset(); err.textContent = ""; toast(L.passSent);
  } catch (e) { err.textContent = L.errNet; }
  btn.disabled = false;
}
function render() {
  if (!me) return;
  renderChrome();
  if (view === "profile" && $("#view [data-prof]") && !render.force) return;   // не сбрасывать формы профиля при фоновом обновлении
  render.force = false;
  ({ shelf: renderShelf, offline: renderOffline, marks: renderMarks, help: renderHelp, profile: renderProfile }[view] || renderShelf)();
}
function go(v) { view = v; query = ""; render.force = true; render(); window.scrollTo(0, 0); $(".main").scrollTop = 0; }
function setGrade(g) { grade = g; store.set("grade", g); go("shelf"); }

function openMenu() {
  const rec = store.get("recent", [])[0], rb = rec && byId(rec.id);
  const row = (act, i, t, sub, on) => `<button class="mrow ${on ? "on" : ""}" ${act}><span class="ic">${ico(i)}</span><span class="t">${esc(t)}${sub ? `<small>${esc(sub)}</small>` : ""}</span>${ico("next")}</button>`;
  $("#menuBody").innerHTML = `<button class="userline" data-mview="profile" style="width:100%;text-align:left"><div class="av">${esc(initials(me))}</div><div class="t"><b>${esc(fullName(me))}</b><small>${esc([schoolName(me.sc), clsLine(me), me.u].filter(Boolean).join(" · "))}</small></div>${ico("next")}</button>` +
    row('data-mview="shelf"', "shelf", L.tabShelf, "", view === "shelf") +
    (rb && S.keys[rb.g] ? row(`data-mopen="${esc(rb.id)}"`, "book", L.cont, title(rb) + ", " + L.page + " " + rec.page) : "") +
    row('data-mview="offline"', "down", L.tabOffline, "", view === "offline") + row('data-mview="marks"', "mark", L.tabMarks, "", view === "marks") +
    (me.r === "admin" ? row("data-cabinet", "shield", L.cabinet, "") : "") +
    (installed() ? "" : row("data-install", "down", L.install, L.installText)) +
    row('data-mview="help"', "lang", L.lang, L.langName) + row('data-mview="help"', "help", L.help, "", view === "help") + row("data-logout", "out", L.logout, "");
  $("#menu").hidden = false;
}
function closeMenu() { $("#menu").hidden = true; }

// ============ ЧИТАЛКА ============
const R = { book: null, pdf: null, page: 1, zoom: 1, task: [] };
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "pdfjs/pdf.worker.min.js";
const spreadMode = () => wide.matches && innerWidth > innerHeight;
async function getBookBytes(b) {
  const c = await caches.open(BOOKS_CACHE), parts = [], urls = K.partUrls(b);
  for (let i = 0; i < urls.length; i++) {
    let res = await c.match(urls[i]);
    if (!res) { if (urls.length > 1) $("#stage").innerHTML = `<p class="placeholder muted">${esc(L.loading)} ${Math.round(i / urls.length * 100)}%</p>`; res = await fetch(urls[i]); if (!res.ok) throw new Error("net"); }
    parts.push(new Uint8Array(await res.arrayBuffer()));
  }
  return K.aesDec(S.keys[b.g].key, K.join(parts));
}
async function openBook(id, page) {
  const b = byId(id); if (!b || !S.keys[b.g]) return;
  closeMenu();
  R.book = b; R.pdf = null; R.zoom = 1;
  $("#rTitle").textContent = title(b); $("#rSub").textContent = L.grade(b.g) + (b.author ? ", " + b.author : "");
  $("#reader").hidden = false; document.body.style.overflow = "hidden";
  history.pushState({ reader: 1 }, "");
  updateDl(); $("#rFoot").hidden = false;
  $("#stage").innerHTML = `<p class="placeholder muted">${esc(L.loading)}</p>`;
  try {
    const data = await getBookBytes(b);
    const pdf = await pdfjsLib.getDocument({ data, cMapUrl: "pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "pdfjs/standard_fonts/" }).promise;
    if (R.book !== b) return;
    R.pdf = pdf; R.page = Math.min(page || store.get("page:" + b.id, 1), pdf.numPages);
    $("#rRange").max = pdf.numPages; draw();
  } catch (e) { if (R.book === b) $("#stage").innerHTML = `<p class="placeholder">${esc(L.error)}</p>`; }
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
  const scale = Math.min(sw / (base.width * shown.length), sh / base.height) * R.zoom, dpr = Math.min(window.devicePixelRatio || 1, 2);
  const wrap = document.createElement("div"); wrap.className = "spread";
  for (const p of pages) {
    const vp = p.getViewport({ scale: scale * dpr }), c = document.createElement("canvas");
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    c.style.width = Math.floor(vp.width / dpr) + "px"; c.style.height = Math.floor(vp.height / dpr) + "px";
    wrap.appendChild(c); R.task.push(p.render({ canvasContext: c.getContext("2d"), viewport: vp }));
  }
  stage.innerHTML = ""; stage.appendChild(wrap); stage.scrollTo(0, 0);
  $("#rRange").value = R.page; $("#rNum").innerHTML = `<b>${shown.join("–")}</b> / ${R.pdf.numPages}`;
  $("#rMark").classList.toggle("on", isMarked()); $("#rMark").setAttribute("aria-label", isMarked() ? L.delMark : L.addMark);
  saveProgress(); Promise.all(R.task.map(t => t.promise)).catch(() => {});
}
function step(dir) {
  if (!R.pdf) return;
  const shown = pagesShown(), n = R.pdf.numPages;
  const p = Math.max(1, Math.min(n, dir > 0 ? shown[shown.length - 1] + 1 : shown[0] - 1));
  if (p !== R.page || shown.length > 1) { R.page = p; draw(); }
}
function saveProgress() {
  const b = R.book; if (!b) return;
  store.set("page:" + b.id, R.page);
  const rec = store.get("recent", []).filter(r => r.id !== b.id);
  rec.unshift({ id: b.id, page: R.page, total: R.pdf.numPages }); store.set("recent", rec.slice(0, 6));
  store.set("tot:" + b.id, R.pdf.numPages);
}
function closeReaderSilently() {
  if ($("#reader").hidden) return;
  $("#reader").hidden = true; document.body.style.overflow = "";
  R.task.forEach(t => { try { t.cancel(); } catch (e) {} });
  if (R.pdf) R.pdf.destroy(); R.pdf = null; R.book = null;
}
function closeReader(fromPop) { if ($("#reader").hidden) return; closeReaderSilently(); if (!fromPop) history.back(); render(); }
const isMarked = () => R.book && store.get("marks", []).some(m => m.id === R.book.id && m.page === R.page);
function toggleMark() {
  if (!R.pdf) return;
  let marks = store.get("marks", []);
  if (isMarked()) marks = marks.filter(m => !(m.id === R.book.id && m.page === R.page));
  else { marks.unshift({ id: R.book.id, page: R.page }); toast(L.addMark + " ✓"); }
  store.set("marks", marks); draw();
}
function updateDl() {
  const b = R.book, btn = $("#rDl"); if (!b) return;
  const done = downloaded.has(b.id); btn.classList.toggle("done", done);
  btn.innerHTML = ico(done ? "check" : "down") + `<span>${wide.matches ? esc(done ? L.downloaded : L.download) : ""}</span>`;
}
async function download(b) {
  if (!b || !("caches" in window)) return;
  if (downloaded.has(b.id)) return toast(L.downloaded);
  $("#rDl span").textContent = "…";
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    const c = await caches.open(BOOKS_CACHE), urls = K.partUrls(b);
    for (let i = 0; i < urls.length; i++) { $("#rDl span").textContent = urls.length > 1 ? Math.round(i / urls.length * 100) + "%" : "…"; if (!(await c.match(urls[i]))) { const res = await fetch(urls[i]); if (!res.ok) throw 0; await c.put(urls[i], res); } }
    downloaded.add(b.id); store.set("dl", [...downloaded]); toast(L.downloaded + ": " + title(b));
  } catch (e) { toast(L.error); }
  updateDl();
}
async function undownload(id) {
  const b = byId(id);
  try { const c = await caches.open(BOOKS_CACHE), own = new Set(b ? K.partPaths(b).map(p => K.BASE + p) : []); for (const r of await c.keys()) if (own.has(r.url.split("?")[0])) await c.delete(r); } catch (e) {}
  downloaded.delete(id); store.set("dl", [...downloaded]); render();
}
async function syncDownloads() {
  if (!("caches" in window)) return;
  try {
    const c = await caches.open(BOOKS_CACHE), valid = new Set(BOOKS().flatMap(K.partUrls));
    for (const r of await c.keys()) if (!valid.has(r.url)) await c.delete(r);
    const keys = new Set((await c.keys()).map(r => r.url));
    downloaded = new Set(BOOKS().filter(b => K.partUrls(b).every(u => keys.has(u))).map(b => b.id)); store.set("dl", [...downloaded]);
  } catch (e) {}
}

// ============ СОБЫТИЯ ============
addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; render(); });
document.addEventListener("submit", e => {
  const f = e.target; e.preventDefault();
  if (f.id === "fLogin") doLogin(f); else if (f.id === "fReg") doRegister(f); else if (f.id === "fPw") changePassword(f); else if (f.id === "fFix") sendFix(f);
});
document.addEventListener("click", async e => {
  if (e.target.id === "modal") { $("#modal").hidden = true; return; }
  const t = e.target.closest("button,[data-open]"); if (!t) return;
  const d = t.dataset;
  if (d.auth) { if (d.auth === "register") await loadData().catch(() => {}); showAuth(d.auth); }
  else if (d.logout !== undefined) { if (confirm(L.logout + "?")) wipe(); }
  else if (d.cabinet !== undefined) location.href = K.BASE + "admin/";
  else if (d.share !== undefined) { const p = await idb.get("pending"), url = requestLink(p.req);
    if (navigator.share) navigator.share({ title: L.app, text: L.shareText(fullName(p.req)), url }).catch(() => {}); else navigator.clipboard.writeText(url).then(() => toast(L.copied)); }
  else if (d.copylink !== undefined) { const p = await idb.get("pending"), url = requestLink(p.req); navigator.clipboard.writeText(url).then(() => toast(L.copied), () => prompt(L.copy, url)); }
  else if (d.resend !== undefined) { await checkPending(); if (await idb.get("pending")) showPending(); }
  else if (d.cancelreq !== undefined) { clearInterval(showPending.t); await idb.del("pending"); showAuth("register"); }
  else if (d.open) openBook(d.open, d.page ? +d.page : 0);
  else if (d.grade) setGrade(+d.grade);
  else if (d.view) go(d.view);
  else if (d.mview) { closeMenu(); go(d.mview); }
  else if (d.mopen) openBook(d.mopen);
  else if (d.undl) undownload(d.undl);
  else if (d.unmark) { const m = store.get("marks", []); m.splice(+d.unmark, 1); store.set("marks", m); render(); }
  else if (d.install !== undefined) { closeMenu(); if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; } else installHelp(); }
  else if (d.noinstall !== undefined) { store.set("noinstall", 1); render.force = true; render(); }
  else if (d.closemodal !== undefined) $("#modal").hidden = true;
});
document.addEventListener("input", e => { if (e.target.id === "q") { query = e.target.value; renderShelf.focus = true; renderShelf(); renderShelf.focus = false; } });
$("#menuBtn").onclick = () => go("profile"); $("#menuClose").onclick = closeMenu;
$("#rBack").onclick = () => closeReader(false);
$("#rPrev").onclick = () => step(-1); $("#rNext").onclick = () => step(1);
$("#rRange").oninput = e => { $("#rNum").innerHTML = `<b>${e.target.value}</b> / ${R.pdf ? R.pdf.numPages : ""}`; };
$("#rRange").onchange = e => { R.page = +e.target.value; draw(); };
$("#rZoomIn").onclick = () => { R.zoom = Math.min(R.zoom * 1.25, 4); draw(); };
$("#rZoomOut").onclick = () => { R.zoom = Math.max(R.zoom / 1.25, 1); draw(); };
$("#rMark").onclick = toggleMark; $("#rDl").onclick = () => download(R.book);
addEventListener("popstate", () => closeReader(true));
addEventListener("keydown", e => {
  if ($("#reader").hidden) { if (e.key === "Escape") closeMenu(); return; }
  if (e.key === "ArrowRight" || e.key === "PageDown") step(1);
  if (e.key === "ArrowLeft" || e.key === "PageUp") step(-1);
  if (e.key === "Escape") closeReader(false);
});
let sx = null, sy = 0;
$("#stage").addEventListener("touchstart", e => { sx = e.touches.length === 1 && R.zoom === 1 ? e.touches[0].clientX : null; sy = e.touches[0].clientY; }, { passive: true });
$("#stage").addEventListener("touchend", e => { if (sx === null) return; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1); });
// на телефоне при прокрутке прячется/показывается адресная строка и меняется высота окна —
// перерисовываем полку только при смене ширины (поворот), иначе обложки «моргают»
let rt, lastW = innerWidth, lastH = innerHeight;
addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => {
  const wChanged = innerWidth !== lastW, hBig = Math.abs(innerHeight - lastH) > 150; lastW = innerWidth; lastH = innerHeight;
  if (!$("#reader").hidden) { if (wChanged || hBig) { draw(); updateDl(); } }
  else if (wChanged) { render.force = true; render(); }
}, 150); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && S) refresh(); });

async function refresh() {
  try { await loadData(); } catch (e) { return; }
  if (!(await syncKeys())) return wipe(L.wiped);
  await syncDownloads(); render();
}
fillStatic();
(async () => {
  try { S = await idb.get("session"); } catch (e) { S = null; }
  if (S) {
    me = store.get("me", null); CAT = store.get("cat", CAT); SCH = store.get("sch", SCH);
    if (me) enterApp();
    await refresh();
    if (!me && S) wipe();
    return;
  }
  if (await idb.get("pending").catch(() => null)) { showPending(); checkPending(); return; }
  showAuth("login");
})();
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js"));
})();
