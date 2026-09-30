/* Distancias Ley 11.178 (Entre Ríos) — mapa satelital con zonas de exclusión y amortiguamiento.
   Todo corre en el navegador; los datos del lote se guardan sólo en este dispositivo. */
(function () {
"use strict";

/* ---------- Configuración ---------- */
// Si activás la Map Tiles API de Google, pegá acá tu clave para tener fondo satelital de Google.
// Sin clave se usa Esri World Imagery.
const GOOGLE_API_KEY = "";

/* ---------- Normativa ---------- */
// [exclusión hasta (m), amortiguamiento hasta (m), cita exclusión, cita amortiguamiento]
// Claves de modo: m = manual o drone ≤60 L, t = terrestre, a = aérea tripulada
const LIM = {
  con: { m: [10, 30, "art. 63 a)", "art. 66 a)"], t: [100, 300, "art. 63 a)", "art. 66 a)"], a: [200, 600, "art. 63 a)", "art. 66 a)"] },
  sin: { m: [5, 30, "art. 63 b)", "art. 66 b)"], t: [50, 300, "art. 63 b)", "art. 66 b)"], a: [100, 600, "art. 63 b)", "art. 66 b)"] },
  esc: { m: [15, 45, "art. 68 a)", "art. 68 b)"], t: [150, 500, "art. 68 a)", "art. 68 b)"], a: [500, 3000, "art. 68 a)", "art. 68 b)"] },
  urb: { m: [10, 30, "art. 63 a) (viviendas)", "art. 66 a) (viviendas)"], t: [100, 300, "art. 63 a) (viviendas)", "art. 66 a) (viviendas)"], a: [1000, 3000, "art. 76 a)", "art. 76 b)"] }
};
const OBL = { con: "art. 67", sin: "art. 67", esc: "art. 69", urb: "art. 77" };
const TIPOS = {
  con: { t: "Vivienda / con personas", c: "#ff5a4f" },
  sin: { t: "Agua, apiario o área protegida", c: "#3fc3ff" },
  esc: { t: "Escuela rural", c: "#ffd23f" },
  urb: { t: "Planta urbana", c: "#e46bff" }
};
const MODOS = { manual: ["Manual", "m"], uav60: ["Drone ≤60 L", "m"], uav60p: ["Drone >60 L", null], terr: ["Terrestre", "t"], trip: ["Aérea tripulada", "a"] };
const BANDA = { Ia: "roja", Ib: "roja", II: "amarilla", III: "azul", IV: "verde" };
const Z_RANK = { dentro: 3, excl: 2, amort: 1, libre: 0 };

/* ---------- Estado ---------- */
const KEY = "d11178-mapa-v1";
const DEF = { modo: "uav60", tox: "III", ref60: "a", areas: [], lote: null, punto: null, base: "sat", view: null };
let S = load();
let draw = null;          // {kind:'area'|'lote', tipo, forma:'poly'|'pt', pts:[[lng,lat]]}
let gps = { on: false, id: null, pos: null, acc: null };

function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s) return Object.assign({}, DEF, s); } catch (_) {}
  return Object.assign({}, DEF);
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (_) {} }

const $ = (s) => document.querySelector(s);
const fmt = (n, d = 0) => Number(n).toLocaleString("es-AR", { maximumFractionDigits: d, minimumFractionDigits: d });
const uid = () => Math.random().toString(36).slice(2, 9);
const modoKey = () => MODOS[S.modo][1] || S.ref60;
const lim = (tipo) => LIM[tipo][modoKey()];
const permitidoAmort = (t) => t === "III" || t === "IV";
const zoneOf = (d, [e, a]) => (d <= 0 ? "dentro" : d <= e ? "excl" : d <= a ? "amort" : "libre");

/* ---------- Mapa ---------- */
const map = L.map("map", { zoomControl: true, attributionControl: true, doubleClickZoom: true, preferCanvas: false });
const baseLayers = {
  sat: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 21, maxNativeZoom: 19, attribution: "Imagen: Esri, Maxar, Earthstar Geographics"
  }),
  osm: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 21, maxNativeZoom: 19, attribution: "© OpenStreetMap" })
};
const labels = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxZoom: 21, maxNativeZoom: 19, opacity: 0.9 });
let google = null;

async function setupGoogle() {
  if (!GOOGLE_API_KEY) return;
  try {
    const r = await fetch("https://tile.googleapis.com/v1/createSession?key=" + GOOGLE_API_KEY, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapType: "satellite", language: "es-AR", region: "AR" })
    });
    const j = await r.json();
    if (!j.session) throw new Error("sin sesión");
    google = L.tileLayer(`https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${j.session}&key=${GOOGLE_API_KEY}`, {
      maxZoom: 21, maxNativeZoom: 20, attribution: "Imágenes © Google"
    });
    baseLayers.google = google;
    if (S.base === "sat" || S.base === "google") { S.base = "google"; applyBase(); }
  } catch (e) { console.warn("Google Map Tiles no disponible, sigo con Esri", e); }
}
function applyBase() {
  Object.values(baseLayers).forEach((l) => map.removeLayer(l));
  map.removeLayer(labels);
  const b = baseLayers[S.base] || baseLayers.sat;
  b.addTo(map);
  if (b !== baseLayers.osm) labels.addTo(map);
}
applyBase();
setupGoogle();

