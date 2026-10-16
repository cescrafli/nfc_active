// =============================================================
// Halaman Kelola Kartu — CRUD link pengalih via /api/links.
// =============================================================
import {
  $,
  CODE_RE,
  api,
  clearToken,
  copyText,
  formatDate,
  getToken,
  h,
  hideStatus,
  parseManualInput,
  setToken,
  showStatus,
} from "./common.js";

const statusBox = $("status-box");
let items = [];

const shortUrl = (code) => `${location.origin}/r/${code}`;

// ---------- Login ----------
$("login-btn").addEventListener("click", login);
$("token-input").addEventListener("keydown", (e) => e.key === "Enter" && login());
$("logout-btn").addEventListener("click", () => {
  clearToken();
  location.reload();
});
$("refresh-btn").addEventListener("click", load);
$("search").addEventListener("input", render);
$("create-btn").addEventListener("click", createLink);

if (getToken()) enterDashboard();

async function login() {
  const token = $("token-input").value.trim();
  if (!token) return showStatus(statusBox, "Masukkan token admin.", "warn");
  setToken(token);
  try {
    await api("/api/links?ping=1");
    $("token-input").value = "";
    enterDashboard();
  } catch (e) {
    clearToken();
    showStatus(statusBox, e.message, "error");
  }
}

async function enterDashboard() {
  $("login-section").hidden = true;
  $("dash").hidden = false;
  await load();
}

// ---------- Data ----------
async function load() {
  showStatus(statusBox, "Memuat data…", "info");
  try {
    const data = await api("/api/links");
    items = data.items || [];
    hideStatus(statusBox);
    render();
  } catch (e) {
    if (e.status === 401) {
      clearToken();
      $("login-section").hidden = false;
      $("dash").hidden = true;
    }
    showStatus(statusBox, e.message, "error");
  }
}

function render() {
  const q = $("search").value.trim().toLowerCase();
  const filtered = q
    ? items.filter((it) => [it.name, it.code, it.target, it.address].some((v) => String(v || "").toLowerCase().includes(q)))
    : items;

  const totalScans = items.reduce((n, it) => n + (it.scans || 0), 0);
  const active = items.filter((it) => it.active).length;
  $("stats").textContent = `${items.length} link (${active} aktif) • total ${totalScans} scan`;

  const list = $("list");
  if (!filtered.length) {
    list.replaceChildren(h("div", { class: "empty" }, items.length ? "Tidak ada yang cocok." : "Belum ada kartu terdaftar."));
    return;
  }
  list.replaceChildren(...filtered.map(renderItem));
}

function renderItem(it) {
  const link = shortUrl(it.code);
  return h(
    "div",
    { class: "link-item" + (it.active ? "" : " inactive") },
    h(
      "div",
      { class: "link-head" },
      h("div", {}, h("div", { class: "link-name" }, it.name || "(tanpa nama)"), it.address ? h("div", { class: "link-row" }, it.address) : null),
      h("span", { class: "badge " + (it.active ? "on" : "off") }, it.active ? "AKTIF" : "NONAKTIF")
    ),
    h("div", { class: "link-row" }, h("b", {}, "Kode: "), it.code),
    h("div", { class: "link-row" }, h("b", {}, "Link kartu: "), link),
    h("div", { class: "link-row" }, h("b", {}, "Tujuan: "), h("a", { href: it.target, target: "_blank", rel: "noopener noreferrer" }, it.target)),
    h("div", { class: "link-row" }, h("b", {}, "Scan: "), `${it.scans || 0}× • terakhir ${formatDate(it.lastScanAt)}`),
    h("div", { class: "link-row" }, h("b", {}, "Dibuat: "), formatDate(it.createdAt), " • ", h("b", {}, "Diubah: "), formatDate(it.updatedAt)),
    h(
      "div",
      { class: "link-actions" },
      h("button", { type: "button", class: "btn-small secondary", onclick: async () => {
        await copyText(link);
        showStatus(statusBox, `Link disalin: ${link}`, "success");
      } }, "Salin Link"),
      h("button", { type: "button", class: "btn-small secondary", onclick: () => window.open(link, "_blank", "noopener") }, "Uji"),
      h("button", { type: "button", class: "btn-small blue", onclick: () => editTarget(it) }, "Ubah Tujuan"),
      h("button", { type: "button", class: "btn-small secondary", onclick: () => editName(it) }, "Ubah Nama"),
      h("button", { type: "button", class: "btn-small", onclick: () => toggleActive(it) }, it.active ? "Nonaktifkan" : "Aktifkan"),
      h("button", { type: "button", class: "btn-small danger", onclick: () => removeLink(it) }, "Hapus")
    )
  );
}

