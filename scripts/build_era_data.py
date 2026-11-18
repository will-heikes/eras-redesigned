"""Build artist, album and song JSON from saved Wikipedia wikitext.

Usage: python3 scripts/build_era_data.py data/sources/eras/prism.json

Only facts stated on the Wikipedia pages are written. Every record carries the
URL of the page it came from. Run fetch_wikitext.py first to refresh snapshots.
"""
import json
import os
import re
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WIKI = os.path.join(ROOT, "data", "sources", "wikitext")
DATA = os.path.join(ROOT, "data")

# {{single chart|CODE|...}} / {{album chart|CODE|...}} codes -> display name.
CHART_NAMES = {
    "Billboardhot100": "US Billboard Hot 100",
    "Billboard200": "US Billboard 200",
    "Billboardpopsongs": "US Pop Airplay (Billboard)",
    "Billboardadultpopsongs": "US Adult Pop Airplay (Billboard)",
    "Billboardadultcontemporary": "US Adult Contemporary (Billboard)",
    "Billboarddanceclubplay": "US Dance Club Songs (Billboard)",
    "Billboarddanceairplay": "US Dance/Mix Show Airplay (Billboard)",
    "Billboardrhythmic": "US Rhythmic Airplay (Billboard)",
    "Billboardrandbhiphopairplay": "US R&B/Hip-Hop Airplay (Billboard)",
    "Billboardlatinpopsongs": "US Latin Pop Airplay (Billboard)",
    "Billboardglobal200": "Billboard Global 200",
    "Billboardcanadianhot100": "Canada (Canadian Hot 100)",
    "BillboardCanada": "Canada (Canadian Hot 100)",
    "Canada": "Canada (Canadian Hot 100)",
    "Billboardcanadaac": "Canada AC (Billboard)",
    "Billboardcanadachrtop40": "Canada CHR/Top 40 (Billboard)",
    "Billboardcanadahotac": "Canada Hot AC (Billboard)",
    "Billboardeurodigital": "Euro Digital Songs (Billboard)",
    "Billboardjapanhot100": "Japan (Japan Hot 100)",
    "UK": "UK Singles (OCC)",
    "Scotland": "Scotland (OCC)",
    "Ireland": "Ireland (IRMA)",
    "Ireland2": "Ireland (IRMA)",
    "Australia": "Australia (ARIA)",
    "New Zealand": "New Zealand (Recorded Music NZ)",
    "Austria": "Austria (Ö3 Austria Top 40)",
    "Flanders": "Belgium (Ultratop 50 Flanders)",
    "Flanders Tip": "Belgium (Ultratip Bubbling Under Flanders)",
    "Wallonia": "Belgium (Ultratop 50 Wallonia)",
    "Wallonia Tip": "Belgium (Ultratip Bubbling Under Wallonia)",
    "Dutch40": "Netherlands (Dutch Top 40)",
    "Dutch100": "Netherlands (Single Top 100)",
    "Netherlands": "Netherlands (Album Top 100)",
    "Germany": "Germany (GfK)",
    "France": "France (SNEP)",
    "Switzerland": "Switzerland (Schweizer Hitparade)",
    "Sweden": "Sweden (Sverigetopplistan)",
    "Norway": "Norway (VG-lista)",
    "Denmark": "Denmark (Tracklisten)",
    "Finland": "Finland (Suomen virallinen lista)",
    "Finnishairplay": "Finland Airplay (Radiosoittolista)",
    "Finnishdownload": "Finland Download (Latauslista)",
    "Spain": "Spain (PROMUSICAE)",
    "Italy": "Italy (FIMI)",
    "Portugal": "Portugal (AFP)",
    "Portugaldigitalsongs": "Portugal Digital Songs (Billboard)",
    "Luxembourgdigitalsongs": "Luxembourg Digital Songs (Billboard)",
    "Greece": "Greece (IFPI)",
    "Poland": "Poland (Polish Airplay Top 100)",
    "Czech Republic": "Czech Republic (Rádio Top 100)",
    "Czech": "Czech Republic (ČNS IFPI)",
    "Czechdigital": "Czech Republic (Singles Digitál Top 100)",
    "Slovakia": "Slovakia (Rádio Top 100)",
    "Slovakdigital": "Slovakia (Singles Digitál Top 100)",
    "Slovakdigital2": "Slovakia (Singles Digitál Top 100)",
    "Hungary": "Hungary (Rádiós Top 40)",
    "Hungaryradio": "Hungary (Rádiós Top 40)",
    "Hungarysingle": "Hungary (Single Top 40)",
    "Hungarystream": "Hungary (Stream Top 40)",
    "CIS": "CIS Airplay (TopHit)",
    "Russiaradio": "Russia Airplay (TopHit)",
    "Ukraineradio": "Ukraine Airplay (TopHit)",
    "Romaniatvairplay": "Romania TV Airplay (Media Forest)",
    "Israelairplay": "Israel (Media Forest)",
    "Bulgaria": "Bulgaria (BAMP)",
    "Croatia": "Croatia (HDU)",
    "South Africa": "South Africa (EMA)",
}