if (S.view) map.setView(S.view.c, S.view.z);
else map.setView([-31.75, -59.9], 8); // Entre Ríos
map.on("moveend", () => { const c = map.getCenter(); S.view = { c: [c.lat, c.lng], z: map.getZoom() }; save(); });

const gZonas = L.layerGroup().addTo(map);
const gAreas = L.layerGroup().addTo(map);
const gLote = L.layerGroup().addTo(map);
const gPunto = L.layerGroup().addTo(map);
const gDraw = L.layerGroup().addTo(map);
const gGps = L.layerGroup().addTo(map);

/* ---------- Geometría ---------- */
function bufferOf(area, m) {
  const f = { type: "Feature", properties: {}, geometry: area.geom };
  return turf.buffer(f, m / 1000, { units: "kilometers", steps: 48 });
}
function distTo(area, pt) {
  const g = area.geom;
  if (g.type === "Point") return { d: turf.distance(pt, g.coordinates, { units: "meters" }), near: g.coordinates };
  const poly = turf.polygon(g.coordinates);
  if (turf.booleanPointInPolygon(pt, poly)) return { d: 0, near: pt };
  const line = turf.lineString(g.coordinates[0]);
  const np = turf.nearestPointOnLine(line, pt, { units: "meters" });
  return { d: np.properties.dist, near: np.geometry.coordinates };
}
function unionAll(fs) {
  let u = null;
  for (const f of fs) { try { u = u ? turf.union(u, f) : f; } catch (e) { console.warn(e); } }
  return u;
}
const areaHa = (f) => (f ? turf.area(f) / 10000 : 0);
function safe(fn) { try { return fn(); } catch (e) { console.warn(e); return null; } }

/* ---------- Evaluación del punto ---------- */
function evaluar(pt) {
  if (!pt || !S.areas.length) return null;
  const rows = S.areas.map((a) => {
    const L_ = lim(a.tipo), r = distTo(a, pt), z = zoneOf(r.d, L_);
    return { area: a, L: L_, d: r.d, near: r.near, z };
  });
  rows.sort((x, y) => (Z_RANK[y.z] - Z_RANK[x.z]) || (x.d - x.L[1]) - (y.d - y.L[1]));
  return { worst: rows[0], rows };
}

