"""Fill release dates for charted peer singles from each single's Wikipedia article.

Usage: python3 scripts/add_release_dates.py [--fetch]

With --fetch, downloads missing articles to data/sources/wikitext/singles/
(index.php?action=raw, about one request a second). Then reads the infobox
"released" field of each article and writes release_date into
data/charts/peer_singles.json. Articles that link to a section of a page
(a cover or remix version) are skipped, since their infobox describes a
different release.
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_era_data import WIKI, DATA, infobox, parse_date, strip_refs  # noqa: E402

UA = "EraResearchBot/0.1 (personal non-commercial research)"
DIR = os.path.join(WIKI, "singles")


def safe(name):
    return re.sub(r"[^\w\-().,'!&]+", "_", name)[:150]


def fetch(title):
    url = "https://en.wikipedia.org/w/index.php?" + urllib.parse.urlencode({"title": title, "action": "raw"})
    try:
        return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=30).read().decode()
    except Exception:
        return None


def main(do_fetch):
    path = os.path.join(DATA, "charts", "peer_singles.json")
    data = json.load(open(path))
    os.makedirs(DIR, exist_ok=True)
    found = 0
    for s in data["singles"]:
        s.pop("release_date", None)
        if not s.get("hot100_peak") or not s.get("article") or "#" in s["article"]:
            continue
        f = os.path.join(DIR, safe(s["article"]) + ".txt")
        if not os.path.exists(f) and do_fetch:
            text = fetch(s["article"])
            m = text and re.match(r"#REDIRECT\s*\[\[([^\]#]+)\]\]", text, re.I)
            if m:
                text = fetch(m.group(1))
            if text:
                open(f, "w").write(text)
            time.sleep(1)
        if not os.path.exists(f):
            continue
        ib = infobox(strip_refs(open(f).read()), "song")
        d = parse_date(ib.get("released", "")) if ib else None
        if d and int(d[:4]) < s["year"] - 1:
            d = None  # infobox describes an earlier release (e.g. the album), not this single
        if d:
            s["release_date"] = d
            s["release_source"] = "https://en.wikipedia.org/wiki/" + s["article"].replace(" ", "_")
            found += 1
    json.dump(data, open(path, "w"), indent=2, ensure_ascii=False)
    print(f"release dates for {found} singles")


if __name__ == "__main__":
    main("--fetch" in sys.argv)
