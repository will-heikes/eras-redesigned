"""Collect 2013-2015 singles from peer artists' Wikipedia discographies.

Usage: python3 scripts/build_peer_singles.py 2013 2015

Reads data/sources/wikitext/discographies/*.txt and writes
data/charts/peer_singles.json: every single from those years that charted on
the US Billboard Hot 100, with its peak. Discographies give
the release year, not the date; add_release_dates.py fills dates in later.
"""
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_era_data import WIKI, DATA, clean, cell_value, strip_refs, wikitable_rows, wiki_url  # noqa: E402

US_HEADER = re.compile(r"\[\[(?:Billboard Hot 100)\|[^\]]*US[^\]]*\]\]|^US$", re.I)
BUBBLING = re.compile(r"Bubbling Under", re.I)


def title_and_link(raw):
    m = re.search(r'"\s*\[\[([^|\]]+)(?:\|([^\]]+))?\]\]\s*"', raw)
    if m:
        return (m.group(2) or m.group(1)).strip(), m.group(1).strip()
    m = re.search(r'"(.+?)"', clean(cell_value(raw)))
    return (m.group(1) if m else clean(cell_value(raw))), None


def featured(raw):
    m = re.search(r"\((?:featuring|with) (.+?)\)", clean(raw))
    return m.group(1) if m else None


def parse(path, y0, y1):
    page = os.path.basename(path)[:-4]
    artist = re.sub(r" (singles )?discography$", "", page.replace("_", " "))
    text = strip_refs(open(path).read())
    out = []
    for sec in re.finditer(r"^(={2,4})\s*(.*?)\s*\1\s*$", text, re.M):
        pass
    for tm in re.finditer(r"\{\|(.*?)\n\|\}", text, re.S):
        body = tm.group(1)
        if "Peak chart positions" not in body and "Peak chart" not in body:
            continue
        # which section is this table in? (lead vs featured vs promotional)
        before = text[:tm.start()]
        heads = re.findall(r"^={2,5}\s*(.*?)\s*={2,5}\s*$", before, re.M)
        section = " / ".join(clean(h) for h in heads[-2:]).lower()
        if "album" in section and "single" not in section:
            continue
        kind = "featured" if "featured" in section else "promotional" if "promotional" in section else \
            "other charted" if "other" in section else "lead"
        rows = wikitable_rows(body)
        if len(rows) < 3:
            continue
        h2 = rows[1]
        us_col = next((i for i, (r, h) in enumerate(h2) if h and US_HEADER.search(r.split("<br")[0].strip(" !|")) and not BUBBLING.search(r)), None)
        if us_col is None:
            us_col = next((i for i, (r, h) in enumerate(h2) if h and "Billboard Hot 100" in r), None)
        if us_col is None:
            continue
        for row in rows[2:]:
            if len(row) <= us_col or not row[0][1]:
                continue
            raw_title = row[0][0]
            title, link = title_and_link(raw_title)
            year_txt = clean(cell_value(row[1][0])) if len(row) > 1 else ""
            ym = re.match(r"(\d{4})", year_txt)
            if not ym or not (y0 <= int(ym.group(1)) <= y1) or not title:
                continue
            peak_txt = clean(cell_value(row[us_col][0]))
            peak = int(peak_txt) if peak_txt.isdigit() else None
            out.append({
                "title": title,
                "artist": artist,
                "featuring": featured(raw_title),
                "year": int(ym.group(1)),
                "hot100_peak": peak,
                "article": link,
                "source": wiki_url(page),
            })
    return out


def main(y0, y1):
    songs, seen = [], set()
    for path in sorted(glob.glob(os.path.join(WIKI, "discographies", "*.txt"))):
        for s in parse(path, y0, y1):
            key = (s["title"].lower(), s["year"])
            if key in seen:
                continue  # the same single listed by lead and featured artist
            seen.add(key)
            if s["hot100_peak"]:
                songs.append(s)
    songs.sort(key=lambda s: (s["year"], s["artist"], s["title"]))
    os.makedirs(os.path.join(DATA, "charts"), exist_ok=True)
    with open(os.path.join(DATA, "charts", "peer_singles.json"), "w") as f:
        json.dump({"years": [y0, y1], "singles": songs}, f, indent=2, ensure_ascii=False)
    charted = [s for s in songs if s["hot100_peak"]]
    print(f"{len(songs)} singles, {len(charted)} charted on the Hot 100")


if __name__ == "__main__":
    main(int(sys.argv[1]), int(sys.argv[2]))
