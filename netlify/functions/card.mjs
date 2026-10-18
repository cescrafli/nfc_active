// =============================================================
// Sistem Kartu Dinamis & Barcode/QR Permanen (Upstash Redis REST)
//
// Setiap fisik kartu memiliki 1 ID Kartu tetap (misal: "KARTU-01" atau "001")
// dan 1 Barcode/QR permanen: https://nfcactive.vercel.app/c/001
//
// Saat user ganti lokasi toko di halaman utama (/), data kartu di Redis
// otomatis ter-update. Barcode fisik TIDAK PERLU di-print ulang selamanya!
// =============================================================
import { generate8DigitOtp } from "./otp.mjs";
import { timingSafeEqual } from "node:crypto";

const DEFAULT_SECRET = "nfc-master-rahasia-2026";

function getSecret() {
  return (
    globalThis.Netlify?.env?.get?.("OTP_SECRET") ||
    process.env.OTP_SECRET ||
    DEFAULT_SECRET
  ).trim();
}

function getRedisConfig() {
  const url = (
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.STORAGE_KV_REST_API_URL ||
    "https://magnetic-spaniel-129505.upstash.io"
  ).replace(/\/+$/, "");

  const token = (
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.STORAGE_KV_REST_API_TOKEN ||
    "gQAAAAAAAfnhAAIgcDFmZTIxODY3OGVkYzA0NDM3ODE1NDMzZmE5MjJlNjg4Nw"
  ).trim();

  return { url, token };
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function normalizeCardId(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 32);
}

export async function getCardFromRedis(cardId) {
  const id = normalizeCardId(cardId);
  if (!id) return null;

  const { url, token } = getRedisConfig();
  const res = await fetch(`${url}/get/${encodeURIComponent(`nfc:card:${id}`)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) return null;
  const data = await res.json();
  if (!data || !data.result) return null;

  try {
    return typeof data.result === "string" ? JSON.parse(data.result) : data.result;
  } catch {
    return null;
  }
}

export async function saveCardToRedis(cardId, payload) {
  const id = normalizeCardId(cardId);
  if (!id) throw new Error("ID Kartu tidak valid");

  const { url, token } = getRedisConfig();
  const key = `nfc:card:${id}`;
  const valueStr = JSON.stringify({
    ...payload,
    cardId: id,
    updatedAt: new Date().toISOString(),
  });

  const res = await fetch(`${url}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(["SET", key, valueStr]),
  });

  if (!res.ok) {
    throw new Error("Gagal menyimpan ke Cloud Database");
  }
  return true;
}

export default async (req) => {
  const reqUrl = new URL(req.url);

  // GET /api/card?id=001 -> Ambil info kartu
  if (req.method === "GET") {
    const id = normalizeCardId(reqUrl.searchParams.get("id") || "");
    if (!id) {
      return json({ error: "Parameter id kartu diperlukan" }, 400);
    }
    const card = await getCardFromRedis(id);
    if (!card) {
      return json({ found: false, cardId: id }, 404);
    }
    return json({ found: true, card });
  }

  // POST /api/card -> Verifikasi OTP & Simpan / Update tujuan Kartu + Barcode
  if (req.method === "POST") {
    let body = {};
    try {
      body = (await req.json()) || {};
    } catch {
      body = {};
    }

    const secret = getSecret();
    const WINDOW_SEC = 300;
    const nowSec = Math.floor(Date.now() / 1000);
    const step = Math.floor(nowSec / WINDOW_SEC);

    const rawCode = String(body.code || "").replace(/\s+/g, "");
    if (!/^\d{8}$/.test(rawCode)) {
      return json({ valid: false, error: "Kode Lisensi harus berupa 8 angka." }, 400);
    }

    const currentOtp = generate8DigitOtp(secret, step);
    const prevOtp = generate8DigitOtp(secret, step - 1);
    const isValid =
      safeEqual(rawCode, currentOtp) ||
      (nowSec % WINDOW_SEC <= 15 && safeEqual(rawCode, prevOtp));

    if (!isValid) {
      return json(
        {
          valid: false,
          error: "Kode Lisensi salah atau sudah kedaluwarsa (lewat 5 menit). Minta kode terbaru ke admin.",
        },
        401
      );
    }

    const cardId = normalizeCardId(body.cardId || "");
    const targetUrl = String(body.targetUrl || "").trim();
    const storeName = String(body.storeName || "").trim();
    const mode = String(body.mode || "review").trim();
    const placeId = String(body.placeId || "").trim();
    const cid = String(body.cid || "").trim();
    const wa = String(body.wa || "").trim();
    const address = String(body.address || "").trim();

    if (cardId && targetUrl) {
      try {
        await saveCardToRedis(cardId, {
          targetUrl,
          storeName,
          mode,
          placeId,
          cid,
          wa,
          address,
        });
      } catch (err) {
        return json({ valid: true, saved: false, error: err.message }, 500);
      }
    }

    return json({
      valid: true,
      saved: Boolean(cardId),
      cardId,
    });
  }

  return json({ error: "Method tidak didukung" }, 405);
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
