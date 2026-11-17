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
| `certifications[]` | `region`, `certification`, optional `units_reported`, `cert_year`, `type` |
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

## Refreshing or adding an era

```
python3 scripts/fetch_wikitext.py data/sources/eras/prism.json
python3 scripts/build_era_data.py data/sources/eras/prism.json
```

For a new album, copy `data/sources/eras/prism.json`, list the album page and a
page for each track that has its own article, then run the two commands.
