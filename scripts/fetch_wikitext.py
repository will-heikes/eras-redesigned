"""Download raw wikitext snapshots from English Wikipedia.

Usage: python3 scripts/fetch_wikitext.py data/sources/eras/prism.json

Reads the "pages" list from an era source file and saves each page's raw
wikitext to data/sources/wikitext/<Page_Title>.txt. Uses index.php?action=raw
(the api.php endpoint is frequently rate limited from shared IPs), follows
#REDIRECT lines, and waits between requests.
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "sources", "wikitext")
UA = "EraResearchBot/0.1 (personal non-commercial research)"


def fetch(title):
    url = "https://en.wikipedia.org/w/index.php?" + urllib.parse.urlencode(
        {"title": title, "action": "raw"}
    )
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=30).read().decode("utf-8")


def main(config_path):
    with open(config_path) as f:
        cfg = json.load(f)
    pages = [cfg["album"]["page"]] + [s["page"] for s in cfg["songs"] if s.get("page")]
    pages += cfg.get("extra_pages", [])
    os.makedirs(OUT, exist_ok=True)
    for title in pages:
        text = fetch(title)
        m = re.match(r"#REDIRECT\s*\[\[([^\]]+)\]\]", text, re.I)
        if m:
            print(f"{title} redirects to {m.group(1)}; update the source file to use that title")
            text = fetch(m.group(1).replace(" ", "_"))
        with open(os.path.join(OUT, title + ".txt"), "w") as f:
            f.write(text)
        print("saved", title, len(text))
        time.sleep(2)


if __name__ == "__main__":
    main(sys.argv[1])
