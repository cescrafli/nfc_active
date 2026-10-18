// =============================================================
// Sistem Kartu Dinamis, Barcode/QR Permanen & PIN 4 Angka Customer
// + Manajemen Daftar Barcode Admin (/print) di Upstash Redis
//
// 3 Status Barcode di /print:
// 1. Belum Di-Link ke Kartu (nfcLinked: false, isUsed: false)
// 2. Sudah Di-Link ke Kartu NFC / Siap Jual (nfcLinked: true, isUsed: false) -> hanya berisi Barcode ID di kartu, belum ada alamat toko
// 3. Sudah Digunakan Customer (isUsed: true) -> sudah diisi alamat toko & PIN 4 angka oleh customer
// =============================================================
import { createHash, timingSafeEqual, randomBytes } from "node:crypto";

const DEFAULT_PRINT_PASSWORD = "print-password-admin";

function getPrintPassword() {
  return (process.env.PRINT_ADMIN_PASSWORD || DEFAULT_PRINT_PASSWORD).trim();
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

async function redisCommand(cmdArray) {
  const { url, token } = getRedisConfig();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmdArray),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Redis error (${res.status})`);
  }
  const data = await res.json();
  return data.result;
}

async function redisPipeline(commands) {
  const { url, token } = getRedisConfig();
  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Redis pipeline error (${res.status})`);
  }
  return await res.json();
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

export function generateSecretCardToken() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = randomBytes(10);
  let token = "";
  for (let i = 0; i < 10; i++) {
    token += alphabet[bytes[i] % alphabet.length];
  }
  return token.slice(0, 5) + "-" + token.slice(5, 10);
}

export async function getCardFromRedis(cardId) {
  const id = normalizeCardId(cardId);
  if (!id) return null;

  const raw = await redisCommand(["GET", `nfc:card:${id}`]);
  if (!raw) return null;

  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

export async function saveCardToRedis(cardId, payload) {
  const id = normalizeCardId(cardId);
  if (!id) throw new Error("ID Kartu tidak valid");

  const key = `nfc:card:${id}`;
  const valueStr = JSON.stringify({
    ...payload,
    cardId: id,
    updatedAt: new Date().toISOString(),
  });

  await redisPipeline([
    ["SET", key, valueStr],
    ["SADD", "nfc:cards:index", id],
  ]);
  return true;
}

export async function listAllCardsFromRedis() {
  const ids = (await redisCommand(["SMEMBERS", "nfc:cards:index"])) || [];
  if (!Array.isArray(ids) || ids.length === 0) {
    return [];
  }

  const keys = ids.map((id) => `nfc:card:${id}`);
  const rawValues = (await redisCommand(["MGET", ...keys])) || [];

  const cards = [];
  for (let i = 0; i < ids.length; i++) {
    const raw = rawValues[i];
    if (!raw) continue;
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      const { pinHash, ...publicCard } = parsed;
      const isUsed = Boolean(parsed.targetUrl && parsed.storeName);
      cards.push({
        ...publicCard,
        cardId: parsed.cardId || ids[i],
        hasPin: Boolean(pinHash),
        nfcLinked: Boolean(parsed.nfcLinked || isUsed),
        isUsed,
      });
    } catch {
      // skip invalid json
    }
  }

  cards.sort((a, b) => {
    const tA = new Date(a.createdAt || a.updatedAt || 0).getTime();
    const tB = new Date(b.createdAt || b.updatedAt || 0).getTime();
    return tB - tA;
  });

  return cards;
}

