/* Distancias Ley 11.178 (Entre Ríos)
   Flujo: 1) lote  2) áreas sensibles  3) modo y producto  4) resultado con hectáreas y franjas.
   Todo corre en el navegador; los lotes se guardan sólo en este dispositivo. */
(function () {
"use strict";
const LF = window.L; // Leaflet (L se usa para el lote)

/* ================= Configuración ================= */
// Si activás la Map Tiles API de Google, pegá acá tu clave para usar su imagen satelital. Sin clave: Esri.
const GOOGLE_API_KEY = "";

/* ================= Normativa ================= */
// Régimen → modo (m: manual o drone ≤60 L, t: terrestre, a: aérea tripulada) → [exclusión hasta, amortiguamiento hasta, cita exclusión, cita amortiguamiento]
const LIM = {
  con: { m: [10, 30, "art. 63 a)", "art. 66 a)"], t: [100, 300, "art. 63 a)", "art. 66 a)"], a: [200, 600, "art. 63 a)", "art. 66 a)"] },
  sin: { m: [5, 30, "art. 63 b)", "art. 66 b)"], t: [50, 300, "art. 63 b)", "art. 66 b)"], a: [100, 600, "art. 63 b)", "art. 66 b)"] },
  esc: { m: [15, 45, "art. 68 a)", "art. 68 b)"], t: [150, 500, "art. 68 a)", "art. 68 b)"], a: [500, 3000, "art. 68 a)", "art. 68 b)"] },
  urb: { m: [10, 30, "art. 63 a)", "art. 66 a)"], t: [100, 300, "art. 63 a)", "art. 66 a)"], a: [1000, 3000, "art. 76 a)", "art. 76 b)"] }
};
const OBL = { con: "art. 67", sin: "art. 67", esc: "art. 69", urb: "art. 77" };

// Tipos de área sensible que ve el usuario → régimen legal, forma sugerida y color
const TIPOS = {
  vivienda:  { t: "Vivienda",            d: "Casa habitada",                 reg: "con", forma: "pt",   c: "#ff5a4f" },
  escuela:   { t: "Escuela rural",       d: "Régimen propio",                reg: "esc", forma: "pt",   c: "#ffd23f" },
  agua:      { t: "Curso de agua",       d: "Arroyo, río, laguna permanente", reg: "sin", forma: "line", c: "#3fc3ff" },
  apiario:   { t: "Apiario o granja",    d: "Colmenas, granja avícola",      reg: "sin", forma: "pt",   c: "#ff9f1c" },
  protegida: { t: "Área protegida",      d: "Área natural protegida",        reg: "sin", forma: "poly", c: "#7bd389" },
  otros:     { t: "Sala, club, policía", d: "Salud, recreación, policía",    reg: "con", forma: "pt",   c: "#ff7eb6" },
  pueblo:    { t: "Pueblo o ciudad",     d: "Planta urbana, +250 hab.",      reg: "urb", forma: "poly", c: "#c77dff" }
};
const MODOS = {
  uav60p: { t: "Drone más de 60 L", s: "T70, T100", k: null },
  uav60:  { t: "Drone hasta 60 L",  s: "T40, T50",  k: "m" },
  terr:   { t: "Terrestre",         s: "Pulverizadora", k: "t" },
  manual: { t: "Manual",            s: "Mochila, lanza", k: "m" },
  trip:   { t: "Avión",             s: "Aeroaplicador", k: "a" }
};
const TOX = { Ia: ["roja", "#d32f2f"], Ib: ["roja", "#d32f2f"], II: ["amarilla", "#f2c200"], III: ["azul", "#1e63c6"], IV: ["verde", "#2e9e44"] };
const FORMAS = { pt: "Punto", line: "Línea", poly: "Perímetro" };

/* ================= Estado ================= */
const KEY = "d11178-v2";
const DEF = { lotes: [], actual: null, base: "sat", view: null, def: { modo: "uav60p", tox: "III", ref60: "a" } };
let S = load();
let step = "lista";
let draw = null;               // { target:'lote'|'area', tipo, forma, pts:[[lng,lat]] }
let pick = { tipo: "vivienda", forma: "pt" };
let campo = { punto: null, gps: false, id: null, acc: null };

function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.lotes) return Object.assign({}, DEF, s); } catch (_) {}
  return JSON.parse(JSON.stringify(DEF));
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (_) {} }
const lote = () => S.lotes.find((l) => l.id === S.actual) || null;
const uid = () => Math.random().toString(36).slice(2, 9);

const $ = (s) => document.querySelector(s);
const fmt = (n, d = 0) => Number(n).toLocaleString("es-AR", { maximumFractionDigits: d, minimumFractionDigits: d });
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const okAmort = (t) => t === "III" || t === "IV";
const keyOf = (L, ref) => MODOS[L.modo].k || ref || L.ref60;
const limOf = (area, L, ref) => LIM[TIPOS[area.tipo].reg][keyOf(L, ref)];
const nombreArea = (a) => a.nombre || TIPOS[a.tipo].t;

/* ================= Mapa ================= */
const map = LF.map("map", { zoomControl: true });
const baseLayers = {
  sat: LF.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 21, maxNativeZoom: 19, attribution: "Imagen: Esri, Maxar, Earthstar Geographics" }),
  osm: LF.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 21, maxNativeZoom: 19, attribution: "© OpenStreetMap" })
};
const labels = LF.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxZoom: 21, maxNativeZoom: 19 });
function applyBase() {
  Object.values(baseLayers).forEach((l) => map.removeLayer(l)); map.removeLayer(labels);
  const b = baseLayers[S.base] || baseLayers.sat; b.addTo(map); if (b !== baseLayers.osm) labels.addTo(map);
}
async function setupGoogle() {
  if (!GOOGLE_API_KEY) return;
  try {
    const r = await fetch("https://tile.googleapis.com/v1/createSession?key=" + GOOGLE_API_KEY, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mapType: "satellite", language: "es-AR", region: "AR" }) });
    const j = await r.json(); if (!j.session) throw new Error("sin sesión");
    baseLayers.google = LF.tileLayer(`https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${j.session}&key=${GOOGLE_API_KEY}`, { maxZoom: 21, maxNativeZoom: 20, attribution: "Imágenes © Google" });
    if (S.base === "sat") { S.base = "google"; applyBase(); }
  } catch (e) { console.warn("Google Map Tiles no disponible", e); }
}
applyBase(); setupGoogle();
if (S.view) map.setView(S.view.c, S.view.z); else map.setView([-31.75, -59.9], 8);
map.on("moveend", () => { const c = map.getCenter(); S.view = { c: [c.lat, c.lng], z: map.getZoom() }; save(); });

const gZonas = LF.layerGroup().addTo(map), gLote = LF.layerGroup().addTo(map), gAreas = LF.layerGroup().addTo(map);
const gDraw = LF.layerGroup().addTo(map), gCampo = LF.layerGroup().addTo(map);