function replaceItem(updated) {
  items = items.map((it) => (it.code === updated.code ? updated : it));
  render();
}

// ---------- Aksi ----------
async function update(it, body, successMsg) {
  try {
    const updated = await api(`/api/links/${encodeURIComponent(it.code)}`, { method: "PUT", body });
    replaceItem(updated);
    showStatus(statusBox, successMsg, "success");
  } catch (e) {
    showStatus(statusBox, e.message, "error");
  }
}

async function editTarget(it) {
  const val = prompt(`Tujuan baru untuk "${it.name || it.code}"\n(Place ID atau link review Google):`, it.target);
  if (val === null) return;
  const r = parseManualInput(val);
  if (!r.ok) return showStatus(statusBox, r.error || "Tujuan tidak boleh kosong.", "error");
  await update(it, { target: r.url, placeId: r.placeId }, `Tujuan "${it.code}" diperbarui. Semua kartu dengan kode ini kini mengarah ke tujuan baru.`);
}

async function editName(it) {
  const val = prompt("Nama toko:", it.name || "");
  if (val === null) return;
  await update(it, { name: val }, "Nama diperbarui.");
}

async function toggleActive(it) {
  if (it.active && !confirm(`Nonaktifkan "${it.code}"? Kartu yang di-scan akan menampilkan pesan "Kartu tidak aktif".`)) return;
  await update(it, { active: !it.active }, it.active ? "Link dinonaktifkan." : "Link diaktifkan kembali.");
}

async function removeLink(it) {
  if (!confirm(`HAPUS "${it.code}" permanen?\n\nKartu fisik dengan kode ini akan menampilkan "Kartu belum diaktifkan". Lebih aman pilih Nonaktifkan.`)) return;
  try {
    await api(`/api/links/${encodeURIComponent(it.code)}`, { method: "DELETE" });
    items = items.filter((x) => x.code !== it.code);
    render();
    showStatus(statusBox, `Link "${it.code}" dihapus.`, "success");
  } catch (e) {
    showStatus(statusBox, e.message, "error");
  }
}

async function createLink() {
  const name = $("new-name").value.trim();
  const code = $("new-code").value.trim().toLowerCase();
  const r = parseManualInput($("new-target").value);
  if (!r.ok) return showStatus(statusBox, r.error || "Isi Place ID / link review.", "error");
  if (code && !CODE_RE.test(code)) return showStatus(statusBox, "Kode hanya boleh huruf kecil, angka, - dan _ (3–32 karakter).", "error");

  const btn = $("create-btn");
  btn.disabled = true;
  try {
    const rec = await api("/api/links", {
      method: "POST",
      body: { name, code: code || undefined, target: r.url, placeId: r.placeId },
    });
    items.unshift(rec);
    render();
    ["new-name", "new-target", "new-code"].forEach((id) => ($(id).value = ""));
    $("create-box").open = false;
    showStatus(statusBox, `Link dibuat: ${shortUrl(rec.code)}\nTulis link ini ke kartu memakai aplikasi NFC (mis. NFC Tools → Write → URL).`, "success");
  } catch (e) {
    showStatus(statusBox, e.message, "error");
  } finally {
    btn.disabled = false;
  }
}
