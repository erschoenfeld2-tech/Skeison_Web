// 3D-Druck (site/3d/): Beschreibung/Fotos -> Server-PC (3d-server/) -> STL/3MF mit Vorschau.
// Navigation, Hell/Dunkel, Toast und Einblenden kommen aus assets/fx.js und assets/mode.js.
// Verbindung laut config.js: ueber Supabase (Live-Seite) oder direkt per HTTP (lokaler Testserver app.py).
const CFG = window.SKEISON_3D || { api: "" };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/* ---------- Verbindung ---------- */
function httpBackend(API) {
  return {
    async health() {
      const r = await fetch(`${API}/api/health`, { cache: "no-store" });
      if (!r.ok) throw new Error("offline");
      return { online: true, ...(await r.json()) };
    },
    async create(d) {
      const fd = new FormData();
      fd.append("description", d.description);
      fd.append("size_mm", d.size);
      fd.append("size_user", d.sizeUser ? "1" : "0");
      fd.append("flat_base", d.flat ? "1" : "0");
      fd.append("settings", JSON.stringify(d.settings || {}));
      d.files.forEach((f) => fd.append("images", f, f.name));
      const r = await fetch(`${API}/api/jobs`, { method: "POST", body: fd, headers: d.code != null ? { "X-Access-Code": d.code } : {} });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.detail || "Der Auftrag konnte nicht gestartet werden.");
      return data.id;
    },
    async get(id) {
      const r = await fetch(`${API}/api/jobs/${id}`, { cache: "no-store" });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("Abfrage fehlgeschlagen");
      return r.json();
    },
    file: (j, fmt, inline) => `${API}/api/jobs/${j.id}/file?format=${fmt}${inline ? "&inline=1" : ""}`,
  };
}

// Fotos verkleinern (laengste Seite 1536 px, JPEG): reicht Meshy und haelt den Auftrag klein
async function shrink(file, max = 1536) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return { mime: "image/jpeg", data: c.toDataURL("image/jpeg", 0.88).split(",")[1] };
}

function supabaseBackend({ url, key }) {
  const rpc = async (fn, body) => {
    const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST", cache: "no-store", body: JSON.stringify(body || {}),
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error(data?.message || "Der Auftrag konnte nicht gestartet werden.");
    return data;
  };
  return {
    health: () => rpc("p3d_status"),
    async create(d) {
      const images = await Promise.all(d.files.map((f) => shrink(f)));
      return rpc("p3d_create_job", {
        p_description: d.description, p_size_mm: +d.size, p_size_user: d.sizeUser, p_flat_base: d.flat,
        p_settings: d.settings || {},
        p_images: images, p_code: d.code || "",
      });
    },
    get: (id) => (/^[0-9a-f-]{36}$/.test(id) ? rpc("p3d_get_job", { p_id: id }) : Promise.resolve(null)),
    file(j, fmt, inline) {
      const u = j.files?.[fmt] || "";
      return inline || !u ? u : `${u}&download=${encodeURIComponent(`${j.name}.${fmt}`)}`;
    },
  };
}

const backend = CFG.api === "supabase" ? supabaseBackend(CFG) : httpBackend((CFG.api || "").replace(/\/$/, ""));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

const state = { files: [], fmt: store.get("s3d-fmt") || "3mf", sizeTouched: false, jobId: null, poll: null };

/* ---------- Hell / Dunkel (assets/mode.js meldet den Wechsel) ---------- */
document.addEventListener("wl:mode", () => viewer?.retheme());

/* ---------- Meldung unten (assets/fx.js) ---------- */
function toast(msg, bad = false) {
  if (!window.FX?.toast) return;
  window.FX.toast(msg);
  document.querySelector(".toast")?.classList.toggle("bad", bad);
}

/* Weiches Einblenden beim Zustandswechsel (Klasse s3d-in, siehe 3d.css) */
function fadeIn(...els) {
  els.flat().forEach((el, i) => {
    if (!el) return;
    el.classList.remove("s3d-in");
    el.style.setProperty("--i", i);
    void el.offsetWidth; // Animation neu starten
    el.classList.add("s3d-in");
  });
}

/* ---------- Beispiele ---------- */
$("chips").addEventListener("click", (e) => {
  const b = e.target.closest(".chip");
  if (!b) return;
  $("desc").value = b.textContent;
  $("desc").focus();
});

