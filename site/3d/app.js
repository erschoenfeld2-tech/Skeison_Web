// 3D-Druck (site/3d/): Beschreibung/Fotos -> Server (3d-server/) -> STL/3MF mit Vorschau.
// Navigation, Hell/Dunkel, Toast und Einblenden kommen aus assets/fx.js und assets/mode.js.
const API = (window.SKEISON_3D_API || "").replace(/\/$/, "");
const $ = (id) => document.getElementById(id);
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

/* ---------- Server-Status ---------- */
let health = null;
async function checkHealth() {
  const n = $("notice");
  try {
    const r = await fetch(`${API}/api/health`, { cache: "no-store" });
    health = await r.json();
    if (health.needs_code) { $("codeField").hidden = false; $("code").value = store.get("s3d-code") || ""; }
    if (health.demo) { n.hidden = false; n.className = "notice warn"; n.textContent = "Demo-Modus: Es wird eine Beispiel-Vase erzeugt, keine echte KI."; }
    $("limitInfo").textContent = `Bis zu ${health.limit_per_day} Modelle pro Tag · Dauer meist 1–4 Minuten`;
  } catch {
    n.hidden = false; n.className = "notice bad";
    n.textContent = "Der 3D-Server ist gerade nicht erreichbar. Bitte später nochmal versuchen.";
    if (!state.jobId) { $("go").disabled = true; $("go").textContent = "Server nicht erreichbar"; }
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
  $("result").hidden = mode !== "done";
  $("viewer").classList.toggle("busy", mode === "run");
  $("empty").hidden = mode === "done";
  $("go").disabled = mode === "run";
  $("go").innerHTML = mode === "run" ? "Wird erstellt …" : 'Modell erstellen <span class="arr">→</span>';
}
function markSteps(stage, progress) {
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

  const fd = new FormData();
  fd.append("description", desc);
  fd.append("size_mm", size.value);
  fd.append("size_user", state.sizeTouched ? "1" : "0");
  fd.append("flat_base", $("flat").checked ? "1" : "0");
  state.files.forEach((f) => fd.append("images", f.file, f.file.name));
  const headers = {};
  if (health?.needs_code) { headers["X-Access-Code"] = $("code").value; store.set("s3d-code", $("code").value); }

  showStage("run");
  markSteps("queued", 0);
  if (matchMedia("(max-width: 900px)").matches) $("stage").scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const r = await fetch(`${API}/api/jobs`, { method: "POST", body: fd, headers });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || "Der Auftrag konnte nicht gestartet werden.");
    startPolling(data.id);
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
      const r = await fetch(`${API}/api/jobs/${id}`, { cache: "no-store" });
      if (r.status === 404) { clearInterval(state.poll); store.set("s3d-job", null); showStage("idle"); return; }
      const j = await r.json();
      markSteps(j.stage, j.progress);
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
  $("stats").innerHTML = `
    <div><b>${Math.round(x)}×${Math.round(y)}×${Math.round(z)}</b><span>mm</span></div>
    <div><b>${(r.triangles || 0).toLocaleString("de-DE")}</b><span>Dreiecke</span></div>
    <div><b class="${r.watertight ? "ok" : ""}">${r.watertight ? "Ja ✓" : "Prüfen"}</b><span>Wasserdicht</span></div>`;
  fadeIn([...$("stats").children]);
  $("hint").hidden = !j.hint;
  $("hint").textContent = j.hint || "";
  const other = state.fmt === "3mf" ? "stl" : "3mf";
  const main = $("dlMain"), alt = $("dlAlt");
  main.href = `${API}/api/jobs/${j.id}/file?format=${state.fmt}`;
  main.setAttribute("download", `${j.name}.${state.fmt}`);
  main.innerHTML = `${state.fmt.toUpperCase()} herunterladen <span class="arr">↓</span>`;
  alt.href = `${API}/api/jobs/${j.id}/file?format=${other}`;
  alt.setAttribute("download", `${j.name}.${other}`);
  alt.textContent = `Als ${other.toUpperCase()}`;
  toast("Dein Modell ist fertig");
  try {
    await ensureViewer();
    await viewer.load(`${API}/api/jobs/${j.id}/file?format=stl&inline=1`);
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