/* ================= Geometría ================= */
const F = (g) => ({ type: "Feature", properties: {}, geometry: g });
const safe = (fn) => { try { return fn(); } catch (e) { console.warn(e); return null; } };
const ha = (f) => (f ? turf.area(f) / 10000 : 0);
const buf = (g, m) => safe(() => turf.buffer(F(g), m, { units: "meters", steps: 40 }));
function unionAll(fs) { let u = null; fs.filter(Boolean).forEach((f) => { u = u ? (safe(() => turf.union(u, f)) || u) : f; }); return u; }
const inter = (a, b) => (a && b ? safe(() => turf.intersect(a, b)) : null);
const minus = (a, b) => (!a ? null : !b ? a : safe(() => turf.difference(a, b)));
function coordsOf(g) { return g.type === "Point" ? [g.coordinates] : g.type === "LineString" ? g.coordinates : g.coordinates[0]; }
function lineOf(g) { return g.type === "LineString" ? turf.lineString(g.coordinates) : g.type === "Polygon" ? turf.lineString(g.coordinates[0]) : null; }
function distPt(g, p) {
  if (g.type === "Point") return turf.distance(p, g.coordinates, { units: "meters" });
  if (g.type === "Polygon" && turf.booleanPointInPolygon(p, turf.polygon(g.coordinates))) return 0;
  return turf.pointToLineDistance(p, lineOf(g), { units: "meters" });
}
function nearPt(g, p) {
  if (g.type === "Point") return g.coordinates;
  if (g.type === "Polygon" && turf.booleanPointInPolygon(p, turf.polygon(g.coordinates))) return p;
  return turf.nearestPointOnLine(lineOf(g), p).geometry.coordinates;
}
// Distancia mínima entre un área sensible y el borde del lote (0 si se tocan)
function distAreaLote(g, Lg) {
  const lp = turf.polygon(Lg.coordinates);
  if (coordsOf(g).some((c) => turf.booleanPointInPolygon(c, lp))) return 0;
  if (g.type === "Polygon" && coordsOf(Lg).some((c) => turf.booleanPointInPolygon(c, turf.polygon(g.coordinates)))) return 0;
  if (g.type !== "Point" && safe(() => turf.lineIntersect(lineOf(g), turf.lineString(Lg.coordinates[0])).features.length)) return 0;
  const a = Math.min(...coordsOf(g).map((c) => distPt(Lg, c)));
  const b = Math.min(...coordsOf(Lg).map((c) => distPt(g, c)));
  return Math.min(a, b);
}

/* ================= Cálculo del lote ================= */
function calcular(L, ref) {
  const lp = turf.polygon(L.geom.coordinates);
  const tot = ha(lp);
  const per = L.areas.map((a) => {
    const [e, am] = limOf(a, L, ref);
    const bE = buf(a.geom, e), bA = buf(a.geom, am);
    const iE = inter(lp, bE), iA = inter(lp, bA);
    return { a, e, am, bE, bA, haE: ha(iE), haA: Math.max(0, ha(iA) - ha(iE)), dist: safe(() => distAreaLote(a.geom, L.geom)) ?? 0 };
  });
  const eU = unionAll(per.map((p) => p.bE)), aU = unionAll(per.map((p) => p.bA));
  const zE = inter(lp, eU);
  const zA = minus(inter(lp, aU), eU);
  const zL = aU ? minus(lp, aU) : lp;
  const hE = ha(zE), hA = Math.max(0, ha(zA)), hL = Math.max(0, tot - hE - hA);
  const aplic = okAmort(L.tox) ? hL + hA : hL;
  const aplicGeom = okAmort(L.tox) ? (eU ? minus(lp, eU) : lp) : zL;
  return { tot, hE, hA, hL, aplic, aplicGeom, zE, zA, zL, per, aplicIII: hL + hA };
}

/* ================= Navegación ================= */
function canGo(s) {
  const L = lote();
  if (s === "lista") return true;
  if (!L) return s === "lote";
  if (s === "lote" || s === "campo") return true;
  if (!L.geom) return false;
  return true;
}
function go(s) {
  if (!canGo(s)) return;
  if (draw) cancelDraw();
  if (step === "campo" && s !== "campo") stopGps();
  if (s === "res" && lote()) { lote().vistoRes = true; save(); }
  step = s; render(); $("#sheet").classList.remove("min");
  $("#sheet").scrollTop = 0;
}

/* ================= Render general ================= */
function render() {
  const L = lote();
  $("#loteTitulo").textContent = L ? [L.nombre || "Lote sin nombre", L.cliente].filter(Boolean).join(" · ") : "Mis lotes";
  const order = ["lote", "sens", "aplic", "res"];
  document.querySelectorAll("#steps button").forEach((b) => {
    const s = b.dataset.go, i = order.indexOf(s);
    b.classList.toggle("cur", s === step);
    b.classList.toggle("done", !!L && (s === "lote" ? !!L.geom : s === "sens" ? L.areas.length > 0 : s === "aplic" ? !!L.vistoRes : false) && s !== step);
    b.disabled = !canGo(s);
  });
  $("#steps").hidden = step === "lista";
  drawMap();
  const P = { lista: pLista, lote: pLote, sens: pSens, aplic: pAplic, res: pRes, campo: pCampo }[step];
  $("#panel").innerHTML = P();
  renderPrint();
}

function drawMap() {
  gZonas.clearLayers(); gLote.clearLayers(); gAreas.clearLayers();
  const L = lote();
  if (!L || step === "lista") { S.lotes.filter((l) => l.geom).forEach((l) => L_poly(l.geom, { color: "#fff", weight: 2, fillOpacity: 0.08 }).bindTooltip(esc(l.nombre || "Lote")).on("click", () => { S.actual = l.id; save(); go("res"); }).addTo(gLote)); return; }
  if (L.geom && (step === "res" || step === "aplic" || step === "campo") && L.areas.length) {
    const r = calcular(L);
    if (r.zL) LF.geoJSON(r.zL, { interactive: false, style: { stroke: false, fillColor: "#43a047", fillOpacity: 0.28 } }).addTo(gZonas);
    if (r.zA) LF.geoJSON(r.zA, { interactive: false, style: { stroke: false, fillColor: "#ffb300", fillOpacity: 0.45 } }).addTo(gZonas);
    if (r.zE) LF.geoJSON(r.zE, { interactive: false, style: { stroke: false, fillColor: "#ff3b30", fillOpacity: 0.5 } }).addTo(gZonas);
    // contorno tenue de los anillos completos
    r.per.forEach((p) => {
      if (p.bA) LF.geoJSON(p.bA, { interactive: false, style: { color: "#ffb300", weight: 1.2, dashArray: "4 5", fill: false } }).addTo(gZonas);
      if (p.bE) LF.geoJSON(p.bE, { interactive: false, style: { color: "#ff3b30", weight: 1.2, dashArray: "4 5", fill: false } }).addTo(gZonas);
    });
  } else if (L.areas.length && step === "sens") {
    L.areas.forEach((a) => {
      const [e, am] = limOf(a, L);
      const bA = buf(a.geom, am), bE = buf(a.geom, e);
      if (bA) LF.geoJSON(bA, { interactive: false, style: { color: "#ffb300", weight: 1.5, dashArray: "5 4", fillColor: "#ffb300", fillOpacity: 0.15 } }).addTo(gZonas);
      if (bE) LF.geoJSON(bE, { interactive: false, style: { color: "#ff3b30", weight: 1.5, fillColor: "#ff3b30", fillOpacity: 0.25 } }).addTo(gZonas);
    });
  }
  if (L.geom) L_poly(L.geom, { color: "#ffffff", weight: 3, fill: step === "lote", fillOpacity: 0.1, interactive: false }).addTo(gLote);
  L.areas.forEach((a) => {
    const t = TIPOS[a.tipo], st = { color: t.c, weight: 4, fillColor: t.c, fillOpacity: 0.45 };
    const lay = a.geom.type === "Point" ? LF.circleMarker([a.geom.coordinates[1], a.geom.coordinates[0]], Object.assign({ radius: 8, color: "#fff", weight: 2.5, fillColor: t.c, fillOpacity: 1 }))
      : a.geom.type === "LineString" ? LF.polyline(a.geom.coordinates.map((c) => [c[1], c[0]]), st) : L_poly(a.geom, st);
    lay.bindTooltip(esc(nombreArea(a))).addTo(gAreas);
  });
}
function L_poly(g, style) { return LF.geoJSON(F(g), { style }); }