/* ---------- Fotos ---------- */
const drop = $("drop");
const input = $("files");
function addFiles(list) {
  for (const f of list) {
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { toast("Nur JPG, PNG oder WebP", true); continue; }
    if (f.size > 10 * 1024 * 1024) { toast("Foto ist größer als 10 MB", true); continue; }
    if (state.files.length >= 4) { toast("Maximal 4 Fotos", true); break; }
    state.files.push({ file: f, url: URL.createObjectURL(f) });
  }
  renderThumbs();
}
function renderThumbs() {
  $("thumbs").innerHTML = state.files.map((f, i) =>
    `<li><img src="${f.url}" alt="Foto ${i + 1}"><button type="button" data-i="${i}" aria-label="Foto ${i + 1} entfernen">×</button></li>`).join("");
}
$("thumbs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-i]");
  if (!b) return;
  const [f] = state.files.splice(+b.dataset.i, 1);
  URL.revokeObjectURL(f.url);
  renderThumbs();
});
input.addEventListener("change", () => { addFiles(input.files); input.value = ""; });
drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
document.addEventListener("paste", (e) => {
  const imgs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
  if (imgs.length) addFiles(imgs);
});

/* ---------- Groesse ---------- */
const size = $("size");
function setSize(v, touched = true) {
  size.value = v;
  $("sizeOut").innerHTML = `<b>${v}</b> mm`;
  size.style.setProperty("--p", `${((v - size.min) / (size.max - size.min)) * 100}%`);
  if (touched) state.sizeTouched = true;
  document.querySelectorAll("#sizePresets button").forEach((b) => b.classList.toggle("on", +b.dataset.size === +v));
}
size.addEventListener("input", () => setSize(size.value));
$("sizePresets").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setSize(b.dataset.size); });

/* ---------- Format ---------- */
function setFmt(f) {
  state.fmt = f;
  store.set("s3d-fmt", f);
  document.querySelectorAll("#fmt button").forEach((b) => {
    const on = b.dataset.fmt === f;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on);
  });
}
$("fmt").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setFmt(b.dataset.fmt); });
setFmt(state.fmt);

/* ---------- Druckeinstellungen (wie im Slicer; Server prueft und begrenzt sie, 3d-server/print_settings.py) ---------- */
const MAT_OVERHANG = { PLA: 50, PETG: 45, ABS: 45, ASA: 45, TPU: 40 };
const DEFAULTS = { nozzle: 0.4, layer: 0.2, material: "PLA", bed: [256, 256, 256], printer: "256,256,256", size_axis: "max",
  clearance: 0.2, overhang: 50, orient: true, no_support: true, shrink: false, detail: "standard" };
const AXIS_NAME = { max: "längste Seite", z: "Höhe", x: "Breite", y: "Tiefe" };
let ps = { ...DEFAULTS };
try { ps = { ...DEFAULTS, ...JSON.parse(store.get("s3d-settings") || "{}") }; } catch { /* Standard */ }
const de = (n, d = 2) => Number(n).toFixed(d).replace(".", ",");

function segValue(id, v) {
  document.querySelectorAll(`#${id} button`).forEach((b) => {
    const on = b.dataset.v === String(v);
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on);
  });
}
function setRange(id, v, text) {
  const el = $(id);
  el.value = v;
  el.style.setProperty("--p", `${((v - el.min) / (el.max - el.min)) * 100}%`);
  $(`${id}Out`).innerHTML = text;
}
function renderSettings() {
  segValue("nozzle", ps.nozzle);
  segValue("layer", ps.layer);
  segValue("material", ps.material);
  segValue("detail", ps.detail);
  // Schichthoehe hoechstens 80 % der Duese
  document.querySelectorAll("#layer button").forEach((b) => { b.disabled = +b.dataset.v > ps.nozzle * 0.8 + 1e-9; });
  document.querySelectorAll("#axis button").forEach((b) => {
    const on = b.dataset.axis === ps.size_axis;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on);
  });
  $("axisName").textContent = AXIS_NAME[ps.size_axis];
  setRange("clearance", ps.clearance, `<b>${de(ps.clearance)}</b> mm`);
  setRange("overhang", ps.overhang, `<b>${ps.overhang}</b> °`);
  $("noSupport").checked = ps.no_support;
  $("orient").checked = ps.orient;
  $("shrink").checked = ps.shrink;
  const known = [...$("printer").options].some((o) => o.value === ps.printer);
  $("printer").value = known ? ps.printer : "custom";
  $("bedCustom").hidden = $("printer").value !== "custom";
  [$("bedX").value, $("bedY").value, $("bedZ").value] = ps.bed;
  $("advSum").textContent = `Düse ${de(ps.nozzle, 1)} · Schicht ${de(ps.layer)} · ${ps.material}`;
}
function saveSettings() { store.set("s3d-settings", JSON.stringify(ps)); renderSettings(); }

