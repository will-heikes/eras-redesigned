"""Fetch Billboard's weekly Hot 100 recap articles cited by our Wikipedia snapshots.

Usage: python3 scripts/fetch_billboard_recaps.py 2013-08-01 2014-12-31

Finds billboard.com articles cited in data/sources/wikitext/ whose title or URL
mentions the Hot 100 and whose cite date falls in the range, downloads each
once, and saves the article text to data/sources/billboard/ (git-ignored:
article text stays local; only extracted facts are committed).
"""
import glob
import html
import json
import os
import re
import sys
import time
import urllib.request
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_era_data import WIKI, parse_date  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "sources", "billboard")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"


def cited_articles():
    found = {}
    for f in glob.glob(os.path.join(WIKI, "*.txt")) + glob.glob(os.path.join(WIKI, "*", "*.txt")):
        text = open(f, errors="ignore").read()
        for m in re.finditer(r"\{\{\s*cite[^{}]*?url\s*=\s*(https?://(?:www\.)?billboard\.com/[^\s|}]+)[^{}]*?\}\}", text, re.I | re.S):
            cite, url = m.group(0), m.group(1).split("?")[0]
            d = re.search(r"\|\s*date\s*=\s*([^|}]+)", cite)
            t = re.search(r"\|\s*title\s*=\s*([^|}]+)", cite)
            title = t.group(1).strip() if t else ""
            if not re.search(r"hot[- ]100", url + title, re.I) or "/charts/" in url:
                continue
            raw = d.group(1).strip() if d else ""
            iso = parse_date(raw) or (raw if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw) else None)
            if not iso:
                continue
            key = re.sub(r"^https?://(www\.)?", "", url).rstrip("/")
            slug = re.sub(r"\W+", "-", key.split("/")[-1])[:80]
            found.setdefault(slug, {"date": iso, "title": title, "url": url.replace("http://", "https://")})
    return found


def article_text(page):
    """Title plus the article's paragraphs, with inline tags (links) removed."""
    page = re.sub(r"<script.*?</script>|<style.*?</style>|<noscript.*?</noscript>", "", page, flags=re.S)
    m = re.search(r"<title>(.*?)</title>", page, re.S)
    paras = []
    for p in re.findall(r"<p\b[^>]*>(.*?)</p>", page, re.S):
        t = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", p))).strip()
        if len(t) > 60:
            paras.append(t)
    return (html.unescape(m.group(1)).strip() if m else ""), paras


def main(start, end):
    os.makedirs(OUT, exist_ok=True)
    arts = {k: v for k, v in cited_articles().items() if start <= v["date"] <= end}
    print(len(arts), "cited articles in range")
    for slug, a in sorted(arts.items(), key=lambda kv: kv[1]["date"]):
        path = os.path.join(OUT, f"{a['date']}_{slug}.json")
        if os.path.exists(path):
            continue
        try:
            req = urllib.request.Request(a["url"], headers={"User-Agent": UA})
            page = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "ignore")
        except Exception as e:
            print("fail", a["url"], e)
            continue
        title, body = article_text(page)
        json.dump({**a, "page_title": title, "paragraphs": body}, open(path, "w"), indent=1, ensure_ascii=False)
        print("ok", a["date"], title[:70], len(body))
        time.sleep(2)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