ALBUM_CHART_NAMES = {
    "Canada": "Canada (Billboard Canadian Albums)",
    "BillboardCanada": "Canada (Billboard Canadian Albums)",
    "UK2": "UK Albums (OCC)",
    "UK": "UK Albums (OCC)",
    "Scotland": "Scotland Albums (OCC)",
    "Australia": "Australia (ARIA)",
    "Germany": "Germany (GfK)",
    "Germany4": "Germany (GfK)",
    "Netherlands": "Netherlands (Album Top 100)",
    "Billboard200": "US Billboard 200",
    "Flanders": "Belgium Albums (Ultratop Flanders)",
    "Wallonia": "Belgium Albums (Ultratop Wallonia)",
    "Hungary": "Hungary Albums (MAHASZ)",
    "Czech": "Czech Albums (ČNS IFPI)",
    "Slovakia": "Slovak Albums (ČNS IFPI)",
    "Poland": "Poland Albums (ZPAV)",
    "Croatia": "Croatia Albums (HDU)",
    "Greece": "Greece Albums (IFPI)",
    "Portugal": "Portugal Albums (AFP)",
    "Finland": "Finland Albums (Suomen virallinen lista)",
    "Denmark": "Denmark Albums (Hitlisten)",
    "Ireland": "Ireland Albums (IRMA)",
    "Austria": "Austria Albums (Ö3 Austria)",
}

# Charts surfaced as headline numbers on song and album cards.
KEY_SINGLE_CHARTS = {
    "US Billboard Hot 100": "us",
    "UK Singles (OCC)": "uk",
    "Canada (Canadian Hot 100)": "can",
    "Australia (ARIA)": "aus",
}
KEY_ALBUM_CHARTS = {
    "US Billboard 200": "us",
    "UK Albums (OCC)": "uk",
    "Canada (Billboard Canadian Albums)": "can",
    "Australia (ARIA)": "aus",
}

MONTHS = {m: i for i, m in enumerate(
    "January February March April May June July August September October November December".split(), 1)}


def wiki_url(page):
    return "https://en.wikipedia.org/wiki/" + page


def strip_refs(text):
    text = re.sub(r"<!--.*?-->", "", text, flags=re.S)
    text = re.sub(r"<ref[^>/]*/>", "", text)
    text = re.sub(r"<ref[^>]*>.*?</ref>", "", text, flags=re.S)
    return text


def strip_template_calls(text, names):
    """Remove {{name ...}} templates (nesting aware) for the given names."""
    out, i = [], 0
    pat = re.compile(r"\{\{\s*(" + "|".join(names) + r")\b", re.I)
    while True:
        m = pat.search(text, i)
        if not m:
            out.append(text[i:])
            return "".join(out)
        out.append(text[i:m.start()])
        depth, j = 0, m.start()
        while j < len(text):
            if text.startswith("{{", j):
                depth += 1
                j += 2
            elif text.startswith("}}", j):
                depth -= 1
                j += 2
                if depth == 0:
                    break
            else:
                j += 1
        i = j


