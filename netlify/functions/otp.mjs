// =============================================================
// Sistem OTP 8 Angka (berganti otomatis setiap 1 menit / 60 detik)
//
//   POST /api/otp/verify  { code: "12345678" }  -> dipakai pembeli saat aktivasi
//   POST /api/otp/current { key: "KUNCI_RAHASIA" } -> dipakai Anda di /otp.html
// =============================================================
import { createHmac, timingSafeEqual } from "node:crypto";

// Kunci bawaan (bisa Anda ganti lewat Environment Variable OTP_SECRET di Netlify)
const DEFAULT_SECRET = "nfc-master-rahasia-2026";

function getSecret() {
  return (
    globalThis.Netlify?.env?.get?.("OTP_SECRET") ||
    process.env.OTP_SECRET ||
    DEFAULT_SECRET
  ).trim();
}

/** Menghasilkan 8 digit angka untuk menit ke-`step` (1 step = 60 detik). */
export function generate8DigitOtp(secret, step) {
  const hmac = createHmac("sha256", `nfc-otp-v1:${secret}`)
    .update(String(step))
    .digest();
  const num = hmac.readUInt32BE(0) % 100000000;
  return String(num).padStart(8, "0");
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method tidak didukung" }, 405);
  }

  let body = {};
  try {
    body = (await req.json()) || {};
  } catch {
    body = {};
  }

  const secret = getSecret();
  const WINDOW_SEC = 300; // 5 menit (300 detik)
  const nowSec = Math.floor(Date.now() / 1000);
  const step = Math.floor(nowSec / WINDOW_SEC);
  const remainingSec = WINDOW_SEC - (nowSec % WINDOW_SEC);

  const url = new URL(req.url);

  // 1. Endpoint khusus Admin (/otp.html) untuk melihat kode 8 angka saat ini
  if (url.pathname.endsWith("/current")) {
    const inputKey = String(body.key || "").trim();
    if (!inputKey || !safeEqual(inputKey, secret)) {
      return json({ valid: false, error: "Kunci Rahasia Admin salah." }, 401);
    }
    return json({
      valid: true,
      code: generate8DigitOtp(secret, step),
      nextCode: generate8DigitOtp(secret, step + 1),
      remainingSec,
      windowSec: WINDOW_SEC,
    });
  }

  // 2. Endpoint verifikasi kode 8 angka saat pembeli klik Aktivasi Kartu
  const rawCode = String(body.code || "").replace(/\s+/g, "");
  if (!/^\d{8}$/.test(rawCode)) {
    return json({ valid: false, error: "Password aktivasi harus berupa 8 angka." }, 400);
  }

  // Cek kode 5 menit ini (dan toleransi 15 detik awal jika baru saja berganti)
  const currentOtp = generate8DigitOtp(secret, step);
  const prevOtp = generate8DigitOtp(secret, step - 1);
  const isValid =
    safeEqual(rawCode, currentOtp) ||
    (nowSec % WINDOW_SEC <= 15 && safeEqual(rawCode, prevOtp));

  if (!isValid) {
    return json(
      {
        valid: false,
        error: "Password aktivasi salah atau sudah kedaluwarsa (lewat 5 menit). Minta kode terbaru ke admin.",
      },
      401
    );
  }

  return json({ valid: true });
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export const config = {
  path: ["/api/otp/verify", "/api/otp/current"],
};