/* ---------- Render ---------- */
function render() {
  $("#modo").value = S.modo; $("#tox").value = S.tox;
  $("#warn60").hidden = S.modo !== "uav60p";
  document.querySelectorAll("#warn60 [data-ref]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.ref === S.ref60));

  // Zonas: amortiguamiento, luego exclusión, luego el área
  gZonas.clearLayers(); gAreas.clearLayers();
  for (const a of S.areas) {
    const [e, am] = lim(a.tipo);
    const bA = safe(() => bufferOf(a, am)), bE = safe(() => bufferOf(a, e));
    if (bA) L.geoJSON(bA, { interactive: false, style: { color: "#ffb300", weight: 2, dashArray: "6 4", fillColor: "#ffb300", fillOpacity: 0.18 } }).addTo(gZonas);
    if (bE) L.geoJSON(bE, { interactive: false, style: { color: "#ff3b30", weight: 2, fillColor: "#ff3b30", fillOpacity: 0.28 } }).addTo(gZonas);
    const style = { color: TIPOS[a.tipo].c, weight: 3, fillColor: TIPOS[a.tipo].c, fillOpacity: 0.35 };
    const lay = a.geom.type === "Point"
      ? L.circleMarker([a.geom.coordinates[1], a.geom.coordinates[0]], Object.assign({ radius: 7 }, style))
      : L.geoJSON({ type: "Feature", geometry: a.geom }, { style });
    lay.bindTooltip(`${a.nombre || TIPOS[a.tipo].t} · exclusión ${fmt(e)} m · amort. ${fmt(am)} m`);
    lay.addTo(gAreas);
  }

  // Lote
  gLote.clearLayers();
  if (S.lote) L.geoJSON({ type: "Feature", geometry: S.lote.geom }, { interactive: false, style: { color: "#ffffff", weight: 2.5, dashArray: "2 6", fill: false } }).addTo(gLote);

  // Punto de aplicación
  gPunto.clearLayers();
  const ev = evaluar(S.punto);
  if (S.punto) {
    const ll = [S.punto[1], S.punto[0]];
    L.circleMarker(ll, { radius: 8, color: "#ffffff", weight: 3, fillColor: "#111", fillOpacity: 1 }).addTo(gPunto);
    if (ev) {
      const w = ev.worst;
      L.polyline([ll, [w.near[1], w.near[0]]], { color: "#ffffff", weight: 2, dashArray: "4 4", interactive: false }).addTo(gPunto)
        .bindTooltip(`${fmt(w.d)} m`, { permanent: true, direction: "center", className: "lbl-tip" });
    }
  }

  renderResult(ev);
  renderLote();
  renderAreas(ev);
  renderPrint(ev);
}

function obligaciones(z, tipo) {
  const it = [];
  const minD = (L_) => (permitidoAmort(S.tox) ? L_[0] : L_[1]);
  if (z === "dentro" || z === "excl") {
    it.push(["No aplicar en este sector. Cortar la pasada o dejar la franja sin tratar.", z === "dentro" ? "art. 98" : "art. 63"]);
  } else if (z === "amort") {
    if (!permitidoAmort(S.tox)) it.push(["Cambiar a un producto clase III o IV, o alejarse del área sensible.", "art. 66"]);
    it.push(["Asesor fitosanitario presente en el lugar.", OBL[tipo]]);
    it.push([tipo === "esc" ? "Aviso fehaciente con 48 h a la autoridad de aplicación y a la dirección de la escuela." : "Aviso fehaciente a las autoridades con 48 h de anticipación.", OBL[tipo]]);
    it.push(["Receta agronómica digital presentada.", OBL[tipo]]);
    it.push(["Condiciones meteorológicas adecuadas según el protocolo de buenas prácticas.", "art. 60"]);
    if (tipo === "esc") it.push(["Aplicar a contraturno escolar, en recesos, fines de semana o feriados.", "art. 69"]);
    if (tipo === "esc") it.push(["Garantizar la limpieza de la escuela antes del reingreso.", "art. 72"]);
  }
  if (z === "amort" || z === "libre") {
    it.push(["Receta agronómica digital emitida antes de aplicar.", "art. 28 c) · 57"]);
    it.push(["Equipo registrado, con habilitación anual y VTF vigente.", "art. 41 · 102"]);
    if (S.modo === "uav60" || S.modo === "uav60p") it.push(["Drone inscripto en el registro de VANT y piloto con requisitos ANAC.", "art. 20 j) · 41 l)"]);
    if (S.modo === "trip") it.push(["Certificado de Explotador de Trabajo Aéreo y requisitos ANAC.", "art. 41 l)"]);
    it.push(["Carga, descarga y lavado en el mismo lote, fuera de áreas sensibles.", "art. 45 f)"]);
  }
  return { it, minD };
}

function renderResult(ev) {
  const R = $("#result");
  const band = `clase ${S.tox}, banda ${BANDA[S.tox]}`;
  if (!S.areas.length) {
    R.innerHTML = `<h3>Punto de aplicación</h3><div class="verdict none"><div class="zone">Sin áreas sensibles</div><p>Marcá la escuela, vivienda, curso de agua o planta urbana con <b>+ Área sensible</b>. Después tocá el mapa donde querés aplicar.</p></div>`;
    return;
  }
  if (!ev) {
    R.innerHTML = `<h3>Punto de aplicación</h3><div class="verdict none"><div class="zone">Tocá el mapa</div><p>Ubicá el punto donde vas a aplicar, o activá el GPS para usar tu posición.</p></div>`;
    return;
  }
  const w = ev.worst, [e, a, ce, ca] = w.L, tipo = w.area.tipo;
  let cls, zone, txt, cite;
  if (w.z === "dentro") { cls = "excl"; zone = "Prohibido"; txt = "El punto está dentro del área sensible."; cite = "art. 98"; }
  else if (w.z === "excl") { cls = "excl"; zone = "Exclusión"; txt = `A ${fmt(w.d)} m de ${nombreDe(w.area)}. Hasta ${fmt(e)} m no se puede aplicar ningún producto.`; cite = ce; }
  else if (w.z === "amort") { cls = "amort"; zone = "Amortiguamiento"; txt = `A ${fmt(w.d)} m de ${nombreDe(w.area)}. Entre ${fmt(e)} y ${fmt(a)} m sólo clases III y IV, con condiciones.`; cite = `${ca} · ${OBL[tipo]}`; }
  else { cls = "libre"; zone = "Fuera de restricción"; txt = `A ${fmt(w.d)} m del área sensible más comprometida. Más allá de ${fmt(a)} m no hay restricción de distancia.`; cite = "art. 61"; }
  let ok, ptxt;
  if (w.z === "dentro" || w.z === "excl") { ok = false; ptxt = `${band}: no se puede aplicar acá`; }
  else if (w.z === "amort") { ok = permitidoAmort(S.tox); ptxt = ok ? `${band}: habilitado con condiciones` : `${band}: no habilitado, en amortiguamiento sólo III y IV`; }
  else { ok = true; ptxt = `${band}: sin restricción de distancia`; }
  const { it, minD } = obligaciones(w.z, tipo);
  const gpsTxt = gps.on && gps.acc != null ? `<div class="gps-ok">Posición GPS · precisión ±${fmt(gps.acc)} m${gps.acc > 10 ? " (esperá a que mejore antes de decidir cerca de un límite)" : ""}</div>` : "";
  R.innerHTML = `<h3>Punto de aplicación${S.modo === "uav60p" ? " · referencia, no distancia legal" : ""}</h3>
    <div class="verdict ${cls}"><div class="zone">${zone}</div><p>${txt}</p><div class="cite">${cite}</div></div>
    ${gpsTxt}
    <div class="prod ${ok ? "si" : "no"}">${ok ? "✓" : "✕"} ${ptxt}</div>
    <div class="kv"><span>Distancia mínima a ${nombreDe(w.area)} para clase ${S.tox}</span><span class="v">&gt; ${fmt(minD(w.L))} m</span></div>
    <ul class="checks">${it.map((x, i) => `<li><label><input type="checkbox" id="ck${i}"><span>${x[0]} <span class="art">${x[1]}</span></span></label></li>`).join("")}</ul>`;
}
const nombreDe = (a) => a.nombre || TIPOS[a.tipo].t.toLowerCase();

let loteStats = null;
function renderLote() {
  const C = $("#loteCard");
  loteStats = null;
  if (!S.lote) { C.hidden = true; return; }
  C.hidden = false;
  const lote = turf.polygon(S.lote.geom.coordinates);
  const tot = areaHa(lote);
  let ex = 0, am = 0;
  if (S.areas.length) {
    const eU = unionAll(S.areas.map((a) => safe(() => bufferOf(a, lim(a.tipo)[0]))).filter(Boolean));
    const aU = unionAll(S.areas.map((a) => safe(() => bufferOf(a, lim(a.tipo)[1]))).filter(Boolean));
    const lE = eU ? safe(() => turf.intersect(lote, eU)) : null;
    const lA = aU ? safe(() => turf.intersect(lote, aU)) : null;
    ex = areaHa(lE);
    am = Math.max(0, areaHa(lA) - ex);
  }
  const li = Math.max(0, tot - ex - am);
  const aplicable = permitidoAmort(S.tox) ? li + am : li;
  loteStats = { tot, ex, am, li, aplicable };
  const pc = (v) => (tot ? (v / tot) * 100 : 0);
  C.innerHTML = `<h3>Lote ${S.lote.nombre ? "· " + esc(S.lote.nombre) : ""}</h3>
    <div class="bars" aria-hidden="true"><i style="width:${pc(ex)}%;background:var(--excl)"></i><i style="width:${pc(am)}%;background:var(--amort)"></i><i style="width:${pc(li)}%;background:var(--libre)"></i></div>
    <div class="kv">
      <span>Superficie total</span><span class="v">${fmt(tot, 2)} ha</span>
      <span class="z-excl">Exclusión</span><span class="v z-excl">${fmt(ex, 2)} ha</span>
      <span class="z-amort">Amortiguamiento</span><span class="v z-amort">${fmt(am, 2)} ha</span>
      <span class="z-libre">Sin restricción</span><span class="v z-libre">${fmt(li, 2)} ha</span>
      <span><b>Aplicable con clase ${S.tox}</b></span><span class="v">${fmt(aplicable, 2)} ha</span>
    </div>
    <div class="tools"><button type="button" class="tool" data-act="lote-del">Borrar lote</button></div>`;
}

function renderAreas(ev) {
  const C = $("#areasCard");
  if (!S.areas.length) { C.hidden = true; return; }
  C.hidden = false;
  const byId = {};
  if (ev) ev.rows.forEach((r) => (byId[r.area.id] = r));
  C.innerHTML = `<h3>Áreas sensibles (${S.areas.length})</h3><ul class="alist">${S.areas.map((a) => {
    const r = byId[a.id], [e, am] = lim(a.tipo);
    return `<li><span class="sw" style="background:${TIPOS[a.tipo].c}"></span>
      <span>${esc(a.nombre || TIPOS[a.tipo].t)}<br><span class="art">${fmt(e)} / ${fmt(am)} m · ${a.geom.type === "Point" ? "punto" : "perímetro"}</span></span>
      <span class="d ${r ? "z-" + (r.z === "dentro" ? "excl" : r.z) : ""}">${r ? fmt(r.d) + " m" : ""}</span>
      <button type="button" data-del="${a.id}" aria-label="Borrar ${esc(a.nombre || TIPOS[a.tipo].t)}">✕</button></li>`;
  }).join("")}</ul>
  ${S.areas.some((a) => a.geom.type === "Point") ? `<p class="foot">Las marcadas como punto miden desde ese punto. La ley mide desde el límite del área: para escuelas y viviendas conviene dibujar el perímetro del predio.</p>` : ""}`;
}

function resumen(ev) {
  const now = new Date().toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
  const L1 = [`CONSULTA LEY 11.178 (ENTRE RÍOS) · ${now}`, `Modo: ${MODOS[S.modo][0]}${S.modo === "uav60p" ? ` (comparado con ${S.ref60 === "a" ? "aérea tripulada" : "terrestre"}, sin distancia legal expresa)` : ""}`, `Producto: clase ${S.tox}, banda ${BANDA[S.tox]}`];
  if (S.punto) L1.push(`Punto: ${S.punto[1].toFixed(6)}, ${S.punto[0].toFixed(6)}`);
  if (ev) {
    const w = ev.worst;
    const zn = { dentro: "PROHIBIDO (dentro del área)", excl: "EXCLUSIÓN", amort: "AMORTIGUAMIENTO", libre: "FUERA DE RESTRICCIÓN" }[w.z];
    L1.push(``, `RESULTADO: ${zn}`, `Área más comprometida: ${w.area.nombre || TIPOS[w.area.tipo].t} a ${fmt(w.d)} m (exclusión ${fmt(w.L[0])} m, amort. ${fmt(w.L[1])} m)`);
    const okp = w.z === "libre" || (w.z === "amort" && permitidoAmort(S.tox));
    L1.push(okp ? (w.z === "amort" ? "Producto habilitado con condiciones: asesor presente, aviso 48 h, receta digital, meteorología adecuada." : "Sin restricción de distancia.") : "Producto NO habilitado en este punto.");
    ev.rows.forEach((r) => L1.push(`· ${r.area.nombre || TIPOS[r.area.tipo].t}: ${fmt(r.d)} m → ${r.z}`));
  }
  if (loteStats) {
    L1.push(``, `LOTE${S.lote.nombre ? " " + S.lote.nombre : ""}: ${fmt(loteStats.tot, 2)} ha`,
      `Exclusión ${fmt(loteStats.ex, 2)} ha · Amortiguamiento ${fmt(loteStats.am, 2)} ha · Libre ${fmt(loteStats.li, 2)} ha`,
      `Aplicable con clase ${S.tox}: ${fmt(loteStats.aplicable, 2)} ha`);
  }
  if (S.punto) L1.push(``, `Mapa: https://www.google.com/maps/@?api=1&map_action=map&center=${S.punto[1].toFixed(6)},${S.punto[0].toFixed(6)}&zoom=17&basemap=satellite`);
  L1.push(`Consulta orientativa según el texto de la ley. No reemplaza la receta agronómica ni la normativa municipal.`);
  return L1.join("\n");
}
function renderPrint(ev) { $("#printBox").textContent = resumen(ev); }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

/* ---------- Dibujo ---------- */
function startDraw(kind) {
  draw = { kind, tipo: kind === "area" ? "con" : null, forma: "poly", pts: [] };
  map.doubleClickZoom.disable();
  $("#drawbar").hidden = false;
  $("#drawSetup").hidden = kind !== "area";
  syncDrawUI();
}
function syncDrawUI() {
  if (!draw) return;
  document.querySelectorAll("#drawbar [data-tipo]").forEach((b) => b.classList.toggle("on", b.dataset.tipo === draw.tipo));
  document.querySelectorAll("#drawbar [data-forma]").forEach((b) => b.classList.toggle("on", b.dataset.forma === draw.forma));
  const n = draw.pts.length;
  $("#drawMsg").textContent = draw.kind === "area" && draw.forma === "pt"
    ? "Tocá el mapa sobre el área sensible."
    : `Tocá los vértices del ${draw.kind === "lote" ? "lote" : "perímetro"} en orden. ${n} punto${n === 1 ? "" : "s"}${n >= 3 ? ". Tocá Terminar para cerrar." : "."}`;
  $("#drawbar [data-draw=done]").hidden = draw.kind === "area" && draw.forma === "pt";
  $("#drawbar [data-draw=undo]").hidden = draw.kind === "area" && draw.forma === "pt";
  gDraw.clearLayers();
  if (n) {
    const lls = draw.pts.map((p) => [p[1], p[0]]);
    L.polyline(lls, { color: "#fff", weight: 2, dashArray: "4 4" }).addTo(gDraw);
    lls.forEach((ll) => L.circleMarker(ll, { radius: 5, color: "#fff", fillColor: "#1f5f4a", fillOpacity: 1, weight: 2 }).addTo(gDraw));
  }
}
function endDraw() {
  draw = null; gDraw.clearLayers(); $("#drawbar").hidden = true; map.doubleClickZoom.enable();
}
function finishDraw() {
  if (!draw) return;
  if (draw.pts.length < 3) { $("#drawMsg").textContent = "Hacen falta al menos 3 puntos."; return; }
  const ring = draw.pts.concat([draw.pts[0]]);
  const geom = { type: "Polygon", coordinates: [ring] };
  if (draw.kind === "lote") {
    const nombre = S.lote && S.lote.nombre;
    S.lote = { nombre: nombre || "", geom };
  } else {
    S.areas.push({ id: uid(), tipo: draw.tipo, nombre: "", geom });
  }
  endDraw(); save(); render();
}

map.on("click", (e) => {
  const p = [e.latlng.lng, e.latlng.lat];
  if (draw) {
    if (draw.kind === "area" && draw.forma === "pt") {
      S.areas.push({ id: uid(), tipo: draw.tipo, nombre: "", geom: { type: "Point", coordinates: p } });
      endDraw(); save(); render();
    } else { draw.pts.push(p); syncDrawUI(); }
    return;
  }
  if (gps.on) setGps(false);
  S.punto = p; save(); render();
});

$("#drawbar").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b || !draw) return;
  if (b.dataset.tipo) { draw.tipo = b.dataset.tipo; syncDrawUI(); }
  else if (b.dataset.forma) { draw.forma = b.dataset.forma; draw.pts = []; syncDrawUI(); }
  else if (b.dataset.draw === "undo") { draw.pts.pop(); syncDrawUI(); }
  else if (b.dataset.draw === "done") finishDraw();
  else if (b.dataset.draw === "cancel") endDraw();
});

