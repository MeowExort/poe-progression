# Path of Building data

Derived from https://github.com/PathOfBuildingCommunity/PathOfBuilding (MIT licence; the item
data itself is © Grinding Gear Games) by `scripts/extract-pob-data.mjs`.

- Commit: `77524f2d452011503827372699cefcbaeb831e54` (2026-11-22, Path of Building 2.68.1, game patch 3.30)
- `uniques.json` — every unique item with its base type and, where the source data has them,
  the league it belongs to, its drop source and its level requirement (`src/Data/Uniques`).
- `bases.json` — base item types with their class and level requirement (`src/Data/Bases`).

To refresh after a patch: check out the repository and run
`node scripts/extract-pob-data.mjs <path to checkout>`.
