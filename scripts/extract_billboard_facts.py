"""Extract per-song chart facts from saved Billboard weekly Hot 100 recaps.

Usage: python3 scripts/extract_billboard_facts.py

Reads data/sources/billboard/*.json (from fetch_billboard_recaps.py) and writes
data/charts/billboard_weekly.json, keyed by chart week (the Saturday issue
date the article describes). For each song the article discusses, it records
positions and units on the Hot 100, Digital Songs, Streaming Songs, Radio Songs
and On-Demand Songs, with the short clause each fact came from so it can be
checked against the article.

This is pattern matching over prose, so it catches the common phrasings
("lifts 4-3 on the Hot 100", "No. 5 on Digital Songs (131,000, up 10 percent)")
and skips anything ambiguous rather than guessing.
"""
import glob
import json
import os
import re
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_era_data import DATA  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "sources", "billboard")

CHARTS = {
    "hot 100": "Hot 100",
    "digital songs": "Digital Songs",
    "streaming songs": "Streaming Songs",
    "radio songs": "Radio Songs",
    "on-demand songs": "On-Demand Songs",
    "on-demand streaming songs": "On-Demand Songs",
}
CHART_RE = r"(?:the\s+)?(?:Billboard\s+)?(Hot 100|Digital Songs|Streaming Songs|Radio Songs|On-Demand(?: Streaming)? Songs)"
SKIP_TITLES = re.compile(r"Ask Billboard|March Madness|Top 20 Billboard Hits|Year-End|Images", re.I)
QUOTE = re.compile(r"[“\"]([^”\"]{1,80}?)[,.]?[”\"]")
UNITS = re.compile(r"^\s*\(?([\d][\d.,]*)\s*(million|billion)?", re.I)
UNITS_WORDS = re.compile(r"(?:to|with) ([\d.,]+)\s*(million|billion)?\s*(?:U\.S\.\s*)?(downloads|streams|in audience|audience|all-format audience)", re.I)


def chart_week(pub):
    """Saturday issue date an article describes: the first Saturday after pub + 7 days."""
    d = date.fromisoformat(pub) + timedelta(days=7)
    return (d + timedelta(days=(5 - d.weekday()) % 7 or 7)).isoformat()


def units(text):
    m = UNITS.match(text) or UNITS_WORDS.search(text[:80])
    if not m:
        return None
    n = float(m.group(1).replace(",", ""))
    if m.group(2):
        n *= 1e6 if m.group(2).lower() == "million" else 1e9
    return int(n)


def known_titles():
    titles = set()
    h = json.load(open(os.path.join(DATA, "charts", "hot100.json")))
    for s in h["top_ten"]:
        titles.add(s["title"])
    for k in ("number_ones", "digital_number_ones", "streaming_number_ones"):
        for w in h.get(k, []):
            titles.add(w["title"])
    p = os.path.join(DATA, "charts", "peer_singles.json")
    if os.path.exists(p):
        titles |= {s["title"] for s in json.load(open(p))["singles"]}
    for f in glob.glob(os.path.join(DATA, "songs", "*.json")):
        titles.add(json.load(open(f))["title"])
    return {norm(t) for t in titles}


def norm(s):
    return s.replace("’", "'").replace("‘", "'")


def resolve(quote, titles, seen):
    q = norm(quote.strip().strip("“”\"'").rstrip(",."))
    ql = q.lower()
    for t in titles:
        if t.lower() == ql:
            return t
    # short references ("Me" for "All of Me", "Turn" for "Turn Down for What")
    for t in seen:
        words = re.findall(r"[\w'#!]+", t.lower())
        if ql in words or t.lower().startswith(ql + " ") or t.lower().endswith(" " + ql):
            return t
    if len(q) >= 3 and q[0].isupper():
        return q
    return None


