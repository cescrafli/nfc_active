// =============================================================
// Membuat public/config.js dari Environment Variables saat build.
// Dengan begitu Google Maps API Key TIDAK pernah tersimpan di GitHub.
//
// - Di Netlify  : env diambil dari Site configuration → Environment variables
// - Di lokal    : env diambil dari file .env (lihat .env.example)
// =============================================================
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const envFile = fileURLToPath(new URL(".env", root));
const outFile = fileURLToPath(new URL("public/config.js", root));

// Muat .env sederhana untuk pengembangan lokal (tidak menimpa env yang sudah ada).
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || line.trim().startsWith("#")) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

const config = {
  googleMapsApiKey: (process.env.GOOGLE_MAPS_API_KEY || "").trim(),
  redirectEnabled: (process.env.REDIRECT_MODE || "on").toLowerCase() !== "off",
};

writeFileSync(
  outFile,
  `// AUTO-GENERATED oleh scripts/build-config.mjs — JANGAN diedit / di-commit.\n` +
    `window.APP_CONFIG = ${JSON.stringify(config, null, 2)};\n`
);

console.log(`[build-config] public/config.js dibuat.`);
console.log(`  - Google Maps API Key : ${config.googleMapsApiKey ? "terpasang" : "KOSONG (bisa diisi dari layar)"}`);
console.log(`  - Mode Link Pengalih  : ${config.redirectEnabled ? "aktif" : "nonaktif"}`);

const token = process.env.ADMIN_TOKEN || "";
if (config.redirectEnabled && token.length < 24) {
  console.warn(`  ! PERINGATAN: ADMIN_TOKEN belum diset / kurang dari 24 karakter. API admin akan menolak semua request.`);
}