/* ================= Paneles ================= */
function pLista() {
  const items = S.lotes.slice().sort((a, b) => (b.fecha || 0) - (a.fecha || 0));
  return `<h2 class="t">Mis lotes</h2>
  <p class="lead">Elegí un lote o cargá uno nuevo. Se guardan en este teléfono o computadora.</p>
  <div class="row"><button type="button" class="btn" data-act="nuevo">+ Nuevo lote</button>
  <button type="button" class="btn ghost" data-act="importar">Importar KML</button></div>
  <a class="btn ghost" href="manual.html" style="text-decoration:none;justify-content:center">¿Primera vez? Mirá el manual paso a paso</a>
  ${items.length ? items.map((l) => `<button type="button" class="card-lote" data-open="${l.id}"><b>${esc(l.nombre || "Lote sin nombre")}</b>
    <span class="meta">${esc(l.cliente || "Sin cliente")} · ${l.areas.length} área${l.areas.length === 1 ? "" : "s"} sensible${l.areas.length === 1 ? "" : "s"} · ${new Date(l.fecha || Date.now()).toLocaleDateString("es-AR")}</span>
    <span class="ha">${l.geom ? fmt(ha(turf.polygon(l.geom.coordinates)), 1) + " ha" : "—"}</span></button>`).join("")
    : `<div class="empty">Todavía no hay lotes. Tocá <b>+ Nuevo lote</b> y dibujalo sobre la imagen satelital, o importá el KML del lote.</div>`}
  <p class="note">Distancias según los arts. 63, 66, 68 y 76 de la Ley 11.178. Consulta orientativa: no reemplaza la receta agronómica digital ni la normativa municipal.</p>`;
}

function pLote() {
  const L = lote();
  const dibujando = draw && draw.target === "lote";
  const hectareas = L.geom ? fmt(ha(turf.polygon(L.geom.coordinates)), 2) + " ha" : null;
  return `<h2 class="t">1 · El lote</h2>
  <p class="lead">${dibujando ? "Tocá las esquinas del lote en orden. La forma se cierra sola. Si marcaste mal, tocá el punto para borrarlo o arrastralo." : L.geom ? `Lote cargado: <b>${hectareas}</b>. Podés redibujarlo o seguir.` : "Buscá el lote en el mapa y dibujá su contorno tocando las esquinas, o importá un KML."}</p>
  <div class="grid2">
    <label class="field">Nombre del lote<input id="inNombre" value="${esc(L.nombre)}" placeholder="Ej.: La Esperanza lote 4"></label>
    <label class="field">Cliente<input id="inCliente" value="${esc(L.cliente)}" placeholder="Ej.: Pérez Hnos."></label>
  </div>
  ${dibujando ? drawButtons() : `<div class="row">
    ${L.geom ? `<button type="button" class="btn ghost" data-act="editar-lote">Editar puntos</button><button type="button" class="btn ghost" data-act="dibujar-lote">Redibujar de cero</button>` : `<button type="button" class="btn" data-act="dibujar-lote">Dibujar lote</button>`}
    <button type="button" class="btn ghost" data-act="importar">Importar KML</button>
    <button type="button" class="btn ghost" data-act="buscar">Ir a coordenadas</button>
  </div>`}
  <form id="buscarForm" class="row" hidden><input id="inCoord" class="coord" placeholder="-31.74, -60.52" inputmode="decimal" aria-label="Coordenadas" style="flex:1;min-width:0;font:500 1rem var(--mono);padding:10px;border:1.5px solid var(--line);border-radius:10px;background:var(--surface);color:var(--fg)"><button class="btn small">Ir</button></form>
  ${L.geom && !dibujando ? `<button type="button" class="btn wide" data-go="sens">Siguiente: áreas sensibles →</button>` : ""}
  <div class="row"><button type="button" class="btn ghost small danger" data-act="borrar-lote">Borrar este lote</button></div>`;
}

function pSens() {
  const L = lote();
  const dibujando = draw && draw.target === "area";
  const t = TIPOS[pick.tipo];
  return `<h2 class="t">2 · Áreas sensibles</h2>
  <p class="lead">${dibujando ? (pick.forma === "pt" ? `Tocá en el mapa dónde está: <b>${t.t.toLowerCase()}</b>.` : `Tocá los puntos del ${pick.forma === "line" ? "cauce" : "perímetro"} y después Terminar.`) : "Elegí qué hay cerca del lote y marcalo en el mapa. Podés agregar varias."}</p>
  ${dibujando ? drawButtons() : `
  <div><div class="lbl">¿Qué hay?</div><div class="tiles">
    ${Object.entries(TIPOS).map(([k, v]) => `<button type="button" class="tile${pick.tipo === k ? " on" : ""}" data-tipo="${k}"><b><span class="sw" style="background:${v.c}"></span>${v.t}</b><small>${v.d}</small></button>`).join("")}
  </div></div>
  <div><div class="lbl">Cómo marcarlo</div><div class="seg">
    ${Object.entries(FORMAS).map(([k, v]) => `<button type="button" data-forma="${k}" class="${pick.forma === k ? "on" : ""}">${v}</button>`).join("")}
  </div>
  <p class="note" style="margin-top:6px">${pick.forma === "pt" ? "Rápido. La distancia se mide desde ese punto." : pick.forma === "line" ? "Para arroyos y ríos: tocá a lo largo del cauce." : "Más preciso: la ley mide desde el límite del área (el predio de la escuela o la casa)."}</p></div>
  <button type="button" class="btn wide" data-act="marcar">Marcar ${t.t.toLowerCase()} en el mapa</button>`}
  ${L.areas.length ? `<div class="card"><h3>Marcadas (${L.areas.length})</h3><ul class="alist">${L.areas.map((a) => {
      const [e, am] = limOf(a, L);
      return `<li><span class="sw" style="background:${TIPOS[a.tipo].c}"></span><span><input class="nm" data-nombre="${a.id}" value="${esc(a.nombre)}" placeholder="${esc(TIPOS[a.tipo].t)}" aria-label="Nombre" style="width:100%;font:600 .92rem var(--body);border:0;border-bottom:1px dashed var(--line);background:none;color:var(--fg);padding:2px 0">
        <span class="meta">${FORMAS[a.geom.type === "Point" ? "pt" : a.geom.type === "LineString" ? "line" : "poly"]} · exclusión ${fmt(e)} m · amort. ${fmt(am)} m</span></span>
        <button type="button" class="x" data-del="${a.id}" aria-label="Borrar">✕</button></li>`; }).join("")}</ul></div>` : ""}
  ${!dibujando ? `<button type="button" class="btn wide${L.areas.length ? "" : " ghost"}" data-go="aplic">${L.areas.length ? "Siguiente: cómo vas a aplicar →" : "No hay áreas sensibles cerca → seguir"}</button>` : ""}`;
}