def facts_from_article(a, titles):
    out = {}
    seen = []
    for para in a["paragraphs"]:
        if para.startswith("Related ") or "Subscribe" in para[:40]:
            continue
        current = None
        for sentence in re.split(r"(?<=[.!?])\s+(?=[A-Z“\"(])", para):
            # titles named in this sentence, by position
            named = []
            for m in QUOTE.finditer(sentence):
                if re.search(r"(?:from|album|LP|set|EP)\s*$", sentence[max(0, m.start() - 14):m.start()], re.I):
                    continue  # an album title, not a song
                t = resolve(m.group(1), titles, seen)
                if t:
                    named.append((m.start(), t))
                    if t not in seen:
                        seen.append(t)
            if not named and current is None:
                continue

            def song_at(pos):
                prior = [t for p, t in named if p <= pos]
                return prior[-1] if prior else (named[0][1] if named and not current else current)

            for clause_m in re.finditer(r"[^;]+", sentence):
                clause, base = clause_m.group(0), clause_m.start()
                # "X-Y on Chart" and "No. X on Chart" and "onto Chart at No. X"
                pats = [
                    (r"(\d{1,3})-(\d{1,3})\s+on\s+" + CHART_RE, "move"),
                    (r"No\.\s*(\d{1,3})(?:\s+(?:peak|highpoint|high|spot|slot|rank|position|perch|summit))?\s+on\s+" + CHART_RE, "pos"),
                    (r"(?:onto|enters|on|debuts on|bows on|arrives on)\s+" + CHART_RE + r"\s+at\s+No\.\s*(\d{1,3})", "pos2"),
                ]
                hits = []
                for pat, kind in pats:
                    for m in re.finditer(pat, clause):
                        if kind == "move":
                            frm, pos, chart = int(m.group(1)), int(m.group(2)), m.group(3)
                        elif kind == "pos":
                            frm, pos, chart = None, int(m.group(1)), m.group(2)
                        else:
                            frm, pos, chart = None, int(m.group(2)), m.group(1)
                        if pos > 100 or (frm and frm > 100):
                            continue
                        hits.append((m.start(), m.end(), frm, pos, CHARTS[chart.lower()]))
                # bare Hot 100 move: "blasts 83-37 with ..." when no other chart named right after
                for m in re.finditer(r"\b(?:lifts|climbs|jumps|rises|blasts|vaults|bounds|soars|surges|leaps|pushes|rockets|zooms|dips|slips|falls|drops|descends|backtracks|slides|holds|advances|ascends|steps|bullets|races|flies|lunges|rumbles|enters the top \w+)\s+\(?(\d{1,3})-(\d{1,3})\b\)?(?!\s+on\s)", clause):
                    frm, pos = int(m.group(1)), int(m.group(2))
                    if frm > 100 or pos > 100 or any(h[0] <= m.start() < h[1] for h in hits):
                        continue
                    # a chart named earlier in the sentence ("On Digital Songs, it slips 2-3") wins
                    prior = list(re.finditer(CHART_RE, sentence[:base + m.start()]))
                    chart = CHARTS[prior[-1].group(1).lower()] if prior else "Hot 100"
                    hits.append((m.start(), m.end(), frm, pos, chart))
                for start, end, frm, pos, chart in hits:
                    song = song_at(base + start)
                    if not song:
                        continue
                    rec = {"chart": chart, "position": pos}
                    if frm:
                        rec["previous"] = frm
                    u = units(clause[end - start + start:][:120] if False else clause[end:end + 120])
                    if u and chart != "Hot 100":
                        rec["units"] = u
                    snippet = clause.strip()
                    rec["clause"] = snippet[:220] + ("…" if len(snippet) > 220 else "")
                    lst = out.setdefault(song, [])
                    if not any(r["chart"] == chart for r in lst):
                        lst.append(rec)
            if named:
                current = named[-1][1]
    return out


def main():
    titles = known_titles()
    h100 = json.load(open(os.path.join(DATA, "charts", "hot100.json")))
    ones = {w["week"]: norm(w["title"]).lower() for w in h100["number_ones"]}
    weeks = {}
    for f in sorted(glob.glob(os.path.join(SRC, "*.json"))):
        a = json.load(open(f))
        if SKIP_TITLES.search(a.get("page_title", "") + " " + a.get("title", "")):
            continue
        wk = chart_week(a["date"])
        entry = weeks.setdefault(wk, {"articles": [], "songs": {}})
        entry["articles"].append({"date": a["date"], "title": a.get("title") or a.get("page_title"), "url": a["url"]})
        for song, facts in facts_from_article(a, titles).items():
            have = entry["songs"].setdefault(song, [])
            for r in facts:
                if r["chart"] == "Hot 100" and r["position"] == 1 and wk in ones and ones[wk] != song.lower():
                    continue  # contradicts the known No. 1 for that week: a misread
                if not any(h["chart"] == r["chart"] for h in have):
                    have.append(r)
    # the week's Hot 100 No. 1 is known from the number-ones list; fill it in when the prose phrasing was missed
    for wk, entry in weeks.items():
        if wk not in ones:
            continue
        title = next((t for t in entry["songs"] if t.lower() == ones[wk]), None)
        if title is None:
            title = next((w["title"] for w in h100["number_ones"] if w["week"] == wk), None)
            entry["songs"][title] = []
        if not any(f["chart"] == "Hot 100" for f in entry["songs"][title]):
            entry["songs"][title].insert(0, {"chart": "Hot 100", "position": 1, "clause": "From the Hot 100 number-ones list (Wikipedia)."})
    out = {
        "note": "Facts extracted from Billboard's weekly Hot 100 recap articles (cited by Wikipedia). "
                "Keys are chart weeks (Saturday issue dates). Units: downloads for Digital Songs, "
                "U.S. streams for Streaming/On-Demand Songs, audience impressions for Radio Songs.",
        "weeks": dict(sorted(weeks.items())),
    }
    json.dump(out, open(os.path.join(DATA, "charts", "billboard_weekly.json"), "w"), indent=1, ensure_ascii=False)
    n = sum(len(w["songs"]) for w in weeks.values())
    f = sum(len(v) for w in weeks.values() for v in w["songs"].values())
    print(f"{len(weeks)} chart weeks, {n} song-weeks, {f} facts")


if __name__ == "__main__":
    main()
