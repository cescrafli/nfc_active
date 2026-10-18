// =============================================================
// Vercel Serverless Function: GET /api/go?id=001 (atau /c/001)
// Redirect otomatis saat pelanggan Scan Barcode/QR Code atau Tap Kartu
// =============================================================
import { getCardFromRedis, normalizeCardId } from "../netlify/functions/card.mjs";

export default {
  async fetch(req) {
    const url = new URL(req.url);
    const rawId = url.searchParams.get("id") || url.pathname.replace(/^\/c\//i, "");
    const cardId = normalizeCardId(rawId);

    if (!cardId) {
      return Response.redirect(new URL("/", url.origin).toString(), 302);
    }

    const card = await getCardFromRedis(cardId);

    // Jika kartu sudah diaktifkan di Cloud Database, langsung redirect ke tujuan terbarunya!
    if (card && card.targetUrl) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: card.targetUrl,
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        },
      });
    }

    // Jika kartu belum pernah diaktifkan, arahkan ke halaman aktivasi dengan ID Kartu langsung terisi
    const setupUrl = new URL("/", url.origin);
    setupUrl.searchParams.set("card", cardId);
    return new Response(null, {
      status: 302,
      headers: {
        Location: setupUrl.toString(),
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    });
  },
};
