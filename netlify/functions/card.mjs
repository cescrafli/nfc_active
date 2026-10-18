// =============================================================
// Sistem Kartu Dinamis, Barcode/QR Permanen & PIN 4 Angka Customer
// (Upstash Redis REST)
//
// - Pertama kali aktivasi: Customer membuat PIN 4 angka baru (disimpan hash-nya).
// - Aktivasi/ganti lokasi berikutnya: Customer memasukkan PIN 4 angka miliknya
//   sendiri (tanpa perlu minta OTP ke Admin lagi!).
// =============================================================
import { createHash, timingSafeEqual } from "node:crypto";

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

function hashPin(cardId, pin) {
  return createHash("sha256")
    .update(`nfc-pin-v1:${cardId}:${String(pin).trim()}`)
    .digest("hex");
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

  // GET /api/card?id=... -> Cek apakah kartu sudah pernah diaktifkan & punya PIN
  if (req.method === "GET") {
    const id = normalizeCardId(reqUrl.searchParams.get("id") || "");
    if (!id) {
      return json({ error: "Parameter id kartu diperlukan" }, 400);
    }
    const card = await getCardFromRedis(id);
    if (!card) {
      return json({ found: false, hasPin: false, cardId: id }, 404);
    }
    // Jangan kirim pinHash ke client demi keamanan
    const { pinHash, ...publicCard } = card;
    return json({
      found: true,
      hasPin: Boolean(pinHash),
      card: publicCard,
    });
  }

  // POST /api/card -> Buat PIN 4 angka (jika kartu baru) atau Verifikasi PIN 4 angka (jika kartu sudah aktif)
  if (req.method === "POST") {
    let body = {};
    try {
      body = (await req.json()) || {};
    } catch {
      body = {};
    }

    const cardId = normalizeCardId(body.cardId || "");
    if (!cardId) {
      return json({ valid: false, error: "Token kartu tidak ditemukan." }, 400);
    }

    const rawPin = String(body.pin || body.code || "").replace(/\s+/g, "");
    if (!/^\d{4}$/.test(rawPin)) {
      return json({ valid: false, error: "Password / PIN harus berupa 4 angka." }, 400);
    }

    const existingCard = await getCardFromRedis(cardId);
    const inputPinHash = hashPin(cardId, rawPin);

    // Jika kartu sudah pernah diaktifkan dan memiliki PIN, wajib cocokkan PIN-nya!
    if (existingCard && existingCard.pinHash) {
      if (!safeEqual(inputPinHash, existingCard.pinHash)) {
        return json(
          {
            valid: false,
            error: "Password 4 angka salah! Masukkan 4 angka password yang Anda buat saat pertama kali mengaktifkan kartu ini.",
          },
          401
        );
      }
    }

    const targetUrl = String(body.targetUrl || "").trim();
    const storeName = String(body.storeName || "").trim();
    const mode = String(body.mode || "review").trim();
    const placeId = String(body.placeId || "").trim();
    const cid = String(body.cid || "").trim();
    const wa = String(body.wa || "").trim();
    const address = String(body.address || "").trim();

    if (targetUrl) {
      try {
        await saveCardToRedis(cardId, {
          targetUrl,
          storeName,
          mode,
          placeId,
          cid,
          wa,
          address,
          pinHash: existingCard?.pinHash || inputPinHash,
          createdAt: existingCard?.createdAt || new Date().toISOString(),
        });
      } catch (err) {
        return json({ valid: false, saved: false, error: err.message }, 500);
      }
    }

    return json({
      valid: true,
      isFirstActivation: !existingCard?.pinHash,
      saved: true,
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
