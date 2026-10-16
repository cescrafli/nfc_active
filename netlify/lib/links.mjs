// =============================================================
// Logika bersama untuk Netlify Functions (links & redirect).
// =============================================================
import { getStore } from "@netlify/blobs";
import { timingSafeEqual, randomInt } from "node:crypto";

/** Format kode kartu: huruf kecil, angka, - dan _ (3–32 karakter). */
export const CODE_RE = /^[a-z0-9_-]{3,32}$/;

/**
 * Domain tujuan yang diizinkan untuk link pengalih.
 * Mencegah layanan ini disalahgunakan sebagai "open redirect" ke situs phishing.
 * HARUS sama dengan ALLOWED_TARGET_HOSTS di public/assets/common.js.
 */
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

/** Data link (kode → tujuan). Strong consistency agar link baru langsung bisa dipakai. */
export const linksStore = () => getStore({ name: "nfc-links", consistency: "strong" });

/** Statistik scan disimpan terpisah agar tidak bentrok dengan edit tujuan. */
export const statsStore = () => getStore({ name: "nfc-stats", consistency: "strong" });

export const normalizeCode = (code) => String(code ?? "").trim().toLowerCase();

export function validateTarget(raw) {
  let u;
  try {
    u = new URL(String(raw ?? "").trim());
  } catch {
    return { ok: false, error: "URL tujuan tidak valid." };
  }
  if (u.protocol !== "https:") return { ok: false, error: "URL tujuan wajib diawali https://" };
  if (!ALLOWED_TARGET_HOSTS.includes(u.hostname.toLowerCase())) {
    return { ok: false, error: `Domain "${u.hostname}" tidak diizinkan. Gunakan link Google Maps / Review.` };
  }
  if (u.href.length > 2000) return { ok: false, error: "URL tujuan terlalu panjang." };
  return { ok: true, url: u.href };
}

/** Potong & bersihkan teks bebas dari input. */
export const cleanText = (v, max) =>
  String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function getEnv(name) {
  return globalThis.Netlify?.env?.get?.(name) ?? process.env[name];
}

/** Validasi header "Authorization: Bearer <ADMIN_TOKEN>". */
export function checkAuth(req) {
  const expected = getEnv("ADMIN_TOKEN") || "";
  if (expected.length < 24) {
    return {
      ok: false,
      status: 500,
      error: "ADMIN_TOKEN belum diset (minimal 24 karakter) di Environment Variables Netlify.",
    };
  }
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: "Token admin salah." };
  }
  return { ok: true };
}

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // tanpa karakter mirip (0/o, 1/l/i)

export function generateCode(length = 7) {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