[["nozzle", (v) => { ps.nozzle = +v; if (ps.layer > ps.nozzle * 0.8) ps.layer = [0.28, 0.2, 0.16, 0.12].find((l) => l <= ps.nozzle * 0.8) || 0.12; }],
 ["layer", (v) => { ps.layer = +v; }],
 ["material", (v) => { ps.material = v; ps.overhang = MAT_OVERHANG[v]; }],
 ["detail", (v) => { ps.detail = v; }]].forEach(([id, apply]) => {
  $(id).addEventListener("click", (e) => { const b = e.target.closest("button"); if (b && !b.disabled) { apply(b.dataset.v); saveSettings(); } });
});
$("axis").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { ps.size_axis = b.dataset.axis; saveSettings(); } });
$("clearance").addEventListener("input", (e) => { ps.clearance = +e.target.value; saveSettings(); });
$("overhang").addEventListener("input", (e) => { ps.overhang = +e.target.value; saveSettings(); });
[["noSupport", "no_support"], ["orient", "orient"], ["shrink", "shrink"]].forEach(([id, key]) => {
  $(id).addEventListener("change", (e) => { ps[key] = e.target.checked; saveSettings(); });
});
$("printer").addEventListener("change", (e) => {
  ps.printer = e.target.value;
  if (ps.printer !== "custom") ps.bed = ps.printer.split(",").map(Number);
  saveSettings();
});
["bedX", "bedY", "bedZ"].forEach((id, i) => $(id).addEventListener("change", (e) => {
  ps.bed[i] = Math.max(50, Math.min(1000, +e.target.value || 256));
  saveSettings();
}));
$("advReset").addEventListener("click", () => { ps = { ...DEFAULTS, bed: [...DEFAULTS.bed] }; saveSettings(); toast("Standard-Druckeinstellungen"); });
renderSettings();

function settingsPayload() {
  const { printer, ...rest } = ps; // Druckername bleibt im Browser
  return rest;
}

/* ---------- Server-Status ---------- */
let health = null;
async function checkHealth() {
  const n = $("notice");
  try {
    health = await backend.health();
    if (!health?.online) throw new Error("offline");
    if (health.needs_code) { $("codeField").hidden = false; $("code").value = store.get("s3d-code") || ""; }
    if (health.demo) { n.hidden = false; n.className = "notice warn"; n.textContent = "Demo-Modus: Es wird eine Beispiel-Vase erzeugt, keine echte KI."; }
    $("limitInfo").textContent = `Bis zu ${health.limit_per_day} Modelle pro Tag · Dauer meist 2–5 Minuten`;
    $("genInfo").hidden = health.generator !== "claude";
  } catch {
    n.hidden = false; n.className = "notice bad";
    n.textContent = "Der 3D-Server ist gerade offline. Bitte später nochmal versuchen.";
    if (!state.jobId) { $("go").disabled = true; $("go").textContent = "Server offline"; }
  }
}

/* ---------- Ablauf ---------- */
const STEPS = ["analyse", "generate", "blender"];
let shown = null;
function showStage(mode) {
  const st = $("stage");
  if (mode !== shown) {
    shown = mode;
    if (mode === "run") fadeIn([...$("steps").children]);
    if (mode === "done") fadeIn([...$("result").children]);
    if (mode === "idle") fadeIn($("empty"));
  }
  st.classList.toggle("idle", mode === "idle");
  $("steps").hidden = mode !== "run";
  if (mode !== "run") $("queueInfo").hidden = true;
  $("result").hidden = mode !== "done";
  $("viewer").classList.toggle("busy", mode === "run");
  $("empty").hidden = mode === "done";
  $("go").disabled = mode === "run";
  $("go").innerHTML = mode === "run" ? "Wird erstellt …" : 'Modell erstellen <span class="arr">→</span>';
}
function markSteps(stage, progress) {
  if (stage === "upload") stage = "blender"; // Hochladen gehoert noch zum letzten Schritt
  const idx = STEPS.indexOf(stage);
  document.querySelectorAll("#steps li").forEach((li, i) => {
    li.classList.toggle("done", idx > i || stage === "done");
    li.classList.toggle("active", idx === i);
  });
  $("bar").style.width = `${stage === "generate" ? progress : stage === "blender" || stage === "done" ? 100 : 0}%`;
}

