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

  if ((!placeId && !cid) || !title) return null;

  const reviewUrl = placeId
    ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`
    : cid
      ? `https://www.google.com/maps?cid=${encodeURIComponent(cid)}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(title)}`;

  const mapsUrl = cid
    ? `https://www.google.com/maps?cid=${encodeURIComponent(cid)}`
    : placeId
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(title)}&query_place_id=${encodeURIComponent(placeId)}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(title)}`;

  return {
    title,
    address,
    placeId,
    cid,
    rating,
    reviews,
    category,
    reviewUrl,
    mapsUrl,
  };
}

async function fetchEmbed(params) {
  const url = `https://maps.google.com/maps?${params}&hl=id&gl=id&output=embed`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        "Accept-Language": "id-ID,id;q=0.9",
      },
    });
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function isGoogleUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    return (
      (u.protocol === "http:" || u.protocol === "https:") &&
      /(\.|^)(google\.[a-z.]+|goo\.gl|maps\.app\.goo\.gl|g\.page)$/i.test(u.hostname)
    );
  } catch {
    return false;
  }
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
      if (!isGoogleUrl(q)) {
        return json({ items: [] });
      }
      try {
        const fetchController = new AbortController();
        const fetchTimeout = setTimeout(() => fetchController.abort(), 6000);
        let resp;
        try {
          resp = await fetch(q, {
            method: "GET",
            redirect: "follow",
            cache: "no-store",
            signal: fetchController.signal,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
              "Accept-Language": "id-ID,id;q=0.9",
            },
          });
        } finally {
          clearTimeout(fetchTimeout);
        }

        const finalUrl = resp.url || q;
        const html = await resp.text();

        // 1. Cari CID desimal dari URL tujuan atau dari body HTML
        const cidMatch = finalUrl.match(/cid[=:](\d+)/i) || html.match(/\["\d{10,22}","(\d{10,22})"\]/);
        let cid = cidMatch ? (cidMatch[1] || cidMatch[0]) : "";

        // 2. Jika belum ada CID desimal, cari Hex CID (:0x...) dari URL Google Maps:
        // Contoh: /data=!3m1!4b1!4m6!3m5!1s0x2e69...:0x89abcdef01234567
        if (!cid) {
          const hexMatch = finalUrl.match(/:0x([0-9a-f]{8,18})/i) || html.match(/:0x([0-9a-f]{8,18})/i);
          if (hexMatch && hexMatch[1]) {
            try {
              cid = BigInt("0x" + hexMatch[1]).toString(10);
            } catch {}
          }
        }

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
        if (!title || /^google\s*maps$/i.test(title)) {
          const placePathMatch = finalUrl.match(/\/place\/([^/@?]+)/i);
          if (placePathMatch) {
            title = decodeURIComponent(placePathMatch[1].replace(/\+/g, " ")).trim();
          }
        }

        if (title && !/^google\s*maps$/i.test(title)) {
          // Coba cari data lengkap tempat via embed pencarian nama toko
          try {
            const queryHtml = await fetchEmbed(`q=${encodeURIComponent(title)}`);
            const spotlit = parseSpotlit(queryHtml);
            if (spotlit) {
              return json({ items: [spotlit] });
            }
          } catch {}

          return json({
            items: [
              {
                title,
                address: "",
                placeId: placeId || "",
                cid: cid || "",
                rating: null,
                reviews: null,
                category: null,
                reviewUrl: placeId ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}` : "",
                mapsUrl: cid ? `https://www.google.com/maps?cid=${encodeURIComponent(cid)}` : finalUrl,
              },
            ],
          });
        }
      } catch {
        // Abaikan error fetch URL
      }
      return json({ items: [] });
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
      "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
    },
  });
}

export const config = {
  path: "/api/places",
};
