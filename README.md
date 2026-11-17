# Eras Redesigned

A historical database of pop eras, plus a tool for building alternate eras:
different singles, different release dates, and the chart competition each one
would have faced. Built for presenting on screen.

The first era is Katy Perry's *Prism* (2013–2015).

- `data/` holds real, sourced history (artist, album, songs). See [docs/DATA_MODEL.md](docs/DATA_MODEL.md).
- `scripts/` rebuilds that data from Wikipedia.

Chart, certification and award data is drawn from English Wikipedia, available under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Each data file links the articles it came from.
