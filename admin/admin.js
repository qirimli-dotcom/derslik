(() => {
"use strict";
const { $, esc, ico, idb, GRADES, subj, title, color, fullName, initials, toast, fld, sel, U_ATTR, json } = K;
const store = K.makeStore("cantam-adm:");
let USERS = { v: 1, users: [] }, CAT = { v: 1, kv: {}, books: [] }, SCH = { v: 1, schools: [] };
const schoolName = id => { const x = (SCH.schools || []).find(s => s.id === id); return x ? x.name : ""; };
let me = null, S = null, admTab = "apps";

// ============ GitHub API ============
const GH = {
  cfg() { return store.get("gh", null); },
  async req(path, opt = {}) {
    const g = this.cfg(); if (!g || !g.token) { const e = new Error("token"); throw e; }
    const r = await fetch((g.api || "https://api.github.com") + path, { ...opt, cache: "no-store", headers: { "Authorization": "Bearer " + g.token, "Accept": opt.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json", ...(opt.body ? { "Content-Type": "application/json" } : {}) } });
    if (!r.ok) { const e = new Error("gh " + r.status); e.status = r.status; throw e; }
    return opt.raw ? r : r.json();
  },
  repo() { return "/repos/" + this.cfg().repo; },
  async branch() { const g = this.cfg(); if (!g.branch) { g.branch = (await this.req(this.repo())).default_branch; store.set("gh", g); } return g.branch; },
  async raw(path) { return this.req(this.repo() + "/contents/" + path + "?ref=" + await this.branch() + "&t=" + Date.now(), { raw: true }); },
  async readJson(path, dflt) { try { return await (await this.raw(path)).json(); } catch (e) { if (e.status === 404) return dflt; throw e; } },
  async commit(files, message) {
    const R = this.repo(), br = await this.branch(), tree = [], list = Object.entries(files);
    const big = list.filter(([, c]) => c && typeof c !== "string" && c.length > 1e6).length; let done = 0;
    for (const [path, content] of list) {   // сначала файлы (долго), потом быстрый коммит
      if (content === null) { tree.push({ path, mode: "100644", type: "blob", sha: null }); continue; }
      const u8 = typeof content === "string" ? K.te.encode(content) : content;
      if (u8.length > 1e6) { done++; toast(L.uploading + " " + Math.round(done / big * 100) + "% (" + done + "/" + big + ")"); }
      let blob, tries = 0;
      while (true) { try { blob = await this.req(R + "/git/blobs", { method: "POST", body: JSON.stringify({ content: K.b64(u8), encoding: "base64" }) }); break; }
        catch (e) { if (++tries >= 4 || e.status === 401 || e.status === 403) { e.message = "part " + done + "/" + big + ": " + (e.status || e.message); throw e; } await new Promise(r => setTimeout(r, 3000 * tries)); } }
      tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const ref = await this.req(R + "/git/ref/heads/" + br), head = await this.req(R + "/git/commits/" + ref.object.sha);
    const t = await this.req(R + "/git/trees", { method: "POST", body: JSON.stringify({ base_tree: head.tree.sha, tree }) });
    const c = await this.req(R + "/git/commits", { method: "POST", body: JSON.stringify({ message, tree: t.sha, parents: [ref.object.sha] }) });
    await this.req(R + "/git/refs/heads/" + br, { method: "PATCH", body: JSON.stringify({ sha: c.sha }) });
  }
};
const guessRepo = () => { const h = location.hostname, seg = location.pathname.split("/").filter(Boolean)[0] || ""; return h.endsWith(".github.io") ? h.split(".")[0] + "/" + seg : ""; };
async function freshData() {
  if (GH.cfg() && GH.cfg().token) { USERS = await GH.readJson("data/users.json", USERS); CAT = await GH.readJson("data/catalog.json", CAT); SCH = await GH.readJson("data/schools.json", SCH); }
  else { USERS = await K.fetchPublic("data/users.json", USERS); CAT = await K.fetchPublic("data/catalog.json", CAT); SCH = await K.fetchPublic("data/schools.json", SCH); }
}

// ============ ВХОД ============
function authFrame(body) {
  $("#auth").hidden = false; $("#cab").hidden = true;
  $("#aTitle").textContent = L.cabinet; $("#aSlogan").textContent = L.app;
  $("#authBody").innerHTML = body;
}
function showLogin(msg) {
  authFrame(`<form class="form" id="fLogin">${fld("u", L.username, U_ATTR + ' autocomplete="username"')}${fld("p", L.password, 'type="password" required autocomplete="current-password"')}
    <div class="err" id="aErr">${esc(msg || "")}</div><button class="btn-main" type="submit">${esc(L.doLogin)}</button></form>
    <p class="alink"><button type="button" data-toapp>${esc(L.toApp)}</button></p>`);
}
async function unwrapAll(rec, priv) { const keys = {}; for (const [g, w] of Object.entries(rec.k || {})) keys[g] = { v: w.v, key: await K.unwrap(w, priv, true) }; return keys; }
async function doLogin(f) {
  const err = $("#aErr"), btn = f.querySelector("button"), u = f.u.value.trim().toLowerCase(), pass = f.p.value;
  err.textContent = ""; btn.disabled = true;
  try {
    await freshData();
    const rec = USERS.users.find(x => x.u === u);
    if (!rec) throw new Error("login");
    if (rec.r !== "admin") { err.textContent = L.notAdmin; btn.disabled = false; return; }
    let priv; try { priv = await K.openIdentity(rec, pass); } catch (e) { throw new Error("login"); }
    S = { u, pub: rec.pub, priv, keys: await unwrapAll(rec, priv) }; me = rec;
    if (rec.tmp) return showFirst(pass);
    await idb.set("admsession", S); store.set("me", me); enterCab();
  } catch (e) { err.textContent = e.message === "login" ? L.errLogin : L.errNet; btn.disabled = false; }
}
function showFirst() {
  const g = GH.cfg() || {};
  authFrame(`<div class="pending" style="text-align:left"><h2>${esc(L.firstLogin)}</h2><p class="muted" style="margin:0">${esc(L.firstText)}</p></div>
    <form class="form" id="fFirst" autocomplete="off">
      <div class="two">${fld("n", L.name, `required value="${esc(me.n || "")}"`)}${fld("s", L.surname, `value="${esc(me.s || "")}"`)}</div>
      ${fld("u", L.username, U_ATTR + ` value="${esc(me.u)}"`)}
      ${fld("p", L.newPass, 'type="password" required minlength="8" autocomplete="new-password"')}
      ${fld("p2", L.password2, 'type="password" required minlength="8" autocomplete="new-password"')}
      ${fld("repo", L.repo, `required value="${esc(g.repo || guessRepo())}" placeholder="login/cantam" autocapitalize="none"`)}
      ${fld("token", L.token, 'required type="password" autocomplete="off"', L.tokenHint)}
      <div class="err" id="aErr"></div><button class="btn-main" type="submit">${esc(L.save)}</button></form>`);
}
// первый вход: новый пароль, новая пара ключей и новые ключи всех классов (временный пароль больше ничего не открывает)
async function doFirst(f) {
  const d = Object.fromEntries(new FormData(f).entries()), err = $("#aErr"), btn = f.querySelector("button");
  d.u = d.u.trim().toLowerCase();
  const bad = K.checkNewUser(d); if (bad) return err.textContent = bad;
  btn.disabled = true; btn.textContent = L.saving;
  try {
    const prev = GH.cfg() || {};
    store.set("gh", { api: prev.api, token: d.token.trim(), repo: d.repo.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, "") });
    await GH.req(GH.repo());
    const oldKeys = S.keys; await freshData();
    const id = await K.makeIdentity(d.p);
    const oldU = me.u;
    me = { u: d.u, n: d.n.trim(), s: d.s.trim(), g: 0, l: "", r: "admin", salt: id.salt, pub: id.pub, ep: id.ep, k: {}, a: Date.now() };
    USERS.users = USERS.users.filter(x => x.u !== oldU && x.u !== d.u).concat(me);
    S = { u: me.u, pub: me.pub, priv: id.priv, keys: oldKeys };
    const files = {};
    for (const g of GRADES) await rotate(g, files);
    files["data/users.json"] = json(USERS); files["data/catalog.json"] = json(CAT);
    await GH.commit(files, "İdareci: ilk kiriş");
    await idb.set("admsession", S); store.set("me", me);
    toast(L.saved + ". " + L.deploying); enterCab();
  } catch (e) {
    err.textContent = (e.status === 401 || e.status === 403 || e.status === 404 || e.message === "token") ? L.tokenBad : L.error;
    btn.disabled = false; btn.textContent = L.save;
  }
}
async function logout() {
  S = null; me = null; try { await idb.del("admsession"); } catch (e) {}
  const gh = store.get("gh", null); store.clear(); if (gh) store.set("gh", gh);
  showLogin();
}

// ============ КАБИНЕТ ============
const reqs = () => store.get("reqs", []);
function enterCab() {
  $("#auth").hidden = true; $("#cab").hidden = false;
  $("#cabTitle").innerHTML = esc(L.cabinet) + `<small>${esc(fullName(me))} · ${esc(me.u)}</small>`;
  handleReqLink(); render(); syncIssues();
  clearInterval(enterCab.t); enterCab.t = setInterval(syncIssues, 60000);
}
function parseReq(text) {
  const m = String(text).match(/req=([A-Za-z0-9_-]+)/) || String(text).trim().match(/^([A-Za-z0-9_-]{100,})$/);
  if (!m) return null;
  try { const r = JSON.parse(K.td.decode(K.ub64(m[1]))); return r && r.u && r.pub && (r.fix || (r.ep && r.salt)) ? r : null; } catch (e) { return null; }
}
async function syncIssues() {   // заявки, которые ученики отправили автоматически
  try {
    const cfg = await K.config(); if (!cfg.it) return;
    const list = await K.issuesApi(cfg, "?state=open&per_page=100&t=" + Date.now());
    let cur = reqs(), changed = false;
    for (const i of list) {
      if (!String(i.title || "").startsWith(K.REQ_TAG)) continue;
      const r = parseReq(i.body || ""); if (!r) continue;
      r._issue = i.number;
      if (!cur.some(x => x.u === r.u && x.pub === r.pub && x.t === r.t)) { cur.unshift(r); changed = true; }
    }
    if (changed) { store.set("reqs", cur); render(); }
  } catch (e) { console.warn("issues", e); }
}
async function closeIssue(r) {
  if (!r || !r._issue) return;
  try { const cfg = await K.config(); await K.issuesApi(cfg, "/" + r._issue, { method: "PATCH", body: JSON.stringify({ state: "closed" }) }); } catch (e) {}
}
function addReq(r) { store.set("reqs", [r].concat(reqs().filter(x => !(x.u === r.u && x.pub === r.pub && !!x.fix === !!r.fix)))); }
function handleReqLink() {
  const r = parseReq(location.hash); if (!r) return;
  history.replaceState(null, "", location.pathname + location.search);
  addReq(r); admTab = "apps";
}
async function busy(fn) {
  if (!GH.cfg() || !GH.cfg().token) { toast(L.needToken); admTab = "settings"; return render(); }
  const v = $("#view"); v.style.opacity = ".5"; v.style.pointerEvents = "none"; toast(L.saving);
  try { await fn(); } catch (e) { console.error(e); const msg = e.status === 401 || e.status === 403 ? L.tokenBad : e.message === "big" ? L.tooBig : L.error + " — " + (e.message || e.status || e);
    toast(msg); alert(msg); }
  v.style.opacity = ""; v.style.pointerEvents = ""; await idb.set("admsession", S).catch(() => {}); render();
}
async function save(files, msg) { await GH.commit(files, msg); toast(L.saved + ". " + L.deploying); }
async function keysFor(u) {
  const gs = u.r === "student" ? [u.g] : GRADES, k = {};
  for (const g of gs) if (S.keys[g]) k[g] = await K.wrapFor(u.pub, await K.rawKey(S.keys[g].key), CAT.kv[g] || 1);
  return k;
}
async function rotate(g, files) {
  const raw = K.rnd(32), key = await K.importAes(raw, true), v = (CAT.kv[g] || 0) + 1;
  for (const b of CAT.books.filter(b => b.g === g)) {
    const oldPaths = K.partPaths(b), old = [];
    for (const p of oldPaths) old.push(new Uint8Array(await (await GH.raw(p)).arrayBuffer()));
    const chunks = K.split(await K.aesEnc(key, await K.aesDec(S.keys[g].key, K.join(old))));
    if (!b.f.endsWith(".bin")) b.f += ".bin";
    if (chunks.length > 1) b.n = chunks.length; else delete b.n;
    const paths = K.partPaths(b); chunks.forEach((part, i) => files[paths[i]] = part);
    for (const p of oldPaths) if (!paths.includes(p)) files[p] = null;
    b.kv = v;
  }
  CAT.kv[g] = v;
  for (const u of USERS.users) if (u.r !== "student" || u.g === g) { u.k = u.k || {}; u.k[g] = await K.wrapFor(u.pub, raw, v); }
  S.keys[g] = { v, key };
}
async function approve(r) {
  if (r.fix) return approveFix(r);
  await busy(async () => {
    await freshData();
    const old = USERS.users.find(x => x.u === r.u);
    if (old && old.pub !== r.pub && !confirm(L.replaceUser)) return;
    const role = old && (old.r === "admin" || r.pw) ? old.r : r.r === "teacher" ? "teacher" : "student";
    const base = r.pw && old ? old : r;   // смена пароля: данные ученика прежние, меняется только ключ
    const u = { u: r.u, n: base.n, s: base.s, g: +base.g || 0, l: base.l || "", sc: base.sc || "", r: role, salt: r.salt, pub: r.pub, ep: r.ep, a: Date.now() };
    u.k = await keysFor(u);
    USERS.users = USERS.users.filter(x => x.u !== r.u).concat(u);
    await save({ "data/users.json": json(USERS) }, "Tasdıq: " + r.u);
    store.set("reqs", reqs().filter(x => !(x.u === r.u && x.pub === r.pub)));
    await closeIssue(r);
  });
}
async function approveFix(r) {   // исправление данных ученика по его просьбе
  await busy(async () => {
    await freshData();
    const u = USERS.users.find(x => x.u === r.u && x.pub === r.pub);
    if (u) {
      const cls = u.g !== +r.g || u.l !== r.l;
      u.n = r.n; u.s = r.s; u.sc = r.sc || ""; u.g = +r.g || 0; u.l = r.l || "";
      if (cls) u.k = await keysFor(u);
      await save({ "data/users.json": json(USERS) }, "Tüzetüv: " + r.u);
    }
    store.set("reqs", reqs().filter(x => !(x.u === r.u && x.t === r.t)));
    await closeIssue(r);
  });
}
async function removeUser(id, block) {
  await busy(async () => {
    await freshData();
    const u = USERS.users.find(x => x.u === id); if (!u) return;
    USERS.users = USERS.users.filter(x => x.u !== id);
    const files = {};
    if (block) { for (const g of u.r === "student" ? [u.g] : GRADES) await rotate(g, files); files["data/catalog.json"] = json(CAT); }
    files["data/users.json"] = json(USERS);
    await save(files, (block ? "Blok: " : "Sil: ") + id);
  });
}
async function editUserSave(id, g, l, r, sc, n, sn) {
  await busy(async () => {
    await freshData();
    const u = USERS.users.find(x => x.u === id); if (!u) return;
    u.g = g; u.l = l; u.r = r; u.sc = sc || ""; if (n) u.n = n; u.s = sn || ""; u.k = await keysFor(u);
    await save({ "data/users.json": json(USERS) }, "Deñişiklik: " + id);
  });
}
async function moveClass(from, to) {
  const [fg, fl] = from.split("-"), [tg, tl] = to.split("-"); let n = 0;
  await busy(async () => {
    await freshData();
    for (const u of USERS.users) if (u.r === "student" && u.g == fg && u.l === fl) { u.g = +tg; u.l = tl; u.k = await keysFor(u); n++; }
    await save({ "data/users.json": json(USERS) }, "Sınıf: " + from + " → " + to);
    toast(L.moved(n));
  });
}
// ---------- обложки
const coverFields = (b = {}) => `<div class="fld"><span>${esc(L.cover)}</span>
  <div class="coverrow"><div class="cvprev">${K.coverSrc(b) ? `<img src="${esc(K.coverSrc(b))}" alt="">` : ""}</div>
  <div style="flex:1;display:flex;flex-direction:column;gap:8px"><input name="curl" type="url" placeholder="https://…" autocomplete="off" value="${esc(b.cu || "")}">
  <input name="cfile" type="file" accept="image/*">${K.coverSrc(b) ? `<label class="chk"><input type="checkbox" name="cdel"> ${esc(L.coverDel)}</label>` : ""}</div></div>
  <small>${esc(L.coverHint)}</small></div>`;
async function shrinkImage(blob) {   // уменьшаем до 360px по ширине, JPEG ~40 КБ
  const url = URL.createObjectURL(blob), img = new Image();
  try { img.src = url; await img.decode(); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  const w = Math.min(360, img.naturalWidth), h = Math.round(img.naturalHeight * w / img.naturalWidth);
  const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h);
  const out = await new Promise(r => c.toBlob(r, "image/jpeg", 0.82));
  return new Uint8Array(await out.arrayBuffer());
}
// обложка из формы: файл → в репозиторий; ссылка → пробуем скачать в репозиторий, не вышло — храним ссылку
async function applyCover(fd, b, files) {
  const file = fd.get("cfile"), url = String(fd.get("curl") || "").trim();
  if (fd.get("cdel")) { if (b.c) files[b.c] = null; delete b.c; delete b.cu; delete b.cv; return; }
  let blob = null;
  if (file && file.size) blob = file;
  else if (url && url !== b.cu) { try { const r = await fetch(url, { mode: "cors" }); if (r.ok) blob = await r.blob(); } catch (e) {} if (!blob) { b.cu = url; toast(L.coverLinkOnly); return; } }
  if (!blob) return;
  const path = "covers/" + b.id + ".jpg";
  files[path] = await shrinkImage(blob); b.c = path; b.cv = (b.cv || 0) + 1; delete b.cu;
}
function previewCover(input) {
  const box = input.closest(".coverrow").querySelector(".cvprev");
  const src = input.type === "file" ? (input.files[0] ? URL.createObjectURL(input.files[0]) : "") : input.value.trim();
  box.innerHTML = src ? `<img src="${esc(src)}" alt="" onerror="this.remove()">` : "";
}
function editBook(id) {
  const b = CAT.books.find(x => x.id === id); if (!b) return;
  modal(`<h2>${esc(title(b))}</h2><form class="form" id="fEditBook" data-id="${esc(b.id)}" style="padding:0">
    ${sel("subject", L.subject, Object.entries(SUBJECTS), b.subject)}
    ${fld("t", L.bookTitle, `maxlength="80" value="${esc(b.t || "")}"`, L.bookTitleHint)}
    <div class="two">${fld("part", L.partLbl, `maxlength="10" value="${esc(b.part || "")}"`)}${fld("author", L.author, `maxlength="80" value="${esc(b.author || "")}"`)}</div>
    ${coverFields(b)}<button class="btn-main" type="submit">${esc(L.save)}</button></form><button class="btn-ghost" data-close>${esc(L.cancel)}</button>`);
}
async function saveBook(f) {
  const fd = new FormData(f), id = f.dataset.id;
  closeModal();
  await busy(async () => {
    await freshData();
    const b = CAT.books.find(x => x.id === id); if (!b) return;
    b.subject = fd.get("subject"); b.t = String(fd.get("t") || "").trim(); b.part = String(fd.get("part") || "").trim(); b.author = String(fd.get("author") || "").trim();
    if (!b.t) delete b.t;
    const files = {};
    await applyCover(fd, b, files);
    files["data/catalog.json"] = json(CAT);
    await save(files, "Derslik: " + title(b));
  });
}
async function uploadBook(f) {
  const fd = new FormData(f), file = fd.get("file");
  if (!file || !file.size) return;
  if (file.size > 150 * 1024 * 1024) return toast(L.tooBig);
  await busy(async () => {
    await freshData();
    const g = +fd.get("g"), id = Date.now().toString(36) + K.b64u(K.rnd(3));
    toast(L.encrypting);
    const enc = await K.aesEnc(S.keys[g].key, new Uint8Array(await file.arrayBuffer())), chunks = K.split(enc);
    const b = { id, g, subject: fd.get("subject"), part: String(fd.get("part") || "").trim(), author: String(fd.get("author") || "").trim(), f: "books/g" + g + "/" + id + ".bin", kv: CAT.kv[g] || 1, size: file.size };
    const t = String(fd.get("t") || "").trim(); if (t) b.t = t;
    if (chunks.length > 1) b.n = chunks.length;
    const files = {}; K.partPaths(b).forEach((p, i) => files[p] = chunks[i]);
    await applyCover(fd, b, files);
    CAT.books.push(b);
    CAT.books.sort((a, c) => a.g - c.g || a.subject.localeCompare(c.subject) || String(a.part).localeCompare(String(c.part)));
    files["data/catalog.json"] = json(CAT);
    await save(files, "Derslik: " + title(b) + ", " + g);
  });
}
async function deleteBook(id) {
  await busy(async () => {
    await freshData();
    const b = CAT.books.find(x => x.id === id); if (!b) return;
    CAT.books = CAT.books.filter(x => x.id !== id);
    const files = { "data/catalog.json": json(CAT) }; K.partPaths(b).forEach(p => files[p] = null); if (b.c) files[b.c] = null;
    await save(files, "Sil: " + title(b));
  });
}
async function changePass(f) {
  const d = { u: me.u, p: f.p.value, p2: f.p2.value }, bad = K.checkNewUser(d);
  if (bad) return toast(bad);
  await busy(async () => {
    await freshData();
    const u = USERS.users.find(x => x.u === me.u);
    let np; try { np = await K.repass(u, f.old.value, d.p); } catch (e) { throw Object.assign(new Error(L.errLogin), { status: 0 }); }
    Object.assign(u, np); me = u;
    await save({ "data/users.json": json(USERS) }, "Parol: " + me.u);
  });
}

// ============ ЭКРАНЫ ============
const classOf = u => u.g + "-" + u.l;
function userRow(u, acts, cls) {
  const pill = u.r !== "student" ? `<span class="pill ${u.r}">${esc(L.roles[u.r])}</span>` : "";
  const line = [schoolName(u.sc), u.g ? L.cls(u.g, u.l) : "", u.u].filter(Boolean).join(" · ");
  return `<div class="arow ${cls || ""}"><div class="av">${esc(initials(u))}</div><div class="t"><b>${esc(fullName(u))}${pill}</b><small>${esc(line)}</small></div><div class="acts">${acts}</div></div>`;
}
function render() {
  if (!me) return;
  const tabs = [["apps", "clock", L.apps], ["students", "users", L.students], ["books", "book", L.booksAdm], ["settings", "gear", L.settings]], n = reqs().length;
  let h = `<div class="seg adm">${tabs.map(([k, i, t]) => `<button data-adm="${k}" class="${admTab === k ? "on" : ""}">${ico(i)}${esc(t)}${k === "apps" && n ? ` <span class="badge">${n}</span>` : ""}</button>`).join("")}</div>`;
  if (!GH.cfg() || !GH.cfg().token) h += `<p class="err">${esc(L.needToken)}</p>`;
  if (admTab === "apps") {
    h += `<form class="form" id="fPaste"><label class="fld"><span>${esc(L.pasteCode)}</span><input name="code" autocomplete="off" autocapitalize="none"></label><button class="btn-ghost" type="submit">${esc(L.addApp)}</button></form>` +
      (n ? `<div class="list">${reqs().map((r, i) => { const ex = USERS.users.some(x => x.u === r.u);
        const o = USERS.users.find(x => x.u === r.u);
        const was = r.fix && o ? " · " + L.fixTag + " (" + L.was + ": " + [fullName(o), schoolName(o.sc), o.g ? L.cls(o.g, o.l) : ""].filter(Boolean).join(", ") + ")" : "";
        return userRow({ n: r.n, s: r.s, g: r.g, l: r.l, sc: r.sc, u: r.u + (r.pw ? " · " + L.pwReq : r.fix ? was : ex ? " ⚠" : ""), r: r.r === "teacher" ? "teacher" : "student" }, `<button class="sbtn no" data-rejectreq="${i}">${esc(L.reject)}</button><button class="sbtn ok" data-approvereq="${i}">${esc(L.approve)}</button>`, "stack"); }).join("")}</div>`
      : `<p class="empty">${esc(L.noApps)}</p>`);
  } else if (admTab === "students") {
    const classes = [...new Set(USERS.users.filter(u => u.g).map(classOf))].sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b));
    const f = render.filter || "", fs = render.school || "", q = (render.q || "").toLowerCase();
    const list = USERS.users.filter(u => (!f || classOf(u) === f) && (!fs || u.sc === fs) && (!q || (fullName(u) + " " + u.u).toLowerCase().includes(q))).sort((a, b) => a.g - b.g || String(a.l).localeCompare(b.l) || String(a.s).localeCompare(b.s));
    h += `<div class="tools"><label class="search">${ico("search")}<input id="uq" type="search" value="${esc(render.q || "")}" placeholder="${esc(L.name)} / ${esc(L.username)}"></label>
      <select id="uf"><option value="">${esc(L.allClasses)}</option>${classes.map(c => `<option ${c === f ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
      ${(SCH.schools || []).length ? `<select id="us"><option value="">${esc(L.allSchools)}</option>${SCH.schools.map(x => `<option value="${esc(x.id)}" ${x.id === fs ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>` : ""}</div>
      <div class="tools"><button class="sbtn" data-newyear>${ico("clock")} ${esc(L.newYear)}</button><button class="sbtn" data-moveclass>${ico("swap")} ${esc(L.moveClass)}</button><span class="muted" style="font-size:14px">${USERS.users.length}</span></div>
      <div class="list">${list.map(u => userRow(u, `<button class="ib" data-edituser="${esc(u.u)}" aria-label="${esc(L.change)}">${ico("next")}</button>`)).join("") || `<p class="empty">${esc(L.nothing)}</p>`}</div>`;
  } else if (admTab === "books") {
    h += `<form class="form" id="fBook"><div class="two">${sel("g", L.gradeLbl, GRADES, render.lastG || 5)}${sel("subject", L.subject, Object.entries(SUBJECTS), "mat")}</div>
      ${fld("t", L.bookTitle, 'maxlength="80"', L.bookTitleHint)}
      <div class="two">${fld("part", L.partLbl, 'maxlength="10" inputmode="numeric"')}${fld("author", L.author, 'maxlength="80"')}</div>
      ${coverFields()}
      <label class="fld"><span>${esc(L.file)}</span><input name="file" type="file" accept="application/pdf" required></label>
      <button class="btn-main" type="submit">${ico("upload")} ${esc(L.addBook)}</button></form>` +
      GRADES.map(g => { const bs = CAT.books.filter(b => b.g === g); return bs.length ? `<div class="gh">${esc(L.grade(g))}</div><div class="list">${bs.map(b => `<div class="item">${K.coverSrc(b) ? `<img class="mini" src="${esc(K.coverSrc(b))}" alt="">` : `<div class="mini" style="--c:${color(b)}"></div>`}<div class="t">${esc(title(b))}<small>${esc([subj(b), b.author, b.size ? (b.size / 1048576).toFixed(1) + " MB" : ""].filter(Boolean).join(" · "))}</small></div><button class="ib" data-editbook="${esc(b.id)}" aria-label="${esc(L.change)}">${ico("gear")}</button><button class="ib" data-delbook="${esc(b.id)}" aria-label="${esc(L.del)}">${ico("trash")}</button></div>`).join("")}</div>` : ""; }).join("");
  } else {
    const g = GH.cfg() || {};
    h += `<form class="form" id="fSchools"><h2 class="ftitle">${esc(L.schools)}</h2>
      ${(SCH.schools || []).map(x => `<div class="srow"><input data-sid="${esc(x.id)}" value="${esc(x.name)}" aria-label="${esc(L.schoolNameLbl)}"><button type="button" class="ib" data-delschool="${esc(x.id)}" aria-label="${esc(L.del)}">${ico("trash")}</button></div>`).join("")}
      ${fld("add", L.addSchool, `placeholder="${esc(L.schoolNameLbl)}"`)}
      <button class="btn-main" type="submit">${esc(L.save)}</button></form>
      <form class="form" id="fGh"><h2 class="ftitle">GitHub</h2>${fld("repo", L.repo, `value="${esc(g.repo || guessRepo())}" autocapitalize="none" required`)}${fld("token", L.token, `value="${esc(g.token || "")}" type="password" autocomplete="off" required`, L.tokenHint)}
      <button class="btn-main" type="submit">${esc(L.save)}</button><button class="btn-ghost" type="button" data-checkgh>${esc(L.check)}</button></form>
      <form class="form" id="fIt"><h2 class="ftitle">${esc(L.apps)}</h2>${fld("it", L.reqToken, 'type="password" autocomplete="off" required', L.reqTokenHint)}
      <button class="btn-main" type="submit">${esc(L.save)}</button></form>
      <p class="muted" style="margin:0;font-size:12px;text-align:center">v${K.VER}</p>
      <form class="form" id="fPass"><h2 class="ftitle">${esc(L.changePass)}</h2>${fld("old", L.oldPass, 'type="password" required autocomplete="current-password"')}${fld("p", L.newPass, 'type="password" required minlength="8" autocomplete="new-password"')}${fld("p2", L.password2, 'type="password" required minlength="8" autocomplete="new-password"')}
      <button class="btn-main" type="submit">${esc(L.changePass)}</button></form>`;
  }
  $("#view").innerHTML = h;
  const uq = $("#uq"); if (uq && render.focus) { uq.focus(); uq.setSelectionRange(99, 99); render.focus = false; }
}
function modal(html) { $("#modalBox").innerHTML = html; $("#modal").hidden = false; }
function closeModal() { $("#modal").hidden = true; $("#modalBox").innerHTML = ""; }
function editUser(id) {
  const u = USERS.users.find(x => x.u === id); if (!u) return;
  const self = u.u === me.u;
  modal(`<div class="userline" style="padding:0"><div class="av">${esc(initials(u))}</div><div class="t"><b>${esc(fullName(u))}</b><small>${u.g ? esc(L.cls(u.g, u.l)) + " · " : ""}${esc(u.u)}</small></div></div>
    <form class="form" id="fUser" data-id="${esc(u.u)}" style="padding:0">
      <div class="two">${fld("n", L.name, `required value="${esc(u.n || "")}"`)}${fld("s", L.surname, `value="${esc(u.s || "")}"`)}</div>
      ${(SCH.schools || []).length ? sel("sc", L.school, [["", "—"]].concat(SCH.schools.map(x => [x.id, x.name])), u.sc || "") : ""}
      <div class="two">${sel("g", L.gradeLbl, [[0, "—"]].concat(GRADES.map(g => [g, g])), u.g)}${sel("l", L.letter, [["", "—"]].concat(LETTERS.map(l => [l, l])), u.l)}</div>
      ${self ? "" : sel("r", L.role, Object.entries(L.roles), u.r)}
      <button class="btn-main" type="submit">${esc(L.save)}</button></form>
    ${self ? "" : `<button class="btn-ghost" data-blockuser="${esc(u.u)}" style="color:#A1251B">${ico("lock")} ${esc(L.block)}</button><p class="muted" style="margin:-6px 0 0;font-size:12px;text-align:center">${esc(L.blockText)}</p>
    <button class="btn-ghost" data-deluser="${esc(u.u)}">${ico("trash")} ${esc(L.del)}</button>`}
    <button class="btn-ghost" data-close>${esc(L.close)}</button>`);
}
function newYearForm() {
  const opts = [["", L.allSchools]].concat((SCH.schools || []).map(x => [x.id, x.name]));
  const count = sc => { const st = USERS.users.filter(u => u.r === "student" && u.g && (!sc || u.sc === sc)); return [st.filter(u => u.g < 11).length, st.filter(u => u.g === 11).length]; };
  const [n, m] = count("");
  modal(`<h2>${esc(L.newYear)}</h2><form class="form" id="fYear" style="padding:0">${(SCH.schools || []).length ? sel("sc", L.school, opts, "") : ""}
    <p class="muted" style="margin:0" id="yText">${esc(L.newYearText(n, m))}</p>
    <label class="chk"><input type="checkbox" name="del" checked> ${esc(L.delGrads)}</label>
    <button class="btn-main" type="submit">${esc(L.newYear)}</button></form><button class="btn-ghost" data-close>${esc(L.cancel)}</button>`);
  const s = $("#fYear [name=sc]"); if (s) s.onchange = () => { const [a, b] = count(s.value); $("#yText").textContent = L.newYearText(a, b); };
}
async function newYear(sc, delGrads) {
  let n = 0, m = 0;
  await busy(async () => {
    await freshData();
    const out = [];
    for (const u of USERS.users) {
      if (u.r !== "student" || !u.g || (sc && u.sc !== sc)) { out.push(u); continue; }
      if (u.g >= 11) { m++; if (delGrads) continue; u.g = 0; u.l = ""; u.k = {}; out.push(u); continue; }
      u.g += 1; u.k = await keysFor(u); n++; out.push(u);
    }
    USERS.users = out;
    await save({ "data/users.json": json(USERS) }, L.newYear + (sc ? ": " + schoolName(sc) : ""));
    toast(L.newYearDone(n, m));
  });
}
function moveClassForm() {
  const classes = [...new Set(USERS.users.filter(u => u.r === "student").map(classOf))];
  const all = []; for (const g of GRADES) LETTERS.forEach(l => all.push(g + "-" + l));
  modal(`<h2>${esc(L.moveClass)}</h2><form class="form" id="fMove" style="padding:0"><div class="two">${sel("from", L.from, classes)}${sel("to", L.to, all)}</div><button class="btn-main" type="submit">${esc(L.moveClass)}</button></form><button class="btn-ghost" data-close>${esc(L.cancel)}</button>`);
}

// ============ СОБЫТИЯ ============
document.addEventListener("submit", e => {
  const f = e.target; e.preventDefault();
  if (f.id === "fLogin") doLogin(f);
  else if (f.id === "fFirst") doFirst(f);
  else if (f.id === "fBook") { render.lastG = +f.g.value; uploadBook(f); }
  else if (f.id === "fPaste") { const r = parseReq(f.code.value); if (!r) return toast(L.badCode); addReq(r); render(); }
  else if (f.id === "fGh") { const g = GH.cfg() || {}; store.set("gh", { ...g, repo: f.repo.value.trim(), token: f.token.value.trim(), branch: "" }); toast(L.saved); render(); }
  else if (f.id === "fPass") changePass(f);
  else if (f.id === "fEditBook") saveBook(f);
  else if (f.id === "fIt") { const tok = f.it.value.trim(); busy(async () => { const g = GH.cfg(), cfg = { repo: g.repo, it: K.obf(tok) }; if (g.api) cfg.api = g.api;
    await K.issuesApi(cfg, "?per_page=1"); await save({ "data/config.json": json(cfg) }, "Arıza tokeni"); }); }
  else if (f.id === "fUser") { closeModal(); const u = USERS.users.find(x => x.u === f.dataset.id); editUserSave(f.dataset.id, +f.g.value, f.l.value, f.r ? f.r.value : u.r, f.sc ? f.sc.value : u.sc, f.n.value.trim(), f.s.value.trim()); }
  else if (f.id === "fMove") { closeModal(); moveClass(f.from.value, f.to.value); }
  else if (f.id === "fYear") { const sc = f.sc ? f.sc.value : "", del = f.del.checked; closeModal(); newYear(sc, del); }
  else if (f.id === "fSchools") { const names = [...f.querySelectorAll("[data-sid]")].map(i => ({ id: i.dataset.sid, name: i.value.trim() })).filter(x => x.name);
    const add = f.add.value.trim(); if (add) names.push({ id: "s" + Date.now().toString(36), name: add });
    busy(async () => { SCH = { v: 1, schools: names }; await save({ "data/schools.json": json(SCH) }, L.schools); }); }
});
document.addEventListener("click", async e => {
  if (e.target.id === "modal") return closeModal();
  const t = e.target.closest("button"); if (!t) return;
  const d = t.dataset;
  if (d.toapp !== undefined) location.href = K.BASE;
  else if (d.logout !== undefined) { if (confirm(L.logout + "?")) logout(); }
  else if (d.adm) { admTab = d.adm; render(); if (d.adm === "apps") syncIssues(); }
  else if (d.approvereq) approve(reqs()[+d.approvereq]);
  else if (d.rejectreq) { const l = reqs(), [r] = l.splice(+d.rejectreq, 1); store.set("reqs", l); render(); closeIssue(r); }
  else if (d.edituser) editUser(d.edituser);
  else if (d.blockuser) { if (confirm(L.block + "? " + L.blockText)) { closeModal(); removeUser(d.blockuser, true); } }
  else if (d.deluser) { if (confirm(L.confirmDel)) { closeModal(); removeUser(d.deluser, false); } }
  else if (d.moveclass !== undefined) moveClassForm();
  else if (d.newyear !== undefined) newYearForm();
  else if (d.delschool) { const inp = document.querySelector(`[data-sid="${d.delschool}"]`); if (inp && confirm(L.confirmDel)) { inp.value = ""; inp.closest(".srow").style.display = "none"; } }
  else if (d.editbook) editBook(d.editbook);
  else if (d.delbook) { if (confirm(L.confirmDel)) deleteBook(d.delbook); }
  else if (d.checkgh !== undefined) { try { await GH.req(GH.repo()); toast(L.tokenOk); } catch (x) { toast(L.tokenBad); } }
  else if (d.close !== undefined) closeModal();
});
document.addEventListener("input", e => { if (e.target.id === "uq") { render.q = e.target.value; render.focus = true; render(); } });
document.addEventListener("change", e => { if (e.target.name === "curl" || e.target.name === "cfile") previewCover(e.target); });
document.addEventListener("change", e => { if (e.target.id === "uf") { render.filter = e.target.value; render(); } if (e.target.id === "us") { render.school = e.target.value; render(); } });
addEventListener("hashchange", () => { if (me) { handleReqLink(); render(); } });
addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

$("#toAppBtn").setAttribute("aria-label", L.toApp); $("#outBtn").setAttribute("aria-label", L.logout);
(async () => {
  try { S = await idb.get("admsession"); } catch (e) { S = null; }
  me = store.get("me", null);
  if (S && me) {
    try { await freshData(); const u = USERS.users.find(x => x.u === S.u && x.pub === S.pub); if (!u) return logout(); me = u; store.set("me", me);
      for (const [g, w] of Object.entries(u.k)) if (!S.keys[g] || S.keys[g].v !== w.v) S.keys[g] = { v: w.v, key: await K.unwrap(w, S.priv, true) };
      await idb.set("admsession", S);
    } catch (e) {}
    return enterCab();
  }
  showLogin();
})();
})();
