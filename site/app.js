import { competitionOn, chartWeekOf, lastTopTenWeek } from "./lib/competition.js";

const DATA = "../data/";
const params = new URLSearchParams(location.search);
const ALBUM_ID = params.get("album") || "prism";
const STORE_KEY = `eras:alt:${ALBUM_ID}`;
const DAY = 86400000;
const t = (iso) => Date.parse(iso + "T00:00:00Z");
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (d) => d ? new Date(t(d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";

const state = {
  album: null, artist: null, songs: {}, hot100: null,
  real: [],          // [{song_id, date, promo}]
  scenarios: {},     // id -> scenario
  alt: null,         // {id, title, album_id, singles:[{song_id,date}]}
  sel: { lane: "alt", i: 0 },
  lookahead: 12,
};

async function j(path) {
  const r = await fetch(DATA + path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

function storeGet() { try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch { return null; } }
function storeSet(v) { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* ignore */ } }

async function load() {
  const [album, hot100, index] = await Promise.all([j(`albums/${ALBUM_ID}.json`), j("charts/hot100.json"), j("eras/index.json")]);
  state.album = album;
  state.hot100 = hot100;
  state.artist = await j(`artists/${album.artist_id}.json`);
  const songs = await Promise.all(album.tracklist.map((tr) => j(`songs/${tr.song_id}.json`)));
  for (const s of songs) state.songs[s.id] = s;

  state.real = album.singles.map((s) => ({ song_id: s.song_id, date: s.date, order: s.order }));
  for (const s of songs) {
    if (s.promotional_release) state.real.push({ song_id: s.id, date: s.promotional_release, promo: true });
  }

  for (const id of index[ALBUM_ID] || []) state.scenarios[id] = await j(`eras/${id}.json`);
  state.scenarios["__real"] = {
    id: "__real", title: "Start from the real era", album_id: ALBUM_ID,
    singles: album.singles.map((s) => ({ song_id: s.song_id, date: s.date })),
  };

  const saved = storeGet();
  const first = Object.keys(state.scenarios).find((k) => k !== "__real") || "__real";
  state.alt = saved && saved.singles ? saved : structuredClone(state.scenarios[first]);

  document.title = `${album.title} era redesign`;
  document.getElementById("kicker").textContent = `${state.artist.name} · Era redesign`;
  document.getElementById("era-title").textContent = album.title;
  renderScenarioSelect();
  renderAll();
}

function renderScenarioSelect() {
  const sel = document.getElementById("scenario");
  const opts = Object.values(state.scenarios).map((s) => `<option value="${esc(s.id)}">${esc(s.title)}</option>`);
  if (state.alt && !state.scenarios[state.alt.id]) opts.unshift(`<option value="${esc(state.alt.id)}">${esc(state.alt.title)} (edited)</option>`);
  sel.innerHTML = opts.join("");
  sel.value = state.alt.id;
}

function title(id) { return state.songs[id]?.title || id; }
function usPeak(id) { const p = state.songs[id]?.key_peaks_original_era; return p ? p.us : null; }

function realSingles() { return state.real.filter((r) => !r.promo).sort((a, b) => a.date.localeCompare(b.date)); }

function markEdited() {
  if (!state.alt.id.endsWith("-edited")) {
    state.alt = { ...state.alt, id: `${state.alt.id === "__real" ? ALBUM_ID + "-custom" : state.alt.id}-edited`, title: state.alt.id === "__real" ? "Custom era" : state.alt.title };
  }
  storeSet(state.alt);
  renderScenarioSelect();
}

// ---------- singles table
function renderSingles() {
  const real = realSingles();
  const alt = state.alt.singles;
  const n = Math.max(real.length, alt.length);
  const options = state.album.tracklist.map((tr) => `<option value="${esc(tr.song_id)}">${tr.track}. ${esc(tr.title)}</option>`).join("");
  const rows = [];
  for (let i = 0; i < n; i++) {
    const r = real[i], a = alt[i];
    const changed = a && (!r || r.song_id !== a.song_id || r.date !== a.date);
    const sel = state.sel.i === i;
    rows.push(`<tr data-i="${i}" class="${sel ? "sel" : ""}">
      <td class="n">${i + 1}</td>
      <td class="real-cell" data-lane="real">${r ? `<div class="t">${esc(title(r.song_id))}</div><div class="d">${fmt(r.date)}</div>` : "<span class='mono'>none</span>"}</td>
      <td class="n">${r && usPeak(r.song_id) ? usPeak(r.song_id) : r ? "—" : ""}</td>
      <td>${a ? `<select data-k="song_id" data-i="${i}" class="${changed ? "changed" : ""}">${options}</select>` : ""}</td>
      <td>${a ? `<input type="date" data-k="date" data-i="${i}" value="${esc(a.date)}" min="2013-01-01" max="2015-12-31">` : ""}</td>
      <td>${a ? `<button class="x" data-del="${i}" title="Remove" type="button">×</button>` : ""}</td>
    </tr>`);
  }
  const body = document.getElementById("singles-body");
  body.innerHTML = rows.join("");
  body.querySelectorAll("select[data-k]").forEach((s) => { s.value = alt[+s.dataset.i].song_id; });
}

// ---------- timeline
function renderTimeline() {
  const all = [...state.real.map((r) => r.date), ...state.alt.singles.map((a) => a.date)].filter(Boolean);
  const minD = t(all.reduce((a, b) => (a < b ? a : b))) - 6 * 7 * DAY;
  const maxD = t(all.reduce((a, b) => (a > b ? a : b))) + 16 * 7 * DAY;
  const W = 1400, L = 110, R = 20;
  const x = (ms) => L + ((ms - minD) / (maxD - minD)) * (W - L - R);
  const lanes = { one: 40, real: 132, alt: 240 };
  const H = 316;
  const parts = [];

  // month grid
  const d0 = new Date(minD);
  let firstMonth = true;
  for (let m = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1)); m.getTime() < maxD; m.setUTCMonth(m.getUTCMonth() + 1)) {
    const xx = x(m.getTime());
    const jan = m.getUTCMonth() === 0 || firstMonth;
    firstMonth = false;
    parts.push(`<line x1="${xx}" x2="${xx}" y1="14" y2="${H - 22}" stroke="${jan ? "#111" : "#c9c5b8"}" stroke-width="${jan ? 2 : 1}"/>`);
    const label = m.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase() + (jan ? ` ${m.getUTCFullYear()}` : "");
    parts.push(`<text x="${xx + 4}" y="${H - 8}" font-size="12" font-weight="${jan ? 800 : 400}">${label}</text>`);
  }

  // lane labels
  const laneLabel = (y, txt, color) => parts.push(`<text x="0" y="${y + 5}" font-size="12" font-weight="800" fill="${color}">${txt}</text>`);
  laneLabel(lanes.one, "NO. 1", "#111");
  laneLabel(lanes.real, "REAL", "#111");
  laneLabel(lanes.alt, "ALTERNATE", "var(--accent)");

  // number-one runs
  const ones = state.hot100.number_ones.filter((w) => t(w.week) >= minD && t(w.week) <= maxD);
  const runs = [];
  for (const w of ones) {
    const last = runs[runs.length - 1];
    if (last && last.title === w.title) last.end = w.week; else runs.push({ title: w.title, artist: w.artist, start: w.week, end: w.week });
  }
  runs.forEach((r, k) => {
    const x1 = x(t(r.start) - 3.5 * DAY), x2 = x(t(r.end) + 3.5 * DAY);
    const same = r.artist.includes(state.artist.name);
    parts.push(`<rect x="${x1}" y="${lanes.one - 16}" width="${Math.max(1, x2 - x1)}" height="32" fill="${same ? "var(--accent)" : "var(--one)"}" stroke="#111" stroke-width="1"><title>${esc(r.title)} - ${esc(r.artist)} (${fmt(r.start)} to ${fmt(r.end)})</title></rect>`);
    if (x2 - x1 > 46) {
      const max = Math.floor((x2 - x1 - 8) / 7.2);
      const txt = r.title.length > max ? r.title.slice(0, Math.max(1, max - 1)) + "…" : r.title;
      parts.push(`<text x="${x1 + 4}" y="${lanes.one + 4}" font-size="12" font-weight="600" fill="${same ? "#fff" : "#111"}" pointer-events="none">${esc(txt)}</text>`);
    }
  });

  // selected single: chart week + lookahead window
  const selDate = selectedDate();
  if (selDate) {
    const wk = t(chartWeekOf(selDate));
    const x1 = x(wk), x2 = x(wk + state.lookahead * 7 * DAY);
    parts.unshift(`<rect x="${x1}" y="14" width="${x2 - x1}" height="${H - 36}" fill="var(--select)"/>`);
    parts.push(`<line x1="${x1}" x2="${x1}" y1="14" y2="${H - 22}" stroke="var(--accent)" stroke-width="2" stroke-dasharray="4 3"/>`);
  }

  // single markers, with labels placed in the first free slot to avoid overlaps
  const slots = [-14, 26, -30, 42];
  const placed = { real: [], alt: [] };
  const marker = (item, lane, color, i, kind) => {
    const xx = x(t(item.date));
    const y = lanes[lane];
    const label = `${kind === "promo" ? "PROMO: " : ""}${title(item.song_id)}`.toUpperCase();
    const w = label.length * (kind === "promo" ? 7.2 : 8) + 16;
    let slot = slots.find((dy) => !placed[lane].some((p) => p.dy === dy && xx < p.x2 && xx + w > p.x1));
    if (slot === undefined) slot = slots[i % slots.length];
    placed[lane].push({ dy: slot, x1: xx, x2: xx + w });
    const sel = state.sel.lane === lane && state.sel.i === i && kind !== "promo";
    const shape = kind === "promo"
      ? `<rect x="${xx - 6}" y="${y - 6}" width="12" height="12" fill="var(--paper)" stroke="${color}" stroke-width="3"/>`
      : `<rect x="${xx - 8}" y="${y - 8}" width="16" height="16" fill="${color}" ${sel ? 'stroke="#111" stroke-width="3"' : ""}/>`;
    return `<g class="mk" data-lane="${lane}" data-i="${i}" data-kind="${kind}" style="cursor:${kind === "promo" ? "default" : "pointer"}">
      <line x1="${xx}" x2="${xx}" y1="${y}" y2="${y + slot - (slot < 0 ? -2 : 10)}" stroke="${color}" stroke-width="1"/>${shape}
      <text x="${xx + 6}" y="${y + slot}" font-size="${kind === "promo" ? 11 : 13}" font-weight="${kind === "promo" ? 600 : 800}" fill="${color}">${esc(label)}</text>
      <title>${esc(title(item.song_id))}: ${fmt(item.date)}</title></g>`;
  };
  realSingles().forEach((r, i) => parts.push(marker(r, "real", "#111", i, "single")));
  state.real.filter((r) => r.promo).forEach((r, i) => parts.push(marker(r, "real", "#111", i, "promo")));
  state.alt.singles.forEach((a, i) => a.date && parts.push(marker(a, "alt", "var(--accent)", i, "single")));

  document.getElementById("timeline").innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Real and alternate single timeline">${parts.join("")}</svg>`;
  document.querySelectorAll("#timeline .mk").forEach((g) => g.addEventListener("click", () => {
    const lane = g.dataset.lane, i = +g.dataset.i;
    if (g.dataset.kind === "promo") return;
    select(lane, i);
  }));
}

function selectedItem() {
  return state.sel.lane === "real" ? realSingles()[state.sel.i] : state.alt.singles[state.sel.i];
}
function selectedDate() { return selectedItem()?.date || null; }

// ---------- competition panel
function runBar(s, week) {
  const W = 180, H = 18;
  const from = t(week) - 20 * 7 * DAY, to = t(week) + 20 * 7 * DAY;
  const x = (ms) => Math.max(0, Math.min(W, ((ms - from) / (to - from)) * W));
  const a = x(t(s.entry_date) - 3.5 * DAY), b = x(t(s.approx_last_top_ten_week) + 3.5 * DAY), p = x(t(s.peak_date)), w = x(t(week));
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="#c9c5b8"/>
    <rect x="${a}" y="4" width="${Math.max(2, b - a)}" height="${H - 8}" fill="#111"/>
    <rect x="${p - 2}" y="0" width="4" height="${H}" fill="var(--one)" stroke="#111" stroke-width="1"/>
    <line x1="${w}" x2="${w}" y1="0" y2="${H}" stroke="var(--accent)" stroke-width="2"/>
  </svg>`;
}

function compRows(list, week, extraCol) {
  if (!list.length) return `<div class="empty">None in this window.</div>`;
  const artist = state.artist.name;
  return `<div class="tbl"><table class="comp"><thead><tr>
      <th class="n">Peak</th><th>Song</th><th>Artist</th><th>Peak week</th>${extraCol ? `<th class="n">${extraCol.head}</th>` : "<th>Status</th>"}<th>Top-ten run (±20 wks)</th>
    </tr></thead><tbody>${list.map((s) => `<tr class="${s.artist.includes(artist) ? "same" : ""}">
      <td class="n">${s.peak}</td>
      <td class="title">${esc(s.title)}${s.approximate_run ? " *" : ""}</td>
      <td class="artist">${esc(s.artist)}</td>
      <td class="mono">${fmt(s.peak_date)}</td>
      ${extraCol ? `<td class="n">${extraCol.val(s)}</td>` : `<td><span class="status ${s.status.replace(" ", "-")}">${s.status}${s.weeks_to_peak ? ` ${Math.abs(s.weeks_to_peak)}w` : ""}</span></td>`}
      <td class="run">${runBar(s, week)}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

function renderCompetition() {
  const el = document.getElementById("competition");
  const item = selectedItem();
  if (!item || !item.date) { el.innerHTML = `<div class="empty">Pick a single to see its competition.</div>`; return; }
  const song = state.songs[item.song_id];
  const r = competitionOn(item.date, state.hot100, { lookaheadWeeks: state.lookahead });
  const lane = state.sel.lane;
  const pk = song.key_peaks_original_era || {};
  const fact = (v, l) => `<div class="fact"><b>${v ?? "—"}</b><span>${l}</span></div>`;
  const realRole = song.single ? `Real single ${song.single.order}` : song.role === "promotional single" ? "Real promo single" : "Album track";
  const ones = r.number_ones_ahead.filter((w, k, a) => k === 0 || a[k - 1].title !== w.title);

  el.innerHTML = `
    <div class="comp-head">
      <div class="kicker">${lane === "alt" ? "Alternate" : "Real"} single ${state.sel.i + 1} · released ${fmt(item.date)} · chart week ${fmt(r.chart_week)}</div>
      <div class="song ${lane === "alt" ? "alt" : ""}">${esc(song.title)}</div>
      <div class="facts">
        ${fact(realRole.replace(/^Real s/, "S").replace(/^Real p/, "P"), "Real role")}
        ${fact(pk.us, "US peak")}${fact(pk.uk, "UK peak")}${fact(pk.can, "CAN peak")}${fact(pk.aus, "AUS peak")}
        ${fact(r.in_top_ten.length, "In top ten")}${fact(r.in_top_ten.filter((s) => s.status === "climbing").length, "Still climbing")}
      </div>
    </div>
    <div class="number-one"><span class="lbl">No. 1 that week</span>
      <span class="t">${r.number_one ? esc(r.number_one.title) : "—"}</span>
      <span class="mono">${r.number_one ? esc(r.number_one.artist) : ""}</span></div>

    <div class="section-title"><h2>In the top ten that week</h2></div>
    ${compRows(r.in_top_ten, r.chart_week)}

    <div class="section-title"><h2>Entering the top ten next</h2>
      <label class="field"><span>Look ahead</span>
        <select id="lookahead">${[4, 8, 12, 16, 20].map((n) => `<option value="${n}" ${n === state.lookahead ? "selected" : ""}>${n} weeks</option>`).join("")}</select>
      </label></div>
    ${compRows(r.arriving_in_top_ten, r.chart_week, { head: "Arrives", val: (s) => `+${s.weeks_until_top_ten}w` })}

    <div class="section-title"><h2>No. 1s in the window</h2></div>
    <div class="mono">${ones.map((w) => `${esc(w.title)} (${fmt(w.week)})`).join(" → ") || "—"}</div>
  `;
  el.querySelector("#lookahead").addEventListener("change", (e) => { state.lookahead = +e.target.value; renderTimeline(); renderCompetition(); });
}

function renderAll() { renderSingles(); renderTimeline(); renderCompetition(); }
function select(lane, i) { state.sel = { lane, i }; renderAll(); }

// ---------- events
document.getElementById("singles-body").addEventListener("click", (e) => {
  const del = e.target.closest("[data-del]");
  if (del) {
    state.alt.singles.splice(+del.dataset.del, 1);
    state.sel = { lane: "alt", i: Math.min(state.sel.i, state.alt.singles.length - 1) };
    markEdited(); renderAll(); return;
  }
  if (e.target.closest("select, input")) return;
  const tr = e.target.closest("tr[data-i]");
  if (!tr) return;
  const i = +tr.dataset.i;
  const lane = e.target.closest("[data-lane=real]") ? "real" : (state.alt.singles[i] ? "alt" : "real");
  select(lane, i);
});
document.getElementById("singles-body").addEventListener("change", (e) => {
  const k = e.target.dataset.k;
  if (!k) return;
  const i = +e.target.dataset.i;
  state.alt.singles[i][k] = e.target.value;
  state.sel = { lane: "alt", i };
  markEdited(); renderAll();
});
document.getElementById("btn-add").addEventListener("click", () => {
  const last = state.alt.singles[state.alt.singles.length - 1];
  const date = last ? iso(t(last.date) + 12 * 7 * DAY) : state.album.release_date;
  const used = new Set(state.alt.singles.map((s) => s.song_id));
  const next = state.album.tracklist.find((tr) => !used.has(tr.song_id));
  state.alt.singles.push({ song_id: (next || state.album.tracklist[0]).song_id, date });
  state.sel = { lane: "alt", i: state.alt.singles.length - 1 };
  markEdited(); renderAll();
});
document.getElementById("scenario").addEventListener("change", (e) => {
  const s = state.scenarios[e.target.value];
  if (!s) return;
  state.alt = structuredClone(s);
  state.sel = { lane: "alt", i: 0 };
  storeSet(state.alt); renderScenarioSelect(); renderAll();
});
document.getElementById("btn-reset").addEventListener("click", () => {
  try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
  const first = Object.keys(state.scenarios).find((k) => k !== "__real") || "__real";
  state.alt = structuredClone(state.scenarios[first]);
  state.sel = { lane: "alt", i: 0 };
  renderScenarioSelect(); renderAll();
});
document.getElementById("btn-export").addEventListener("click", () => {
  const out = { ...state.alt, id: state.alt.id.replace(/-edited$/, "") || `${ALBUM_ID}-custom`, album_id: ALBUM_ID };
  const blob = new Blob([JSON.stringify(out, null, 2) + "\n"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${out.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

load().catch((err) => {
  document.getElementById("era-title").textContent = "Could not load data";
  document.getElementById("competition").innerHTML = `<div class="empty">${esc(err.message)}</div>`;
});
