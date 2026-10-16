// =============================================================
// Utilitas bersama untuk halaman Aktivasi (app.js) & Kelola (admin.js).
// =============================================================

export const $ = (id) => document.getElementById(id);

/** Domain tujuan yang diizinkan. HARUS sama dengan netlify/lib/links.mjs. */
export const ALLOWED_TARGET_HOSTS = [
  "search.google.com",
  "www.google.com",
  "google.com",
  "maps.google.com",
  "www.google.co.id",
  "google.co.id",
  "maps.google.co.id",
  "g.page",
  "maps.app.goo.gl",
  "goo.gl",
];

/** Place ID Google: karakter base64-url, umumnya diawali "ChIJ". */
export const PLACE_ID_RE = /^[A-Za-z0-9_-]{20,400}$/;

/** Kode kartu: huruf kecil, angka, - dan _ (3–32 karakter). */
export const CODE_RE = /^[a-z0-9_-]{3,32}$/;

/** Kapasitas NDEF aman per jenis chip (byte). */
export const CHIP_CAPACITY = { NTAG213: 137, NTAG215: 496, NTAG216: 868 };

export const reviewUrlFromPlaceId = (placeId) =>
  "https://search.google.com/local/writereview?placeid=" + encodeURIComponent(placeId);

/** Validasi link review: wajib https + domain Google. */
export function validateReviewUrl(raw) {
  let u;
  try {
    u = new URL(String(raw ?? "").trim());
  } catch {
    return { ok: false, error: "Link tidak valid." };
  }
  if (u.protocol !== "https:") return { ok: false, error: "Link wajib diawali https://" };
  if (!ALLOWED_TARGET_HOSTS.includes(u.hostname.toLowerCase())) {
    return { ok: false, error: `Domain "${u.hostname}" tidak diizinkan. Gunakan link dari Google Maps / Google Review.` };
  }
  if (u.href.length > 2000) return { ok: false, error: "Link terlalu panjang." };
  return { ok: true, url: u.href };
}

/**
 * Terima Place ID atau link review Google.
 * @returns {{ok:true, kind:"url"|"placeId", url:string, placeId:string} | {ok:false, error?:string, empty?:boolean}}
 */
export function parseManualInput(raw) {
  const v = String(raw ?? "").trim();
  if (!v) return { ok: false, empty: true };

  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) {
    const r = validateReviewUrl(v);
    if (!r.ok) return r;
    const placeId = new URL(r.url).searchParams.get("placeid") || "";
    return { ok: true, kind: "url", url: r.url, placeId };
  }
  if (/^(www\.)?(g\.page|maps\.app\.goo\.gl|search\.google\.com)\//i.test(v)) {
    return { ok: false, error: "Tambahkan https:// di depan link." };
  }
  if (PLACE_ID_RE.test(v)) {
    return { ok: true, kind: "placeId", url: reviewUrlFromPlaceId(v), placeId: v };
  }
  return { ok: false, error: "Format tidak dikenali. Masukkan Place ID (contoh: ChIJ...) atau link https:// dari Google." };
}

/**
 * Perkiraan ukuran data NDEF (byte) untuk 1 record URL — dihitung konservatif
 * tanpa kompresi prefix "https://", termasuk header record & TLV.
 */
export function ndefUrlBytes(url) {
  const urlBytes = new TextEncoder().encode(url).length;
  const payload = 1 + urlBytes; // 1 byte kode prefix URI + URL
  const record = 1 + 1 + (payload > 255 ? 4 : 1) + 1 + payload; // header + typeLen + payloadLen + type "U"
  const tlv = (record > 254 ? 4 : 2) + 1; // tag + length + terminator
  return record + tlv;
}

export function chipAdvice(bytes) {
  if (bytes <= CHIP_CAPACITY.NTAG213) return { ok: true, text: "muat di NTAG213/215/216 ✓" };
  if (bytes <= CHIP_CAPACITY.NTAG215) return { ok: false, text: "TIDAK muat di NTAG213 — gunakan NTAG215/216" };
  if (bytes <= CHIP_CAPACITY.NTAG216) return { ok: false, text: "hanya muat di NTAG216" };
  return { ok: false, text: "terlalu panjang untuk kartu NTAG" };
}

// ---------- Token admin (disimpan hanya di perangkat ini) ----------
const TOKEN_KEY = "nfc_admin_token";
export const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

/** Panggil API admin (Netlify Functions) dengan token. */
export async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${getToken()}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Tidak bisa terhubung ke server. Periksa koneksi internet.");
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    /* bukan JSON */
  }

  if (!res.ok || data === null) {
    const msg =
      data?.error ||
      (res.status === 404 || data === null
        ? "API tidak ditemukan. Fitur ini hanya berjalan setelah di-deploy ke Netlify (atau via `netlify dev`), bukan dari Laragon / file lokal."
        : `HTTP ${res.status}`);
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function showStatus(box, msg, type = "info") {
  box.hidden = false;
  box.textContent = msg;
  box.className = `status status-${type}`;
}

export const hideStatus = (box) => {
  box.hidden = true;
};

export const isIOS = () =>
  /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function formatDate(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

/** Buat elemen DOM secara aman (tanpa innerHTML). */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt("Salin link ini:", text);
    return false;
  }
}