export default async (req) => {
  const reqUrl = new URL(req.url);

  // GET /api/card?id=... -> Cek status 1 kartu (berdasarkan Barcode ID)
  if (req.method === "GET") {
    const id = normalizeCardId(reqUrl.searchParams.get("id") || "");
    if (!id) {
      return json({ error: "Parameter id kartu diperlukan" }, 400);
    }
    const card = await getCardFromRedis(id);
    // Jika belum ada alamat toko (masih kosong / baru di-link Barcode ID saja ke kartu)
    if (!card || !card.targetUrl) {
      return json({
        found: false,
        existsInStock: Boolean(card),
        nfcLinked: Boolean(card?.nfcLinked),
        hasPin: Boolean(card?.pinHash),
        cardId: id,
      }, 404);
    }
    const { pinHash, ...publicCard } = card;
    return json({
      found: true,
      nfcLinked: true,
      hasPin: Boolean(pinHash),
      card: publicCard,
    });
  }

  // POST /api/card
  if (req.method === "POST") {
    let body = {};
    try {
      body = (await req.json()) || {};
    } catch {
      body = {};
    }

    // --- AKSI KHUSUS ADMIN (/print) ---
    if (body.adminAction) {
      const adminKey = String(body.adminKey || "").trim();
      if (!adminKey || !safeEqual(adminKey, getPrintPassword())) {
        return json({ valid: false, error: "Password Admin salah." }, 401);
      }

      // 1. Ambil semua daftar barcode
      if (body.adminAction === "list") {
        const cards = await listAllCardsFromRedis();
        return json({ valid: true, cards });
      }

      // 2. Generate stok barcode baru & simpan ke database
      if (body.adminAction === "generate") {
        const qty = Math.max(1, Math.min(50, Number(body.qty) || 6));
        const nowIso = new Date().toISOString();
        const cmds = [];
        const createdIds = [];

        for (let i = 0; i < qty; i++) {
          const id = generateSecretCardToken();
          createdIds.push(id);
          const payload = JSON.stringify({
            cardId: id,
            nfcLinked: false,
            targetUrl: "",
            storeName: "",
            mode: "review",
            createdAt: nowIso,
            updatedAt: nowIso,
          });
          cmds.push(["SET", `nfc:card:${id}`, payload]);
          cmds.push(["SADD", "nfc:cards:index", id]);
        }

        await redisPipeline(cmds);
        const cards = await listAllCardsFromRedis();
        return json({ valid: true, createdIds, cards });
      }

      // 3. Tandai Barcode ID sudah ditanam/di-link ke fisik Kartu NFC (tanpa mengisi alamat toko!)
      if (body.adminAction === "mark_linked") {
        const id = normalizeCardId(body.cardId || "");
        const existing = (await getCardFromRedis(id)) || {
          cardId: id,
          targetUrl: "",
          storeName: "",
          mode: "review",
          createdAt: new Date().toISOString(),
        };
        existing.nfcLinked = true;
        existing.linkedAt = new Date().toISOString();
        await saveCardToRedis(id, existing);
        const cards = await listAllCardsFromRedis();
        return json({ valid: true, cards });
      }

      // 4. Reset PIN Customer (Jika customer lupa PIN 4 angkanya)
      if (body.adminAction === "reset_pin") {
        const id = normalizeCardId(body.cardId || "");
        const existing = await getCardFromRedis(id);
        if (!existing) {
          return json({ valid: false, error: "Kartu tidak ditemukan." }, 404);
        }
        delete existing.pinHash;
        await saveCardToRedis(id, existing);
        const cards = await listAllCardsFromRedis();
        return json({ valid: true, cards });
      }

      // 5. Kosongkan alamat toko pada kartu (tetap berstatus Sudah Di-Link ke Kartu NFC, siap dipakai toko baru)
      if (body.adminAction === "reset_card") {
        const id = normalizeCardId(body.cardId || "");
        const existing = await getCardFromRedis(id);
        if (!existing) {
          return json({ valid: false, error: "Kartu tidak ditemukan." }, 404);
        }
        await saveCardToRedis(id, {
          cardId: id,
          nfcLinked: Boolean(existing.nfcLinked),
          targetUrl: "",
          storeName: "",
          mode: "review",
          createdAt: existing.createdAt || new Date().toISOString(),
        });
        const cards = await listAllCardsFromRedis();
        return json({ valid: true, cards });
      }

      // 6. Hapus barcode dari database
      if (body.adminAction === "delete") {
        const id = normalizeCardId(body.cardId || "");
        if (id) {
          await redisPipeline([
            ["DEL", `nfc:card:${id}`],
            ["SREM", "nfc:cards:index", id],
          ]);
        }
        const cards = await listAllCardsFromRedis();
        return json({ valid: true, cards });
      }

      return json({ valid: false, error: "Aksi admin tidak dikenal" }, 400);
    }

    // --- AKSI CUSTOMER (Mengisi Alamat Toko & PIN 4 Angka ke Barcode ID yang sudah ada di Kartu) ---
    const cardId = normalizeCardId(body.cardId || "");
    if (!cardId) {
      return json({ valid: false, error: "Barcode ID kartu tidak ditemukan." }, 400);
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
          nfcLinked: true,
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