def clean(text):
    """Wikitext fragment -> plain text."""
    text = strip_template_calls(text, ["efn", "sfn", "refn", "abbr\\|Ref"])
    text = re.sub(r"\{\{\s*nbsp\s*\}\}", " ", text, flags=re.I)
    text = re.sub(r"\{\{\s*(?:won|Won)\s*\}\}", "Won", text)
    text = re.sub(r"\{\{\s*(?:nom|Nom)\s*\}\}", "Nominated", text)
    text = re.sub(r"\{\{\s*pending\s*\}\}", "Pending", text, flags=re.I)
    text = re.sub(r"\{\{\s*(?:Screen reader-only|sro|nowrap|center)\|([^{}]*)\}\}", r"\1", text, flags=re.I)
    text = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", text)
    text = re.sub(r"\[https?://\S+ ([^\]]*)\]", r"\1", text)
    text = re.sub(r"'{2,}", "", text)
    text = re.sub(r"<br\s*/?>", " ", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("&nbsp;", " ").replace("&NoBreak;", "")
    return re.sub(r"\s+", " ", text).strip()


def cell_value(cell):
    """Drop a leading 'style=...|' attribute block from a table cell."""
    cell = cell.strip()
    m = re.match(r'^(?:[a-z\-]+\s*=\s*"?[^|"]*"?\s*)+\|(?!\|)(.*)$', cell, re.S)
    return (m.group(1) if m else cell).strip()


def sections(text):
    """Map lowercased heading -> body text (until the next heading of same or higher level)."""
    out = {}
    heads = list(re.finditer(r"^(={2,5})\s*(.*?)\s*\1\s*$", text, re.M))
    for k, h in enumerate(heads):
        level = len(h.group(1))
        end = len(text)
        for h2 in heads[k + 1:]:
            if len(h2.group(1)) <= level:
                end = h2.start()
                break
        out.setdefault(clean(h.group(2)).lower(), text[h.end():end])
    return out


def template_params(body):
    """Split a template body on top-level pipes -> (positional, named)."""
    parts, depth, cur = [], 0, ""
    i = 0
    while i < len(body):
        two = body[i:i + 2]
        if two in ("{{", "[["):
            depth += 1
            cur += two
            i += 2
            continue
        if two in ("}}", "]]"):
            depth -= 1
            cur += two
            i += 2
            continue
        if body[i] == "|" and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += body[i]
        i += 1
    parts.append(cur)
    pos, named = [], {}
    for p in parts:
        m = re.match(r"^\s*([\w\- ]+?)\s*=(.*)$", p, re.S)
        if m:
            named[m.group(1).strip().lower()] = m.group(2).strip()
        else:
            pos.append(p.strip())
    return pos, named


def find_templates(text, name):
    """Yield the inner body of each {{name|...}} (nesting aware)."""
    pat = re.compile(r"\{\{\s*" + name + r"\s*\|", re.I)
    for m in pat.finditer(text):
        depth, j = 0, m.start()
        while j < len(text):
            if text.startswith("{{", j):
                depth += 1
                j += 2
            elif text.startswith("}}", j):
                depth -= 1
                j += 2
                if depth == 0:
                    break
            else:
                j += 1
        yield text[m.end():j - 2]


def parse_date(raw):
    raw = clean(raw) if "{{" not in raw else raw
    m = re.search(r"\{\{\s*start date\s*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})", raw, re.I)
    if m:
        return date(*map(int, m.groups())).isoformat()
    raw = clean(raw)
    m = re.search(r"([A-Z][a-z]+) (\d{1,2}), (\d{4})", raw)
    if m and m.group(1) in MONTHS:
        return date(int(m.group(3)), MONTHS[m.group(1)], int(m.group(2))).isoformat()
    m = re.search(r"(\d{1,2}) ([A-Z][a-z]+) (\d{4})", raw)
    if m and m.group(2) in MONTHS:
        return date(int(m.group(3)), MONTHS[m.group(2)], int(m.group(1))).isoformat()
    return None


def infobox(text, kind):
    for body in find_templates(text, "Infobox " + kind):
        return template_params(body)[1]
    return {}


def to_int(v):
    v = clean(v).replace(",", "")
    m = re.match(r"^\d+$", v)
    return int(v) if m else None


def parse_tables(section_text):
    """Yield (period, [rows]) for each wikitable in a chart section.

    A row is {"chart": name, "peak"/"position": int or text}.
    """
    for tm in re.finditer(r"\{\|(.*?)\n\|\}", section_text, re.S):
        table = tm.group(1)
        period = None
        hm = re.search(r"Chart\s*\(([^)]*)\)", table)
        if hm:
            period = hm.group(1).replace("–", "-").strip()
        rows = []
        lines = table.split("\n")
        pending = None
        for line in lines:
            s = line.strip()
            tm2 = re.search(r"\{\{\s*(single|album) chart\s*\|", s, re.I)
            if tm2:
                is_album = tm2.group(1).lower() == "album"
                body = next(find_templates(s[tm2.start():], r"(?:single|album) chart"), None)
                if body is None:
                    continue
                pos, _ = template_params(body)
                if len(pos) >= 2:
                    code = pos[0]
                    name = (ALBUM_CHART_NAMES.get(code) if is_album else None) or CHART_NAMES.get(code, code)
                    rows.append({"chart": name, "value": clean(pos[1])})
                pending = None
            elif s.startswith("!") and "scope" in s and "row" in s:
                name = re.sub(r'^!\s*(?:[a-z]+\s*=\s*"?[^"|]*"?\s*)*\|', "", s)
                pending = clean(name)
                # value on the same line: "! scope=row | Name || 5"
                if "||" in pending:
                    pending, val = pending.split("||", 1)
                    rows.append({"chart": pending.strip(), "value": clean(cell_value(val))})
                    pending = None
            elif pending and s.startswith("|") and not s.startswith("|-") and not s.startswith("|}") and not s.startswith("|+"):
                rows.append({"chart": pending, "value": clean(cell_value(s[1:]))})
                pending = None
        out = []
        for r in rows:
            n = to_int(r["value"])
            out.append({"chart": r["chart"], "position": n if n is not None else r["value"]})
        if out:
            yield period, out


def chart_tables(section_text):
    """parse_tables, tagging tables that sit under a ==== "Version" ==== subheading."""
    out = []
    parts = re.split(r"^={4,}\s*(.*?)\s*={4,}\s*$", section_text, flags=re.M)
    version = None
    for k, part in enumerate(parts):
        if k % 2 == 1:
            version = clean(part).strip('"')
            continue
        for p, e in parse_tables(part):
            t = {"period": p, "entries": e}
            if version:
                t["version"] = version
            out.append(t)
    return out


def wikitable_rows(table):
    """Rowspan-aware wikitable parser -> list of rows, each a list of (raw, is_header)."""
    rows, carry = [], {}
    for chunk in re.split(r"\n\|-[^\n]*", table):
        cells = []
        for line in chunk.split("\n"):
            line = line.strip()
            if not line or line.startswith("|+") or line.startswith("{|"):
                continue
            if line[0] in "!|":
                hdr = line[0] == "!"
                sep = "!!" if hdr else "||"
                for c in line[1:].split(sep):
                    cells.append((c, hdr))
            elif cells:
                cells[-1] = (cells[-1][0] + "\n" + line, cells[-1][1])
        if not cells:
            continue
        row, col, it = [], 0, iter(cells)
        pending = list(cells)
        while pending or carry.get(col):
            if carry.get(col):
                raw, hdr, left = carry[col]
                row.append((raw, hdr))
                carry[col] = (raw, hdr, left - 1) if left > 1 else None
                col += 1
                continue
            raw, hdr = pending.pop(0)
            m = re.search(r'rowspan\s*=\s*"?(\d+)"?', raw.split("|")[0] if "|" in raw else "")
            if m and int(m.group(1)) > 1:
                carry[col] = (raw, hdr, int(m.group(1)) - 1)
            row.append((raw, hdr))
            col += 1
        rows.append(row)
    return rows


def parse_release_history(text):
    secs = sections(text)
    body = secs.get("release history", "")
    out = []
    for tm in re.finditer(r"\{\|(.*?)\n\|\}", body, re.S):
        rows = wikitable_rows(tm.group(1))
        if not rows:
            continue
        header = [clean(cell_value(r)).lower() for r, h in rows[0]]
        for row in rows[1:]:
            rec = {}
            for name, (raw, hdr) in zip(header, row):
                val = clean(cell_value(raw))
                if name.startswith(("region", "country")):
                    rec["region"] = val
                elif name.startswith("date"):
                    rec["date"] = parse_date(cell_value(raw))
                    if re.search(r"promotional", raw, re.I):
                        rec["promotional"] = True
                elif name.startswith("format"):
                    rec["format"] = val
                elif name.startswith("version"):
                    rec["version"] = val
                elif name.startswith("label"):
                    rec["label"] = val
            if rec.get("date"):
                out.append(rec)
    return out


def chart_section(secs, *names):
    for n in names:
        if n in secs:
            return secs[n]
    return ""


def parse_certifications(text):
    certs = []
    secs = sections(text)
    body = chart_section(secs, "certifications and sales", "certifications")
    category = "standard"
    for line in re.split(r"(?=\{\{\s*Certification Table)", body, flags=re.I):
        if re.match(r"\{\{\s*Certification Table Separator", line, re.I):
            m = re.search(r"title\s*=\s*([^|}]*)", line)
            category = clean(m.group(1)).lower() if m else category
            continue
        if not re.match(r"\{\{\s*Certification Table Entry", line, re.I):
            continue
        tb = next(find_templates(line, "Certification Table Entry"), None)
        if tb is None:
            continue
        _, p = template_params(tb)
        region = clean(p.get("region", ""))
        entry = {"region": region}
        if p.get("nocert", "").lower() == "true":
            entry["certification"] = None
        else:
            award = clean(p.get("award", ""))
            num = p.get("number", "").strip()
            entry["certification"] = (f"{num}× {award}" if num and num != "1" else award) or None
        if p.get("salesamount"):
            entry["units_reported"] = clean(p["salesamount"])
        if p.get("certyear"):
            entry["cert_year"] = int(p["certyear"]) if p["certyear"].strip().isdigit() else p["certyear"]
        entry["type"] = "streaming only" if (p.get("streamsonly", "").lower() == "true" or "stream" in category) else "standard"
        certs.append(entry)
    return certs


def parse_awards(text):
    secs = sections(text)
    body = secs.get("awards and nominations", "")
    awards = []
    for tm in re.finditer(r"\{\|(.*?)\n\|\}", body, re.S):
        award = year = None
        for row in re.split(r"\n\|-[^\n]*", tm.group(1)):
            lines = [l.strip() for l in row.strip().split("\n") if l.strip()]
            if not lines or lines[0].startswith("|+"):
                continue
            cells = []
            for l in lines:
                if l.startswith("!") and "scope" in l:
                    award = clean(re.sub(r'^!\s*(?:[a-z]+\s*=\s*"?[^"|]*"?\s*)*\|', "", l))
                elif l.startswith("!"):
                    continue
                elif l.startswith("|"):
                    for c in l[1:].split("||"):
                        cells.append(c)
            vals = [clean(cell_value(c)) for c in cells]
            result = None
            rest = []
            for v in vals:
                if v in ("Won", "Nominated", "Pending"):
                    result = v
                elif re.fullmatch(r"\d{4}", v):
                    year = int(v)
                elif v:
                    rest.append(v)
            if result and award:
                awards.append({"year": year, "award": award, "category": " / ".join(rest) or None, "result": result})
    return awards


def lead_paragraph(text):
    body = strip_template_calls(text, ["Infobox", "Short description", "Use ", "Good article", "pp-", "distinguish", "for", "about", "redirect", "other uses"])
    for para in body.split("\n\n"):
        p = para.strip()
        if p.startswith("'''") or p.startswith('"\'\'\''):
            return clean(p)
    return None


def key_peaks(tables, mapping, period_filter=None):
    out = {v: None for v in mapping.values()}
    for t in tables:
        if period_filter and not period_filter(t["period"]):
            continue
        if t.get("version"):
            continue
        for r in t["entries"]:
            k = mapping.get(r["chart"])
            if k and isinstance(r["position"], int):
                if out[k] is None or r["position"] < out[k]:
                    out[k] = r["position"]
    return out


def original_era(period):
    """True for chart tables covering the original release window (before 2020)."""
    if not period:
        return True
    years = [int(y) for y in re.findall(r"\d{4}", period)]
    return not years or min(years) < 2020


def cover_of(ib):
    """Wikipedia file name of the infobox cover, plus a URL that redirects to the image."""
    name = clean(ib.get("cover", "")).strip()
    if not name or not re.search(r"\.(png|jpe?g|gif|webp)$", name, re.I):
        return None
    return {"file": name, "url": "https://en.wikipedia.org/wiki/Special:FilePath/" + name.replace(" ", "_"),
            "page": "https://en.wikipedia.org/wiki/File:" + name.replace(" ", "_")}


def song_from_page(page, wiki):
    secs = sections(wiki)
    ib = infobox(wiki, "song")
    weekly = chart_tables(chart_section(secs, "weekly charts", "charts"))
    year_end = [{"year": p, "entries": e} for p, e in parse_tables(secs.get("year-end charts", ""))]
    return {
        "cover": cover_of(ib),
        "release_history": parse_release_history(wiki),
        "first_release": parse_date(ib.get("released", "")),
        "infobox_type": clean(ib.get("type", "")) or None,
        "genre": [g for g in (clean(x) for x in re.split(r"\n\*|\*|\|", ib.get("genre", ""))) if g] or None,
        "lead": lead_paragraph(wiki),
        "key_peaks_original_era": key_peaks(weekly, KEY_SINGLE_CHARTS, original_era),
        "key_peaks_all_time": key_peaks(weekly, KEY_SINGLE_CHARTS),
        "weekly_charts": weekly,
        "year_end_charts": year_end,
        "certifications": parse_certifications(wiki),
        "awards": parse_awards(wiki),
    }


def parse_tracklist(album_wiki):
    secs = sections(album_wiki)
    body = secs.get("track listing", "")
    tracks = []
    for tl in find_templates(body, "track listing"):
        _, p = template_params(tl)
        edition = clean(p.get("headline", "Standard edition")) or "Standard edition"
        n = 1
        while True:
            # track numbers continue across editions, so scan forward
            keys = [k for k in p if re.fullmatch(r"title\d+", k)]
            if not keys:
                break
            nums = sorted(int(k[5:]) for k in keys)
            for n in nums:
                writers = [clean(w) for w in re.findall(r"^\*\s*(.+)$", p.get(f"writer{n}", ""), re.M)]
                producers = [clean(w) for w in re.findall(r"^\*\s*(.+)$", p.get(f"extra{n}", ""), re.M)]
                tracks.append({
                    "track": n,
                    "title": clean(p[f"title{n}"]),
                    "note": clean(p.get(f"note{n}", "")) or None,
                    "length": clean(p.get(f"length{n}", "")) or None,
                    "writers": writers or None,
                    "producers": producers or None,
                    "edition": "deluxe" if "deluxe" in edition.lower() else "standard",
                })
            break
    return tracks


def album_singles(ib):
    misc = ib.get("misc", "")
    out = []
    for body in find_templates(misc, "Singles"):
        _, p = template_params(body)
        k = 1
        while f"single{k}" in p:
            out.append({"order": k, "title": clean(p[f"single{k}"]), "date": parse_date(p.get(f"single{k}date", ""))})
            k += 1
    return out


def discography_other_charted(disc_wiki, album_title):
    """Rows of the 'Other charted or certified songs' table for one album."""
    secs = sections(disc_wiki)
    body = secs.get("2010s", "")
    # the 2010s heading also exists under Singles; use the one in other charted songs
    m = re.search(r"==\s*Other charted or certified songs\s*==(.*?)(\n==[^=])", disc_wiki, re.S)
    if m:
        sub = re.search(r"===\s*2010s\s*===(.*?)(\n===|\Z)", m.group(1), re.S)
        body = sub.group(1) if sub else m.group(1)
    headers = []
    hm = re.search(r"colspan=\"?\d+\"?\s*\|\s*Peak chart positions(.*?)\n\|-", body, re.S)
    for line in body.split("\n"):
        if line.startswith("! scope=\"col\" style") or (line.startswith("!") and "width:2.5em" in line):
            mm = re.search(r"\[\[[^|\]]*\|([^\]]*)\]\]", line)
            headers.append(clean(mm.group(1)) if mm else clean(line.split("|")[-1]))
    rows = {}
    for row in re.split(r"\n\|-", body):
        rm = re.search(r'!\s*scope="row"\s*\|\s*"(.+?)"', row)
        if not rm:
            continue
        title = clean(rm.group(1))
        lines = [l for l in row.split("\n") if l.startswith("|") and "||" in l]
        if not lines:
            continue
        vals = [clean(v) for v in lines[0].lstrip("|").split("||")]
        vals = vals[-len(headers):] if headers else vals
        album_hit = album_title.lower() in row.lower()
        rows[title] = {"peaks": {h: (to_int(v) if to_int(v) is not None else None) for h, v in zip(headers, vals)}, "row_mentions_album": album_hit}
    return headers, rows


def main(config_path):
    with open(config_path) as f:
        cfg = json.load(f)
    read = lambda page: strip_refs(open(os.path.join(WIKI, page + ".txt")).read())

    # ---- album
    apage = cfg["album"]["page"]
    album_wiki = read(apage)
    secs = sections(album_wiki)
    ib = infobox(album_wiki, "album")
    tracks = parse_tracklist(album_wiki)
    singles = album_singles(ib)
    weekly = [{"period": p, "entries": e} for p, e in parse_tables(secs.get("weekly charts", ""))]
    for t in weekly:
        for r in t["entries"]:
            if r["chart"] == "UK":
                r["chart"] = "UK Albums (OCC)"
    year_end = [{"year": p, "entries": e} for p, e in parse_tables(secs.get("year-end charts", ""))]

    # ---- discography (album tracks without their own article)
    disc_wiki = read(cfg["artist"]["discography_page"])
    disc_headers, disc_rows = discography_other_charted(disc_wiki, cfg["album"]["title"])

    title_to_id = {s["title"].lower(): s["id"] for s in cfg["songs"]}
    single_by_title = {s["title"].lower(): s for s in singles}

    os.makedirs(os.path.join(DATA, "songs"), exist_ok=True)
    song_ids = []
    for s in cfg["songs"]:
        sid = s["id"]
        song_ids.append(sid)
        track = next((t for t in tracks if t["title"].lower() == s["title"].lower()), None)
        rec = {
            "id": sid,
            "title": s["title"],
            "artist_id": cfg["artist"]["id"],
            "album_id": cfg["album"]["id"],
            "track": track["track"] if track else None,
            "edition": track["edition"] if track else None,
            "featuring": track["note"].replace("featuring ", "") if track and track["note"] and track["note"].startswith("featuring") else None,
            "length": track["length"] if track else None,
            "writers": track["writers"] if track else None,
            "producers": track["producers"] if track else None,
        }
        sg = single_by_title.get(s["title"].lower())
        rec["single"] = {"order": sg["order"], "date": sg["date"], "source": wiki_url(apage)} if sg else None
        sources = [wiki_url(apage)]
        if s.get("page"):
            data = song_from_page(s["page"], read(s["page"]))
            rec.update(data)
            sources.insert(0, wiki_url(s["page"]))
        else:
            rec.update({"first_release": parse_date(ib.get("released", "")), "lead": None,
                        "weekly_charts": [], "year_end_charts": [], "certifications": [], "awards": []})
        dr = disc_rows.get(s["title"])
        if dr:
            rec["discography_peaks"] = {k: v for k, v in dr["peaks"].items()}
            sources.append(wiki_url(cfg["artist"]["discography_page"]) + "#Other_charted_or_certified_songs")
        if not s.get("page"):
            rec["key_peaks_original_era"] = None
            rec["key_peaks_all_time"] = None
        promo = any(r.get("promotional") for r in rec.get("release_history", [])) or (rec.get("infobox_type") or "").lower().startswith("promo")
        rec["role"] = "single" if sg else ("promotional single" if promo else "album track")
        rec["promotional_release"] = next((r["date"] for r in rec.get("release_history", []) if r.get("promotional")), None) or (rec.get("first_release") if promo and not sg else None)
        rec["sources"] = sources
        rec["retrieved"] = cfg.get("retrieved")
        with open(os.path.join(DATA, "songs", sid + ".json"), "w") as f:
            json.dump(rec, f, indent=2, ensure_ascii=False)

    album = {
        "id": cfg["album"]["id"],
        "title": cfg["album"]["title"],
        "artist_id": cfg["artist"]["id"],
        "release_date": parse_date(ib.get("released", "")),
        "cover": cover_of(ib),
        "label": clean(ib.get("label", "")) or None,
        "genre": clean(ib.get("genre", "")) or None,
        "length": clean(ib.get("length", "")) or None,
        "producers": [clean(x) for x in re.findall(r"^\*\s*(.+)$", ib.get("producer", ""), re.M)],
        "previous_album": clean(ib.get("prev_title", "")) or None,
        "next_album": clean(ib.get("next_title", "")) or None,
        "lead": lead_paragraph(album_wiki),
        "tracklist": [{"track": t["track"], "song_id": title_to_id.get(t["title"].lower()), "title": t["title"], "edition": t["edition"]} for t in tracks],
        "singles": [{**s, "song_id": title_to_id.get(s["title"].lower())} for s in singles],
        "key_peaks": key_peaks(weekly, KEY_ALBUM_CHARTS),
        "weekly_charts": weekly,
        "year_end_charts": year_end,
        "certifications": parse_certifications(album_wiki),
        "awards": parse_awards(album_wiki),
        "sources": [wiki_url(apage)],
        "retrieved": cfg.get("retrieved"),
    }
    os.makedirs(os.path.join(DATA, "albums"), exist_ok=True)
    with open(os.path.join(DATA, "albums", album["id"] + ".json"), "w") as f:
        json.dump(album, f, indent=2, ensure_ascii=False)

    artist_path = os.path.join(DATA, "artists", cfg["artist"]["id"] + ".json")
    os.makedirs(os.path.dirname(artist_path), exist_ok=True)
    artist = {"id": cfg["artist"]["id"], "name": cfg["artist"]["name"], "albums": []}
    if os.path.exists(artist_path):
        artist = json.load(open(artist_path))
    entry = {"album_id": album["id"], "title": album["title"], "release_date": album["release_date"]}
    artist["albums"] = [a for a in artist["albums"] if a["album_id"] != album["id"]] + [entry]
    artist["albums"].sort(key=lambda a: a["release_date"] or "")
    artist["sources"] = [wiki_url(cfg["artist"]["page"]), wiki_url(cfg["artist"]["discography_page"])]
    with open(artist_path, "w") as f:
        json.dump(artist, f, indent=2, ensure_ascii=False)
    print(f"wrote {len(song_ids)} songs, album {album['id']}, artist {artist['id']}")


if __name__ == "__main__":
    main(sys.argv[1])
