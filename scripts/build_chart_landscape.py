"""Build the Hot 100 chart landscape from Wikipedia's yearly lists.

Usage: python3 scripts/build_chart_landscape.py 2013 2014 2015

Reads data/sources/wikitext/List_of_Billboard_Hot_100_top-ten_singles_in_<year>.txt
and List_of_Billboard_Hot_100_number_ones_of_<year>.txt (fetch them with
fetch_wikitext.py or by hand) and writes data/charts/hot100.json:

  top_ten[]     every song that peaked inside the top ten in those years:
                entry date, peak, peak date, weeks in the top ten
  number_ones[] the number-one song for every chart week
"""
import json
import os
import re
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_era_data import (WIKI, DATA, MONTHS, clean, cell_value, strip_refs,  # noqa: E402
                            wikitable_rows, wiki_url)


def month_day(text, year):
    m = re.search(r"([A-Z][a-z]+)\s+(\d{1,2})", clean(text))
    if not m or m.group(1) not in MONTHS:
        return None
    return date(year, MONTHS[m.group(1)], int(m.group(2))).isoformat()


def song_title(raw):
    t = clean(cell_value(raw))
    t = re.sub(r"\{\{[^}]*\}\}", "", t)
    t = re.sub(r"\(#1\)", "", t)
    m = re.search(r'"(.+)"', t)
    return (m.group(1) if m else t).strip()


def to_int(raw):
    v = clean(cell_value(raw))
    return int(v) if v.isdigit() else None


def top_ten(year):
    page = f"List_of_Billboard_Hot_100_top-ten_singles_in_{year}"
    text = strip_refs(open(os.path.join(WIKI, page + ".txt")).read())
    m = re.search(r"==\s*Top-ten singles\s*==(.*?)\n===", text, re.S)
    table = re.search(r"\{\|(.*?)\n\|\}", m.group(1), re.S).group(1)
    out, entry_year = [], year
    for row in wikitable_rows(table):
        raws = [r for r, _ in row]
        if len(row) == 1 or any("colspan" in r for r in raws[:1]):
            ym = re.search(r"from (\d{4})", clean(raws[0]))
            if ym:
                entry_year = int(ym.group(1))
            continue
        if len(raws) < 6 or row[0][1]:  # header row
            continue
        entry, single, artist, peak, peak_date, weeks = raws[:6]
        notes = []
        if re.search(r"ref label\|ReEntry", single, re.I):
            notes.append("re-entered the top ten")
        out.append({
            "title": song_title(single),
            "artist": clean(cell_value(artist)),
            "entry_date": month_day(entry, entry_year),
            "peak": to_int(peak),
            "peak_date": month_day(peak_date, year),
            "weeks_in_top_ten": to_int(weeks),
            "notes": notes or None,
            "source": wiki_url(page),
        })
    return out


def number_ones(year):
    page = f"List_of_Billboard_Hot_100_number_ones_of_{year}"
    text = strip_refs(open(os.path.join(WIKI, page + ".txt")).read())
    m = re.search(r"==\s*Chart history\s*==(.*?)\n==[^=]", text, re.S)
    out = []
    for tm in re.finditer(r"\{\|(.*?)\n\|\}", m.group(1), re.S):
        body = tm.group(1)
        if "Issue date" not in body:
            continue
        for row in wikitable_rows(body):
            hdr = [i for i, (r, h) in enumerate(row) if h and "scope" in r and "row" in r]
            if not hdr:
                continue
            i = hdr[0]
            week = month_day(cell_value(row[i][0]), year)
            if not week or len(row) < i + 3:
                continue
            out.append({
                "week": week,
                "title": song_title(row[i + 1][0]),
                "artist": clean(cell_value(row[i + 2][0])),
                "source": wiki_url(page),
            })
    return out


def main(years):
    songs, seen = [], set()
    for y in years:
        for s in top_ten(y):
            key = (s["title"].lower(), s["artist"].lower(), s["peak_date"])
            if key not in seen:
                seen.add(key)
                songs.append(s)
    songs.sort(key=lambda s: (s["entry_date"] or "", s["title"]))
    ones = []
    for y in years:
        ones += number_ones(y)
    ones.sort(key=lambda w: w["week"])
    out = {
        "chart": "US Billboard Hot 100",
        "years": years,
        "note": "Top-ten entries come from Wikipedia's yearly top-ten lists. "
                "Dates are Billboard chart issue dates. weeks_in_top_ten counts all weeks, "
                "including any re-entry, so the end of a run is approximate.",
        "top_ten": songs,
        "number_ones": ones,
    }
    os.makedirs(os.path.join(DATA, "charts"), exist_ok=True)
    with open(os.path.join(DATA, "charts", "hot100.json"), "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f"wrote {len(songs)} top-ten songs and {len(ones)} number-one weeks")


if __name__ == "__main__":
    main([int(y) for y in sys.argv[1:]])
