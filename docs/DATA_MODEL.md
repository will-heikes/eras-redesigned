# Data model

Everything the site shows comes from plain JSON files in `data/`. Real history
lives in the artist, album and song files. Alternate eras (step 3) will point at
these files instead of copying them, so the real record stays the single source
of truth.

All facts are taken from English Wikipedia. Each file lists its `sources` and the
date the pages were `retrieved`. Nothing is estimated or projected.

```
data/
  artists/katy-perry.json      artist and their albums
  albums/prism.json            one album: tracklist, singles, charts, certs, awards
  songs/<song-id>.json         one file per track on the album
  charts/hot100.json           Hot 100 top-ten hits and number ones, 2013-2015
  sources/eras/prism.json      which Wikipedia pages feed this era
  sources/wikitext/*.txt       raw page snapshots the data was built from
```

## Artist

| Field | Meaning |
| --- | --- |
| `id`, `name` | Stable id used in other files, display name |
| `albums[]` | `album_id`, `title`, `release_date`, in release order |

## Album

| Field | Meaning |
| --- | --- |
| `release_date` | ISO date of the original release |
| `tracklist[]` | `track`, `song_id`, `title`, `edition` (`standard` or `deluxe`) |
| `singles[]` | Official singles in order: `order`, `title`, `date`, `song_id` |
| `key_peaks` | Best position on the four headline charts: `us` (Billboard 200), `uk`, `can`, `aus` |
| `weekly_charts[]` | Tables as they appear on Wikipedia: `period` (e.g. `2013-15`) and `entries[]` of `chart`, `position` |
| `year_end_charts[]` | `year` and `entries[]` |
| `certifications[]` | `region`, `certification`, optional `units_reported`, `cert_year`, `type` (`standard`, or `streaming only` for streaming-only certifications) |
| `awards[]` | `year`, `award`, `category`, `result` (`Won` or `Nominated`) |

## Song

| Field | Meaning |
| --- | --- |
| `track`, `edition`, `length`, `writers`, `producers`, `featuring` | From the album's track listing |
| `role` | `single`, `promotional single` or `album track` |
| `single` | For official singles: `order` and `date` (from the album's singles list) |
| `promotional_release` | Date of a promotional release, if any (Dark Horse, Walking on Air) |
| `first_release` | First release date from the song's infobox (album tracks use the album date) |
| `release_history[]` | Region, date, format and label rows: radio adds, CD releases, etc. |
| `key_peaks_original_era` | Best `us` / `uk` / `can` / `aus` position from chart tables before 2020 |
| `key_peaks_all_time` | Same, including later re-entries |
| `weekly_charts[]` | Each Wikipedia chart table with its `period`. A remix or other version is tagged with `version` and left out of key peaks |
| `year_end_charts[]`, `certifications[]`, `awards[]` | Same shape as the album |
| `discography_peaks` | For album tracks without their own article: peaks from the discography's "Other charted songs" table |
| `lead` | The article's opening paragraph, for on-screen context |

`null` means Wikipedia does not list that value. For example, Dark Horse has no
Australian peak because the ARIA chart treated it as ineligible at the time.

## Chart landscape (`charts/hot100.json`)

The competition a single faced. Built from Wikipedia's yearly "List of Billboard
Hot 100 top-ten singles" and "number ones" pages.

| Field | Meaning |
| --- | --- |
| `top_ten[]` | Every song that peaked in the top ten: `title`, `artist`, `entry_date` (first top-ten week), `peak`, `peak_date`, `weeks_in_top_ten`, `notes` (re-entries) |
| `number_ones[]` | `week`, `title`, `artist` for every chart week |

Dates are Billboard issue dates (Saturdays). Wikipedia gives total weeks in the
top ten, not the exit date, so the end of each run is estimated as entry date
plus weeks. Songs that left and re-entered are flagged and their runs are
approximate.

### Competition lookup

`site/lib/competition.js` answers "what would a single released on this date be
up against?": the number one that week, every song in the top ten with whether
it was climbing or past its peak, and the songs about to enter the top ten. Try
it from the command line:

```
node scripts/competition.mjs 2014-04-21      # Birthday's real radio date
node scripts/competition.mjs 2014-04-21 8    # look 8 weeks ahead instead of 12
```

## Refreshing or adding an era

```
python3 scripts/fetch_wikitext.py data/sources/eras/prism.json
python3 scripts/build_era_data.py data/sources/eras/prism.json
```

Rebuild the chart landscape for more years (fetch the matching list pages first):

```
python3 scripts/build_chart_landscape.py 2013 2014 2015
```

For a new album, copy `data/sources/eras/prism.json`, list the album page and a
page for each track that has its own article, then run the two commands.

## Alternate eras (`eras/`)

An alternate era only lists its singles. Everything else (peaks, competition)
is looked up from the real data, so a scenario can never contain made-up numbers.

```json
{
  "id": "prism-legendary-lovers-4th",
  "title": "Legendary Lovers as the fourth single",
  "album_id": "prism",
  "singles": [
    { "song_id": "roar", "date": "2013-08-10" },
    { "song_id": "legendary-lovers", "date": "2014-04-21" }
  ]
}
```

`eras/index.json` lists the scenarios for each album. The tool's Export JSON
button downloads a scenario in this format: save it into `data/eras/` and add
its id to the index to keep it.

## The tool (`site/`)

Open `site/index.html` through a local web server from the repository root,
for example `python3 -m http.server`, then visit `http://localhost:8000/site/` for the album page and `site/redesign.html` for the tool.
Edits made in the page are kept in that browser until you press Reset.