function formError(msg) { const e = $("formError"); e.hidden = !msg; e.textContent = msg || ""; }

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  formError("");
  const desc = $("desc").value.trim();
  if (!desc && !state.files.length) { formError("Beschreibe kurz, was du drucken willst, oder lade ein Foto hoch."); $("desc").focus(); return; }

  const order = {
    description: desc, size: size.value, sizeUser: state.sizeTouched, flat: $("flat").checked,
    files: state.files.map((f) => f.file), code: health?.needs_code ? $("code").value : null,
    settings: settingsPayload(),
  };
  if (health?.needs_code) store.set("s3d-code", $("code").value);

  showStage("run");
  markSteps("queued", 0);
  if (matchMedia("(max-width: 900px)").matches) $("stage").scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    startPolling(await backend.create(order));
  } catch (err) {
    showStage("idle");
    formError(err.message === "Failed to fetch" ? "Keine Verbindung zum 3D-Server." : err.message);
  }
});

function startPolling(id) {
  state.jobId = id;
  store.set("s3d-job", id);
  clearInterval(state.poll);
  const tick = async () => {
    try {
      const j = await backend.get(id);
      if (!j) { clearInterval(state.poll); store.set("s3d-job", null); showStage("idle"); return; }
      markSteps(j.stage, j.progress);
      const q = $("queueInfo");
      q.hidden = !(j.state === "queued" && j.position > 0);
      q.textContent = `Platz ${(j.position || 0) + 1} in der Warteschlange – vor dir ${j.position === 1 ? "ist 1 Auftrag" : `sind ${j.position} Aufträge`}.`;
      if (j.state === "done") { clearInterval(state.poll); finish(j); }
      if (j.state === "error") { clearInterval(state.poll); store.set("s3d-job", null); showStage("idle"); formError(j.message); toast(j.message, true); }
    } catch { /* kurzer Netzaussetzer: weiter versuchen */ }
  };
  tick();
  state.poll = setInterval(tick, 2500);
}