function pAplic() {
  const L = lote();
  return `<h2 class="t">3 · Cómo vas a aplicar</h2>
  <div><div class="lbl">Equipo</div><div class="tiles">
    ${Object.entries(MODOS).map(([k, v]) => `<button type="button" class="tile${L.modo === k ? " on" : ""}" data-modo="${k}"><b>${v.t}</b><small>${v.s}</small></button>`).join("")}
  </div></div>
  ${L.modo === "uav60p" ? `<div class="warn"><b>Más de 60 L:</b> la ley sólo fija distancias para drones de hasta 60 L y el decreto reglamentario no agrega nada. No hay distancia legal expresa; elegí con qué comparar:
    <div class="seg" style="margin-top:8px"><button type="button" data-ref="a" class="${L.ref60 === "a" ? "on" : ""}">Avión (más conservador)</button><button type="button" data-ref="t" class="${L.ref60 === "t" ? "on" : ""}">Terrestre</button></div></div>` : ""}
  <div class="tox"><div class="lbl">Clase toxicológica del producto (el más tóxico del caldo)</div><div class="tiles" style="grid-template-columns:repeat(5,minmax(0,1fr))">
    ${Object.entries(TOX).map(([k, v]) => `<button type="button" class="tile${L.tox === k ? " on" : ""}" data-tox="${k}" style="min-height:0;padding:8px"><span class="band" style="background:${v[1]};width:100%"></span><b>${k}</b><small>${v[0]}</small></button>`).join("")}
  </div></div>
  <button type="button" class="btn wide" data-go="res">Ver resultado →</button>`;
}

function pRes() {
  const L = lote();
  if (!L.geom) return `<div class="empty">Primero dibujá el lote.</div>`;
  const r = calcular(L);
  const pc = (v) => (r.tot ? (v / r.tot) * 100 : 0);
  const modoTxt = MODOS[L.modo].t + (L.modo === "uav60p" ? ` (comparado con ${L.ref60 === "a" ? "avión" : "terrestre"})` : "");
  let alt = "";
  if (L.modo === "uav60p" && L.areas.length) {
    const otro = L.ref60 === "a" ? "t" : "a", r2 = calcular(L, otro);
    alt = `<div class="alt">Con distancias de <b>${otro === "a" ? "avión" : "terrestre"}</b> serían <b>${fmt(r2.aplic, 2)} ha</b> aplicables (exclusión ${fmt(r2.hE, 2)} ha, amortiguamiento ${fmt(r2.hA, 2)} ha).</div>`;
  }
  const franjas = r.per.map((p) => {
    const reg = TIPOS[p.a.tipo].reg, [, , ce, ca] = limOf(p.a, L), afecta = p.haE + p.haA > 0.0001;
    return `<li><div class="hd"><span class="sw" style="background:${TIPOS[p.a.tipo].c}"></span>${esc(nombreArea(p.a))}</div>
      <div class="ln"><span>Distancia al lote</span><span>${p.dist < 0.5 ? "dentro o lindante" : fmt(p.dist) + " m"}</span></div>
      ${afecta ? `<div class="ln c-excl"><span>Exclusión: franja de ${fmt(p.e)} m <span class="art">${ce}</span></span><span>${fmt(p.haE, 2)} ha</span></div>
      <div class="ln c-amort"><span>Amortiguamiento: de ${fmt(p.e)} a ${fmt(p.am)} m <span class="art">${ca}</span></span><span>${fmt(p.haA, 2)} ha</span></div>`
      : `<div class="ln c-libre"><span>No afecta al lote (amortiguamiento hasta ${fmt(p.am)} m)</span><span>0 ha</span></div>`}</li>`;
  }).join("");
  const hayA = r.hA > 0.0001, hayE = r.hE > 0.0001;
  const tipos = new Set(r.per.filter((p) => p.haA + p.haE > 0.0001).map((p) => TIPOS[p.a.tipo].reg));
  const chk = [];
  if (hayE) chk.push(["No aplicar en la zona roja: dejar la franja sin tratar.", "art. 63"]);
  if (hayA && !okAmort(L.tox)) chk.push([`Con clase ${L.tox} la zona ámbar tampoco se puede tratar. Con un clase III o IV se suman ${fmt(r.hA, 2)} ha.`, "art. 66"]);
  if (hayA && okAmort(L.tox)) {
    const obl = [...tipos].map((t) => OBL[t]).filter((v, i, a) => a.indexOf(v) === i).join(" · ");
    chk.push(["Asesor fitosanitario presente en el lugar para tratar la zona ámbar.", obl]);
    chk.push([tipos.has("esc") ? "Aviso fehaciente con 48 h a la autoridad de aplicación y a la dirección de la escuela." : "Aviso fehaciente a las autoridades con 48 h de anticipación.", obl]);
    chk.push(["Condiciones meteorológicas adecuadas según el protocolo de buenas prácticas.", "art. 60"]);
    if (tipos.has("esc")) chk.push(["Aplicar a contraturno, en recesos, fines de semana o feriados, y limpiar la escuela antes del reingreso.", "art. 69 · 72"]);
  }
  chk.push(["Receta agronómica digital emitida antes de aplicar.", "art. 28 c) · 57"]);
  chk.push(["Equipo registrado, con habilitación anual y VTF vigente.", "art. 41 · 102"]);
  if (L.modo === "uav60" || L.modo === "uav60p") chk.push(["Drone inscripto en el registro de VANT y piloto con requisitos ANAC.", "art. 20 j) · 41 l)"]);
  if (L.modo === "trip") chk.push(["Certificado de Explotador de Trabajo Aéreo y requisitos ANAC.", "art. 41 l)"]);

  return `<h2 class="t">4 · Resultado</h2>
  <p class="lead">${esc(modoTxt)} · clase ${L.tox} (banda ${TOX[L.tox][0]})</p>
  <div class="big"><span class="k">Superficie aplicable</span><span class="v">${fmt(r.aplic, 2)} ha</span><p>de ${fmt(r.tot, 2)} ha del lote (${fmt(pc(r.aplic))} %)</p></div>
  ${alt}
  <div class="card">
    <div class="bars" aria-hidden="true"><i style="width:${pc(r.hE)}%;background:var(--excl)"></i><i style="width:${pc(r.hA)}%;background:var(--amort)"></i><i style="width:${pc(r.hL)}%;background:var(--libre)"></i></div>
    <table class="z"><thead><tr><th>Zona</th><th>ha</th><th>%</th></tr></thead><tbody>
      <tr><td class="c-excl"><span class="dot" style="background:var(--excl)"></span>Exclusión<small>No se aplica nada</small></td><td>${fmt(r.hE, 2)}</td><td>${fmt(pc(r.hE))}</td></tr>
      <tr><td class="c-amort"><span class="dot" style="background:var(--amort)"></span>Amortiguamiento<small>${okAmort(L.tox) ? "Clase " + L.tox + " habilitada con condiciones" : "Sólo clases III y IV"}</small></td><td>${fmt(r.hA, 2)}</td><td>${fmt(pc(r.hA))}</td></tr>
      <tr><td class="c-libre"><span class="dot" style="background:var(--libre)"></span>Sin restricción</td><td>${fmt(r.hL, 2)}</td><td>${fmt(pc(r.hL))}</td></tr>
    </tbody></table>
  </div>
  ${r.per.length ? `<div class="card"><h3>Franjas por área sensible</h3><ul class="franjas">${franjas}</ul></div>` : `<div class="empty">No marcaste áreas sensibles: todo el lote queda sin restricción de distancia. Si hay casas, escuelas, arroyos o colmenas cerca, volvé al paso 2.</div>`}
  <div class="card"><h3>Qué tenés que cumplir</h3><ul class="checks">${chk.map((c, i) => `<li><label><input type="checkbox" id="ck${i}"><span>${c[0]} <span class="art">${c[1]}</span></span></label></li>`).join("")}</ul></div>
  <div class="card noprint"><h3>Llevar el resultado</h3>
    <div class="row">
      <button type="button" class="btn small" data-act="kml">KML para el drone</button>
      <button type="button" class="btn ghost small" data-act="geojson">GeoJSON (QGIS)</button>
      <button type="button" class="btn ghost small" data-act="compartir">Compartir</button>
      <button type="button" class="btn ghost small" data-act="imprimir">Imprimir</button>
    </div>
    <p class="note">El KML trae la superficie aplicable (para cargar como lote en SmartFarm), las zonas y las áreas sensibles.</p>
  </div>
  <button type="button" class="btn ghost wide noprint" data-go="campo">Modo campo: ¿puedo aplicar donde estoy parado?</button>`;
}

