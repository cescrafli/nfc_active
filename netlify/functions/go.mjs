// =============================================================
// Netlify Serverless Function: GET /c/:id (Redirect Dinamis Kartu/QR)
// Redirect otomatis saat pelanggan Scan Barcode/QR Code atau Tap Kartu
// =============================================================
import { getCardFromRedis, normalizeCardId, normalizeWaNumber } from "./card.mjs";

export default async (req) => {
  const url = new URL(req.url);
  const rawId = url.searchParams.get("id") || url.pathname.replace(/^\/c\//i, "");
  const cardId = normalizeCardId(rawId);

  if (!cardId) {
    return Response.redirect(new URL("/", url.origin).toString(), 302);
  }

  const card = await getCardFromRedis(cardId);

  // Jika kartu sudah diaktifkan di Cloud Database, arahkan ke tujuan terbarunya
  if (card && card.targetUrl && card.storeName) {
    let dest = card.targetUrl;
    try {
      const parsedDest = new URL(dest, url.origin);
      if (card.mode === "review" || parsedDest.pathname === "/rate" || parsedDest.pathname === "/rate.html") {
        const rateUrl = new URL("/rate", url.origin);
        rateUrl.searchParams.set("n", card.storeName);
        if (card.placeId) rateUrl.searchParams.set("p", card.placeId);
        else if (card.cid) rateUrl.searchParams.set("c", card.cid);
        const cleanWa = normalizeWaNumber(card.wa || "");
        if (cleanWa) rateUrl.searchParams.set("w", cleanWa);
        rateUrl.searchParams.set("card", cardId);
        dest = rateUrl.toString();
      }
    } catch {
      // biarkan dest apa adanya jika URL eksternal
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: dest,
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    });
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
};

export const config = {
  path: "/c/:id",
};
