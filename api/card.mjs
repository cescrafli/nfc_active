// =============================================================
// Vercel Serverless Function: GET & POST /api/card
// Menyimpan & mengambil data tujuan Kartu NFC + Dynamic Barcode/QR
// =============================================================
import handler from "../netlify/functions/card.mjs";

export default {
  fetch: (req) => handler(req),
};