function pCampo() {
  const L = lote();
  let v = `<div class="verdict none"><div class="zone">Tocá el mapa</div><p>O activá el GPS para usar tu posición.</p></div>`;
  gCampo.clearLayers();
  if (campo.punto && L.areas.length) {
    const p = campo.punto;
    const rows = L.areas.map((a) => { const lim_ = limOf(a, L), d = distPt(a.geom, p); return { a, lim: lim_, d, z: d <= 0 ? "dentro" : d <= lim_[0] ? "excl" : d <= lim_[1] ? "amort" : "libre" }; });
    const rk = { dentro: 3, excl: 2, amort: 1, libre: 0 };
    rows.sort((x, y) => rk[y.z] - rk[x.z] || (x.d - x.lim[1]) - (y.d - y.lim[1]));
    const w = rows[0], [e, am, ce, ca] = w.lim;
    const cls = w.z === "libre" ? "libre" : w.z === "amort" ? "amort" : "excl";
    const zone = { dentro: "Prohibido", excl: "Exclusión", amort: "Amortiguamiento", libre: "Se puede aplicar" }[w.z];
    const ok = w.z === "libre" || (w.z === "amort" && okAmort(L.tox));
    v = `<div class="verdict ${cls}"><div class="zone">${zone}</div>
      <p>A <b>${fmt(w.d)} m</b> de ${esc(nombreArea(w.a))}. ${w.z === "excl" || w.z === "dentro" ? `No se aplica nada hasta ${fmt(e)} m.` : w.z === "amort" ? `Entre ${fmt(e)} y ${fmt(am)} m sólo clases III y IV, con asesor presente y aviso 48 h.` : `Más allá de ${fmt(am)} m no hay restricción de distancia.`}</p>
      <p><b>${ok ? "✓" : "✕"} Clase ${L.tox}</b> ${ok ? "se puede aplicar acá" : "no se puede aplicar acá"} <span class="art">${w.z === "libre" ? "art. 61" : w.z === "amort" ? ca : ce}</span></p></div>
      ${campo.gps && campo.acc != null ? `<p class="mono">GPS ±${fmt(campo.acc)} m${campo.acc > 10 ? " · esperá a que mejore si estás cerca de un límite" : ""}</p>` : ""}`;
    const ll = [p[1], p[0]], np = nearPt(w.a.geom, p);
    LF.circleMarker(ll, { radius: 9, color: "#fff", weight: 3, fillColor: "#111", fillOpacity: 1 }).addTo(gCampo);
    LF.polyline([ll, [np[1], np[0]]], { color: "#fff", weight: 2, dashArray: "4 4", interactive: false }).addTo(gCampo).bindTooltip(fmt(w.d) + " m", { permanent: true, direction: "center", className: "lbl-tip" });
    if (campo.gps && campo.acc) LF.circle(ll, { radius: campo.acc, color: "#4fc3f7", weight: 1, fillOpacity: 0.12, interactive: false }).addTo(gCampo);
  } else if (!L.areas.length) v = `<div class="verdict libre"><div class="zone">Sin áreas sensibles</div><p>Este lote no tiene áreas sensibles marcadas.</p></div>`;
  return `<h2 class="t">Modo campo</h2>
  <p class="lead">Tocá el mapa donde vas a aplicar o usá el GPS del teléfono.</p>
  ${v}
  <div class="row"><button type="button" class="btn${campo.gps ? "" : " ghost"}" data-act="gps">${campo.gps ? "GPS activo · detener" : "Usar GPS"}</button>
  <button type="button" class="btn ghost" data-go="res">← Volver al resultado</button></div>`;
}

