// =============================================================
// API admin untuk mengelola link pengalih kartu NFC.
//
//   GET    /api/links?ping=1      → cek token
//   GET    /api/links             → daftar semua link (+ statistik scan)
//   GET    /api/links/:code       → detail satu link
//   POST   /api/links             → buat link  { code?, target, name?, address?, placeId? }
//   PUT    /api/links/:code       → ubah link  { target?, name?, address?, placeId?, active? }
//   DELETE /api/links/:code       → hapus link
//
// Semua request wajib header:  Authorization: Bearer <ADMIN_TOKEN>
// =============================================================
import {
  CODE_RE,
  checkAuth,
  cleanText,
  generateCode,
  json,
  linksStore,
  normalizeCode,
  statsStore,
  validateTarget,
} from "../lib/links.mjs";

export default async (req, context) => {
  const auth = checkAuth(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.has("ping")) return json({ ok: true });

  const links = linksStore();
  const stats = statsStore();
  const code = context.params?.code ? normalizeCode(decodeURIComponent(context.params.code)) : "";
  if (code && !CODE_RE.test(code)) return json({ error: "Format kode tidak valid." }, 400);

  try {
    switch (req.method) {
      case "GET": {
        if (code) {
          const rec = await links.get(code, { type: "json" });
          if (!rec) return json({ error: "Link tidak ditemukan." }, 404);
          const st = (await stats.get(code, { type: "json" })) || {};
          return json({ ...rec, scans: st.scans || 0, lastScanAt: st.lastScanAt || null });
        }
        const { blobs } = await links.list();
        const items = await Promise.all(
          blobs.map(async ({ key }) => {
            const [rec, st] = await Promise.all([
              links.get(key, { type: "json" }),
              stats.get(key, { type: "json" }),
            ]);
            return rec ? { ...rec, scans: st?.scans || 0, lastScanAt: st?.lastScanAt || null } : null;
          })
        );
        return json({
          items: items.filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
        });
      }

      case "POST": {
        if (code) return json({ error: "Gunakan POST /api/links (tanpa kode di URL)." }, 400);
        const body = await readJson(req);
        const target = validateTarget(body.target);
        if (!target.ok) return json({ error: target.error }, 400);

        let newCode = normalizeCode(body.code);
        if (newCode) {
          if (!CODE_RE.test(newCode)) {
            return json({ error: "Kode hanya boleh huruf kecil, angka, - dan _ (3–32 karakter)." }, 400);
          }
          if ((await links.get(newCode)) !== null) {
            return json({ error: `Kode "${newCode}" sudah dipakai.`, code: newCode }, 409);
          }
        } else {
          for (let i = 0; i < 6 && !newCode; i++) {
            const candidate = generateCode();
            if ((await links.get(candidate)) === null) newCode = candidate;
          }
          if (!newCode) return json({ error: "Gagal membuat kode unik, coba lagi." }, 500);
        }

        const now = new Date().toISOString();
        const rec = {
          code: newCode,
          target: target.url,
          name: cleanText(body.name, 120),
          address: cleanText(body.address, 200),
          placeId: cleanText(body.placeId, 400),
          active: true,
          createdAt: now,
          updatedAt: now,
        };
        await links.setJSON(newCode, rec);
        return json({ ...rec, scans: 0, lastScanAt: null }, 201);
      }

      case "PUT":
      case "PATCH": {
        if (!code) return json({ error: "Kode wajib ada di URL: /api/links/:code" }, 400);
        const rec = await links.get(code, { type: "json" });
        if (!rec) return json({ error: "Link tidak ditemukan." }, 404);
        const body = await readJson(req);

        if ("target" in body) {
          const target = validateTarget(body.target);
          if (!target.ok) return json({ error: target.error }, 400);
          rec.target = target.url;
        }
        if ("name" in body) rec.name = cleanText(body.name, 120);
        if ("address" in body) rec.address = cleanText(body.address, 200);
        if ("placeId" in body) rec.placeId = cleanText(body.placeId, 400);
        if ("active" in body) rec.active = Boolean(body.active);
        rec.updatedAt = new Date().toISOString();

        await links.setJSON(code, rec);
        const st = (await stats.get(code, { type: "json" })) || {};
        return json({ ...rec, scans: st.scans || 0, lastScanAt: st.lastScanAt || null });
      }

      case "DELETE": {
        if (!code) return json({ error: "Kode wajib ada di URL: /api/links/:code" }, 400);
        await Promise.all([links.delete(code), stats.delete(code)]);
        return json({ ok: true });
      }

      default:
        return json({ error: "Method tidak didukung." }, 405);
    }
  } catch (err) {
    console.error(err);
    return json({ error: "Server error: " + (err?.message || err) }, 500);
  }
};

async function readJson(req) {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

export const config = {
  path: ["/api/links", "/api/links/:code"],
};