async function finish(j) {
  showStage("done");
  markSteps("done", 100);
  const r = j.result || {};
  const [x, y, z] = r.size_mm || [0, 0, 0];
  const n1 = (v) => Number(v).toLocaleString("de-DE", { maximumFractionDigits: 1 });
  const tiles = [
    [`${n1(x)}×${n1(y)}×${n1(z)}`, "mm"],
    [(r.triangles || 0).toLocaleString("de-DE"), r.exact ? "Dreiecke · exakt" : "Dreiecke"],
    [r.watertight ? "Ja ✓" : "Prüfen", "Wasserdicht", r.watertight ? "ok" : ""],
  ];
  if (r.layers) tiles.push([r.layers.toLocaleString("de-DE"), "Schichten"]);
  if (r.wall_p05 != null) tiles.push([`${n1(r.wall_p05)} mm`, "Dünnste Wand"]);
  if (r.overhang_pct != null) tiles.push([`${n1(r.overhang_pct)} %`, "Überhang"]);
  $("stats").innerHTML = tiles.map(([b, s, c]) => `<div><b class="${c || ""}">${esc(b)}</b><span>${esc(s)}</span></div>`).join("");
  fadeIn([...$("stats").children]);

  // Druckpruefung in Worten
  const checks = [];
  if (r.fits_bed === false) checks.push(["bad", "Passt nicht auf dein Druckbett: kleiner wählen oder im Slicer teilen."]);
  else if (r.fits_bed) checks.push(["", "Passt auf dein Druckbett."]);
  if (r.critical_pct > 0.5) checks.push(["bad", `${n1(r.critical_pct)} % der Fläche ist dünner als die Düse und wird nicht gedruckt.`]);
  else if (r.thin_pct > 1) checks.push(["warn", `${n1(r.thin_pct)} % der Fläche hat sehr dünne Wände (unter zwei Linien).`]);
  if (r.overhang_pct > 5) checks.push(["warn", `Deutliche Überhänge (${n1(r.overhang_pct)} %): mit Stützen drucken.`]);
  else if (r.overhang_pct != null) checks.push(["", "Kaum Überhänge, ohne Stützen druckbar."]);
  if (r.orientation && r.orientation !== "wie modelliert") checks.push(["", `Ausrichtung optimiert: ${r.orientation}.`]);
  if (r.shrink_pct) checks.push(["", `Schrumpf ausgeglichen: +${n1(r.shrink_pct)} %.`]);
  $("checks").innerHTML = checks.map(([c, t]) => `<li class="${c}">${esc(t)}</li>`).join("");
  $("checks").hidden = !checks.length;
  const rec = r.recommend || [];
  $("rec").innerHTML = rec.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
  $("recBox").hidden = !rec.length;
  $("hint").hidden = !j.hint;
  $("hint").textContent = j.hint || "";
  const other = state.fmt === "3mf" ? "stl" : "3mf";
  const main = $("dlMain"), alt = $("dlAlt");
  main.href = backend.file(j, state.fmt);
  main.setAttribute("download", `${j.name}.${state.fmt}`);
  main.innerHTML = `${state.fmt.toUpperCase()} herunterladen <span class="arr">↓</span>`;
  alt.href = backend.file(j, other);
  alt.setAttribute("download", `${j.name}.${other}`);
  alt.textContent = `Als ${other.toUpperCase()}`;
  toast("Dein Modell ist fertig");
  try {
    await ensureViewer();
    await viewer.load(backend.file(j, "stl", true));
  } catch (err) { console.warn("Vorschau nicht moeglich", err); $("empty").hidden = false; }
}

$("again").addEventListener("click", () => {
  store.set("s3d-job", null);
  state.jobId = null;
  viewer?.clear();
  showStage("idle");
  $("desc").focus();
  $("form").scrollIntoView({ behavior: "smooth", block: "start" });
});

/* ---------- 3D-Vorschau (three.js, erst bei Bedarf geladen) ---------- */
let viewer = null;
async function ensureViewer() {
  if (viewer) return viewer;
  const THREE = await import("three");
  const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
  const { STLLoader } = await import("three/addons/loaders/STLLoader.js");
  const host = $("viewer");
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotate = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  controls.autoRotateSpeed = 1.6;
  controls.addEventListener("start", () => { controls.autoRotate = false; });
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334466, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(1, 2, 1.5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb0ff, 1.0); rim.position.set(-1.5, 1, -1); scene.add(rim);
  const css = () => getComputedStyle(document.documentElement);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.05 });
  let mesh = null, grid = null;

  function retheme() {
    mat.color.set(css().getPropertyValue("--accent").trim() || "#ffcb05");
    if (grid) { grid.material.color.set(css().getPropertyValue("--line").trim()); }
  }
  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();
  retheme();
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

  viewer = {
    retheme,
    clear() { if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh = null; } if (grid) { scene.remove(grid); grid = null; } },
    async load(url) {
      const geo = await new STLLoader().loadAsync(url);
      geo.rotateX(-Math.PI / 2); // Druck: Z oben -> three.js: Y oben
      geo.computeVertexNormals();
      geo.computeBoundingBox();
      const bb = geo.boundingBox, c = new THREE.Vector3();
      bb.getCenter(c);
      geo.translate(-c.x, -bb.min.y, -c.z);
      this.clear();
      mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);
      const s = bb.getSize(new THREE.Vector3());
      const r = Math.max(s.x, s.y, s.z);
      grid = new THREE.GridHelper(r * 2.4, 12);
      grid.material.transparent = true; grid.material.opacity = 0.5;
      scene.add(grid);
      retheme();
      controls.target.set(0, s.y / 2, 0);
      camera.position.set(r * 1.4, r * 1.1, r * 1.8);
      camera.near = r / 100; camera.far = r * 50; camera.updateProjectionMatrix();
      controls.autoRotate = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    },
  };
  return viewer;
}

/* ---------- Start ---------- */
setSize(size.value, false);
showStage("idle");
checkHealth();
const pending = store.get("s3d-job");
if (pending) { showStage("run"); startPolling(pending); }
