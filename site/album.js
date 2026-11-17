import { lastTopTenWeek } from "./lib/competition.js";

const DATA = "../data/";
const ALBUM_ID = new URLSearchParams(location.search).get("album") || "prism";
const DAY = 86400000;
const t = (iso) => Date.parse(iso + "T00:00:00Z");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (d) => d ? new Date(t(d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
const j = async (p) => { const r = await fetch(DATA + p); if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); };

const MARKETS = [["us", "US"], ["uk", "UK"], ["can", "CAN"], ["aus", "AUS"]];
const DISC_KEYS = { us: null, uk: "UK", can: "CAN", aus: "AUS" };

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

function peaksFor(song) {
  const kp = song.key_peaks_original_era;
  const out = {};
  for (const [k] of MARKETS) {
    out[k] = kp ? kp[k] : null;
    if (out[k] == null && song.discography_peaks && DISC_KEYS[k]) out[k] = song.discography_peaks[DISC_KEYS[k]] ?? null;
  }
  const bub = song.discography_peaks?.["US Bub."];
  return { ...out, bubbling: out.us == null && bub != null ? bub : null };
}

function laterCharting(song) {
  const years = (song.weekly_charts || [])
    .filter((tb) => !tb.version && tb.period && Math.min(...(tb.period.match(/\d{4}/g) || [9999]).map(Number)) >= 2020)
    .map((tb) => tb.period);
  return [...new Set(years)];
}

async function load() {
  const album = await j(`albums/${ALBUM_ID}.json`);
  const [artist, hot100, ...songs] = await Promise.all([
    j(`artists/${album.artist_id}.json`), j("charts/hot100.json"),
    ...album.tracklist.map((tr) => j(`songs/${tr.song_id}.json`)),
  ]);
  const byId = Object.fromEntries(songs.map((s) => [s.id, s]));
  document.title = `${album.title}`;

  // ----- header
  document.getElementById("kicker").textContent = `${artist.name} · Studio album`;
  document.getElementById("album-title").textContent = album.title;
  const usCert = cert(album, "United States");
  document.getElementById("album-sub").innerHTML =
    `Released <b>${fmt(album.release_date)}</b> · ${esc(album.label)} · ${album.tracklist.length} tracks · ${album.singles.length} singles${usCert ? ` · RIAA <b>${esc(usCert)}</b>` : ""}`;
  document.getElementById("album-stats").innerHTML = MARKETS.map(([k, label]) => {
    const p = album.key_peaks[k];
    return `<div class="stat ${p === 1 ? "top" : ""}"><b>${p ?? "—"}</b><span>${label} albums peak</span></div>`;
  }).join("");

  // ----- singles list (official + promo), chronological
  // one row per song that was promoted: official singles plus promo-only songs
  const items = [
    ...album.singles.map((s) => ({ song: byId[s.song_id], date: s.date, label: `Single ${s.order}`, promo: false, promoDate: byId[s.song_id].promotional_release })),
    ...songs.filter((s) => s.promotional_release && !s.single).map((s) => ({ song: s, date: s.promotional_release, label: "Promo single", promo: true })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  // match each single to its Hot 100 top-ten run(s)
  const runs = hot100.top_ten.filter((r) => r.artist.includes(artist.name));
  const runFor = (song) => runs.filter((r) => r.title.toLowerCase() === song.title.toLowerCase());

  renderTimeline(album, items, runFor);

  document.getElementById("singles").innerHTML = items.map(({ song, date, label, promo, promoDate }) => {
    const p = peaksFor(song);
    const us = cert(song, "United States");
    const run = runFor(song)[0];
    return `<div class="card ${promo ? "promo" : ""}">
      <div class="ord">${label}</div>
      <div class="ttl">${esc(song.title)}</div>
      <div class="dt">${fmt(date)}${promoDate ? ` · promo ${fmt(promoDate).replace(/, \d{4}$/, "")}` : ""}</div>
      <div class="big">${p.us ? `#${p.us}` : "—"}<small>HOT 100</small></div>
      <div class="mini-peaks">${MARKETS.slice(1).map(([k, l]) => `<div><span>${l}</span>${p[k] ?? "—"}</div>`).join("")}</div>
      <div class="cert">${run ? `<b>${run.weeks_in_top_ten}</b> wks in top ten · ` : ""}${us ? `RIAA <b>${esc(us)}</b>` : "No RIAA cert listed"}</div>
    </div>`;
  }).join("");

  // ----- heat table
  const head = `<thead><tr><th class="n">#</th><th>Track</th><th>Role</th><th class="n">Length</th>${MARKETS.map(([, l]) => `<th class="n">${l}</th>`).join("")}<th>RIAA</th></tr></thead>`;
  const rows = album.tracklist.map((tr) => {
    const s = byId[tr.song_id];
    const p = peaksFor(s);
    const later = laterCharting(s);
    const role = s.single ? `<span class="role single">Single ${s.single.order}</span>`
      : s.role === "promotional single" ? `<span class="role promo">Promo</span>` : `<span class="role">Album track</span>`;
    const cell = (k) => {
      if (k === "us" && p.us == null && p.bubbling != null) return `<td class="cell t100">B${p.bubbling}</td>`;
      return `<td class="cell ${tier(p[k])}">${p[k] ?? "—"}</td>`;
    };
    return `<tr class="${s.single || s.role === "promotional single" ? "" : "album-track"}">
      <td class="n">${tr.track}</td>
      <td class="title">${esc(s.title)}${s.featuring ? ` <span class="mono">feat. ${esc(s.featuring)}</span>` : ""}${tr.edition === "deluxe" ? ` <span class="mono">deluxe</span>` : ""}${later.length ? ` <span class="role" style="border-color:var(--accent);color:var(--accent)">Charted again ${esc(later[0])}</span>` : ""}</td>
      <td>${role}</td>
      <td class="n">${esc(s.length || "")}</td>
      ${MARKETS.map(([k]) => cell(k)).join("")}
      <td class="mono">${esc(cert(s, "United States") || "")}</td>
    </tr>`;
  }).join("");
  document.getElementById("tracks").innerHTML = head + `<tbody>${rows}</tbody>`;

  // ----- album certs: major markets, rest behind a toggle
  const MAJOR = ["United States", "United Kingdom", "Canada", "Australia", "Germany", "France", "Brazil", "Mexico"];
  const certs = (album.certifications || []).filter((c) => c.certification);
  const certRow = (c) => `<tr><td>${esc(c.region)}</td><td>${esc(c.certification)}</td><td class="n">${c.cert_year ?? ""}</td></tr>`;
  const major = MAJOR.map((r) => certs.find((c) => c.region === r)).filter(Boolean);
  const rest = certs.filter((c) => !MAJOR.includes(c.region));
  document.getElementById("album-certs").innerHTML =
    `<thead><tr><th>Region</th><th>Certification</th><th class="n">Year</th></tr></thead><tbody>${major.map(certRow).join("")}</tbody>` +
    `<tbody class="more" hidden>${rest.map(certRow).join("")}</tbody>`;
  addToggle("album-certs", `Show ${rest.length} more regions`);

  // ----- awards (album + songs, original era first)
  const awards = [
    ...(album.awards || []).map((a) => ({ ...a, work: album.title })),
    ...songs.flatMap((s) => (s.awards || []).map((a) => ({ ...a, work: s.title }))),
  ].filter((a) => a.year && a.year <= 2015).sort((a, b) => a.year - b.year || (a.result === "Won" ? -1 : 1));
  const won = awards.filter((a) => a.result === "Won");
  const nom = awards.filter((a) => a.result !== "Won");
  const awardRow = (a) => `<tr><td class="n">${a.year}</td><td>${esc(a.award)}<div class="mono">${esc(a.category || "")}</div></td><td>${esc(a.work)}</td><td class="status ${a.result === "Won" ? "climbing" : "past-peak"}">${esc(a.result)}</td></tr>`;
  document.getElementById("awards-summary").innerHTML =
    `<div class="stat top"><b>${won.length}</b><span>Won, 2013–15</span></div><div class="stat"><b>${awards.length}</b><span>Nominations</span></div>` +
    `<div class="stat"><b>${awards.filter((a) => a.award === "Grammy Awards").length}</b><span>Grammy noms</span></div>` +
    `<div class="stat"><b>${awards.filter((a) => a.award === "Grammy Awards" && a.result === "Won").length}</b><span>Grammy wins</span></div>`;
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

function renderTimeline(album, items, runFor) {
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
