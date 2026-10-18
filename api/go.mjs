// =============================================================
// Vercel Serverless Function: GET /api/go?id=... (atau /c/:id)
// Redirect otomatis saat pelanggan Scan Barcode/QR Code atau Tap Kartu
// =============================================================
import { getCardFromRedis, normalizeCardId, normalizeWaNumber, isSafeHttpUrl } from "../netlify/functions/card.mjs";

export default {
  async fetch(req) {
    const url = new URL(req.url);
    const pathMatch = url.pathname.match(/^\/c\/([^/?#]+)/i);
    const rawId = url.searchParams.get("id") || (pathMatch ? pathMatch[1] : "");
    const cardId = normalizeCardId(rawId);

    if (!cardId) {
      return Response.redirect(new URL("/", url.origin).toString(), 302);
    }

    let card = null;
    try {
      card = await getCardFromRedis(cardId);
    } catch {
      card = null;
    }

    // Jika kartu sudah diaktifkan di Cloud Database, arahkan ke tujuan terbarunya
    if (card && card.targetUrl && card.storeName && isSafeHttpUrl(card.targetUrl)) {
      let dest = card.targetUrl;
      try {
        const parsedDest = new URL(dest, url.origin);
        if (card.mode === "review" || parsedDest.pathname === "/rate" || parsedDest.pathname === "/rate.html") {
          const rateUrl = new URL("/rate", url.origin);
          rateUrl.searchParams.set("n", card.storeName);
          if (card.placeId) rateUrl.searchParams.set("p", card.placeId);
          else if (card.cid) rateUrl.searchParams.set("c", card.cid);
          else if (card.mapsUrl) rateUrl.searchParams.set("m", card.mapsUrl);
          const cleanWa = normalizeWaNumber(card.wa || "");
          if (cleanWa) rateUrl.searchParams.set("w", cleanWa);
          rateUrl.searchParams.set("card", cardId);
          dest = rateUrl.toString();
        }
      } catch {
        // biarkan dest apa adanya jika URL eksternal
      }

      if (isSafeHttpUrl(dest)) {
        return new Response(null, {
          status: 302,
          headers: {
            Location: dest,
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          },
        });
      }
    }

    // Jika kartu belum pernah diaktifkan, arahkan ke halaman aktivasi dengan Barcode ID langsung terisi
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
