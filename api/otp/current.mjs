// =============================================================
// Vercel Serverless Function: POST /api/otp/current
// Mengambil kode OTP 8 digit aktif untuk halaman admin /otp.html.
// =============================================================
import handler from "../../netlify/functions/otp.mjs";

export default {
  fetch: (req) => handler(req),
};
