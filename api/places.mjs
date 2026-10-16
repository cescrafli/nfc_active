// =============================================================
// Vercel Serverless Function: GET /api/places?q=...
// Mengambil daftar cabang toko, alamat, rating, dan Place ID resmi
// langsung dari Google Maps tanpa API Key.
// =============================================================
import handler from "../netlify/functions/places.mjs";

export default {
  fetch: (req) => handler(req),
};