/* ================= Dibujo ================= */
function drawButtons() {
  const n = draw ? draw.pts.length : 0, need = draw && draw.target === "lote" ? 3 : draw && draw.forma === "line" ? 2 : 3;
  const pt = draw && draw.forma === "pt";
  return `<div class="row">${pt ? "" : `<button type="button" class="btn ghost" data-draw="undo" ${n ? "" : "disabled"}>Borrar último</button>
    <button type="button" class="btn" data-draw="done" ${n >= need ? "" : "disabled"}>Terminar (${n})</button>`}
    <button type="button" class="btn ghost" data-draw="cancel">Cancelar</button></div>`;
}
function startDraw(target, pts) {
  draw = { target, tipo: pick.tipo, forma: target === "lote" ? "poly" : pick.forma, pts: pts ? pts.map((p) => p.slice()) : [], edit: !!pts };
  map.doubleClickZoom.disable();
  $("#sheet").classList.add("min");
  syncDraw(); render();
}
const vIcon = (first) => LF.divIcon({ className: "vtx" + (first ? " first" : ""), iconSize: [26, 26], iconAnchor: [13, 13] });
const mIcon = LF.divIcon({ className: "vtx-mid", iconSize: [16, 16], iconAnchor: [8, 8] });
function refreshDrawPanel() { if (step === "lote" || step === "sens") $("#panel").innerHTML = ({ lote: pLote, sens: pSens })[step](); }
function syncDraw() {
  gDraw.clearLayers();
  const h = $("#drawhint");
  if (!draw) { h.hidden = true; return; }
  const n = draw.pts.length, poly = draw.forma === "poly";
  h.hidden = false;
  h.textContent = draw.forma === "pt" ? "Tocá donde está"
    : n === 0 ? "Tocá el primer punto"
    : n < (poly ? 3 : 2) ? "Seguí tocando puntos"
    : "Tocá un punto para borrarlo · arrastralo para moverlo";
  if (!n) return;
  const lls = draw.pts.map((p) => [p[1], p[0]]);
  const c = draw.target === "lote" ? "#ffffff" : TIPOS[draw.tipo].c;
  // la forma se cierra sola: el último punto se une con el primero
  (poly && n > 2 ? LF.polygon(lls, { color: c, weight: 3, fillColor: c, fillOpacity: 0.15, interactive: false })
    : LF.polyline(lls, { color: c, weight: 3, interactive: false })).addTo(gDraw);
  if (poly && n === 2) LF.polyline(lls, { color: c, weight: 2, dashArray: "5 5", interactive: false }).addTo(gDraw);
  // puntos intermedios: tocarlos agrega un punto en el medio del lado
  const segs = n > 1 ? (poly && n > 2 ? n : n - 1) : 0;
  for (let i = 0; i < segs; i++) {
    const a = draw.pts[i], b = draw.pts[(i + 1) % n];
    LF.marker([(a[1] + b[1]) / 2, (a[0] + b[0]) / 2], { icon: mIcon, draggable: true, title: "Agregar punto acá" })
      .on("click", () => { draw.pts.splice(i + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); syncDraw(); refreshDrawPanel(); })
      .on("dragend", (ev) => { const ll = ev.target.getLatLng(); draw.pts.splice(i + 1, 0, [ll.lng, ll.lat]); syncDraw(); refreshDrawPanel(); })
      .addTo(gDraw);
  }
  // vértices: tocar = borrar, arrastrar = mover
  lls.forEach((ll, i) => {
    LF.marker(ll, { icon: vIcon(i === 0), draggable: true, title: "Tocá para borrar, arrastrá para mover" })
      .on("click", () => { draw.pts.splice(i, 1); syncDraw(); refreshDrawPanel(); })
      .on("drag", (ev) => { const p = ev.target.getLatLng(); draw.pts[i] = [p.lng, p.lat]; })
      .on("dragend", () => syncDraw())
      .addTo(gDraw);
  });
}
function cancelDraw() { draw = null; map.doubleClickZoom.enable(); syncDraw(); $("#sheet").classList.remove("min"); }
function finishDraw() {
  const L = lote(); if (!draw || !L) return;
  let geom;
  if (draw.forma === "line") { if (draw.pts.length < 2) return; geom = { type: "LineString", coordinates: draw.pts }; }
  else { if (draw.pts.length < 3) return; geom = { type: "Polygon", coordinates: [draw.pts.concat([draw.pts[0]])] }; }
  if (draw.target === "lote") L.geom = geom;
  else L.areas.push({ id: uid(), tipo: draw.tipo, nombre: "", geom });
  L.fecha = Date.now();
  cancelDraw(); save(); render();
  if (lote().geom && draw === null && step === "lote") fit(L.geom);
}
function fit(g) { const b = turf.bbox(F(g)); map.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [30, 30], maxZoom: 18 }); }

map.on("click", (e) => {
  const p = [e.latlng.lng, e.latlng.lat];
  if (draw) {
    if (draw.forma === "pt") { const L = lote(); L.areas.push({ id: uid(), tipo: draw.tipo, nombre: "", geom: { type: "Point", coordinates: p } }); L.fecha = Date.now(); cancelDraw(); save(); render(); return; }
    draw.pts.push(p); syncDraw(); refreshDrawPanel(); return;
  }
  if (step === "campo") { if (campo.gps) stopGps(); campo.punto = p; $("#panel").innerHTML = pCampo(); }
});

/* ================= GPS ================= */
function startGps() {
  if (!("geolocation" in navigator)) { toast("Este navegador no tiene GPS disponible."); return; }
  campo.gps = true; let first = true;
  campo.id = navigator.geolocation.watchPosition((pos) => {
    campo.punto = [pos.coords.longitude, pos.coords.latitude]; campo.acc = pos.coords.accuracy;
    if (first) { map.setView([campo.punto[1], campo.punto[0]], Math.max(map.getZoom(), 17)); first = false; }
    if (step === "campo") $("#panel").innerHTML = pCampo();
  }, (err) => { toast(err.code === 1 ? "Sin permiso de ubicación. Habilitalo en el navegador." : "No se pudo obtener la ubicación."); stopGps(); if (step === "campo") $("#panel").innerHTML = pCampo(); },
  { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  $("#panel").innerHTML = pCampo();
}
function stopGps() { if (campo.id != null) navigator.geolocation.clearWatch(campo.id); campo.id = null; campo.gps = false; }

/* ================= Importar ================= */
function closeRing(r) { if (r.length && (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1])) r.push(r[0]); return r; }
function parseKML(txt) {
  const doc = new DOMParser().parseFromString(txt, "application/xml"), out = [];
  const cs = (s) => s.trim().split(/\s+/).map((c) => c.split(",").map(Number)).filter((c) => !isNaN(c[0]) && !isNaN(c[1])).map((c) => [c[0], c[1]]);
  doc.querySelectorAll("Placemark").forEach((pm) => {
    const name = ((pm.querySelector("name") || {}).textContent || "").trim();
    pm.querySelectorAll("Polygon").forEach((pg) => { const c = pg.querySelector("outerBoundaryIs coordinates") || pg.querySelector("coordinates"); if (c) out.push({ name, geom: { type: "Polygon", coordinates: [closeRing(cs(c.textContent))] } }); });
    pm.querySelectorAll("LineString coordinates").forEach((c) => { const l = cs(c.textContent); if (l.length > 1) out.push({ name, geom: { type: "LineString", coordinates: l } }); });
    pm.querySelectorAll("Point coordinates").forEach((c) => { const p = cs(c.textContent)[0]; if (p) out.push({ name, geom: { type: "Point", coordinates: p } }); });
  });
  return out;
}
function parseGeoJSON(txt) {
  const j = JSON.parse(txt), out = [];
  const feats = j.type === "FeatureCollection" ? j.features : j.type === "Feature" ? [j] : [F(j)];
  feats.forEach((f) => {
    if (!f.geometry) return;
    const pr = f.properties || {}, name = pr.name || pr.nombre || pr.Name || "";
    turf.flatten(f).features.forEach((ff) => {
      const g = ff.geometry;
      if (g.type === "Polygon") out.push({ name, capa: pr.capa, geom: { type: "Polygon", coordinates: [closeRing(g.coordinates[0].map((c) => [c[0], c[1]]))] } });
      else if (g.type === "LineString") out.push({ name, capa: pr.capa, geom: { type: "LineString", coordinates: g.coordinates.map((c) => [c[0], c[1]]) } });
      else if (g.type === "Point") out.push({ name, capa: pr.capa, geom: { type: "Point", coordinates: [g.coordinates[0], g.coordinates[1]] } });
    });
  });
  return out;
}
let pending = [];
$("#fileIn").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try { const txt = await f.text(); pending = /\.kml$/i.test(f.name) || txt.trim().startsWith("<") ? parseKML(txt) : parseGeoJSON(txt); }
  catch (_) { toast("No pude leer el archivo. Probá con KML o GeoJSON."); return; }
  pending = pending.filter((p) => !/^(exclusi|amortiguamiento|sin restricci|superficie aplicable|zona )/i.test(p.name) && !["exclusion", "amortiguamiento", "libre", "lote_aplicable"].includes(p.capa));
  if (!pending.length) { toast("El archivo no tiene polígonos, líneas ni puntos."); return; }
  let hayLote = !!(lote() && lote().geom);
  $("#importList").innerHTML = pending.map((p, i) => {
    const isPoly = p.geom.type === "Polygon";
    let def = isPoly && !hayLote ? "lote" : p.geom.type === "LineString" ? "agua" : p.geom.type === "Point" ? "vivienda" : "ignorar";
    const tn = Object.entries(TIPOS).find(([, v]) => p.name && p.name.toLowerCase().includes(v.t.toLowerCase().split(" ")[0]));
    if (tn && def !== "lote") def = tn[0];
    if (def === "lote") hayLote = true;
    return `<label><span>${esc(p.name || { Polygon: "Polígono", LineString: "Línea", Point: "Punto" }[p.geom.type] + " " + (i + 1))}</span><select data-i="${i}">
      <option value="ignorar"${def === "ignorar" ? " selected" : ""}>Ignorar</option>
      ${isPoly ? `<option value="lote"${def === "lote" ? " selected" : ""}>Es el lote</option>` : ""}
      ${Object.entries(TIPOS).map(([k, v]) => `<option value="${k}"${def === k ? " selected" : ""}>${v.t}</option>`).join("")}</select></label>`;
  }).join("");
  $("#importDlg").showModal();
});
$("#importDlg").addEventListener("close", () => {
  if ($("#importDlg").returnValue !== "ok") return;
  if (!lote()) nuevoLote(false);
  const L = lote(), feats = [];
  document.querySelectorAll("#importList select").forEach((s) => {
    const p = pending[+s.dataset.i], v = s.value;
    if (v === "lote") { L.geom = p.geom; if (!L.nombre) L.nombre = p.name; }
    else if (TIPOS[v]) L.areas.push({ id: uid(), tipo: v, nombre: p.name, geom: p.geom });
    if (v !== "ignorar") feats.push(F(p.geom));
  });
  L.fecha = Date.now(); save();
  if (feats.length) { const b = turf.bbox({ type: "FeatureCollection", features: feats }); map.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [30, 30], maxZoom: 18 }); }
  go(L.geom ? (L.areas.length ? "aplic" : "sens") : "lote");
});

