# Awakened PoE Trade data

`sanctum-stats.json` is derived from https://github.com/SnosMe/awakened-poe-trade (MIT, see `LICENSE`)
by `scripts/extract-apt-sanctum-stats.mjs`: the modifiers of Sanctum relics, each with the text
patterns it appears as on an item and the id the official trade site searches it by.

- Commit: `db3486768c770ed1cb3200f8941d112f44a1b536` (2026-11-22)
- Source file: `renderer/public/data/en/stats.ndjson`

To refresh after a patch: check out the repository and run
`node scripts/extract-apt-sanctum-stats.mjs <path to checkout>`.
