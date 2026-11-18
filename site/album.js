import { lastTopTenWeek } from "./lib/competition.js";
import { coverAccent, applyAccent } from "./lib/palette.js";

const DATA = "../data/";
const params = new URLSearchParams(location.search);
const ALBUM_ID = params.get("album") || "prism";
// "complete" shows the whole era including a reissue; "original" stops at the reissue date
let EDITION = params.get("edition") === "original" ? "original" : "complete";
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
  const full = await j(`albums/${ALBUM_ID}.json`);
  const [artist, hot100, ...allSongs] = await Promise.all([
    j(`artists/${full.artist_id}.json`), j("charts/hot100.json"),
    ...full.tracklist.map((tr) => j(`songs/${tr.song_id}.json`)),
  ]);
  const rx = full.reissue;
  const original = rx && EDITION === "original";
  // the original edition view: tracks and singles that existed before the reissue
  const album = original ? { ...full,
    tracklist: full.tracklist.filter((tr) => tr.edition !== "reissue"),
    singles: full.singles.filter((s) => s.edition !== "reissue") } : full;
  const keep = new Set(album.tracklist.map((tr) => tr.song_id));
  const songs = allSongs.filter((s) => keep.has(s.id));
  const cutoff = original ? rx.release_date : "9999";

  // album switcher in the top bar
  document.getElementById("tabs").innerHTML = artist.albums.map((a) =>
    `<a href="./?album=${a.album_id}"${a.album_id === full.id ? ' aria-current="page"' : ""}>${esc(a.title)}</a>`).join("") +
    `<a href="redesign.html">Redesign</a>`;
  const byId = Object.fromEntries(songs.map((s) => [s.id, s]));
  document.title = `${album.title}`;

  const us = {};
  for (const s of songs) {
    us[s.id] = {
      hot100: usPeak(s, "US Billboard Hot 100") ?? s.key_peaks_original_era?.us ?? null,
      bubbling: usPeak(s, "US Bubbling Under Hot 100 (Billboard)") ?? s.discography_peaks?.["US Bub."] ?? null,
      radio: Object.fromEntries(RADIO.map(([c, l]) => [l, usPeak(s, c)])),
      club: usPeak(s, CLUB[0]),
      popDigital: usPeak(s, "US Pop Digital Songs (Billboard)"),
      hot100One: numberOneWeeks(hot100.number_ones, s, artist.name),
      digital: numberOneWeeks(hot100.digital_number_ones, s, artist.name, "weekly_sales"),
      streaming: numberOneWeeks(hot100.streaming_number_ones, s, artist.name, "weekly_streams"),
    };
  }

  // ----- header
  document.getElementById("kicker").textContent = `${artist.name} · Studio album${rx && !original ? " + reissue" : ""} · US charts`;
  document.getElementById("album-title").textContent = album.title;
  const coverEl = document.getElementById("album-cover");
  const coverImg = (c, alt, cls = "") => c ? `<a class="${cls}" href="${esc(c.page)}" target="_blank" rel="noopener"><img src="${esc(c.url)}" alt="${esc(alt)} cover"></a>` : "";
  if (album.cover) {
    coverEl.outerHTML = `<div class="album-cover ${rx && !original ? "pair" : ""}" id="album-cover">${coverImg(album.cover, album.title)}${rx && !original ? coverImg(rx.cover, rx.title, "rx") : ""}</div>`;
  } else coverEl.remove();
  coverAccent(full.cover?.direct).then((a) => applyAccent(a));
  if (rx) coverAccent(rx.cover?.direct).then((a) => applyAccent(a && { ...a, l: 0.36 }, "--rx"));
  const usCert = cert(album, "United States");
  const added = full.tracklist.filter((tr) => tr.edition === "reissue").length;
  const addedSingles = full.singles.filter((s) => s.edition === "reissue").length;
  document.getElementById("album-sub").innerHTML = rx && !original
    ? `Released <b>${fmt(album.release_date)}</b> · reissued as <i>${esc(rx.title.replace(album.title + ": ", ""))}</i> <b>${fmt(rx.release_date)}</b> · ${album.tracklist.length} tracks (${added} added) · ${album.singles.length} singles (${addedSingles} from the reissue)${usCert ? ` · RIAA <b>${esc(usCert)}</b>` : ""}`
    : `Released <b>${fmt(album.release_date)}</b> · ${esc(album.label)} · ${album.tracklist.length} tracks · ${album.singles.length} singles${usCert ? ` · RIAA <b>${esc(usCert)}</b>` : ""}`;
  document.getElementById("legend-rx").hidden = !(rx && !original);
  const sw = document.getElementById("edition-switch");
  if (rx) {
    sw.hidden = false;
    sw.innerHTML = [["original", `Original · ${album.release_date.slice(0, 4)}`], ["complete", `${rx.title.replace(full.title + ": ", "")} · ${rx.release_date.slice(0, 4)}`]]
      .map(([k, l]) => `<button type="button" data-ed="${k}" aria-pressed="${EDITION === k}">${esc(l)}</button>`).join("");
    sw.onclick = (e) => {
      const b = e.target.closest("button[data-ed]");
      if (!b || b.dataset.ed === EDITION) return;
      EDITION = b.dataset.ed;
      const u = new URL(location.href);
      if (EDITION === "original") u.searchParams.set("edition", "original"); else u.searchParams.delete("edition");
      history.replaceState(null, "", u);
      document.querySelectorAll(".more-btn").forEach((x) => x.remove());
      load().catch(console.error);
    };
  }
  const eraEnd = Math.max(...album.singles.map((s) => +s.date.slice(0, 4)));
  const streamingExists = eraEnd >= 2013; // Billboard's Streaming Songs chart began in January 2013
  document.getElementById("legend-stream").hidden = !streamingExists;
  const sum = (k) => songs.reduce((n, s) => n + us[s.id][k].weeks, 0);
  const stat = (v, l, top) => `<div class="stat ${top ? "top" : ""}"><b>${v ?? "—"}</b><span>${l}</span></div>`;
  document.getElementById("album-stats").innerHTML =
    stat(album.key_peaks.us, "Billboard 200 peak", album.key_peaks.us === 1) +
    stat(sum("hot100One"), "Wks at No. 1, Hot 100") +
    stat(sum("digital"), "Wks at No. 1, Digital") +
    (streamingExists ? stat(sum("streaming"), "Wks at No. 1, Streaming")
      : rx && !original ? stat(rx.key_peaks.us, "Billboard 200 peak, reissue") : stat("—", "Streaming chart began 2013")) +
    (streamingExists && rx && !original ? stat(rx.key_peaks.us, "Billboard 200 peak, reissue") : "");

  // ----- singles (official + promo-only), chronological
  const items = [
    ...album.singles.map((s) => ({ song: byId[s.song_id], date: s.date, label: `Single ${s.order}`, promo: false, reissue: s.edition === "reissue",
      promoDate: byId[s.song_id].promotional_release && byId[s.song_id].promotional_release < s.date ? byId[s.song_id].promotional_release : null })),
    ...songs.filter((s) => s.promotional_release && !s.single && s.promotional_release < cutoff).map((s) => ({ song: s, date: s.promotional_release, label: "Promo single", promo: true, reissue: rx && s.promotional_release >= rx.release_date })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const runs = hot100.top_ten.filter((r) => r.artist.includes(artist.name));
  const runFor = (song) => runs.filter((r) => r.title.toLowerCase() === song.title.toLowerCase());

  ctx = { byId, us, runFor, album, full, rx, original, streamingExists, artist };
  renderTimeline(album, items, runFor, us, original ? null : rx);

  // ----- the songs: every track in album order, reissue additions split out
  const songCard = (tr) => {
    const song = byId[tr.song_id];
    const u = us[song.id];
    const riaa = cert(song, "United States");
    const run = runFor(song)[0];
    const promo = !song.single && song.role === "promotional single";
    const reissue = tr.edition === "reissue";
    const cellsHtml = [["Pop", u.radio.Pop], ["Adult Pop", u.radio["Adult Pop"]], ["AC", u.radio.AC],
      ["Rhythmic", u.radio.Rhythmic], ["Digital #1", u.digital.weeks ? `${u.digital.weeks} wk${u.digital.weeks > 1 ? "s" : ""}` : null], streamingExists ? ["Stream #1", u.streaming.weeks ? `${u.streaming.weeks} wk${u.streaming.weeks > 1 ? "s" : ""}` : null] : ["Club", u.club]]
      .map(([l, v]) => `<div><span>${l}</span>${v ?? "—"}</div>`).join("");
    const albumCover = reissue && rx?.cover ? rx.cover : album.cover;
    const art = song.cover
      ? `<div class="art"><img src="${esc(song.cover.url)}" alt="${esc(song.title)} cover" loading="lazy"></div>`
      : albumCover ? `<div class="art album-art" title="No single cover on Wikipedia, album cover shown"><img src="${esc(albumCover.url)}" alt="" loading="lazy"><span>Album art</span></div>` : "";
    const role = song.single ? `Single ${song.single.order}` : promo ? "Promo single" : "Album track";
    const date = song.single ? song.single.date : promo && song.promotional_release < cutoff ? song.promotional_release : null;
    const promoDate = song.single && song.promotional_release && song.promotional_release < song.single.date ? song.promotional_release : null;
    const big = u.hot100 ? `#${u.hot100}` : u.bubbling ? `B${u.bubbling}` : "—";
    return `<div class="card ${song.single ? "" : promo ? "promo" : "track"} ${reissue ? "reissue" : ""}" data-song="${song.id}" tabindex="0" role="button" aria-label="Details for ${esc(song.title)}">
      ${art}
      <div class="ord">Track ${tr.track} · ${role}</div>
      <div class="ttl">${esc(song.title)}</div>
      <div class="dt">${date ? fmt(date) : `On the album ${fmt(reissue ? rx.release_date : album.release_date)}`}${promoDate ? ` · promo ${fmt(promoDate).replace(/, \d{4}$/, "")}` : ""}</div>
      <div class="big">${big}<small>${u.hot100 || !u.bubbling ? "HOT 100" : "BUBBLING UNDER"}</small></div>
      <div class="mini-peaks">${cellsHtml}</div>
      <div class="cert">${run ? `<b>${run.weeks_in_top_ten}</b> wks top ten · ` : ""}${u.digital.best ? `best sales wk <b>${esc(u.digital.best)}</b> · ` : ""}${riaa ? `RIAA <b>${esc(riaa)}</b>` : "No RIAA cert listed"}</div>
    </div>`;
  };
  const mainTracks = album.tracklist.filter((tr) => tr.edition !== "reissue");
  const rxTracks = album.tracklist.filter((tr) => tr.edition === "reissue");
  document.getElementById("singles").innerHTML = mainTracks.map(songCard).join("");
  const rxBand = document.getElementById("reissue-songs");
  rxBand.hidden = !rxTracks.length;
  if (rxTracks.length) {
    document.getElementById("reissue-title").textContent = `Added on ${rx.title}`;
    document.getElementById("reissue-date").textContent = fmt(rx.release_date);
    document.getElementById("reissue-cards").innerHTML = rxTracks.map(songCard).join("");
  }

  // ----- grid
  const head = `<thead>
    <tr><th></th><th></th><th></th><th class="n grp">Overall</th><th colspan="${RADIO.length}" class="grp">Radio airplay</th><th class="grp">Clubs</th><th colspan="${streamingExists ? 2 : 1}" class="grp">No. 1 weeks</th><th></th></tr>
    <tr><th class="n">#</th><th>Track</th><th>Role</th><th class="n">Hot 100</th>${RADIO.map(([, l]) => `<th class="n">${l}</th>`).join("")}<th class="n">${CLUB[1]}</th><th class="n">Digital</th>${streamingExists ? `<th class="n">Streaming</th>` : ""}<th>RIAA</th></tr>
  </thead>`;
  const cell = (p) => `<td class="cell ${tier(p)}">${p ?? "—"}</td>`;
  const ones = (n) => `<td class="cell ${n ? "t1" : "tnone"}">${n ? `${n} wk${n > 1 ? "s" : ""}` : "—"}</td>`;
  const ncols = 7 + RADIO.length + (streamingExists ? 1 : 0);
  let rxStarted = false;
  const rows = album.tracklist.map((tr) => {
    let sep = "";
    if (tr.edition === "reissue" && !rxStarted) {
      rxStarted = true;
      sep = `<tr class="sep"><td colspan="${ncols}">Added on <i>${esc(rx.title)}</i> · ${fmt(rx.release_date)}</td></tr>`;
    }
    const s = byId[tr.song_id];
    const u = us[s.id];
    const later = laterCharting(s);
    const role = s.single ? `<span class="role single">Single ${s.single.order}</span>`
      : s.role === "promotional single" ? `<span class="role promo">Promo</span>` : `<span class="role">Album track</span>`;
    const hot = u.hot100 == null && u.bubbling != null ? `<td class="cell t100">B${u.bubbling}</td>` : cell(u.hot100);
    const dig = u.digital.weeks ? ones(u.digital.weeks) : u.popDigital ? `<td class="cell t100" title="Pop Digital Songs">PD ${u.popDigital}</td>` : ones(0);
    return sep + `<tr class="${s.single || s.role === "promotional single" ? "" : "album-track"} ${tr.edition === "reissue" ? "rx-row" : ""}" data-song="${s.id}">
      <td class="n">${tr.track}</td>
      <td class="title">${esc(s.title)}${s.featuring ? ` <span class="mono">feat. ${esc(s.featuring)}</span>` : ""}${tr.edition === "deluxe" ? ` <span class="mono">deluxe</span>` : ""}${later.length ? ` <span class="role later">Charted again ${esc(later[0])}</span>` : ""}</td>
      <td>${role}</td>
      ${hot}${RADIO.map(([, l]) => cell(u.radio[l])).join("")}${cell(u.club)}${dig}${streamingExists ? ones(u.streaming.weeks) : ""}
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
      ${streamingExists ? `<td class="n">${u.streaming.weeks || "—"}</td><td class="n mono">${esc(u.streaming.best || "")}</td>` : ""}</tr>`;
  }).join("");
  document.getElementById("album-certs").innerHTML =
    `<thead><tr><th>Song</th><th class="n">Hot 100</th><th class="n">Digital</th><th class="n">Best sales wk</th>${streamingExists ? `<th class="n">Streaming</th><th class="n">Best streams wk</th>` : ""}</tr></thead><tbody>${oneRows}</tbody>`;

  // ----- US awards during the era
  const y0 = +album.release_date.slice(0, 4), y1 = eraEnd + 1;
  document.getElementById("awards-title").textContent = `US awards, ${y0}–${y1}`;
  const awards = [
    ...(album.awards || []).map((a) => ({ ...a, work: album.title })),
    ...songs.flatMap((s) => (s.awards || []).map((a) => ({ ...a, work: s.title }))),
  ].filter((a) => a.year && a.year >= y0 && a.year <= y1 && US_AWARDS.has(a.award))
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

function renderTimeline(album, items, runFor, us, rx) {
  const dates = items.map((i) => t(i.date));
  const runEnds = items.flatMap((i) => runFor(i.song).map((r) => t(lastTopTenWeek(r))));
  const W = 1400, L = 20, R = 20;
  const maxD = Math.max(...dates, ...runEnds) + 8 * 7 * DAY;
  // leave room on the left for the first single's label
  const first0 = Math.min(...dates, t(album.release_date));
  const needPx = Math.max(60, items[0].song.title.length * 8 + 30);
  const span = maxD - first0;
  const minD = first0 - Math.max(5 * 7 * DAY, (needPx * span) / (W - L - R - needPx));
  const x = (ms) => L + ((ms - minD) / (maxD - minD)) * (W - L - R);
  const rowH = 30, top = 70;
  const H = top + items.length * rowH + 52;
  const parts = [];

  let first = true;
  const monthsSpan = (maxD - minD) / (30 * DAY);
  const d0 = new Date(minD);
  for (let m = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1)); m.getTime() < maxD; m.setUTCMonth(m.getUTCMonth() + 1)) {
    const xx = x(m.getTime());
    const yr = m.getUTCMonth() === 0 || first;
    first = false;
    parts.push(`<line x1="${xx}" x2="${xx}" y1="40" y2="${H - 26}" stroke="${yr ? "var(--rule)" : "var(--hair)"}"/>`);
    const mon = m.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
    // long eras: year on its own line under January so labels don't collide
    if (monthsSpan > 20) {
      parts.push(`<text x="${xx + 4}" y="${H - 18}" font-size="11" fill="${yr ? "var(--ink)" : "var(--ink-2)"}">${mon}</text>`);
      if (yr) parts.push(`<text x="${xx + 4}" y="${H - 2}" font-size="12" font-weight="600" fill="var(--ink)">${m.getUTCFullYear()}</text>`);
    } else {
      parts.push(`<text x="${xx + 5}" y="${H - 8}" font-size="12" fill="${yr ? "var(--ink)" : "var(--ink-2)"}">${mon}${yr ? " " + m.getUTCFullYear() : ""}</text>`);
    }
  }

  // reissue: shade everything after it
  if (rx) {
    const rxx = x(t(rx.release_date));
    parts.unshift(`<rect x="${rxx}" y="18" width="${W - R - rxx}" height="${H - 44}" fill="var(--rx-bg)"/>`);
    parts.push(`<line x1="${rxx}" x2="${rxx}" y1="18" y2="${H - 26}" stroke="var(--rx)" stroke-width="2"/>`);
    parts.push(`<text x="${rxx + 8}" y="30" font-size="13" font-weight="600" fill="var(--rx)">${esc(rx.title.replace(album.title + ": ", "").toUpperCase())} · ${fmt(rx.release_date).toUpperCase()}</text>`);
  }
  // album release
  const ax = x(t(album.release_date));
  parts.push(`<line x1="${ax}" x2="${ax}" y1="18" y2="${H - 26}" stroke="var(--accent)" stroke-width="2"/>`);
  parts.push(`<text x="${ax + 8}" y="30" font-size="13" font-weight="600" fill="var(--accent)">ALBUM RELEASE · ${fmt(album.release_date).toUpperCase()}</text>`);

  items.forEach((it, k) => {
    const y = top + k * rowH;
    const xx = x(t(it.date));
    parts.push(`<g class="tl-row" data-song="${it.song.id}"><rect x="${L}" y="${y - rowH / 2}" width="${W - L - R}" height="${rowH}" fill="transparent"/>`);
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
      : `<rect x="${xx - 7}" y="${y - 7}" width="14" height="14" fill="${it.reissue ? "var(--rx)" : "var(--real)"}"/>`);
    const label = `${it.song.title.toUpperCase()}${it.promo ? " (PROMO)" : ""}`;
    const lw = label.length * 8;
    const anchorX = it.promoDate ? x(t(it.promoDate)) : xx;
    const left = anchorX - 14 - lw > L;
    parts.push(`<text x="${left ? anchorX - 14 : xx + 14}" y="${y + 4}" font-size="13" font-weight="600" text-anchor="${left ? "end" : "start"}" fill="${it.promo ? "var(--ink-2)" : "var(--ink)"}">${esc(label)}</text>`);
    parts.push(`</g>`);
  });

  document.getElementById("timeline").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Singles and their Hot 100 top-ten runs">${parts.join("")}</svg>`;
}