/* ================= Exportar ================= */
function capas(L) {
  const r = calcular(L), out = [];
  const add = (capa, nombre, g, extra) => g && out.push({ type: "Feature", properties: Object.assign({ capa, nombre }, extra || {}), geometry: g.geometry || g });
  add("lote", L.nombre || "Lote", L.geom, { ha: +r.tot.toFixed(2), cliente: L.cliente || "" });
  add("lote_aplicable", `Superficie aplicable clase ${L.tox}`, r.aplicGeom, { ha: +r.aplic.toFixed(2), clase: L.tox, modo: MODOS[L.modo].t });
  add("exclusion", "Zona de exclusión", r.zE, { ha: +r.hE.toFixed(2) });
  add("amortiguamiento", "Zona de amortiguamiento", r.zA, { ha: +r.hA.toFixed(2) });
  L.areas.forEach((a) => add("area_sensible", nombreArea(a), a.geom, { tipo: TIPOS[a.tipo].t }));
  return out;
}
const KST = { lote: ["ffffffff", "00ffffff"], lote_aplicable: ["ff32c83c", "6632c83c"], exclusion: ["ff303bff", "88303bff"], amortiguamiento: ["ff00b3ff", "6600b3ff"], area_sensible: ["ffff00ff", "66ff00ff"] };
function toKML(fs, L) {
  const x = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const ring = (r) => r.map((c) => `${(+c[0]).toFixed(7)},${(+c[1]).toFixed(7)},0`).join(" ");
  const poly = (rs) => `<Polygon><outerBoundaryIs><LinearRing><coordinates>${ring(rs[0])}</coordinates></LinearRing></outerBoundaryIs>${rs.slice(1).map((h) => `<innerBoundaryIs><LinearRing><coordinates>${ring(h)}</coordinates></LinearRing></innerBoundaryIs>`).join("")}</Polygon>`;
  const geom = (g) => g.type === "Point" ? `<Point><coordinates>${g.coordinates[0]},${g.coordinates[1]},0</coordinates></Point>`
    : g.type === "LineString" ? `<LineString><coordinates>${ring(g.coordinates)}</coordinates></LineString>`
    : g.type === "Polygon" ? poly(g.coordinates) : g.type === "MultiPolygon" ? `<MultiGeometry>${g.coordinates.map(poly).join("")}</MultiGeometry>` : "";
  const st = Object.entries(KST).map(([k, [l, p]]) => `<Style id="${k}"><LineStyle><color>${l}</color><width>2</width></LineStyle><PolyStyle><color>${p}</color></PolyStyle></Style>`).join("");
  const pm = fs.map((f) => `<Placemark><name>${x(f.properties.nombre)}</name><description>${x(Object.entries(f.properties).map(([a, b]) => a + ": " + b).join(" | "))}</description><styleUrl>#${f.properties.capa}</styleUrl>${geom(f.geometry)}</Placemark>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${x(L.nombre || "Lote")} · Ley 11.178</name>${st}${pm}</Document></kml>`;
}
function bajar(txt, type, name) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([txt], { type })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const archivo = (L) => (L.nombre || "lote").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w-]+/g, "_").slice(0, 40) + "_11178";

function resumen() {
  const L = lote(); if (!L || !L.geom) return "";
  const r = calcular(L);
  const out = [`LEY 11.178 ENTRE RÍOS · ${new Date().toLocaleDateString("es-AR")}`,
    `Lote: ${L.nombre || "sin nombre"}${L.cliente ? " · " + L.cliente : ""} (${fmt(r.tot, 2)} ha)`,
    `Aplicación: ${MODOS[L.modo].t}${L.modo === "uav60p" ? ` (comparado con ${L.ref60 === "a" ? "avión" : "terrestre"}, sin distancia legal expresa)` : ""} · clase ${L.tox}, banda ${TOX[L.tox][0]}`, ``,
    `SUPERFICIE APLICABLE: ${fmt(r.aplic, 2)} ha`,
    `Exclusión ${fmt(r.hE, 2)} ha · Amortiguamiento ${fmt(r.hA, 2)} ha · Sin restricción ${fmt(r.hL, 2)} ha`];
  if (r.per.length) { out.push(``, `Áreas sensibles:`); r.per.forEach((p) => out.push(`· ${nombreArea(p.a)} (${TIPOS[p.a.tipo].t}) a ${p.dist < 0.5 ? "0" : fmt(p.dist)} m del lote: exclusión ${fmt(p.e)} m (${fmt(p.haE, 2)} ha), amortiguamiento hasta ${fmt(p.am)} m (${fmt(p.haA, 2)} ha)`)); }
  if (r.hA > 0.0001 && okAmort(L.tox)) out.push(``, `En amortiguamiento: asesor presente, aviso fehaciente 48 h, receta digital y condiciones meteorológicas adecuadas.`);
  const c = turf.centroid(F(L.geom)).geometry.coordinates;
  out.push(``, `Ubicación: https://www.google.com/maps/@?api=1&map_action=map&center=${c[1].toFixed(6)},${c[0].toFixed(6)}&zoom=16&basemap=satellite`,
    `Consulta orientativa según el texto de la ley. No reemplaza la receta agronómica ni la normativa municipal.`);
  return out.join("\n");
}
function renderPrint() { $("#printBox").textContent = step === "res" ? resumen() : ""; }

