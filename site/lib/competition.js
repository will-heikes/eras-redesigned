// What a song released on a given date would have competed against on the
// Billboard Hot 100. Works in the browser and in Node (ES module, no deps).
//
// hot100 is the parsed data/charts/hot100.json.

const DAY = 86400000;
const toTime = (iso) => Date.parse(iso + "T00:00:00Z");
const toIso = (t) => new Date(t).toISOString().slice(0, 10);

// Billboard issue dates fall on Saturdays. Snap a date to the issue on or after it.
export function chartWeekOf(iso) {
  const t = toTime(iso);
  const dow = new Date(t).getUTCDay(); // 6 = Saturday
  return toIso(t + ((6 - dow + 7) % 7) * DAY);
}

const weeksBetween = (a, b) => Math.round((toTime(b) - toTime(a)) / (7 * DAY));

// Approximate last top-ten week: assumes a continuous run. Songs flagged as
// re-entries may have had gaps.
export const lastTopTenWeek = (s) => toIso(toTime(s.entry_date) + (s.weeks_in_top_ten - 1) * 7 * DAY);

function describe(song, week) {
  const toPeak = weeksBetween(week, song.peak_date);
  let status;
  if (toPeak > 0) status = "climbing";
  else if (toPeak === 0) status = "at peak";
  else status = "past peak";
  return {
    title: song.title,
    artist: song.artist,
    peak: song.peak,
    peak_date: song.peak_date,
    entry_date: song.entry_date,
    weeks_in_top_ten: song.weeks_in_top_ten,
    approx_last_top_ten_week: lastTopTenWeek(song),
    status,
    weeks_to_peak: toPeak, // negative = weeks since peak
    approximate_run: Boolean(song.notes && song.notes.length),
  };
}

// options.lookaheadWeeks: how far ahead to list songs that had not yet reached
// the top ten (a new single usually takes weeks to climb). Default 12.
export function competitionOn(dateIso, hot100, options = {}) {
  const lookahead = options.lookaheadWeeks ?? 12;
  const week = chartWeekOf(dateIso);
  const horizon = toIso(toTime(week) + lookahead * 7 * DAY);

  const inTopTen = hot100.top_ten
    .filter((s) => s.entry_date <= week && lastTopTenWeek(s) >= week)
    .map((s) => describe(s, week))
    .sort((a, b) => a.peak - b.peak || b.weeks_in_top_ten - a.weeks_in_top_ten);

  const arriving = hot100.top_ten
    .filter((s) => s.entry_date > week && s.entry_date <= horizon)
    .map((s) => ({ ...describe(s, week), weeks_until_top_ten: weeksBetween(week, s.entry_date) }))
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date));

  const numberOnes = hot100.number_ones.filter((w) => w.week >= week && w.week <= horizon);
  const numberOne = numberOnes.find((w) => w.week === week) || null;

  return {
    date: dateIso,
    chart_week: week,
    lookahead_until: horizon,
    number_one: numberOne,
    digital_number_one: (hot100.digital_number_ones || []).find((w) => w.week === week) || null,
    streaming_number_one: (hot100.streaming_number_ones || []).find((w) => w.week === week) || null,
    in_top_ten: inTopTen,
    arriving_in_top_ten: arriving,
    number_ones_ahead: numberOnes,
  };
}

// Singles by other artists released within `before` weeks before and `after`
// weeks after a date, with their eventual Hot 100 peak. Strongest first.
// peers is the parsed data/charts/peer_singles.json.
export function peerReleasesAround(dateIso, peers, { before = 8, after = 8, exclude = "" } = {}) {
  const t0 = toTime(dateIso);
  return (peers?.singles || [])
    .filter((s) => s.release_date && (!exclude || !s.artist.includes(exclude)))
    .map((s) => ({ ...s, weeks_from_release: Math.round((toTime(s.release_date) - t0) / (7 * DAY)) }))
    .filter((s) => s.weeks_from_release >= -before && s.weeks_from_release <= after)
    .sort((a, b) => a.hot100_peak - b.hot100_peak || a.release_date.localeCompare(b.release_date));
}

// Strength tier from an eventual Hot 100 peak.
export function strength(peak) {
  if (peak == null) return "unknown";
  if (peak <= 10) return "high";
  if (peak <= 40) return "medium";
  return "low";
}
