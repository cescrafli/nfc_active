// =============================================================
// Halaman Aktivasi Kartu NFC Review Google Maps.
// =============================================================
import {
  $,
  CHIP_CAPACITY,
  CODE_RE,
  api,
  chipAdvice,
  clearToken,
  getToken,
  hideStatus,
  isIOS,
  ndefUrlBytes,
  parseManualInput,
  reviewUrlFromPlaceId,
  setToken,
  showStatus,
} from "./common.js";

const config = window.APP_CONFIG || {};
const LS_MAPS_KEY = "gmaps_api_key";
const nfcSupported = "NDEFReader" in window;
const redirectEnabled = config.redirectEnabled !== false;
const statusBox = $("status-box");

const state = {
  place: null, // { name, address, placeId, targetUrl, source }
  registered: null, // { code, target } — link pengalih yang sudah terdaftar di server
  abort: null,
  busy: false,
};

// ---------- Inisialisasi ----------
setupNfcBanner();
setupTabs();
setupMaps();
setupTestMode();
setupLock();
setupModes();
setupToken();
$("code-input").addEventListener("input", () => {
  state.registered = null;
  validateCodeField();
  updateWritePreview();
});
$("write-btn").addEventListener("click", writeToNfcCard);
$("cancel-btn").addEventListener("click", () => state.abort?.abort());
updateWriteButton();

// =============================================================
// Dukungan Web NFC
// =============================================================
function setupNfcBanner() {
  if (nfcSupported) return;
  const banner = $("nfc-banner");
  banner.hidden = false;
  if (isIOS()) {
    banner.textContent =
      "iPhone/iPad belum mendukung Web NFC untuk MENULIS kartu. Gunakan Google Chrome di HP Android. (iPhone tetap bisa MEMBACA kartu yang sudah aktif.)";
  } else if (!window.isSecureContext) {
    banner.textContent = "Halaman harus dibuka melalui HTTPS agar Web NFC aktif.";
  } else {
    banner.textContent =
      "Browser ini belum mendukung Web NFC. Buka halaman ini dengan Google Chrome di HP Android dan pastikan NFC menyala. Anda tetap bisa menyiapkan data di bawah.";
  }
}

// =============================================================
// Tabs
// =============================================================
function setupTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  buttons.forEach((btn) =>
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      buttons.forEach((b) => b.classList.toggle("active", b === btn));
      $("section-maps").hidden = tab !== "maps";
      $("section-test").hidden = tab !== "test";
    })
  );
}

// =============================================================
// Google Maps — Places API (New): PlaceAutocompleteElement
// =============================================================
function setupMaps() {
  const fixedKey = String(config.googleMapsApiKey || "").trim();
  const key = fixedKey || localStorage.getItem(LS_MAPS_KEY) || "";

  $("save-key-btn").addEventListener("click", () => {
    const val = $("api-key-input").value.trim();
    if (!val) return alert("Masukkan Google Maps API Key terlebih dahulu.");
    localStorage.setItem(LS_MAPS_KEY, val);
    location.reload();
  });
  $("change-key-btn").addEventListener("click", () => {
    if (!confirm("Hapus API Key yang tersimpan di perangkat ini?")) return;
    localStorage.removeItem(LS_MAPS_KEY);
    location.reload();
  });

  if (!key) {
    $("api-key-config").hidden = false;
    setMapsPlaceholder('Masukkan API Key di atas, atau gunakan tab "Mode Tes / Place ID".');
    return;
  }
  if (!fixedKey) {
    $("api-key-input").value = key;
    $("change-key-btn").hidden = false;
  }

  setMapsPlaceholder("Memuat Google Maps…");
  // Dipanggil Google jika API Key ditolak (billing / restriction / API belum aktif).
  window.gm_authFailure = () =>
    onMapsFailed(
      "API Key ditolak Google. Pastikan Maps JavaScript API & Places API (New) aktif, billing menyala, dan domain ini diizinkan di HTTP referrer.",
      !fixedKey
    );

  loadMapsScript(key)
    .then(initPlaces)
    .catch(() =>
      onMapsFailed('Gagal memuat Google Maps. Periksa koneksi / API Key, atau gunakan tab "Mode Tes / Place ID".', !fixedKey)
    );
}