/* ---------- GPS ---------- */
function setGps(on) {
  gps.on = on;
  $("#gpsBtn").setAttribute("aria-pressed", on);
  if (!on) { if (gps.id != null) navigator.geolocation.clearWatch(gps.id); gps.id = null; gGps.clearLayers(); render(); return; }
  if (!("geolocation" in navigator)) { toast("Este navegador no tiene GPS disponible."); setGps(false); return; }
  let first = true;
  gps.id = navigator.geolocation.watchPosition((pos) => {
    const p = [pos.coords.longitude, pos.coords.latitude];
    gps.pos = p; gps.acc = pos.coords.accuracy;
    gGps.clearLayers();
    L.circle([p[1], p[0]], { radius: gps.acc, color: "#4fc3f7", weight: 1, fillOpacity: 0.12, interactive: false }).addTo(gGps);
    S.punto = p; save(); render();
    if (first) { map.setView([p[1], p[0]], Math.max(map.getZoom(), 16)); first = false; }
  }, (err) => {
    toast(err.code === 1 ? "Sin permiso de ubicación. Habilitalo en el navegador." : "No se pudo obtener la ubicación.");
    setGps(false);
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
}

/* ---------- Importar / exportar ---------- */
function parseKML(txt) {
  const doc = new DOMParser().parseFromString(txt, "application/xml");
  const out = [];
  const coords = (s) => s.trim().split(/\s+/).map((c) => c.split(",").map(Number)).map((c) => [c[0], c[1]]).filter((c) => !isNaN(c[0]) && !isNaN(c[1]));
  doc.querySelectorAll("Placemark").forEach((pm) => {
    const name = (pm.querySelector("name") || {}).textContent || "";
    pm.querySelectorAll("Polygon").forEach((pg) => {
      const c = pg.querySelector("outerBoundaryIs coordinates") || pg.querySelector("coordinates");
      if (c) out.push({ name, geom: { type: "Polygon", coordinates: [closeRing(coords(c.textContent))] } });
    });
    pm.querySelectorAll("Point coordinates").forEach((c) => {
      const p = coords(c.textContent)[0]; if (p) out.push({ name, geom: { type: "Point", coordinates: p } });
    });
  });
  return out;
}
function parseGeoJSON(txt) {
  const j = JSON.parse(txt);
  const feats = j.type === "FeatureCollection" ? j.features : j.type === "Feature" ? [j] : [{ type: "Feature", properties: {}, geometry: j }];
  const out = [];
  feats.forEach((f) => {
    if (!f.geometry) return;
    const name = (f.properties && (f.properties.name || f.properties.nombre || f.properties.Name)) || "";
    turf.flatten(f).features.forEach((ff) => {
      const g = ff.geometry;
      if (g.type === "Polygon") out.push({ name, geom: { type: "Polygon", coordinates: [closeRing(g.coordinates[0].map((c) => [c[0], c[1]]))] } });
      else if (g.type === "Point") out.push({ name, geom: { type: "Point", coordinates: [g.coordinates[0], g.coordinates[1]] } });
    });
  });
  return out;
}
function closeRing(r) {
  if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push(r[0]);
  return r;
}
let pending = [];
$("#importIn").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const txt = await f.text();
    pending = /\.kml$/i.test(f.name) || txt.trim().startsWith("<") ? parseKML(txt) : parseGeoJSON(txt);
  } catch (err) { toast("No pude leer el archivo. Probá con KML o GeoJSON en WGS84."); return; }
  e.target.value = "";
  if (!pending.length) { toast("El archivo no tiene polígonos ni puntos."); return; }
  let loteAsignado = !!S.lote;
  $("#importList").innerHTML = pending.map((p, i) => {
    let def = p.geom.type === "Point"
      ? (/punto de aplicaci/i.test(p.name) ? "ignorar" : "con")
      : (/^(exclusi|amortiguamiento|aplicable)/i.test(p.name) ? "ignorar" : (!loteAsignado ? "lote" : "ignorar"));
    if (def === "lote") loteAsignado = true;
    return `<label><span>${esc(p.name || (p.geom.type === "Point" ? "Punto" : "Polígono") + " " + (i + 1))}</span>
      <select data-i="${i}">
        <option value="ignorar"${def === "ignorar" ? " selected" : ""}>Ignorar</option>
        ${p.geom.type === "Polygon" ? `<option value="lote"${def === "lote" ? " selected" : ""}>Lote a aplicar</option>` : ""}
        ${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}"${def === k ? " selected" : ""}>${v.t}</option>`).join("")}
      </select></label>`;
  }).join("");
  $("#importDlg").showModal();
});
$("#importDlg").addEventListener("close", () => {
  if ($("#importDlg").returnValue !== "ok") return;
  const all = [];
  document.querySelectorAll("#importList select").forEach((s) => {
    const p = pending[+s.dataset.i], v = s.value;
    if (v === "lote") S.lote = { nombre: p.name, geom: p.geom };
    else if (TIPOS[v]) S.areas.push({ id: uid(), tipo: v, nombre: p.name, geom: p.geom });
    if (v !== "ignorar") all.push({ type: "Feature", geometry: p.geom });
  });
  save(); render();
  if (all.length) { const b = turf.bbox({ type: "FeatureCollection", features: all }); map.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [30, 30], maxZoom: 18 }); }
});

function capasExport() {
  const feats = [];
  if (S.lote) {
    feats.push({ type: "Feature", properties: { capa: "lote", nombre: S.lote.nombre || "Lote" }, geometry: S.lote.geom });
    // Superficie del lote donde se puede aplicar con la clase elegida
    if (S.areas.length) {
      const idx = permitidoAmort(S.tox) ? 0 : 1;
      const U = unionAll(S.areas.map((a) => safe(() => bufferOf(a, lim(a.tipo)[idx]))).filter(Boolean));
      const ap = U ? safe(() => turf.difference(turf.polygon(S.lote.geom.coordinates), U)) : null;
      if (ap) feats.push({ type: "Feature", properties: { capa: "lote_aplicable", nombre: `Aplicable clase ${S.tox}`, clase: S.tox, ha: +(areaHa(ap).toFixed(2)) }, geometry: ap.geometry });
    }
  }
  S.areas.forEach((a) => {
    const [e, am] = lim(a.tipo);
    const nom = a.nombre || TIPOS[a.tipo].t;
    feats.push({ type: "Feature", properties: { capa: "area_sensible", tipo: TIPOS[a.tipo].t, nombre: nom }, geometry: a.geom });
    const bE = safe(() => bufferOf(a, e)), bA = safe(() => bufferOf(a, am));
    if (bA) feats.push({ type: "Feature", properties: { capa: "amortiguamiento", nombre: `Amortiguamiento ${am} m · ${nom}`, tipo: TIPOS[a.tipo].t, hasta_m: am, modo: MODOS[S.modo][0] }, geometry: bA.geometry });
    if (bE) feats.push({ type: "Feature", properties: { capa: "exclusion", nombre: `Exclusión ${e} m · ${nom}`, tipo: TIPOS[a.tipo].t, hasta_m: e, modo: MODOS[S.modo][0] }, geometry: bE.geometry });
  });
  if (S.punto) feats.push({ type: "Feature", properties: { capa: "punto_aplicacion", nombre: "Punto de aplicación" }, geometry: { type: "Point", coordinates: S.punto } });
  return feats;
}

// KML: colores en formato aabbggrr
const KML_ST = {
  lote: ["ffffffff", "00ffffff"], lote_aplicable: ["ff32c83c", "5532c83c"], area_sensible: ["ffff00ff", "66ff00ff"],
  amortiguamiento: ["ff00b3ff", "4400b3ff"], exclusion: ["ff303bff", "66303bff"], punto_aplicacion: ["ffffffff", "ffffffff"]
};
function toKML(feats) {
  const x = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const ring = (r) => r.map((c) => `${c[0].toFixed(7)},${c[1].toFixed(7)},0`).join(" ");
  const poly = (rings) => `<Polygon><outerBoundaryIs><LinearRing><coordinates>${ring(rings[0])}</coordinates></LinearRing></outerBoundaryIs>${rings.slice(1).map((h) => `<innerBoundaryIs><LinearRing><coordinates>${ring(h)}</coordinates></LinearRing></innerBoundaryIs>`).join("")}</Polygon>`;
  const geom = (g) => g.type === "Point" ? `<Point><coordinates>${g.coordinates[0]},${g.coordinates[1]},0</coordinates></Point>`
    : g.type === "Polygon" ? poly(g.coordinates)
    : g.type === "MultiPolygon" ? `<MultiGeometry>${g.coordinates.map(poly).join("")}</MultiGeometry>` : "";
  const styles = Object.entries(KML_ST).map(([k, [l, p]]) => `<Style id="${k}"><LineStyle><color>${l}</color><width>2</width></LineStyle><PolyStyle><color>${p}</color></PolyStyle><IconStyle><scale>0.8</scale></IconStyle></Style>`).join("");
  const grupos = [["lote", "Lote"], ["lote_aplicable", "Superficie aplicable"], ["area_sensible", "Áreas sensibles"], ["exclusion", "Zonas de exclusión"], ["amortiguamiento", "Zonas de amortiguamiento"], ["punto_aplicacion", "Punto de aplicación"]];
  const folders = grupos.map(([k, t]) => {
    const fs = feats.filter((f) => f.properties.capa === k);
    if (!fs.length) return "";
    return `<Folder><name>${t}</name>${fs.map((f) => `<Placemark><name>${x(f.properties.nombre)}</name><description>${x(Object.entries(f.properties).map(([a, b]) => `${a}: ${b}`).join(" | "))}</description><styleUrl>#${k}</styleUrl>${geom(f.geometry)}</Placemark>`).join("")}</Folder>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Zonas Ley 11.178 · ${x(MODOS[S.modo][0])} · clase ${S.tox}</name>${styles}${folders}</Document></kml>`;
}

function descargar(texto, tipo, nombre) {
  const blob = new Blob([texto], { type: tipo });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function exportar(formato) {
  const feats = capasExport();
  if (!feats.length) { toast("No hay nada para exportar todavía."); return; }
  const base = `zonas_11178_${new Date().toISOString().slice(0, 10)}`;
  if (formato === "kml") descargar(toKML(feats), "application/vnd.google-earth.kml+xml", base + ".kml");
  else descargar(JSON.stringify({ type: "FeatureCollection", features: feats }, null, 1), "application/geo+json", base + ".geojson");
}

async function compartir() {
  const txt = resumen(evaluar(S.punto));
  if (navigator.share) { try { await navigator.share({ title: "Consulta Ley 11.178", text: txt }); return; } catch (e) { if (e.name === "AbortError") return; } }
  try { await navigator.clipboard.writeText(txt); toast("Resultado copiado. Pegalo en WhatsApp."); }
  catch (_) { toast("No se pudo copiar automáticamente."); }
}

/* ---------- Controles ---------- */
$("#modo").addEventListener("change", (e) => { S.modo = e.target.value; save(); render(); });
$("#tox").addEventListener("change", (e) => { S.tox = e.target.value; save(); render(); });
$("#warn60").addEventListener("click", (e) => { const b = e.target.closest("[data-ref]"); if (b) { S.ref60 = b.dataset.ref; save(); render(); } });

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act],[data-del]"); if (!b) return;
  if (b.dataset.del) { S.areas = S.areas.filter((a) => a.id !== b.dataset.del); save(); render(); return; }
  switch (b.dataset.act) {
    case "area": startDraw("area"); break;
    case "lote": startDraw("lote"); break;
    case "gps": setGps(!gps.on); break;
    case "more": { const m = $("#more"); m.hidden = !m.hidden; b.setAttribute("aria-expanded", !m.hidden); break; }
    case "export-kml": exportar("kml"); break;
    case "export-geojson": exportar("geojson"); break;
    case "share": compartir(); break;
    case "print": window.print(); break;
    case "base": {
      const order = ["sat"].concat(baseLayers.google ? ["google"] : [], ["osm"]);
      S.base = order[(order.indexOf(S.base) + 1) % order.length]; applyBase(); save();
      toast({ sat: "Fondo: satelital Esri", google: "Fondo: satelital Google", osm: "Fondo: mapa de calles" }[S.base]); break;
    }
    case "lote-del": S.lote = null; save(); render(); break;
    case "reset":
      if (b.dataset.confirm) { S = Object.assign({}, DEF, { view: S.view, base: S.base }); save(); render(); b.textContent = "Borrar todo"; delete b.dataset.confirm; toast("Se borró todo."); }
      else { b.dataset.confirm = "1"; b.textContent = "Tocá de nuevo para confirmar"; setTimeout(() => { b.textContent = "Borrar todo"; delete b.dataset.confirm; }, 4000); }
      break;
  }
});

$("#goto").addEventListener("submit", (e) => {
  e.preventDefault();
  const m = $("#gotoIn").value.match(/(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)/);
  if (!m) { toast("Escribí latitud y longitud, por ejemplo -31.74, -60.52"); return; }
  const lat = parseFloat(m[1].replace(",", ".")), lng = parseFloat(m[2].replace(",", "."));
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) { toast("Coordenadas fuera de rango."); return; }
  map.setView([lat, lng], 17);
  S.punto = [lng, lat]; save(); render();
});

let tt;
function toast(msg) {
  let el = $("#toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.setAttribute("role", "status");
    el.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 16px);background:var(--fg);color:var(--bg);padding:10px 14px;border-radius:8px;font-weight:600;z-index:2000;max-width:calc(100vw - 32px)";
    document.body.appendChild(el); }
  el.textContent = msg; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => (el.hidden = true), 3200);
}

window.addEventListener("beforeprint", () => { renderPrint(evaluar(S.punto)); map.invalidateSize(); });

render();

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW", e));
}
})();
