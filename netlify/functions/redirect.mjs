// =============================================================
// Link pengalih kartu NFC:  GET /r/:code  →  302 ke halaman review Google.
//
// Kartu NFC cukup berisi https://domain-anda/r/kode. Tujuan akhirnya bisa
// diubah dari halaman Kelola Kartu kapan saja — walau kartu sudah dikunci.
// =============================================================
import {
  CODE_RE,
  escapeHtml,
  linksStore,
  normalizeCode,
  statsStore,
  validateTarget,
} from "../lib/links.mjs";

export default async (req, context) => {
  const code = normalizeCode(context.params?.code);
  if (!CODE_RE.test(code)) {
    return page(404, "Kartu tidak dikenali", "Kode pada kartu ini tidak valid.");
  }

  let rec;
  try {
    rec = await linksStore().get(code, { type: "json" });
  } catch (err) {
    console.error(err);
    return page(503, "Sedang gangguan", "Silakan coba tempelkan kartu lagi beberapa saat lagi.");
  }

  if (!rec) {
    return page(404, "Kartu belum diaktifkan", "Kartu ini belum terdaftar. Hubungi pemilik toko.");
  }
  if (!rec.active) {
    return page(410, "Kartu tidak aktif", "Kartu ini sudah dinonaktifkan oleh pemiliknya.");
  }

  const target = validateTarget(rec.target);
  if (!target.ok) {
    return page(500, "Tujuan tidak valid", "Link tujuan kartu ini bermasalah. Hubungi pemilik toko.");
  }

  // Hitung scan (best-effort, tidak menghambat redirect).
  const countScan = (async () => {
    try {
      const stats = statsStore();
      const st = (await stats.get(code, { type: "json" })) || { scans: 0 };
      await stats.setJSON(code, { scans: (st.scans || 0) + 1, lastScanAt: new Date().toISOString() });
    } catch (err) {
      console.error("stat error", err);
    }
  })();
  if (typeof context.waitUntil === "function") context.waitUntil(countScan);
  else await countScan;

  return new Response(null, {
    status: 302,
    headers: {
      location: target.url,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
};

function page(status, title, message) {
  const html = `<!DOCTYPE html>
<html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow"><title>${escapeHtml(title)}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f4f6f9;color:#202124;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
.c{background:#fff;max-width:420px;width:100%;padding:28px;border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,.08);text-align:center}
h1{font-size:20px;margin:8px 0}p{color:#5f6368;font-size:14px;line-height:1.5;margin:0}.i{font-size:40px}</style></head>
<body><div class="c"><div class="i">📇</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></div></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

export const config = {
  path: "/r/:code",
};
