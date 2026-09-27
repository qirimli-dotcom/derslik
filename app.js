(() => {
"use strict";
// ============ UTILS ============
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const ico = (id, cls = "") => `<svg class="${cls}"><use href="#i-${id}"/></svg>`;
const store = {
  get(k, d) { try { const v = localStorage.getItem("cantam:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("cantam:" + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem("cantam:" + k); } catch (e) {} },
  clear(keep) { try { Object.keys(localStorage).filter(k => k.startsWith("cantam:") && !(keep || []).includes(k.slice(7))).forEach(k => localStorage.removeItem(k)); } catch (e) {} }
};
const idb = (() => {
  let db;
  const open = () => db || (db = new Promise((res, rej) => { const r = indexedDB.open("cantam", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const tx = async (mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction("kv", mode), s = t.objectStore("kv"), q = fn(s); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  return { get: k => tx("readonly", s => s.get(k)), set: (k, v) => tx("readwrite", s => s.put(v, k)), del: k => tx("readwrite", s => s.delete(k)) };
})();
const COLORS = { mat:"#2848B8", alg:"#1F5FA8", geo:"#3A4BA8", rus:"#B8322B", crh:"#1E6E57", crhedb:"#17604B", oqu:"#B5651D",
  edb:"#A42A5E", etr:"#2F7A1F", bio:"#3F7F22", eng:"#5E36B0", tar:"#9A4515", cog:"#1F7068", fiz:"#0F6F84", kim:"#7E3AA3", inf:"#44607A" };
const GRADES = [1,2,3,4,5,6,7,8,9,10,11];
const wide = matchMedia("(min-width: 900px)");
const BOOKS_CACHE = "cantam-books";
const BASE = new URL(".", location.href).href;          // корень сайта (для GitHub Pages — /repo/)
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2800); }

// ============ CRYPTO ============
const C = crypto.subtle, te = new TextEncoder(), td = new TextDecoder();
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
function b64(u8) { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function ub64(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
const b64u = u8 => b64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
async function pwKey(pass, salt) {
  const base = await C.importKey("raw", te.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return C.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 250000 }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function aesEnc(key, data) { const iv = rnd(12); return cat(iv, new Uint8Array(await C.encrypt({ name: "AES-GCM", iv }, key, data))); }
async function aesDec(key, buf) { buf = new Uint8Array(buf); return new Uint8Array(await C.decrypt({ name: "AES-GCM", iv: buf.subarray(0, 12) }, key, buf.subarray(12))); }
const importAes = (raw, extractable) => C.importKey("raw", raw, "AES-GCM", extractable, ["encrypt", "decrypt"]);
async function ecdhAes(priv, pubRaw) {
  const pub = await C.importKey("raw", pubRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const bits = await C.deriveBits({ name: "ECDH", public: pub }, priv, 256);
  return importAes(new Uint8Array(await C.digest("SHA-256", bits)), false);
}
// новый пользователь: пара ключей, приватный ключ шифруется паролем
async function makeIdentity(pass) {
  const salt = rnd(16), kp = await C.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = new Uint8Array(await C.exportKey("raw", kp.publicKey));
  const pk8 = new Uint8Array(await C.exportKey("pkcs8", kp.privateKey));
  const ep = await aesEnc(await pwKey(pass, salt), pk8);
  const priv = await C.importKey("pkcs8", pk8, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  return { salt: b64(salt), pub: b64(pub), ep: b64(ep), priv };
}
async function openIdentity(u, pass) {
  const pk8 = await aesDec(await pwKey(pass, ub64(u.salt)), ub64(u.ep));   // бросит ошибку при неверном пароле
  return C.importKey("pkcs8", pk8, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
}
// зашифровать ключ класса для пользователя (по его публичному ключу)
async function wrapFor(pubB64, rawKey, v) {
  const eph = await C.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const k = await ecdhAes(eph.privateKey, ub64(pubB64));
  return { v, e: b64(new Uint8Array(await C.exportKey("raw", eph.publicKey))), c: b64(await aesEnc(k, rawKey)) };
}
async function unwrap(w, priv, extractable) { return importAes(await aesDec(await ecdhAes(priv, ub64(w.e)), ub64(w.c)), extractable); }

// ============ GITHUB API (только для администратора) ============
const GH = {
  cfg() { return store.get("gh", null); },
  async req(path, opt = {}) {
    const g = this.cfg(); if (!g || !g.token) throw new Error("token");
    const r = await fetch((g.api || "https://api.github.com") + path, { ...opt, cache: "no-store", headers: { "Authorization": "Bearer " + g.token, "Accept": opt.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json", ...(opt.body ? { "Content-Type": "application/json" } : {}) } });
    if (!r.ok) { const e = new Error("gh " + r.status); e.status = r.status; throw e; }
    return opt.raw ? r : r.json();
  },
  repo() { const g = this.cfg(); return "/repos/" + g.repo; },
  async branch() { const g = this.cfg(); if (!g.branch) { g.branch = (await this.req(this.repo())).default_branch; store.set("gh", g); } return g.branch; },
  async readJson(path, dflt) {
    try { const r = await this.req(this.repo() + "/contents/" + path + "?ref=" + await this.branch() + "&t=" + Date.now(), { raw: true }); return await r.json(); }
    catch (e) { if (e.status === 404) return dflt; throw e; }
  },
  // один коммит с несколькими файлами: {path: Uint8Array|string|null(удалить)}
  async commit(files, message) {
    const R = this.repo(), br = await this.branch();
    const ref = await this.req(R + "/git/ref/heads/" + br);
    const head = await this.req(R + "/git/commits/" + ref.object.sha);
    const tree = [];
    for (const [path, content] of Object.entries(files)) {
      if (content === null) { tree.push({ path, mode: "100644", type: "blob", sha: null }); continue; }
      const u8 = typeof content === "string" ? te.encode(content) : content;
      const blob = await this.req(R + "/git/blobs", { method: "POST", body: JSON.stringify({ content: b64(u8), encoding: "base64" }) });
      tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const t = await this.req(R + "/git/trees", { method: "POST", body: JSON.stringify({ base_tree: head.tree.sha, tree }) });
    const c = await this.req(R + "/git/commits", { method: "POST", body: JSON.stringify({ message, tree: t.sha, parents: [ref.object.sha] }) });
    await this.req(R + "/git/refs/heads/" + br, { method: "PATCH", body: JSON.stringify({ sha: c.sha }) });
  }
};
const json = o => JSON.stringify(o, null, 1);

// ============ STATE ============
let USERS = { v: 1, users: [] }, CAT = { v: 1, kv: {}, books: [] };
let me = null;           // запись пользователя из users.json
let S = null;            // сессия: { u, priv, keys: {g: {v, key}} }
let grade = 0, view = "shelf", admTab = "apps", query = "";
let downloaded = new Set(store.get("dl", []));
const isStaff = () => me && (me.r === "admin" || me.r === "teacher");
const isAdmin = () => me && me.r === "admin";
const subj = b => SUBJECTS[b.subject] || b.subject;
const title = b => subj(b) + (b.part ? ", " + L.part(b.part) : "");
const color = b => COLORS[b.subject] || "#44607A";
const BOOKS = () => CAT.books.filter(b => S && S.keys[b.g]);
const byId = id => CAT.books.find(b => b.id === id);
const bookUrl = b => BASE + b.f + "?v=" + b.kv;
const fullName = u => [u.n, u.s].filter(Boolean).join(" ");
const initials = u => ((u.n || "?")[0] + ((u.s || "")[0] || "")).toUpperCase();

async function fetchPublic(path, dflt) {
  const r = await fetch(BASE + path + "?t=" + Date.now(), { cache: "no-store" });
  if (r.status === 404) return dflt;
  if (!r.ok) throw new Error("net");
  return r.json();
}
async function loadData() {
  const [u, c] = await Promise.all([fetchPublic("data/users.json", null), fetchPublic("data/catalog.json", null)]);
  if (u) USERS = u; if (c) CAT = c;
  store.set("cat", CAT);
  return !!u;
}

// ============ SESSION ============
async function saveSession() { await idb.set("session", S); }
async function syncKeys() {   // сверить ключи сессии с users.json (после смены ключа класса)
  const u = USERS.users.find(x => x.u === S.u);
  if (!u || u.pub !== S.pub) return false;
  me = u; store.set("me", me);
  let changed = false;
  for (const g of Object.keys(S.keys)) if (!u.k[g]) { delete S.keys[g]; changed = true; }
  for (const [g, w] of Object.entries(u.k)) if (!S.keys[g] || S.keys[g].v !== w.v) { S.keys[g] = { v: w.v, key: await unwrap(w, S.priv, isAdmin()) }; changed = true; }
  if (changed) await saveSession();
  return true;
}
async function wipe(msg) {
  S = null; me = null;
  try { await idb.del("session"); await idb.del("pending"); } catch (e) {}
  try { await caches.delete(BOOKS_CACHE); } catch (e) {}
  store.clear(["gh"]); downloaded = new Set(); CAT = { v: 1, kv: {}, books: [] };
  closeReaderSilently(); closeMenu(); closeModal();
  showAuth("login", msg);
}

// ============ AUTH SCREENS ============
function authFrame(body) {
  $("#auth").hidden = false; $("#app").hidden = true;
  $("#aTitle").textContent = L.app; $("#aSlogan").textContent = L.slogan;
  $("#authBody").innerHTML = body;
}
const fld = (name, label, attrs = "", hint = "") => `<label class="fld"><span>${esc(label)}</span><input name="${name}" ${attrs}>${hint ? `<small>${esc(hint)}</small>` : ""}</label>`;
const sel = (name, label, opts, v) => `<label class="fld"><span>${esc(label)}</span><select name="${name}">${opts.map(o => `<option ${o == v ? "selected" : ""}>${o}</option>`).join("")}</select></label>`;
const U_ATTR = 'required autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="32"';
function showAuth(mode, msg) {
  const reg = mode === "register";
  authFrame(reg ? `<form class="form" id="fReg" autocomplete="off">
      <h2 class="ftitle">${esc(L.register)}</h2>
      <div class="two">${fld("n", L.name, 'required maxlength="40"')}${fld("s", L.surname, 'required maxlength="60"')}</div>
      <div class="two">${sel("g", L.gradeLbl, GRADES, 5)}${sel("l", L.letter, LETTERS, "A")}</div>
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
  window.scrollTo(0, 0); $("#auth").scrollTop = 0;
}
function showSetup() {
  const h = location.hostname, seg = location.pathname.split("/").filter(Boolean)[0] || "";
  const guess = h.endsWith(".github.io") ? h.split(".")[0] + "/" + seg : "";
  authFrame(`<div class="pending" style="text-align:left"><h2>${esc(L.setup)}</h2><p class="muted" style="margin:0">${esc(L.setupText)}</p></div>
    <form class="form" id="fSetup" autocomplete="off">
      <div class="two">${fld("n", L.name, 'required')}${fld("s", L.surname, '')}</div>
      ${fld("u", L.username, U_ATTR)}
      ${fld("p", L.password, 'type="password" required minlength="8" autocomplete="new-password"')}
      ${fld("p2", L.password2, 'type="password" required minlength="8" autocomplete="new-password"')}
      ${fld("repo", L.repo, `required value="${esc(guess)}" placeholder="login/cantam" autocapitalize="none"`)}
      ${fld("token", L.token, 'required autocapitalize="none" autocomplete="off"', L.tokenHint)}
      <div class="err" id="aErr"></div><button class="btn-main" type="submit">${esc(L.setupDo)}</button></form>`);
}
function requestLink(req) { return BASE + "#req=" + b64u(te.encode(JSON.stringify(req))); }
async function showPending() {
  const p = await idb.get("pending"); if (!p) return showAuth("register");
  const link = requestLink(p.req);
  let qrSvg = "";
  try { const q = qrcode(0, "L"); q.addData(link); q.make(); qrSvg = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); } catch (e) {}
  authFrame(`<div class="pending"><div class="ico">${ico("clock")}</div><h2>${esc(L.appReady)}</h2>
    <p class="muted" style="margin:0">${esc(L.appSend)}</p>
    <div class="qrbox">${qrSvg}</div>
    <p style="margin:0"><b>${esc(fullName(p.req))}</b><br><span class="muted">${esc(L.cls(p.req.g, p.req.l))}, ${esc(p.req.u)}</span></p>
    <button class="btn-main share" data-share>${esc(L.appShare)}</button>
    <button class="btn-ghost" data-copylink>${esc(L.copy)}</button>
    <p class="muted" style="margin:0;font-size:13px">${esc(L.appAfter)}</p>
    <button class="btn-ghost" data-cancelreq>${esc(L.appCancel)}</button></div>`);
  clearInterval(showPending.t);
  showPending.t = setInterval(checkPending, 30000);
}
async function checkPending() {
  const p = await idb.get("pending"); if (!p) return;
  try { await loadData(); } catch (e) { return; }
  const u = USERS.users.find(x => x.u === p.req.u && x.pub === p.req.pub);
  if (!u) return;
  clearInterval(showPending.t);
  S = { u: u.u, pub: u.pub, priv: p.priv, keys: {} }; me = u;
  await syncKeys(); await saveSession(); await idb.del("pending");
  enterApp();
}
async function doRegister(f) {
  const d = Object.fromEntries(new FormData(f).entries()), err = $("#aErr"), btn = f.querySelector("button[type=submit]");
  d.u = d.u.trim().toLowerCase(); err.textContent = "";
  if (!/^[a-z0-9._-]{3,32}$/.test(d.u)) return err.textContent = L.errUser;
  if (d.p.length < 8) return err.textContent = L.errPassLen;
  if (d.p !== d.p2) return err.textContent = L.errPass2;
  btn.disabled = true;
  try {
    const id = await makeIdentity(d.p);
    const req = { v: 1, u: d.u, n: d.n.trim(), s: d.s.trim(), g: +d.g, l: d.l, salt: id.salt, pub: id.pub, ep: id.ep, t: Date.now() };
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
    try { priv = await openIdentity(rec, f.p.value); } catch (e) { err.textContent = L.errLogin; btn.disabled = false; return; }
    S = { u, pub: rec.pub, priv, keys: {} }; me = rec;
    await syncKeys(); await saveSession(); await idb.del("pending");
    enterApp();
  } catch (e) { err.textContent = L.errNet; btn.disabled = false; }
}
async function doSetup(f) {
  const d = Object.fromEntries(new FormData(f).entries()), err = $("#aErr"), btn = f.querySelector("button");
  d.u = d.u.trim().toLowerCase(); err.textContent = "";
  if (!/^[a-z0-9._-]{3,32}$/.test(d.u)) return err.textContent = L.errUser;
  if (d.p.length < 8) return err.textContent = L.errPassLen;
  if (d.p !== d.p2) return err.textContent = L.errPass2;
  btn.disabled = true; btn.textContent = L.saving;
  try {
    const prev = store.get("gh", {}) || {};
    store.set("gh", { token: d.token.trim(), repo: d.repo.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, ""), api: prev.api });
    const existing = await GH.readJson("data/users.json", null);
    if (existing && existing.users && existing.users.length) throw new Error("exists");
    const id = await makeIdentity(d.p);
    const kv = {}, keys = {}, k = {};
    for (const g of GRADES) {
      const raw = rnd(32); kv[g] = 1;
      k[g] = await wrapFor(id.pub, raw, 1);
      keys[g] = { v: 1, key: await importAes(raw, true) };
    }
    const admin = { u: d.u, n: d.n.trim(), s: d.s.trim(), g: 0, l: "", r: "admin", salt: id.salt, pub: id.pub, ep: id.ep, k, a: Date.now() };
    USERS = { v: 1, users: [admin] }; CAT = { v: 1, kv, books: [] };
    await GH.commit({ "data/users.json": json(USERS), "data/catalog.json": json(CAT) }, "Derslik Çantam: qurulış");
    S = { u: d.u, pub: id.pub, priv: id.priv, keys }; me = admin;
    await saveSession(); store.set("me", me); store.set("cat", CAT);
    toast(L.setupDone); enterApp();
  } catch (e) {
    err.textContent = e.message === "exists" ? L.errTaken : (e.status === 401 || e.status === 403 || e.status === 404 || e.message === "token") ? L.tokenBad : String(e.message || e);
    btn.disabled = false; btn.textContent = L.setupDo;
  }
}

// ============ APP ============
function enterApp() {
  $("#auth").hidden = true; $("#app").hidden = false;
  grade = isStaff() ? store.get("grade", 5) : me.g;
  syncDownloads().then(render);
  render();
  if (isAdmin()) handleReqLink();
}
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
const reqs = () => store.get("reqs", []);
function renderChrome() {
  if (!me) return;
  const n = reqs().length, badge = n ? `<span class="badge">${n}</span>` : "";
  const tabs = [["shelf", "shelf", L.tabShelf], ["offline", "down", L.tabOffline], ["marks", "mark", L.tabMarks]];
  if (isAdmin()) tabs.push(["admin", "shield", L.admin]);
  $("#tabs").innerHTML = tabs.map(([v, i, t]) => `<button class="tab ${view === v ? "on" : ""}" data-view="${v}">${ico(i)}${esc(t)}${v === "admin" ? badge : ""}</button>`).join("");
  $("#sideGradesLabel").hidden = $("#sideGrades").hidden = !isStaff();
  $("#sideGrades").innerHTML = isStaff() ? GRADES.map(g => `<button class="chip ${g === grade && view === "shelf" ? "on" : ""}" data-grade="${g}">${g}</button>`).join("") : "";
  const links = [["shelf", "shelf", L.tabShelf], ["offline", "down", L.tabOffline + (downloaded.size ? ": " + downloaded.size : "")], ["marks", "mark", L.tabMarks]];
  if (isAdmin()) links.push(["admin", "shield", L.admin]);
  links.push(["help", "help", L.help]);
  $("#sideLinks").innerHTML = links.map(([v, i, t]) => `<button class="${view === v ? "on" : ""}" data-view="${v}">${ico(i)}${esc(t)}${v === "admin" && n ? " " + badge : ""}</button>`).join("") + `<button data-logout>${ico("out")}${esc(L.logout)}</button>`;
}
function coverHtml(b) {
  return `<button class="book" data-open="${esc(b.id)}" aria-label="${esc(title(b) + ", " + L.grade(b.g))}"><div class="cover" style="--c:${color(b)}">
    <div><b>${esc(subj(b))}</b>${b.part ? `<br><em>${esc(L.part(b.part))}</em>` : ""}</div><span class="g">${b.g}</span>
    ${downloaded.has(b.id) ? `<span class="ok">${ico("check")}</span>` : ""}</div></button>`;
}
function shelvesHtml(list) {
  const W = $("#view").clientWidth - 24, bw = wide.matches ? 124 : 98, gap = wide.matches ? 22 : 14;
  const per = Math.max(2, Math.floor((W + gap) / (bw + gap))); let out = "";
  for (let i = 0; i < list.length; i += per) {
    const row = list.slice(i, i + per);
    out += `<div class="shelf" style="--bw:${bw}px;--gap:${gap}px"><div class="row">${row.map(coverHtml).join("")}</div><div class="plank"></div><div class="names">${row.map(b => `<span>${esc(b.author || "")}</span>`).join("")}</div></div>`;
  }
  return out;
}
function contHtml() {
  const rec = store.get("recent", []).map(r => ({ ...r, b: byId(r.id) })).filter(r => r.b && S.keys[r.b.g]).slice(0, 2);
  if (!rec.length) return "";
  return `<div class="conts">${rec.map(r => { const pct = r.total ? Math.round(r.page / r.total * 100) : 0;
    return `<button class="cont" data-open="${esc(r.id)}"><div class="mini" style="--c:${color(r.b)}"></div><div class="t"><small>${esc(L.cont)}</small><b>${esc(title(r.b))}</b><div class="bar"><i style="width:${pct}%"></i></div><small>${esc(L.page)} ${r.page}${r.total ? " / " + r.total : ""}</small></div></button>`; }).join("")}</div>`;
}
let deferredPrompt = null;
function installHtml() {
  if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) return "";
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (deferredPrompt) return `<div class="install"><svg class="logo"><use href="#logo"/></svg><div class="t">${esc(L.install)}</div><button class="btn" data-install>${esc(L.install)}</button></div>`;
  if (ios) return `<div class="install"><svg class="logo"><use href="#logo"/></svg><div class="t"><b>${esc(L.install)}</b><br><span class="muted">${esc(L.installIos)}</span></div></div>`;
  return "";
}
const searchHtml = () => `<label class="search">${ico("search")}<input id="q" type="search" value="${esc(query)}" placeholder="${esc(L.search)}" aria-label="${esc(L.search)}" autocomplete="off"></label>`;
function renderShelf() {
  const q = query.trim().toLowerCase(), all = BOOKS();
  const list = all.filter(b => q ? (title(b) + " " + (b.author || "") + " " + b.g).toLowerCase().includes(q) : b.g === grade);
  const count = all.filter(b => b.g === grade).length;
  const clsName = isStaff() ? L.grade(grade) : L.cls(me.g, me.l);
  const head = wide.matches ? `<div class="hello"><div><h1>${esc(clsName)}</h1><p>${esc(L.books(count))}</p></div>${searchHtml()}</div>`
    : `<div class="hello"><div><h1>${esc(L.hello + ", " + (me.n || "") + "!")}</h1><p>${esc(clsName + ", " + L.books(count))}</p></div>${searchHtml()}</div>`;
  const chips = isStaff() ? `<div class="chips">${GRADES.map(g => `<button class="chip ${g === grade ? "on" : ""}" data-grade="${g}">${g === grade ? esc(L.grade(g)) : g}</button>`).join("")}</div>` : "";
  $("#view").innerHTML = head + chips + (q ? "" : contHtml()) + (list.length ? shelvesHtml(list) : `<p class="empty">${esc(q ? L.nothing : L.soonText)}</p>`) + installHtml();
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
  $("#view").innerHTML = `<h1>${esc(L.help)}</h1><div class="list">${L.helpText.map(t => `<div class="item"><div class="t">${esc(t)}</div></div>`).join("")}</div>${installHtml()}<p class="muted">${esc(L.app)} — ${esc(L.slogan)}</p>`;
}
function render() {
  if (!me) return;
  if (view === "admin" && !isAdmin()) view = "shelf";
  renderChrome();
  ({ shelf: renderShelf, offline: renderOffline, marks: renderMarks, help: renderHelp, admin: renderAdmin }[view] || renderShelf)();
}
function go(v) { view = v; query = ""; render(); window.scrollTo(0, 0); $(".main").scrollTop = 0; }
function setGrade(g) { grade = g; store.set("grade", g); go("shelf"); }

// ============ MENU / MODAL ============
function openMenu() {
  const rec = store.get("recent", [])[0], rb = rec && byId(rec.id);
  const row = (act, i, t, sub, on, extra) => `<button class="mrow ${on ? "on" : ""}" ${act}><span class="ic">${ico(i)}</span><span class="t">${esc(t)}${sub ? `<small>${esc(sub)}</small>` : ""}</span>${extra || ""}${ico("next")}</button>`;
  const n = reqs().length;
  $("#menuBody").innerHTML = `<div class="userline"><div class="av">${esc(initials(me))}</div><div class="t"><b>${esc(fullName(me))}</b><small>${esc(L.roles[me.r])}${me.g ? ", " + esc(L.cls(me.g, me.l)) : ""} · ${esc(me.u)}</small></div></div>` +
    row('data-mview="shelf"', "shelf", L.tabShelf, "", view === "shelf") +
    (rb && S.keys[rb.g] ? row(`data-mopen="${esc(rb.id)}"`, "book", L.cont, title(rb) + ", " + L.page + " " + rec.page) : "") +
    row('data-mview="offline"', "down", L.tabOffline, "", view === "offline") +
    row('data-mview="marks"', "mark", L.tabMarks, "", view === "marks") +
    (isAdmin() ? row('data-mview="admin"', "shield", L.admin, "", view === "admin", n ? `<span class="badge">${n}</span>` : "") : "") +
    row('data-mview="help"', "lang", L.lang, L.langName) + row('data-mview="help"', "help", L.help, "", view === "help") + row("data-logout", "out", L.logout, "");
  $("#menu").hidden = false;
}
function closeMenu() { $("#menu").hidden = true; }
function modal(html) { $("#modalBox").innerHTML = html; $("#modal").hidden = false; }
function closeModal() { $("#modal").hidden = true; $("#modalBox").innerHTML = ""; }

// ============ ADMIN ============
async function rawKey(g) { return new Uint8Array(await C.exportKey("raw", S.keys[g].key)); }
function parseReq(text) {
  const m = String(text).match(/req=([A-Za-z0-9_-]+)/) || String(text).trim().match(/^([A-Za-z0-9_-]{100,})$/);
  if (!m) return null;
  try { const r = JSON.parse(td.decode(ub64(m[1]))); return r && r.u && r.pub && r.ep && r.salt ? r : null; } catch (e) { return null; }
}
function addReq(r) {
  const list = reqs().filter(x => !(x.u === r.u && x.pub === r.pub));
  list.unshift(r); store.set("reqs", list);
}
function handleReqLink() {
  const r = parseReq(location.hash);
  if (!r) return;
  history.replaceState(null, "", location.pathname + location.search);
  addReq(r); admTab = "apps"; go("admin");
}
// свежие данные прямо из репозитория (Pages обновляется с задержкой)
async function freshData() {
  USERS = await GH.readJson("data/users.json", USERS);
  CAT = await GH.readJson("data/catalog.json", CAT);
}
async function adminSave(files, msg) {
  await GH.commit(files, msg);
  store.set("cat", CAT);
  toast(L.saved + ". " + L.deploying);
}
async function withBusy(fn) {
  if (!GH.cfg() || !GH.cfg().token) { toast(L.needToken); admTab = "settings"; return renderAdmin(); }
  const box = $("#adm"); if (box) box.style.opacity = ".5";
  toast(L.saving);
  try { await fn(); } catch (e) { console.error("admin", e && e.message, e && e.status); toast(e.status === 401 || e.status === 403 ? L.tokenBad : e.status === 409 || e.status === 422 ? L.error + " (" + e.status + ")" : e.message === "big" ? L.tooBig : L.error); }
  if (box) box.style.opacity = "";
  await syncKeys().catch(() => {});
  render();
}
// выдать пользователю ключи: ученику — своего класса, учителю и админу — всех
async function keysFor(u) {
  const gs = u.r === "student" ? [u.g] : GRADES, k = {};
  for (const g of gs) if (S.keys[g]) k[g] = await wrapFor(u.pub, await rawKey(g), CAT.kv[g] || 1);
  return k;
}
async function approve(r) {
  await withBusy(async () => {
    await freshData();
    const old = USERS.users.find(x => x.u === r.u);
    if (old && old.pub !== r.pub && !confirm(L.replaceUser)) return;
    const u = { u: r.u, n: r.n, s: r.s, g: +r.g, l: r.l, r: old ? old.r : "student", salt: r.salt, pub: r.pub, ep: r.ep, a: Date.now() };
    u.k = await keysFor(u);
    USERS.users = USERS.users.filter(x => x.u !== r.u).concat(u);
    await adminSave({ "data/users.json": json(USERS) }, "Tasdıq: " + r.u);
    store.set("reqs", reqs().filter(x => !(x.u === r.u && x.pub === r.pub)));
  });
}
// сменить ключ класса: перешифровать учебники и выдать новый ключ всем, кто остался
async function rotate(g, files) {
  const newRaw = rnd(32), newKey = await importAes(newRaw, true), v = (CAT.kv[g] || 1) + 1;
  for (const b of CAT.books.filter(b => b.g === g)) {
    const enc = new Uint8Array(await (await GH.req(GH.repo() + "/contents/" + b.f + "?ref=" + await GH.branch() + "&t=" + Date.now(), { raw: true })).arrayBuffer());
    files[b.f] = await aesEnc(newKey, await aesDec(S.keys[g].key, enc));
    b.kv = v;
  }
  CAT.kv[g] = v;
  for (const u of USERS.users) if (u.r !== "student" || u.g === g) u.k[g] = await wrapFor(u.pub, newRaw, v);
  S.keys[g] = { v, key: newKey };
}
async function removeUser(id, block) {
  await withBusy(async () => {
    await freshData();
    const u = USERS.users.find(x => x.u === id); if (!u) return;
    USERS.users = USERS.users.filter(x => x.u !== id);
    const files = {};
    if (block) { if (u.r === "student") await rotate(u.g, files); else for (const g of GRADES) await rotate(g, files); files["data/catalog.json"] = json(CAT); }
    files["data/users.json"] = json(USERS);
    await adminSave(files, (block ? "Blok: " : "Sil: ") + id);
  });
}
async function editUserSave(id, g, l, r) {
  await withBusy(async () => {
    await freshData();
    const u = USERS.users.find(x => x.u === id); if (!u) return;
    u.g = g; u.l = l; u.r = r; u.k = await keysFor(u);
    await adminSave({ "data/users.json": json(USERS) }, "Deñişiklik: " + id);
  });
}
async function moveClass(from, to) {
  const [fg, fl] = from.split("-"), [tg, tl] = to.split("-"); let n = 0;
  await withBusy(async () => {
    await freshData();
    for (const u of USERS.users) if (u.r === "student" && u.g == fg && u.l === fl) { u.g = +tg; u.l = tl; u.k = await keysFor(u); n++; }
    await adminSave({ "data/users.json": json(USERS) }, "Sınıf: " + from + " → " + to);
    toast(L.moved(n));
  });
}
async function uploadBook(f) {
  const fd = new FormData(f), file = fd.get("file");
  if (!file || !file.size) return;
  if (file.size > 95 * 1024 * 1024) return toast(L.tooBig);
  await withBusy(async () => {
    await freshData();
    const g = +fd.get("g"), id = Date.now().toString(36) + b64u(rnd(3));
    const enc = await aesEnc(S.keys[g].key, new Uint8Array(await file.arrayBuffer()));
    const b = { id, g, subject: fd.get("subject"), part: String(fd.get("part") || "").trim(), author: String(fd.get("author") || "").trim(), f: "books/g" + g + "/" + id + ".bin", kv: CAT.kv[g] || 1, size: file.size };
    CAT.books.push(b);
    CAT.books.sort((a, c) => a.g - c.g || a.subject.localeCompare(c.subject) || String(a.part).localeCompare(String(c.part)));
    await adminSave({ [b.f]: enc, "data/catalog.json": json(CAT) }, "Derslik: " + title(b) + ", " + g);
  });
}
async function deleteBook(id) {
  await withBusy(async () => {
    await freshData();
    const b = CAT.books.find(x => x.id === id); if (!b) return;
    CAT.books = CAT.books.filter(x => x.id !== id);
    await adminSave({ [b.f]: null, "data/catalog.json": json(CAT) }, "Sil: " + title(b));
  });
}
const classOf = u => u.g + "-" + u.l;
function userRow(u, acts, cls) {
  const pill = u.r !== "student" ? `<span class="pill ${u.r}">${esc(L.roles[u.r])}</span>` : "";
  return `<div class="arow ${cls || ""}"><div class="av">${esc(initials(u))}</div><div class="t"><b>${esc(fullName(u))}${pill}</b><small>${u.g ? esc(L.cls(u.g, u.l)) + " · " : ""}${esc(u.u)}</small></div><div class="acts">${acts}</div></div>`;
}
function renderAdmin() {
  const tabs = [["apps", "clock", L.apps], ["students", "users", L.students], ["books", "book", L.booksAdm], ["settings", "gear", L.settings]];
  const n = reqs().length;
  let html = `<h1>${esc(L.admin)}</h1><div class="seg adm">${tabs.map(([k, i, t]) => `<button data-adm="${k}" class="${admTab === k ? "on" : ""}">${ico(i)}${esc(t)}${k === "apps" && n ? ` <span class="badge">${n}</span>` : ""}</button>`).join("")}</div><div id="adm">`;
  if (admTab === "apps") {
    html += `<form class="form" id="fPaste"><label class="fld"><span>${esc(L.pasteCode)}</span><input name="code" autocomplete="off" autocapitalize="none"></label><button class="btn-ghost" type="submit">${esc(L.addApp)}</button></form>` +
      (n ? `<div class="list">${reqs().map((r, i) => { const exists = USERS.users.some(x => x.u === r.u);
        return userRow({ n: r.n, s: r.s, g: r.g, l: r.l, u: r.u + (exists ? " ⚠" : ""), r: "student" }, `<button class="sbtn no" data-rejectreq="${i}">${esc(L.reject)}</button><button class="sbtn ok" data-approvereq="${i}">${esc(L.approve)}</button>`, "stack"); }).join("")}</div>`
      : `<p class="empty">${esc(L.noApps)}</p>`);
  } else if (admTab === "students") {
    const classes = [...new Set(USERS.users.filter(u => u.g).map(classOf))].sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b));
    const f = renderAdmin.filter || "", q = (renderAdmin.q || "").toLowerCase();
    const list = USERS.users.filter(u => (!f || classOf(u) === f) && (!q || (fullName(u) + " " + u.u).toLowerCase().includes(q))).sort((a, b) => a.g - b.g || String(a.l).localeCompare(b.l) || String(a.s).localeCompare(b.s));
    html += `<div class="tools"><label class="search">${ico("search")}<input id="uq" type="search" value="${esc(renderAdmin.q || "")}" placeholder="${esc(L.name)} / ${esc(L.username)}"></label>
      <select id="uf"><option value="">${esc(L.allClasses)}</option>${classes.map(c => `<option ${c === f ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
      <div class="tools"><button class="sbtn" data-moveclass>${ico("swap")} ${esc(L.moveClass)}</button></div>
      <div class="list">${list.map(u => userRow(u, `<button class="ib" data-edituser="${esc(u.u)}" aria-label="${esc(L.change)}">${ico("next")}</button>`)).join("") || `<p class="empty">${esc(L.nothing)}</p>`}</div>`;
  } else if (admTab === "books") {
    const opt = a => a.map(v => `<option value="${esc(v[0])}">${esc(v[1])}</option>`).join("");
    html += `<form class="form" id="fBook"><div class="two"><label class="fld"><span>${esc(L.gradeLbl)}</span><select name="g">${opt(GRADES.map(g => [g, g]))}</select></label>
      <label class="fld"><span>${esc(L.subject)}</span><select name="subject">${opt(Object.entries(SUBJECTS))}</select></label></div>
      <div class="two">${fld("part", L.partLbl, 'maxlength="10" inputmode="numeric"')}${fld("author", L.author, 'maxlength="80"')}</div>
      <label class="fld"><span>${esc(L.file)}</span><input name="file" type="file" accept="application/pdf" required></label>
      <button class="btn-main" type="submit">${ico("upload")} ${esc(L.addBook)}</button></form>` +
      GRADES.map(g => { const bs = CAT.books.filter(b => b.g === g); return bs.length ? `<div class="gh">${esc(L.grade(g))}</div><div class="list">${bs.map(b => `<div class="item"><div class="mini" style="--c:${color(b)}"></div><button class="t" data-open="${esc(b.id)}">${esc(title(b))}<small>${esc(b.author || "")}${b.size ? " · " + (b.size / 1048576).toFixed(1) + " MB" : ""}</small></button><button class="ib" data-delbook="${esc(b.id)}" aria-label="${esc(L.del)}">${ico("trash")}</button></div>`).join("")}</div>` : ""; }).join("");
  } else {
    const g = GH.cfg() || {};
    html += `<form class="form" id="fGh">${fld("repo", L.repo, `value="${esc(g.repo || "")}" autocapitalize="none" required`)}${fld("token", L.token, `value="${esc(g.token || "")}" type="password" autocomplete="off" required`, L.tokenHint)}
      <button class="btn-main" type="submit">${esc(L.save)}</button><button class="btn-ghost" type="button" data-checkgh>${esc(L.check)}</button></form>`;
  }
  $("#view").innerHTML = html + "</div>";
  const uq = $("#uq"); if (uq && renderAdmin.focus) { uq.focus(); uq.setSelectionRange(99, 99); renderAdmin.focus = false; }
}
function editUser(id) {
  const u = USERS.users.find(x => x.u === id); if (!u) return;
  const opt = (a, v) => a.map(x => `<option value="${esc(x[0])}" ${x[0] == v ? "selected" : ""}>${esc(x[1])}</option>`).join("");
  const self = u.u === me.u;
  modal(`<div class="userline" style="padding:0"><div class="av">${esc(initials(u))}</div><div class="t"><b>${esc(fullName(u))}</b><small>${u.g ? esc(L.cls(u.g, u.l)) + " · " : ""}${esc(u.u)}</small></div></div>
    <form class="form" id="fUser" data-id="${esc(u.u)}" style="padding:0">
      <div class="two"><label class="fld"><span>${esc(L.gradeLbl)}</span><select name="g">${opt([[0, "—"]].concat(GRADES.map(g => [g, g])), u.g)}</select></label>
      <label class="fld"><span>${esc(L.letter)}</span><select name="l">${opt([["", "—"]].concat(LETTERS.map(l => [l, l])), u.l)}</select></label></div>
      <label class="fld"><span>${esc(L.role)}</span><select name="r" ${self ? "disabled" : ""}>${opt(Object.entries(L.roles), u.r)}</select></label>
      <button class="btn-main" type="submit">${esc(L.save)}</button></form>
    ${self ? "" : `<button class="btn-ghost" data-blockuser="${esc(u.u)}" style="color:#A1251B">${ico("lock")} ${esc(L.block)}</button><p class="muted" style="margin:-6px 0 0;font-size:12px;text-align:center">${esc(L.blockText)}</p>
    <button class="btn-ghost" data-deluser="${esc(u.u)}">${ico("trash")} ${esc(L.del)}</button>`}
    <button class="btn-ghost" data-close>${esc(L.close)}</button>`);
}
function moveClassForm() {
  const classes = [...new Set(USERS.users.filter(u => u.r === "student").map(classOf))];
  const all = []; for (const g of GRADES) LETTERS.forEach(l => all.push(g + "-" + l));
  const opt = a => a.map(v => `<option>${esc(v)}</option>`).join("");
  modal(`<h2>${esc(L.moveClass)}</h2><form class="form" id="fMove" style="padding:0"><div class="two"><label class="fld"><span>${esc(L.from)}</span><select name="from">${opt(classes)}</select></label><label class="fld"><span>${esc(L.to)}</span><select name="to">${opt(all)}</select></label></div><button class="btn-main" type="submit">${esc(L.moveClass)}</button></form><button class="btn-ghost" data-close>${esc(L.cancel)}</button>`);
}

// ============ READER ============
const R = { book: null, pdf: null, page: 1, zoom: 1, task: [] };
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "pdfjs/pdf.worker.min.js";
const spreadMode = () => wide.matches && innerWidth > innerHeight;
async function getBookBytes(b, save) {
  const c = await caches.open(BOOKS_CACHE), key = bookUrl(b);
  let res = await c.match(key);
  if (!res) { res = await fetch(key); if (!res.ok) throw new Error("net"); if (save) await c.put(key, res.clone()); }
  return aesDec(S.keys[b.g].key, await res.arrayBuffer());
}
async function openBook(id, page) {
  const b = byId(id); if (!b || !S.keys[b.g]) return;
  closeMenu();
  R.book = b; R.pdf = null; R.zoom = 1;
  $("#rTitle").textContent = title(b);
  $("#rSub").textContent = L.grade(b.g) + (b.author ? ", " + b.author : "");
  $("#reader").hidden = false; document.body.style.overflow = "hidden";
  history.pushState({ reader: 1 }, "");
  updateDl(); $("#rFoot").hidden = false;
  $("#stage").innerHTML = `<p class="placeholder muted">${esc(L.loading)}</p>`;
  try {
    const data = await getBookBytes(b, false);
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
  $("#rRange").value = R.page;
  $("#rNum").innerHTML = `<b>${shown.join("–")}</b> / ${R.pdf.numPages}`;
  $("#rMark").classList.toggle("on", isMarked());
  $("#rMark").setAttribute("aria-label", isMarked() ? L.delMark : L.addMark);
  saveProgress();
  Promise.all(R.task.map(t => t.promise)).catch(() => {});
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
  if (downloaded.has(b.id)) { toast(L.downloaded); return; }
  $("#rDl span").textContent = "…";
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
    const c = await caches.open(BOOKS_CACHE), key = bookUrl(b);
    if (!(await c.match(key))) { const res = await fetch(key); if (!res.ok) throw 0; await c.put(key, res); }
    downloaded.add(b.id); store.set("dl", [...downloaded]); toast(L.downloaded + ": " + title(b));
  } catch (e) { toast(L.error); }
  updateDl();
}
async function undownload(id) {
  const b = byId(id);
  try { const c = await caches.open(BOOKS_CACHE); for (const r of await c.keys()) if (b && r.url.split("?")[0] === BASE + b.f) await c.delete(r); } catch (e) {}
  downloaded.delete(id); store.set("dl", [...downloaded]); render();
}
async function syncDownloads() {
  if (!("caches" in window)) return;
  try {
    const c = await caches.open(BOOKS_CACHE), valid = new Set(BOOKS().map(bookUrl));
    for (const r of await c.keys()) if (!valid.has(r.url)) await c.delete(r);
    const keys = new Set((await c.keys()).map(r => r.url));
    downloaded = new Set(BOOKS().filter(b => keys.has(bookUrl(b))).map(b => b.id));
    store.set("dl", [...downloaded]);
  } catch (e) {}
}

// ============ EVENTS ============
addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; render(); });
document.addEventListener("submit", async e => {
  const f = e.target; e.preventDefault();
  if (f.id === "fLogin") doLogin(f);
  else if (f.id === "fReg") doRegister(f);
  else if (f.id === "fSetup") doSetup(f);
  else if (f.id === "fBook") uploadBook(f);
  else if (f.id === "fPaste") { const r = parseReq(f.code.value); if (!r) return toast(L.badCode); addReq(r); renderAdmin(); renderChrome(); }
  else if (f.id === "fGh") { const g = GH.cfg() || {}; store.set("gh", { ...g, repo: f.repo.value.trim(), token: f.token.value.trim(), branch: "" }); toast(L.saved); }
  else if (f.id === "fUser") { closeModal(); editUserSave(f.dataset.id, +f.g.value, f.l.value, f.r.disabled ? me.r : f.r.value); }
  else if (f.id === "fMove") { closeModal(); moveClass(f.from.value, f.to.value); }
});
document.addEventListener("click", async e => {
  if (e.target.id === "modal") return closeModal();
  const t = e.target.closest("button,[data-open]"); if (!t) return;
  const d = t.dataset;
  if (d.auth) showAuth(d.auth);
  else if (d.logout !== undefined) { if (confirm(L.logout + "?")) wipe(); }
  else if (d.share !== undefined) { const p = await idb.get("pending"); const url = requestLink(p.req);
    if (navigator.share) navigator.share({ title: L.app, text: L.shareText(fullName(p.req)), url }).catch(() => {}); else { navigator.clipboard.writeText(url).then(() => toast(L.copied)); } }
  else if (d.copylink !== undefined) { const p = await idb.get("pending"); navigator.clipboard.writeText(requestLink(p.req)).then(() => toast(L.copied), () => prompt(L.copy, requestLink(p.req))); }
  else if (d.cancelreq !== undefined) { clearInterval(showPending.t); await idb.del("pending"); showAuth("register"); }
  else if (d.open) openBook(d.open, d.page ? +d.page : 0);
  else if (d.grade && !t.closest("form")) setGrade(+d.grade);
  else if (d.view) go(d.view);
  else if (d.mview) { closeMenu(); go(d.mview); }
  else if (d.mopen) openBook(d.mopen);
  else if (d.undl) undownload(d.undl);
  else if (d.unmark) { const m = store.get("marks", []); m.splice(+d.unmark, 1); store.set("marks", m); render(); }
  else if (d.install !== undefined && deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; }
  else if (d.adm) { admTab = d.adm; renderAdmin(); }
  else if (d.approvereq) approve(reqs()[+d.approvereq]);
  else if (d.rejectreq) { const l = reqs(); l.splice(+d.rejectreq, 1); store.set("reqs", l); render(); }
  else if (d.edituser) editUser(d.edituser);
  else if (d.blockuser) { if (confirm(L.block + "? " + L.blockText)) { closeModal(); removeUser(d.blockuser, true); } }
  else if (d.deluser) { if (confirm(L.confirmDel)) { closeModal(); removeUser(d.deluser, false); } }
  else if (d.moveclass !== undefined) moveClassForm();
  else if (d.delbook) { if (confirm(L.confirmDel)) deleteBook(d.delbook); }
  else if (d.checkgh !== undefined) { try { await GH.req(GH.repo()); toast(L.tokenOk); } catch (x) { toast(L.tokenBad); } }
  else if (d.close !== undefined) closeModal();
});
document.addEventListener("input", e => {
  if (e.target.id === "q") { query = e.target.value; renderShelf.focus = true; renderShelf(); renderShelf.focus = false; }
  if (e.target.id === "uq") { renderAdmin.q = e.target.value; renderAdmin.focus = true; renderAdmin(); }
});
document.addEventListener("change", e => { if (e.target.id === "uf") { renderAdmin.filter = e.target.value; renderAdmin(); } });
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
addEventListener("hashchange", () => { if (isAdmin()) handleReqLink(); });
addEventListener("keydown", e => {
  if ($("#reader").hidden) { if (e.key === "Escape") { closeMenu(); closeModal(); } return; }
  if (e.key === "ArrowRight" || e.key === "PageDown") step(1);
  if (e.key === "ArrowLeft" || e.key === "PageUp") step(-1);
  if (e.key === "Escape") closeReader(false);
});
let sx = null, sy = 0;
$("#stage").addEventListener("touchstart", e => { sx = e.touches.length === 1 && R.zoom === 1 ? e.touches[0].clientX : null; sy = e.touches[0].clientY; }, { passive: true });
$("#stage").addEventListener("touchend", e => { if (sx === null) return; const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1); });
let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { if (!$("#reader").hidden) { draw(); updateDl(); } else if (view !== "admin") render(); }, 150); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && S) refresh(); });

// ============ START ============
async function refresh() {   // проверка доступа и новых учебников
  try { await loadData(); } catch (e) { return; }          // нет сети — работаем с тем, что есть
  if (!(await syncKeys())) return wipe(L.wiped);
  await syncDownloads(); render();
}
fillStatic();
(async () => {
  try { S = await idb.get("session"); } catch (e) { S = null; }
  if (S) {
    me = store.get("me", null); CAT = store.get("cat", CAT);
    if (me) enterApp();
    await refresh();
    if (!me && S) wipe();
    return;
  }
  if (await idb.get("pending").catch(() => null)) { showPending(); checkPending(); return; }
  let has = true;
  try { has = await loadData(); } catch (e) {}
  if (!has) return showSetup();
  showAuth(parseReq(location.hash) ? "login" : "login");
})();
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js"));
})();
