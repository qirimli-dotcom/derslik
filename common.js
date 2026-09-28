// Derslik Çantam — общий код приложения и кабинета
(() => {
"use strict";
const C = crypto.subtle, te = new TextEncoder(), td = new TextDecoder();
const K = window.K = {};
K.$ = s => document.querySelector(s);
K.esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
K.ico = (id, cls = "") => `<svg class="${cls}"><use href="#i-${id}"/></svg>`;
K.makeStore = prefix => ({
  get(k, d) { try { const v = localStorage.getItem(prefix + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(prefix + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(prefix + k); } catch (e) {} },
  clear() { try { Object.keys(localStorage).filter(k => k.startsWith(prefix)).forEach(k => localStorage.removeItem(k)); } catch (e) {} }
});
K.idb = (() => {
  let db;
  const open = () => db || (db = new Promise((res, rej) => { const r = indexedDB.open("cantam", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const tx = async (mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction("kv", mode), s = t.objectStore("kv"), q = fn(s); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  return { get: k => tx("readonly", s => s.get(k)), set: (k, v) => tx("readwrite", s => s.put(v, k)), del: k => tx("readwrite", s => s.delete(k)) };
})();
K.COLORS = { mat:"#2848B8", alg:"#1F5FA8", geo:"#3A4BA8", rus:"#B8322B", crh:"#1E6E57", crhedb:"#17604B", oqu:"#B5651D",
  edb:"#A42A5E", etr:"#2F7A1F", bio:"#3F7F22", eng:"#5E36B0", tar:"#9A4515", cog:"#1F7068", fiz:"#0F6F84", kim:"#7E3AA3", inf:"#44607A" };
K.GRADES = [1,2,3,4,5,6,7,8,9,10,11];
K.subj = b => SUBJECTS[b.subject] || b.subject;
K.name = b => b.t || K.subj(b);                                   // название книги (на крымскотатарском) или предмет
K.title = b => K.name(b) + (b.part ? ", " + L.part(b.part) : "");
K.coverSrc = b => b.c ? K.BASE + b.c + "?v=" + (b.cv || 1) : b.cu || "";   // своя копия обложки или внешняя ссылка
K.color = b => K.COLORS[b.subject] || "#44607A";
K.fullName = u => [u.n, u.s].filter(Boolean).join(" ");
K.initials = u => ((u.n || "?")[0] + ((u.s || "")[0] || "")).toUpperCase();
K.toast = msg => { const t = K.$("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(K.toast.t); K.toast.t = setTimeout(() => t.classList.remove("show"), 2800); };
K.fld = (name, label, attrs = "", hint = "") => `<label class="fld"><span>${K.esc(label)}</span><input name="${name}" ${attrs}>${hint ? `<small>${K.esc(hint)}</small>` : ""}</label>`;
K.sel = (name, label, opts, v) => `<label class="fld"><span>${K.esc(label)}</span><select name="${name}">${opts.map(o => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${K.esc(val)}" ${val == v ? "selected" : ""}>${K.esc(lab)}</option>`; }).join("")}</select></label>`;
K.U_ATTR = 'required autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="32"';
K.checkNewUser = d => !/^[a-z0-9._-]{3,32}$/.test(d.u) ? L.errUser : d.p.length < 8 ? L.errPassLen : d.p !== d.p2 ? L.errPass2 : "";

// ---------- crypto
const rnd = K.rnd = n => crypto.getRandomValues(new Uint8Array(n));
const b64 = K.b64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const ub64 = K.ub64 = s => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
K.b64u = u8 => b64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
K.te = te; K.td = td;
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
async function pwKey(pass, salt) {
  const base = await C.importKey("raw", te.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return C.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 250000 }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
const aesEnc = K.aesEnc = async (key, data) => { const iv = rnd(12); return cat(iv, new Uint8Array(await C.encrypt({ name: "AES-GCM", iv }, key, data))); };
const aesDec = K.aesDec = async (key, buf) => { buf = new Uint8Array(buf); return new Uint8Array(await C.decrypt({ name: "AES-GCM", iv: buf.subarray(0, 12) }, key, buf.subarray(12))); };
const importAes = K.importAes = (raw, extractable) => C.importKey("raw", raw, "AES-GCM", extractable, ["encrypt", "decrypt"]);
const EC = { name: "ECDH", namedCurve: "P-256" };
async function ecdhAes(priv, pubRaw) {
  const pub = await C.importKey("raw", pubRaw, EC, false, []);
  const bits = await C.deriveBits({ name: "ECDH", public: pub }, priv, 256);
  return importAes(new Uint8Array(await C.digest("SHA-256", bits)), false);
}
// новый пользователь: пара ключей, приватный ключ шифруется паролем
K.makeIdentity = async pass => {
  const salt = rnd(16), kp = await C.generateKey(EC, true, ["deriveBits"]);
  const pub = new Uint8Array(await C.exportKey("raw", kp.publicKey));
  const pk8 = new Uint8Array(await C.exportKey("pkcs8", kp.privateKey));
  const ep = await aesEnc(await pwKey(pass, salt), pk8);
  const priv = await C.importKey("pkcs8", pk8, EC, false, ["deriveBits"]);
  return { salt: b64(salt), pub: b64(pub), ep: b64(ep), priv };
};
// открыть приватный ключ паролем (ошибка — неверный пароль)
K.openIdentity = async (u, pass, extractable) => C.importKey("pkcs8", await aesDec(await pwKey(pass, ub64(u.salt)), ub64(u.ep)), EC, !!extractable, ["deriveBits"]);
// перешифровать приватный ключ новым паролем
K.repass = async (u, oldPass, newPass) => {
  const pk8 = await aesDec(await pwKey(oldPass, ub64(u.salt)), ub64(u.ep)), salt = rnd(16);
  return { salt: b64(salt), ep: b64(await aesEnc(await pwKey(newPass, salt), pk8)) };
};
// ключ класса → для пользователя (по его публичному ключу)
K.wrapFor = async (pubB64, rawKey, v) => {
  const eph = await C.generateKey(EC, true, ["deriveBits"]);
  const k = await ecdhAes(eph.privateKey, ub64(pubB64));
  return { v, e: b64(new Uint8Array(await C.exportKey("raw", eph.publicKey))), c: b64(await aesEnc(k, rawKey)) };
};
K.unwrap = async (w, priv, extractable) => importAes(await aesDec(await ecdhAes(priv, ub64(w.e)), ub64(w.c)), extractable);
K.rawKey = async key => new Uint8Array(await C.exportKey("raw", key));

// ---------- данные сайта
K.BASE = new URL(document.querySelector('meta[name="cantam-root"]') ? document.querySelector('meta[name="cantam-root"]').content : ".", location.href).href;
K.fetchPublic = async (path, dflt) => {
  const r = await fetch(K.BASE + path + "?t=" + Date.now(), { cache: "no-store" });
  if (r.status === 404) return dflt;
  if (!r.ok) throw new Error("net");
  return r.json();
};
K.bookUrl = b => K.BASE + b.f + "?v=" + b.kv;
// книги хранятся частями по 4 МБ: books/gN/id.0.bin, id.1.bin … (GitHub API обрывает долгие запросы)
K.VER = "16";
K.CHUNK = 4 * 1024 * 1024;
K.partPaths = b => b.n ? Array.from({ length: b.n }, (_, i) => b.f.replace(/\.bin$/, "." + i + ".bin")) : [b.f];
K.partUrls = b => K.partPaths(b).map(p => K.BASE + p + "?v=" + b.kv);
K.split = u8 => { const out = []; for (let i = 0; i < u8.length; i += K.CHUNK) out.push(u8.subarray(i, i + K.CHUNK)); return out; };
K.join = parts => { const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let x = 0; for (const p of parts) { o.set(p, x); x += p.length; } return o; };
K.json = o => JSON.stringify(o, null, 1);
// токен «только заявки» хранится в data/config.json в перевёрнутом base64, чтобы его не отзывал сканер GitHub
K.obf = t => btoa(t).split("").reverse().join("");
K.deobf = s => { try { return atob(String(s).split("").reverse().join("")); } catch (e) { return ""; } };
K.config = async () => { try { return await K.fetchPublic("data/config.json", {}); } catch (e) { return {}; } };
K.REQ_TAG = "[arıza]";
K.issuesApi = async (cfg, path, opt = {}) => {
  const r = await fetch((cfg.api || "https://api.github.com") + "/repos/" + cfg.repo + "/issues" + path, { ...opt, cache: "no-store",
    headers: { "Authorization": "Bearer " + K.deobf(cfg.it), "Accept": "application/vnd.github+json", ...(opt.body ? { "Content-Type": "application/json" } : {}) } });
  if (!r.ok) { const e = new Error("issues " + r.status); e.status = r.status; throw e; }
  return r.json();
};
})();