/* ================= Acciones ================= */
function nuevoLote(ir = true) {
  const L = { id: uid(), nombre: "", cliente: "", geom: null, areas: [], modo: S.def.modo, tox: S.def.tox, ref60: S.def.ref60, fecha: Date.now() };
  S.lotes.push(L); S.actual = L.id; save(); if (ir) go("lote");
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const L = lote(), d = b.dataset;
  if (d.go) { go(d.go); return; }
  if (d.open) { S.actual = d.open; save(); const l = lote(); if (l.geom) fit(l.geom); go(l.geom ? "res" : "lote"); return; }
  if (d.tipo) { pick.tipo = d.tipo; pick.forma = TIPOS[d.tipo].forma; $("#panel").innerHTML = pSens(); return; }
  if (d.forma) { pick.forma = d.forma; $("#panel").innerHTML = pSens(); return; }
  if (d.modo) { L.modo = d.modo; S.def.modo = d.modo; save(); render(); return; }
  if (d.ref) { L.ref60 = d.ref; S.def.ref60 = d.ref; save(); render(); return; }
  if (d.tox) { L.tox = d.tox; S.def.tox = d.tox; save(); render(); return; }
  if (d.del) { L.areas = L.areas.filter((a) => a.id !== d.del); save(); render(); return; }
  if (d.draw === "undo") { draw.pts.pop(); syncDraw(); refreshDrawPanel(); return; }
  if (d.draw === "done") { finishDraw(); return; }
  if (d.draw === "cancel") { cancelDraw(); render(); return; }
  switch (d.act) {
    case "nuevo": nuevoLote(); break;
    case "importar": $("#fileIn").click(); break;
    case "dibujar-lote": startDraw("lote"); break;
    case "editar-lote": startDraw("lote", L.geom.coordinates[0].slice(0, -1)); break;
    case "marcar": startDraw("area"); break;
    case "buscar": { const f = $("#buscarForm"); f.hidden = !f.hidden; if (!f.hidden) $("#inCoord").focus(); break; }
    case "borrar-lote":
      if (d.confirm) { S.lotes = S.lotes.filter((l) => l.id !== L.id); S.actual = null; save(); go("lista"); }
      else { d.confirm = "1"; b.textContent = "Tocá de nuevo para borrar"; setTimeout(() => { if (b.isConnected) { b.textContent = "Borrar este lote"; delete d.confirm; } }, 4000); }
      break;
    case "kml": bajar(toKML(capas(L), L), "application/vnd.google-earth.kml+xml", archivo(L) + ".kml"); break;
    case "geojson": bajar(JSON.stringify({ type: "FeatureCollection", features: capas(L) }, null, 1), "application/geo+json", archivo(L) + ".geojson"); break;
    case "compartir": {
      const t = resumen();
      if (navigator.share) { try { await navigator.share({ title: "Ley 11.178 · " + (L.nombre || "Lote"), text: t }); break; } catch (er) { if (er.name === "AbortError") break; } }
      try { await navigator.clipboard.writeText(t); toast("Resultado copiado. Pegalo en WhatsApp."); } catch (_) { toast("No se pudo copiar."); }
      break;
    }
    case "imprimir": renderPrint(); window.print(); break;
    case "gps": campo.gps ? (stopGps(), ($("#panel").innerHTML = pCampo())) : startGps(); break;
    case "base": { const o = ["sat"].concat(baseLayers.google ? ["google"] : [], ["osm"]); S.base = o[(o.indexOf(S.base) + 1) % o.length]; applyBase(); save(); break; }
    case "locate":
      if (!navigator.geolocation) { toast("GPS no disponible."); break; }
      navigator.geolocation.getCurrentPosition((p) => map.setView([p.coords.latitude, p.coords.longitude], 16), () => toast("No se pudo obtener la ubicación."), { enableHighAccuracy: true, timeout: 15000 });
      break;
  }
});
document.addEventListener("input", (e) => {
  const L = lote(); if (!L) return;
  if (e.target.id === "inNombre") { L.nombre = e.target.value; save(); $("#loteTitulo").textContent = [L.nombre || "Lote sin nombre", L.cliente].filter(Boolean).join(" · "); }
  if (e.target.id === "inCliente") { L.cliente = e.target.value; save(); $("#loteTitulo").textContent = [L.nombre || "Lote sin nombre", L.cliente].filter(Boolean).join(" · "); }
  if (e.target.dataset.nombre) { const a = L.areas.find((x) => x.id === e.target.dataset.nombre); if (a) { a.nombre = e.target.value; save(); } }
});
document.addEventListener("submit", (e) => {
  if (e.target.id !== "buscarForm") return;
  e.preventDefault();
  const m = $("#inCoord").value.match(/(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)/);
  if (!m) { toast("Escribí latitud y longitud, por ejemplo -31.74, -60.52"); return; }
  const lat = parseFloat(m[1].replace(",", ".")), lng = parseFloat(m[2].replace(",", "."));
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) { toast("Coordenadas fuera de rango."); return; }
  map.setView([lat, lng], 16);
});
$("#grip").addEventListener("click", () => { $("#sheet").classList.toggle("min"); setTimeout(() => map.invalidateSize(), 50); });

let tt;
function toast(msg) {
  let el = $(".toast"); if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.textContent = msg; el.hidden = false; clearTimeout(tt); tt = setTimeout(() => (el.hidden = true), 3200);
}
window.addEventListener("beforeprint", () => { renderPrint(); map.invalidateSize(); });
new ResizeObserver(() => map.invalidateSize()).observe($(".mapwrap"));

/* ================= Arranque ================= */
// Migrar datos de la versión anterior (un solo lote)
try {
  const old = JSON.parse(localStorage.getItem("d11178-mapa-v1"));
  if (old && old.lote && !S.lotes.length) {
    const mapTipo = { con: "vivienda", sin: "agua", esc: "escuela", urb: "pueblo" };
    S.lotes.push({ id: uid(), nombre: old.lote.nombre || "Lote importado", cliente: "", geom: old.lote.geom, areas: (old.areas || []).map((a) => ({ id: uid(), tipo: mapTipo[a.tipo] || "vivienda", nombre: a.nombre || "", geom: a.geom })), modo: old.modo || "uav60p", tox: old.tox || "III", ref60: old.ref60 || "a", fecha: Date.now() });
    save();
  }
} catch (_) {}
step = lote() && lote().geom ? "res" : "lista";
if (lote() && lote().geom) fit(lote().geom);
render();

if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
