// =============================================================
// Vercel Serverless Function: POST /api/print-auth
// Verifikasi password khusus halaman /print (print-password-admin)
// =============================================================
import { timingSafeEqual } from "node:crypto";

const DEFAULT_PRINT_PASSWORD = "print-password-admin";

function getPrintPassword() {
  return (process.env.PRINT_ADMIN_PASSWORD || DEFAULT_PRINT_PASSWORD).trim();
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export default {
  async fetch(req) {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ valid: false, error: "Method tidak didukung" }), {
        status: 405,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    let body = {};
    try {
      body = (await req.json()) || {};
    } catch {
      body = {};
    }

    const inputKey = String(body.key || "").trim();
    const expected = getPrintPassword();

    if (!inputKey || !safeEqual(inputKey, expected)) {
      return new Response(JSON.stringify({ valid: false, error: "Password Admin salah." }), {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }

    return new Response(JSON.stringify({ valid: true }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  },
};