// ---------------------------------------------------------------- song detail panel
let ctx = null;
const chartLabel = (c) => c.replace(/^US /, "").replace(/ \(Billboard\)$/, "").replace(/^Billboard /, "");
const hlist = (v) => String(v || "").replace(/\{\{\s*(?:hlist|flatlist|ubl)\s*\|/gi, "").replace(/\}\}/g, "").split("|").map((x) => x.trim()).filter(Boolean).join(", ");

function openDetail(id) {
  const { byId, us, runFor, album, full, rx, streamingExists, artist } = ctx;
  const song = byId[id];
  if (!song) return;
  const u = us[id];
  const tr = full.tracklist.find((t) => t.song_id === id);
  const reissue = tr?.edition === "reissue";
  const runs = runFor(song);
  const run = runs[0];
  const role = song.single ? `Single ${song.single.order}` : song.role === "promotional single" ? "Promo single" : "Album track";
  const cover = song.cover || (reissue ? rx?.cover : album.cover);

  // every US chart in the original release window, best position per chart
  const best = {};
  for (const tb of originalTables(song)) for (const e of tb.entries) {
    if (!/^US /.test(e.chart) || !Number.isInteger(e.position)) continue;
    if (best[e.chart] == null || e.position < best[e.chart]) best[e.chart] = e.position;
  }
  if (u.hot100 && best["US Billboard Hot 100"] == null) best["US Billboard Hot 100"] = u.hot100;
  const peakRows = Object.entries(best).sort((a, b) => (b[0] === "US Billboard Hot 100") - (a[0] === "US Billboard Hot 100") || a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([c, p]) => `<tr><td>${esc(chartLabel(c))}</td><td class="cell ${tier(p)}">${p}</td></tr>`).join("");

  const yearEnd = (song.year_end_charts || []).flatMap((y) => y.entries.filter((e) => /^US /.test(e.chart)).map((e) => ({ ...e, year: y.year })))
    .filter((e) => +String(e.year).slice(0, 4) < 2020);
  const yeRows = yearEnd.map((e) => `<tr><td>${esc(e.year)} · ${esc(chartLabel(e.chart))}</td><td class="n">${esc(e.position)}</td></tr>`).join("");

  const usRelease = (song.release_history || []).filter((r) => /United States|Various|Worldwide/.test(r.region || "") && (!r.version || /original/i.test(r.version)))
    .map((r) => `<tr><td class="mono">${fmt(r.date)}</td><td>${esc(hlist(r.format))}</td></tr>`).join("");

  const usCerts = (song.certifications || []).filter((c) => c.region === "United States")
    .map((c) => `<tr><td>RIAA${c.type === "streaming only" ? " (streaming)" : ""}</td><td>${esc(c.certification || "—")}${c.units_reported ? ` <span class="mono">· ${esc(c.units_reported)}</span>` : ""}</td></tr>`).join("");

  const fact = (label, value) => `<div class="dfact"><span>${label}</span><b>${value ?? "—"}</b></div>`;
  const firstDate = song.single?.date || song.promotional_release || (reissue ? rx.release_date : album.release_date);
  const ones = u.hot100One.list.map((w) => w.week);
  const later = laterCharting(song);

  document.getElementById("detail-body").innerHTML = `
    <div class="dhead">
      ${cover ? `<img src="${esc(cover.url)}" alt="">` : ""}
      <div>
        <div class="kicker">Track ${tr?.track ?? "—"} · ${role}${reissue ? ` · ${esc(rx.title.replace(full.title + ": ", ""))}` : ""}</div>
        <h3>${esc(song.title)}</h3>
        ${song.featuring ? `<div class="mono">feat. ${esc(song.featuring)}</div>` : ""}
        <div class="sub">${song.single ? "Released as a single" : song.role === "promotional single" ? "Promo release" : "On the album"} <b>${fmt(firstDate)}</b>${song.length ? ` · ${esc(song.length)}` : ""}</div>
      </div>
    </div>
    <div class="dfacts">
      ${fact("Hot 100 peak", u.hot100 ? `#${u.hot100}` : u.bubbling ? `Bubbling Under #${u.bubbling}` : "Did not chart")}
      ${fact("Peak date", run ? fmt(run.peak_date) : "—")}
      ${fact("Weeks in top ten", run ? run.weeks_in_top_ten + (runs.length > 1 ? "+" : "") : "—")}
      ${fact("Top-ten entry", run ? fmt(run.entry_date) : "—")}
      ${fact("Weeks at No. 1", ones.length || "—")}
      ${fact("Digital Songs No. 1", u.digital.weeks ? `${u.digital.weeks} wk${u.digital.weeks > 1 ? "s" : ""}` : "—")}
      ${fact("Best sales week", u.digital.best ? esc(u.digital.best) : "—")}
      ${streamingExists ? fact("Streaming Songs No. 1", u.streaming.weeks ? `${u.streaming.weeks} wk${u.streaming.weeks > 1 ? "s" : ""}` : "—") : fact("Streaming Songs", "Chart began 2013")}
      ${fact("RIAA", esc(cert(song, "United States") || "—"))}
      ${fact("Current streams", `<span class="muted">Not in the data yet</span>`)}
    </div>
    ${ones.length ? `<p class="fine">No. 1 on the Hot 100: ${ones.map(fmt).join(", ")}</p>` : ""}
    ${later.length ? `<p class="fine">Charted again in ${esc(later.join(", "))}.</p>` : ""}
    <h4>US chart peaks</h4>
    ${peakRows ? `<table class="dtable">${peakRows}</table>` : `<p class="fine">No US chart entries on Wikipedia.</p>`}
    ${usRelease ? `<h4>US release</h4><table class="dtable">${usRelease}</table>` : ""}
    ${yeRows ? `<h4>US year-end</h4><table class="dtable">${yeRows}</table>` : ""}
    ${usCerts ? `<h4>Certification</h4><table class="dtable">${usCerts}</table>` : ""}
    ${song.lead ? `<h4>About</h4><p class="lead">${esc(song.lead)}</p>` : ""}
    <p class="fine"><a href="${esc((song.sources || [])[0] || "#")}" target="_blank" rel="noopener">Wikipedia article</a>${cover ? ` · <a href="${esc(cover.page)}" target="_blank" rel="noopener">cover file</a>` : ""}</p>`;
  const d = document.getElementById("detail");
  d.hidden = false;
  document.body.classList.add("detail-open");
  document.querySelectorAll("[data-song].on").forEach((x) => x.classList.remove("on"));
  document.querySelectorAll(`[data-song="${id}"]`).forEach((x) => x.classList.add("on"));
  d.querySelector(".dclose").focus({ preventScroll: true });
}

function closeDetail() {
  document.getElementById("detail").hidden = true;
  document.body.classList.remove("detail-open");
  document.querySelectorAll("[data-song].on").forEach((x) => x.classList.remove("on"));
}

document.addEventListener("click", (e) => {
  if (e.target.closest(".dclose") || e.target.id === "detail-scrim") return closeDetail();
  const el = e.target.closest("[data-song]");
  if (el && !e.target.closest("a, button")) openDetail(el.dataset.song);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeDetail();
  if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".card[data-song]")) { e.preventDefault(); openDetail(e.target.dataset.song); }
});

load().catch((e) => { document.getElementById("kicker").textContent = "Could not load data: " + e.message; });
