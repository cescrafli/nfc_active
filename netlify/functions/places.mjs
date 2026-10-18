// =============================================================
// Endpoint pencarian tempat Google Maps asli: GET /api/places?q=...
// Mengambil daftar toko/cabang langsung dari Google Maps Embed (tanpa API Key)
// lengkap dengan Nama Toko, Alamat, Rating, Jumlah Ulasan, dan Place ID (ChIJ...)
// sehingga link yang ditulis ke kartu NFC bisa langsung membuka:
//   1. Halaman Rating / Tulis Ulasan (search.google.com/local/writereview?placeid=...)
//   2. Aplikasi Google Maps langsung ke profil toko (maps?cid=...)
//
// Mendukung pencarian teks kata kunci (Kopi Senja Bekasi) maupun
// langsung paste Link Google Maps (maps.app.goo.gl, goo.gl/maps, google.com/maps).
// =============================================================

function parseSpotlit(html) {
  const m = html.match(/initEmbed\(([\s\S]*?)\);\s*\}/);
  if (!m) return null;
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const info = data?.[21]?.[3];
  if (!Array.isArray(info)) return null;

  const placeId = (m[1].match(/"(ChIJ[A-Za-z0-9_-]{10,60})"/) || [])[1] || "";
  const cid = info?.[0]?.[3] || "";
  const title = info?.[1] || "";
  const address =
    info?.[13] ||
    (Array.isArray(info?.[2]) ? info[2].join(", ") : "") ||
    info?.[0]?.[1] ||
    "";
  const rating = typeof info?.[3] === "number" ? info[3].toFixed(1) : null;
  const reviews = typeof info?.[4] === "string" ? info[4] : null;
  const category = typeof info?.[12] === "string" ? info[12] : null;

  if (!placeId || !title) return null;

  return {
    title,
    address,
    placeId,
    cid,
    rating,
    reviews,
    category,
    reviewUrl: `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`,
    mapsUrl: cid
      ? `https://www.google.com/maps?cid=${encodeURIComponent(cid)}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(title)}&query_place_id=${encodeURIComponent(placeId)}`,
  };
}

async function fetchEmbed(params) {
  const url = `https://maps.google.com/maps?${params}&hl=id&gl=id&output=embed`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      "Accept-Language": "id-ID,id;q=0.9",
    },
  });
  return res.text();
}

export default async (req) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();

  if (q.length < 2) {
    return json({ items: [] });
  }

  try {
    // Dukungan Khusus: Jika customer mem-paste Link Google Maps langsung
    if (/^https?:\/\//i.test(q)) {
      try {
        const resp = await fetch(q, {
          method: "GET",
          redirect: "follow",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
            "Accept-Language": "id-ID,id;q=0.9",
          },
        });
        const finalUrl = resp.url || q;
        const html = await resp.text();

        // Cari CID dari URL tujuan atau dari body HTML
        const cidMatch = finalUrl.match(/cid[=:](\d+)/i) || html.match(/\["\d{10,22}","(\d{10,22})"\]/);
        const cid = cidMatch ? (cidMatch[1] || cidMatch[0]) : "";

        if (cid) {
          const cidHtml = await fetchEmbed(`cid=${encodeURIComponent(cid)}`);
          const item = parseSpotlit(cidHtml);
          if (item) return json({ items: [item] });
        }

        // Cari Place ID (ChIJ...)
        const placeIdMatch = finalUrl.match(/(ChIJ[A-Za-z0-9_-]{10,60})/) || html.match(/"(ChIJ[A-Za-z0-9_-]{10,60})"/);
        const placeId = placeIdMatch ? placeIdMatch[1] : "";

        let title = "";
        const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) || html.match(/<title>([^<]+)<\/title>/i);
        if (titleMatch) {
          title = titleMatch[1].replace(/\s*·\s*Google Maps.*$/i, "").replace(/\s*-\s*Google Maps.*$/i, "").trim();
        }

        if (placeId && title) {
          return json({
            items: [
              {
                title,
                address: "Google Maps",
                placeId,
                cid: cid || "",
                rating: null,
                reviews: null,
                category: null,
                reviewUrl: `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`,
                mapsUrl: cid ? `https://www.google.com/maps?cid=${encodeURIComponent(cid)}` : finalUrl,
              },
            ],
          });
        }
      } catch {
        // Lanjut ke pencarian teks biasa jika fetch URL eksternal gagal
      }
    }

    // Pencarian Teks Standar
    const html = await fetchEmbed(`q=${encodeURIComponent(q)}`);

    // Kasus 1: Langsung ketemu 1 toko spesifik ("spotlit")
    const direct = parseSpotlit(html);
    if (direct) {
      return json({ items: [direct] });
    }

    // Kasus 2: Banyak cabang / daftar tempat -> ambil hingga 6 CID teratas secara paralel
    const cids = [
      ...new Set([...html.matchAll(/\["\d{10,22}","(\d{10,22})"\]/g)].map((x) => x[1])),
    ].slice(0, 6);

    if (cids.length > 0) {
      const details = await Promise.all(
        cids.map(async (cid) => {
          try {
            const cidHtml = await fetchEmbed(`cid=${encodeURIComponent(cid)}`);
            return parseSpotlit(cidHtml);
          } catch {
            return null;
          }
        })
      );
      const valid = details.filter(Boolean);
      if (valid.length > 0) {
        return json({ items: valid });
      }
    }

    return json({ items: [] });
  } catch (err) {
    return json({ items: [], error: err?.message || "Gagal mencari tempat" });
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=120",
    },
  });
}

export const config = {
  path: "/api/places",
};
