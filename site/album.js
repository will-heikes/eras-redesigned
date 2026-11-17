import { lastTopTenWeek } from "./lib/competition.js";

const DATA = "../data/";
const ALBUM_ID = new URLSearchParams(location.search).get("album") || "prism";
const DAY = 86400000;
const t = (iso) => Date.parse(iso + "T00:00:00Z");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (d) => d ? new Date(t(d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
const j = async (p) => { const r = await fetch(DATA + p); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); };

const RADIO = [
  ["US Pop Airplay (Billboard)", "Pop"],
  ["US Adult Pop Airplay (Billboard)", "Adult Pop"],
  ["US Adult Contemporary (Billboard)", "AC"],
  ["US Rhythmic Airplay (Billboard)", "Rhythmic"],
  ["US Dance/Mix Show Airplay (Billboard)", "Dance/Mix"],
];
const CLUB = ["US Dance Club Songs (Billboard)", "Club"];
const US_AWARDS = new Set(["American Music Awards", "Grammy Awards", "Billboard Music Awards", "Billboard Mid-Year Awards",
  "MTV Video Music Awards", "People's Choice Awards", "Teen Choice Awards", "iHeartRadio Music Awards",
  "Nickelodeon Kids' Choice Awards", "Kids' Choice Awards", "Radio Disney Music Awards", "ASCAP Pop Music Awards",
  "BMI Pop Awards", "CMT Music Awards", "Vevo Certified Awards", "Vevo Hot This Year Awards"]);

function tier(p) {
  if (p == null) return "tnone";
  if (p === 1) return "t1";
  if (p <= 10) return "t10";
  if (p <= 40) return "t40";
  return "t100";
}

function cert(song, region) {
  const c = (song.certifications || []).find((c) => c.region === region && c.type !== "streaming only");
  return c ? c.certification : null;
}

const originalTables = (song) => (song.weekly_charts || []).filter((tb) => !tb.version &&
  (!tb.period || Math.min(...(tb.period.match(/\d{4}/g) || [0]).map(Number)) < 2020));

function usPeak(song, chart) {
  let best = null;
  for (const tb of originalTables(song)) for (const e of tb.entries)
    if (e.chart === chart && Number.isInteger(e.position) && (best == null || e.position < best)) best = e.position;
  return best;
}

function laterCharting(song) {
  const years = (song.weekly_charts || [])
    .filter((tb) => !tb.version && tb.period && Math.min(...(tb.period.match(/\d{4}/g) || [9999]).map(Number)) >= 2020)
    .map((tb) => tb.period);
  return [...new Set(years)];
}

const toNum = (v) => {
  if (!v) return 0;
  const m = String(v).replace(/,/g, "").match(/([\d.]+)\s*(million)?/i);
  return m ? parseFloat(m[1]) * (m[2] ? 1e6 : 1) : 0;
};

// weeks at No. 1 on a weekly list, plus the best week's units
function numberOneWeeks(list, song, artist, unitsKey) {
  const weeks = (list || []).filter((w) => w.title.toLowerCase() === song.title.toLowerCase() && w.artist.includes(artist));
  const best = weeks.reduce((a, w) => (toNum(w[unitsKey]) > toNum(a?.[unitsKey]) ? w : a), null);
  return { weeks: weeks.length, best: best ? best[unitsKey] : null, first: weeks[0]?.week || null, list: weeks };
}

async function load() {
  const album = await j(`albums/${ALBUM_ID}.json`);
  const [artist, hot100, ...songs] = await Promise.all([
    j(`artists/${album.artist_id}.json`), j("charts/hot100.json"),
    ...album.tracklist.map((tr) => j(`songs/${tr.song_id}.json`)),
  ]);
  const byId = Object.fromEntries(songs.map((s) => [s.id, s]));
  document.title = `${album.title}`;

  const us = {};
  for (const s of songs) {
    us[s.id] = {
      hot100: usPeak(s, "US Billboard Hot 100") ?? s.key_peaks_original_era?.us ?? null,
      bubbling: s.discography_peaks?.["US Bub."] ?? null,
      radio: Object.fromEntries(RADIO.map(([c, l]) => [l, usPeak(s, c)])),
      club: usPeak(s, CLUB[0]),
      popDigital: usPeak(s, "US Pop Digital Songs (Billboard)"),
      hot100One: numberOneWeeks(hot100.number_ones, s, artist.name),
      digital: numberOneWeeks(hot100.digital_number_ones, s, artist.name, "weekly_sales"),
      streaming: numberOneWeeks(hot100.streaming_number_ones, s, artist.name, "weekly_streams"),
    };
  }

  // ----- header
  document.getElementById("kicker").textContent = `${artist.name} · Studio album · US charts`;
  document.getElementById("album-title").textContent = album.title;
  const usCert = cert(album, "United States");
  document.getElementById("album-sub").innerHTML =
    `Released <b>${fmt(album.release_date)}</b> · ${esc(album.label)} · ${album.tracklist.length} tracks · ${album.singles.length} singles${usCert ? ` · RIAA <b>${esc(usCert)}</b>` : ""}`;
  const sum = (k) => songs.reduce((n, s) => n + us[s.id][k].weeks, 0);
  const stat = (v, l, top) => `<div class="stat ${top ? "top" : ""}"><b>${v ?? "—"}</b><span>${l}</span></div>`;
  document.getElementById("album-stats").innerHTML =
    stat(album.key_peaks.us, "Billboard 200 peak", album.key_peaks.us === 1) +
    stat(sum("hot100One"), "Wks at No. 1, Hot 100") +
    stat(sum("digital"), "Wks at No. 1, Digital") +
    stat(sum("streaming"), "Wks at No. 1, Streaming");

  // ----- singles (official + promo-only), chronological
  const items = [
    ...album.singles.map((s) => ({ song: byId[s.song_id], date: s.date, label: `Single ${s.order}`, promo: false, promoDate: byId[s.song_id].promotional_release })),
    ...songs.filter((s) => s.promotional_release && !s.single).map((s) => ({ song: s, date: s.promotional_release, label: "Promo single", promo: true })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const runs = hot100.top_ten.filter((r) => r.artist.includes(artist.name));
  const runFor = (song) => runs.filter((r) => r.title.toLowerCase() === song.title.toLowerCase());

  renderTimeline(album, items, runFor, us);

  document.getElementById("singles").innerHTML = items.map(({ song, date, label, promo, promoDate }) => {
    const u = us[song.id];
    const riaa = cert(song, "United States");
    const run = runFor(song)[0];
    const cellsHtml = [["Pop", u.radio.Pop], ["Adult Pop", u.radio["Adult Pop"]], ["AC", u.radio.AC],
      ["Rhythmic", u.radio.Rhythmic], ["Digital #1", u.digital.weeks ? `${u.digital.weeks} wks` : null], ["Stream #1", u.streaming.weeks ? `${u.streaming.weeks} wk${u.streaming.weeks > 1 ? "s" : ""}` : null]]
      .map(([l, v]) => `<div><span>${l}</span>${v ?? "—"}</div>`).join("");
    return `<div class="card ${promo ? "promo" : ""}">
      <div class="ord">${label}</div>
      <div class="ttl">${esc(song.title)}</div>
      <div class="dt">${fmt(date)}${promoDate ? ` · promo ${fmt(promoDate).replace(/, \d{4}$/, "")}` : ""}</div>
      <div class="big">${u.hot100 ? `#${u.hot100}` : "—"}<small>HOT 100</small></div>
      <div class="mini-peaks">${cellsHtml}</div>
      <div class="cert">${run ? `<b>${run.weeks_in_top_ten}</b> wks top ten · ` : ""}${u.digital.best ? `best sales wk <b>${esc(u.digital.best)}</b> · ` : ""}${riaa ? `RIAA <b>${esc(riaa)}</b>` : "No RIAA cert listed"}</div>
    </div>`;
  }).join("");

  // ----- grid
  const head = `<thead>
    <tr><th></th><th></th><th></th><th class="n grp">Overall</th><th colspan="${RADIO.length}" class="grp">Radio airplay</th><th class="grp">Clubs</th><th colspan="2" class="grp">No. 1 weeks</th><th></th></tr>
    <tr><th class="n">#</th><th>Track</th><th>Role</th><th class="n">Hot 100</th>${RADIO.map(([, l]) => `<th class="n">${l}</th>`).join("")}<th class="n">${CLUB[1]}</th><th class="n">Digital</th><th class="n">Streaming</th><th>RIAA</th></tr>
  </thead>`;
  const cell = (p) => `<td class="cell ${tier(p)}">${p ?? "—"}</td>`;
  const ones = (n) => `<td class="cell ${n ? "t1" : "tnone"}">${n ? `${n} wk${n > 1 ? "s" : ""}` : "—"}</td>`;
  const rows = album.tracklist.map((tr) => {
    const s = byId[tr.song_id];
    const u = us[s.id];
    const later = laterCharting(s);
    const role = s.single ? `<span class="role single">Single ${s.single.order}</span>`
      : s.role === "promotional single" ? `<span class="role promo">Promo</span>` : `<span class="role">Album track</span>`;
    const hot = u.hot100 == null && u.bubbling != null ? `<td class="cell t100">B${u.bubbling}</td>` : cell(u.hot100);
    const dig = u.digital.weeks ? ones(u.digital.weeks) : u.popDigital ? `<td class="cell t100" title="Pop Digital Songs">PD ${u.popDigital}</td>` : ones(0);
    return `<tr class="${s.single || s.role === "promotional single" ? "" : "album-track"}">
      <td class="n">${tr.track}</td>
      <td class="title">${esc(s.title)}${s.featuring ? ` <span class="mono">feat. ${esc(s.featuring)}</span>` : ""}${tr.edition === "deluxe" ? ` <span class="mono">deluxe</span>` : ""}${later.length ? ` <span class="role later">Charted again ${esc(later[0])}</span>` : ""}</td>
      <td>${role}</td>
      ${hot}${RADIO.map(([, l]) => cell(u.radio[l])).join("")}${cell(u.club)}${dig}${ones(u.streaming.weeks)}
      <td class="mono">${esc(cert(s, "United States") || "")}</td>
    </tr>`;
  }).join("");
  document.getElementById("tracks").innerHTML = head + `<tbody>${rows}</tbody>`;

  // ----- No. 1 weeks by song
  const oneRows = items.filter((i) => !i.promo || us[i.song.id].digital.weeks || us[i.song.id].streaming.weeks).map(({ song }) => {
    const u = us[song.id];
    return `<tr><td class="title">${esc(song.title)}</td>
      <td class="n">${u.hot100One.weeks || "—"}</td>
      <td class="n">${u.digital.weeks || "—"}</td><td class="n mono">${esc(u.digital.best || "")}</td>
      <td class="n">${u.streaming.weeks || "—"}</td><td class="n mono">${esc(u.streaming.best || "")}</td></tr>`;
  }).join("");
  document.getElementById("album-certs").innerHTML =
    `<thead><tr><th>Song</th><th class="n">Hot 100</th><th class="n">Digital</th><th class="n">Best sales wk</th><th class="n">Streaming</th><th class="n">Best streams wk</th></tr></thead><tbody>${oneRows}</tbody>`;

  // ----- US awards, 2013-2015
  const awards = [
    ...(album.awards || []).map((a) => ({ ...a, work: album.title })),
    ...songs.flatMap((s) => (s.awards || []).map((a) => ({ ...a, work: s.title }))),
  ].filter((a) => a.year && a.year <= 2015 && US_AWARDS.has(a.award))
    .sort((a, b) => a.year - b.year || (a.result === "Won" ? -1 : 1));
  const won = awards.filter((a) => a.result === "Won");
  const nom = awards.filter((a) => a.result !== "Won");
  const awardRow = (a) => `<tr><td class="n">${a.year}</td><td>${esc(a.award)}<div class="mono">${esc(a.category || "")}</div></td><td>${esc(a.work)}</td><td class="status ${a.result === "Won" ? "climbing" : "past-peak"}">${esc(a.result)}</td></tr>`;
  document.getElementById("awards-summary").innerHTML =
    stat(won.length, "US awards won") + stat(awards.length, "US nominations") +
    stat(awards.filter((a) => a.award === "Grammy Awards").length, "Grammy noms") +
    stat(awards.filter((a) => a.award === "Grammy Awards" && a.result === "Won").length, "Grammy wins");
  document.getElementById("awards").innerHTML =
    `<thead><tr><th class="n">Year</th><th>Award</th><th>Work</th><th>Result</th></tr></thead><tbody>${won.map(awardRow).join("")}</tbody>` +
    `<tbody class="more" hidden>${nom.map(awardRow).join("")}</tbody>`;
  addToggle("awards", `Show ${nom.length} nominations`);
}

function addToggle(tableId, label) {
  const table = document.getElementById(tableId);
  const more = table.querySelector(".more");
  if (!more || !more.children.length) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "more-btn";
  btn.textContent = label;
  btn.addEventListener("click", () => {
    more.hidden = !more.hidden;
    btn.textContent = more.hidden ? label : "Show less";
  });
  table.closest(".tbl").after(btn);
}

function renderTimeline(album, items, runFor, us) {
  const dates = items.map((i) => t(i.date));
  const runEnds = items.flatMap((i) => runFor(i.song).map((r) => t(lastTopTenWeek(r))));
  const minD = Math.min(...dates, t(album.release_date)) - 5 * 7 * DAY;
  const maxD = Math.max(...dates, ...runEnds) + 8 * 7 * DAY;
  const W = 1400, L = 20, R = 20;
  const x = (ms) => L + ((ms - minD) / (maxD - minD)) * (W - L - R);
  const rowH = 30, top = 70;
  const H = top + items.length * rowH + 40;
  const parts = [];

  let first = true;
  const d0 = new Date(minD);
  for (let m = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1)); m.getTime() < maxD; m.setUTCMonth(m.getUTCMonth() + 1)) {
    const xx = x(m.getTime());
    const yr = m.getUTCMonth() === 0 || first;
    first = false;
    parts.push(`<line x1="${xx}" x2="${xx}" y1="40" y2="${H - 26}" stroke="${yr ? "var(--rule)" : "var(--hair)"}"/>`);
    parts.push(`<text x="${xx + 5}" y="${H - 8}" font-size="12" fill="${yr ? "var(--ink)" : "var(--ink-2)"}">${m.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase()}${yr ? " " + m.getUTCFullYear() : ""}</text>`);
  }

  // album release
  const ax = x(t(album.release_date));
  parts.push(`<line x1="${ax}" x2="${ax}" y1="18" y2="${H - 26}" stroke="var(--accent)" stroke-width="2"/>`);
  parts.push(`<text x="${ax + 8}" y="30" font-size="13" font-weight="600" fill="var(--accent)">ALBUM RELEASE · ${fmt(album.release_date).toUpperCase()}</text>`);

  items.forEach((it, k) => {
    const y = top + k * rowH;
    const xx = x(t(it.date));
    parts.push(`<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="var(--hair)" stroke-dasharray="2 4"/>`);
    for (const r of runFor(it.song)) {
      const x1 = x(t(r.entry_date) - 3.5 * DAY), x2 = x(t(lastTopTenWeek(r)) + 3.5 * DAY), xp = x(t(r.peak_date));
      parts.push(`<rect x="${x1}" y="${y - 6}" width="${Math.max(2, x2 - x1)}" height="12" fill="var(--accent)" opacity=".85"><title>${esc(it.song.title)}: top ten ${fmt(r.entry_date)}, peaked #${r.peak} on ${fmt(r.peak_date)}, ${r.weeks_in_top_ten} weeks</title></rect>`);
      parts.push(`<rect x="${xp - 1.5}" y="${y - 10}" width="3" height="20" fill="var(--ink)"/>`);
      parts.push(`<text x="${x2 + 8}" y="${y + 4}" font-size="12" fill="var(--ink-2)">#${r.peak} · ${r.weeks_in_top_ten} WKS</text>`);
    }
    if (it.promoDate) {
      const px = x(t(it.promoDate));
      parts.push(`<line x1="${px}" x2="${xx}" y1="${y}" y2="${y}" stroke="var(--ink-3)" stroke-dasharray="3 3"/>`);
      parts.push(`<rect x="${px - 6}" y="${y - 6}" width="12" height="12" fill="var(--bg)" stroke="var(--real)" stroke-width="2"><title>Promo release ${fmt(it.promoDate)}</title></rect>`);
    }
    const tick = (w, dy, color, what) => {
      const wx = x(t(w.week));
      return `<rect x="${wx - 3}" y="${y + dy}" width="6" height="4" fill="${color}"><title>No. 1 on ${what}: ${fmt(w.week)}</title></rect>`;
    };
    us[it.song.id].digital.list.forEach((w) => parts.push(tick(w, -14, "var(--digital)", "Digital Songs")));
    us[it.song.id].streaming.list.forEach((w) => parts.push(tick(w, 10, "var(--stream)", "Streaming Songs")));
    parts.push(it.promo
      ? `<rect x="${xx - 6}" y="${y - 6}" width="12" height="12" fill="var(--bg)" stroke="var(--real)" stroke-width="2"/>`
      : `<rect x="${xx - 7}" y="${y - 7}" width="14" height="14" fill="var(--real)"/>`);
    const label = `${it.song.title.toUpperCase()}${it.promo ? " (PROMO)" : ""}`;
    const lw = label.length * 8;
    const anchorX = it.promoDate ? x(t(it.promoDate)) : xx;
    const left = anchorX - 14 - lw > L;
    parts.push(`<text x="${left ? anchorX - 14 : xx + 14}" y="${y + 4}" font-size="13" font-weight="600" text-anchor="${left ? "end" : "start"}" fill="${it.promo ? "var(--ink-2)" : "var(--ink)"}">${esc(label)}</text>`);
  });

  document.getElementById("timeline").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Singles and their Hot 100 top-ten runs">${parts.join("")}</svg>`;
}

load().catch((e) => { document.getElementById("kicker").textContent = "Could not load data: " + e.message; });
