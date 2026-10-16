// =============================================================
// Vercel Serverless Function: POST /api/otp/verify
// Memverifikasi 8 digit Kode Lisensi Aktivasi (berlaku 5 menit).
// =============================================================
import handler from "../../netlify/functions/otp.mjs";

export default {
  fetch: (req) => handler(req),
};
