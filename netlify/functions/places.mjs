// =============================================================
// Endpoint pencarian tempat: GET /api/places?q=...
// Menggabungkan saran tempat dari Google + Nominatim/Photon (Indonesia)
// sehingga pengguna tidak memerlukan Google Cloud API Key.
// =============================================================

export default async (req) => {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();

  if (q.length < 2) {
    return json({ items: [] });
  }

  const results = [];
  const seen = new Set();

  const addItem = (title, subtitle, query) => {
    const key = (title + "|" + subtitle).toLowerCase();
    if (!title || seen.has(key)) return;
    seen.add(key);
    results.push({ title, subtitle, query: query || [title, subtitle].filter(Boolean).join(", ") });
  };

  // 1. Ambil autocomplete dari Google (sangat mengenal nama toko/tempat di Indonesia)
  const googleTask = (async () => {
    try {
      const gUrl =
        "https://suggestqueries.google.com/complete/search?client=firefox&hl=id&gl=id&ds=cse&q=" +
        encodeURIComponent(q);
      const res = await fetch(gUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0" },
      });
      const data = await res.json();
      const list = Array.isArray(data?.[1]) ? data[1] : [];
      for (const item of list.slice(0, 6)) {
        const clean = String(item).trim();
        if (clean) addItem(clean, "Saran pencarian Google", clean);
      }
    } catch {
      /* abaikan jika gagal */
    }
  })();

  // 2. Ambil data detail tempat dari Nominatim OpenStreetMap khusus Indonesia (countrycodes=id)
  const osmTask = (async () => {
    try {
      const nUrl =
        "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&countrycodes=id&accept-language=id&q=" +
        encodeURIComponent(q);
      const res = await fetch(nUrl, {
        headers: { "User-Agent": "NFC-Review-Card-Activator/1.0" },
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        for (const row of data) {
          const name = row.name || (row.display_name ? row.display_name.split(",")[0] : q);
          const addr = row.display_name
            ? row.display_name.split(",").slice(1, 4).join(",").trim()
            : "Indonesia";
          addItem(name, addr, `${name}, ${addr}`);
        }
      }
    } catch {
      /* abaikan jika gagal */
    }
  })();

  await Promise.all([googleTask, osmTask]);

  return json({ items: results.slice(0, 8) });
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
}

export const config = {
  path: "/api/places",
};