function onMapsFailed(msg, showKeyBox) {
  if (showKeyBox) $("api-key-config").hidden = false;
  setMapsPlaceholder("Pencarian Maps tidak tersedia.");
  showStatus(statusBox, msg, "error");
}

function setMapsPlaceholder(text) {
  const box = document.createElement("div");
  box.className = "placeholder-box";
  box.textContent = text;
  $("maps-autocomplete").replaceChildren(box);
}

function loadMapsScript(key) {
  return new Promise((resolve, reject) => {
    window.__nfcMapsReady = resolve;
    const s = document.createElement("script");
    s.src =
      "https://maps.googleapis.com/maps/api/js?" +
      new URLSearchParams({
        key,
        v: "weekly",
        libraries: "places",
        language: "id",
        region: "ID",
        loading: "async",
        callback: "__nfcMapsReady",
      });
    s.async = true;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function initPlaces() {
  const container = $("maps-autocomplete");
  const places = window.google?.maps?.places;
  if (!places) return onMapsFailed("Library Google Places tidak termuat.", true);

  // --- API baru (wajib untuk project Google Cloud yang dibuat sejak Maret 2025) ---
  if (places.PlaceAutocompleteElement) {
    const el = new places.PlaceAutocompleteElement({ includedRegionCodes: ["id"] });
    container.replaceChildren(el);

    const handle = async (place) => {
      try {
        await place.fetchFields({ fields: ["displayName", "formattedAddress", "id"] });
        onPlaceSelected(place.displayName, place.formattedAddress, place.id);
      } catch (e) {
        showStatus(statusBox, "Gagal mengambil detail tempat: " + (e?.message || e), "error");
      }
    };
    el.addEventListener("gmp-select", (ev) => ev.placePrediction && handle(ev.placePrediction.toPlace()));
    el.addEventListener("gmp-placeselect", (ev) => ev.place && handle(ev.place)); // nama event versi lama
    el.addEventListener("gmp-error", () =>
      showStatus(statusBox, 'Pencarian Maps error. Pastikan "Places API (New)" sudah diaktifkan untuk API Key ini.', "error")
    );
    return;
  }

  // --- Fallback: Autocomplete lama (hanya untuk project lama yang masih punya akses) ---
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Contoh: Kopi Kenangan Bekasi…";
  input.autocomplete = "off";
  container.replaceChildren(input);
  const ac = new places.Autocomplete(input, {
    componentRestrictions: { country: "id" },
    fields: ["name", "formatted_address", "place_id"],
    types: ["establishment"],
  });
  ac.addListener("place_changed", () => {
    const p = ac.getPlace();
    onPlaceSelected(p.name, p.formatted_address, p.place_id);
  });
}

function onPlaceSelected(name, address, placeId) {
  if (!placeId) {
    showStatus(statusBox, "Silakan klik salah satu nama toko yang muncul di daftar dropdown.", "warn");
    return;
  }
  setPlace({
    name: name || "Tanpa nama",
    address: address || "",
    placeId,
    targetUrl: reviewUrlFromPlaceId(placeId),
    source: "maps",
  });
}

// =============================================================
// Mode Tes / Input Manual
// =============================================================
function setupTestMode() {
  $("preset-store").addEventListener("change", (e) => {
    const val = e.target.value;
    if (!val) return;
    const [placeId, name] = val.split("|");
    $("manual-input").value = "";
    $("manual-error").hidden = true;
    setPlace({ name, address: "Place ID: " + placeId, placeId, targetUrl: reviewUrlFromPlaceId(placeId), source: "preset" });
  });

  $("manual-input").addEventListener("input", (e) => {
    const r = parseManualInput(e.target.value);
    const err = $("manual-error");
    if (r.empty) {
      err.hidden = true;
      if (state.place?.source === "manual") clearPlace();
      return;
    }
    if (!r.ok) {
      err.hidden = false;
      err.textContent = r.error;
      if (state.place?.source === "manual") clearPlace();
      return;
    }
    err.hidden = true;
    $("preset-store").value = "";
    setPlace({
      name: r.kind === "url" ? "Tautan Review Kustom" : "Lokasi Place ID Manual",
      address: r.kind === "url" ? "Link dimasukkan manual" : "Place ID: " + r.placeId,
      placeId: r.placeId,
      targetUrl: r.url,
      source: "manual",
    });
  });
}

// =============================================================
// State toko terpilih
// =============================================================
function setPlace(p) {
  state.place = p;
  state.registered = null;
  $("preview-name").textContent = p.name;
  $("preview-addr").textContent = p.address;
  $("preview-url").textContent = p.targetUrl;
  $("preview-box").hidden = false;
  hideStatus(statusBox);
  updateWritePreview();
  updateWriteButton();
}

function clearPlace() {
  state.place = null;
  state.registered = null;
  $("preview-box").hidden = true;
  updateWritePreview();
  updateWriteButton();
}

// =============================================================
// Jenis link: Pengalih vs Langsung
// =============================================================
const getMode = () => document.querySelector('input[name="mode"]:checked')?.value || "direct";

function setupModes() {
  if (!redirectEnabled) {
    const r = document.querySelector('input[name="mode"][value="redirect"]');
    r.disabled = true;
    r.closest(".radio-card").classList.add("disabled");
    document.querySelector('input[name="mode"][value="direct"]').checked = true;
  }
  document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener("change", onModeChange));
  onModeChange();
}

function onModeChange() {
  $("redirect-config").hidden = getMode() !== "redirect";
  updateLockHint();
  updateWritePreview();
}

// =============================================================
// Token admin
// =============================================================
function setupToken() {
  renderToken();
  $("token-save-btn").addEventListener("click", async () => {
    const val = $("token-input").value.trim();
    if (!val) return alert("Masukkan token admin.");
    setToken(val);
    const btn = $("token-save-btn");
    btn.disabled = true;
    try {
      await api("/api/links?ping=1");
      $("token-input").value = "";
      showStatus(statusBox, "✅ Token admin valid dan tersimpan di perangkat ini.", "success");
    } catch (e) {
      clearToken();
      showStatus(statusBox, "Token tidak bisa dipakai: " + e.message, "error");
    } finally {
      btn.disabled = false;
      renderToken();
    }
  });
  $("token-clear-btn").addEventListener("click", () => {
    clearToken();
    renderToken();
  });
}

function renderToken() {
  const has = Boolean(getToken());
  $("token-saved").hidden = !has;
  $("token-form").hidden = has;
}

const codeValue = () => $("code-input").value.trim().toLowerCase();

function validateCodeField() {
  const v = codeValue();
  const bad = Boolean(v) && !CODE_RE.test(v);
  $("code-error").hidden = !bad;
  $("code-error").textContent = bad ? "Kode hanya boleh huruf kecil, angka, - dan _ (3–32 karakter)." : "";
  return !bad;
}

// =============================================================
// Pengaman kunci kartu (default: TIDAK dikunci)
// =============================================================
function setupLock() {
  const cb = $("lock-card");
  cb.checked = false; // jangan ikut status checkbox yang diingat browser
  cb.addEventListener("change", () => {
    if (cb.checked) {
      const ok = confirm(
        "PERINGATAN!\n\nMengunci kartu bersifat PERMANEN. Isi kartu tidak akan bisa ditulis ulang selamanya.\n\nGunakan hanya untuk kartu final yang akan diberikan ke toko. Lanjutkan?"
      );
      if (!ok) cb.checked = false;
    }
    updateLockHint();
  });
  updateLockHint();
}

function updateLockHint() {
  const locked = $("lock-card").checked;
  const redirect = getMode() === "redirect";
  const hint = $("lock-hint");
  if (!locked) {
    hint.className = "lock-hint";
    hint.textContent =
      "🧪 Mode Testing aktif: kartu TIDAK dikunci, bisa ditulis ulang berkali-kali." +
      (redirect ? " Untuk kartu final yang dibagikan ke toko, sebaiknya dikunci agar tidak bisa ditimpa orang lain." : "");
  } else if (redirect) {
    hint.className = "lock-hint warn";
    hint.textContent = "🔒 Kartu akan dikunci permanen. Tujuan link tetap bisa diubah lewat halaman Kelola Kartu.";
  } else {
    hint.className = "lock-hint danger";
    hint.textContent = "🔒 Kartu akan DIKUNCI PERMANEN berisi link Google langsung. Isi kartu tidak bisa diubah lagi selamanya!";
  }
}

// =============================================================
// Pratinjau URL & ukuran chip
// =============================================================
const redirectUrlFor = (code) => `${location.origin}/r/${code}`;

function updateWritePreview() {
  const box = $("write-preview");
  if (!state.place) {
    box.hidden = true;
    return;
  }
  box.hidden = false;

  let shown, measured;
  if (getMode() === "redirect") {
    const code = state.registered?.code || codeValue();
    shown = redirectUrlFor(code || "(kode-otomatis)");
    measured = redirectUrlFor(code || "x".repeat(7));
  } else {
    shown = measured = state.place.targetUrl;
  }

  $("write-url").textContent = shown;
  const bytes = ndefUrlBytes(measured);
  const advice = chipAdvice(bytes);
  $("size-info").textContent = `Perkiraan ukuran: ${bytes} byte — ${advice.text}`;
  $("size-info").classList.toggle("bad", !advice.ok);
}

function updateWriteButton() {
  const btn = $("write-btn");
  btn.disabled = !nfcSupported || !state.place || state.busy;
  btn.textContent = !nfcSupported
    ? "Butuh Chrome Android + NFC"
    : state.busy
      ? "Memproses…"
      : "Aktivasi & Tulis ke Kartu NFC";
}

// =============================================================
// Daftarkan link pengalih ke server
// =============================================================
async function ensureRedirectLink() {
  if (!getToken()) {
    throw new Error('Simpan Token Admin dulu di Langkah 2, atau pilih "Link Langsung Google".');
  }
  if (!validateCodeField()) throw new Error("Kode kartu tidak valid.");

  if (state.registered && state.registered.target === state.place.targetUrl) {
    return redirectUrlFor(state.registered.code); // pakai ulang (mis. kartu kedua untuk toko yang sama)
  }

  showStatus(statusBox, "🔗 Mendaftarkan link pengalih ke server…", "info");
  const custom = codeValue();
  try {
    const rec = await api("/api/links", {
      method: "POST",
      body: {
        code: custom || undefined,
        target: state.place.targetUrl,
        name: state.place.name,
        address: state.place.address,
        placeId: state.place.placeId,
      },
    });
    state.registered = { code: rec.code, target: state.place.targetUrl };
  } catch (e) {
    // Kode kustom sudah ada: boleh dipakai ulang jika tujuannya sama.
    if (e.status === 409 && custom) {
      const existing = await api(`/api/links/${encodeURIComponent(custom)}`);
      if (existing.target !== new URL(state.place.targetUrl).href) {
        throw new Error(`Kode "${custom}" sudah dipakai untuk tujuan lain. Gunakan kode lain atau kosongkan.`);
      }
      state.registered = { code: custom, target: state.place.targetUrl };
    } else {
      throw e;
    }
  }
  updateWritePreview();
  return redirectUrlFor(state.registered.code);
}

// =============================================================
// Tulis ke kartu NFC
// =============================================================
async function writeToNfcCard() {
  if (!state.place || state.busy) return;
  if (!nfcSupported) {
    showStatus(statusBox, "Browser ini belum mendukung Web NFC. Gunakan Google Chrome di HP Android (HTTPS) dengan NFC menyala.", "error");
    return;
  }

  const mode = getMode();
  state.busy = true;
  updateWriteButton();

  try {
    const url = mode === "redirect" ? await ensureRedirectLink() : state.place.targetUrl;

    const bytes = ndefUrlBytes(url);
    if (
      bytes > CHIP_CAPACITY.NTAG213 &&
      !confirm(`Data ${bytes} byte melebihi kapasitas NTAG213 (${CHIP_CAPACITY.NTAG213} byte).\nLanjutkan hanya jika kartu Anda NTAG215/216.`)
    ) {
      showStatus(statusBox, "Penulisan dibatalkan.", "warn");
      return;
    }

    state.abort = new AbortController();
    $("cancel-btn").hidden = false;
    const ndef = new NDEFReader();

    showStatus(statusBox, "📡 Siap menulis! Tempelkan dan tahan kartu NFC di belakang HP Anda sekarang…", "warn");
    await ndef.write({ records: [{ recordType: "url", data: url }] }, { signal: state.abort.signal });

    let lockMsg = "Kartu tidak dikunci (bisa ditulis ulang).";
    if ($("lock-card").checked) {
      if (typeof ndef.makeReadOnly === "function") {
        showStatus(statusBox, "✍️ Link tertulis. Tetap tahan kartu untuk proses penguncian…", "warn");
        try {
          await ndef.makeReadOnly({ signal: state.abort.signal });
          lockMsg = "Kartu telah DIKUNCI permanen.";
        } catch (lockErr) {
          lockMsg = `⚠️ Link sudah tertulis, tetapi penguncian GAGAL (${describeError(lockErr)}). Ulangi untuk mengunci.`;
        }
      } else {
        lockMsg = "⚠️ Chrome ini belum mendukung penguncian — kartu TIDAK dikunci. Perbarui Chrome.";
      }
    }

    const lines = [`✅ Aktivasi berhasil untuk "${state.place.name}".`, lockMsg];
    if (mode === "redirect") {
      lines.push(`Kode kartu: ${state.registered.code} — tujuan bisa diubah di halaman Kelola Kartu.`);
      lines.push("Kartu berikutnya untuk toko yang sama akan memakai link yang sama.");
    }
    lines.push("Keluar dari Chrome lalu tempelkan ulang kartu untuk mengetes.");
    showStatus(statusBox, lines.join("\n"), "success");
  } catch (err) {
    showStatus(statusBox, describeError(err), err?.name === "AbortError" ? "warn" : "error");
  } finally {
    state.busy = false;
    state.abort = null;
    $("cancel-btn").hidden = true;
    updateWriteButton();
  }
}

function describeError(err) {
  switch (err?.name) {
    case "AbortError":
      return "Proses penulisan kartu dibatalkan.";
    case "NotAllowedError":
      return "Izin NFC ditolak. Ketuk ikon gembok di address bar → Izin → NFC → Izinkan, lalu coba lagi.";
    case "NotSupportedError":
      return "NFC tidak tersedia. Pastikan NFC di HP menyala (Setelan → Perangkat terhubung → NFC).";
    case "NotReadableError":
      return "Kartu tidak bisa dibaca/ditulis. Coba kartu lain atau pastikan kartu tidak terkunci.";
    case "NetworkError":
      return "Kartu terlepas saat proses berlangsung. Tempelkan lebih lama lalu coba lagi.";
    default:
      return "Gagal: " + (err?.message || err);
  }
}
