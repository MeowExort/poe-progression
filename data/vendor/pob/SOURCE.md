# Path of Building data

Derived from https://github.com/PathOfBuildingCommunity/PathOfBuilding (MIT licence; the item
data itself is © Grinding Gear Games) by `scripts/extract-pob-data.mjs`.

- Commit: `77524f2d452011503827372699cefcbaeb831e54` (2026-11-22, Path of Building 2.68.1, game patch 3.30)
- `uniques.json` — every unique item with its base type and, where the source data has them,
  the league it belongs to, its drop source and its level requirement (`src/Data/Uniques`).
- `bases.json` — base item types with their class, level requirement, attribute requirements,
  tags and, for armour, which defences the base has (`src/Data/Bases`).
- `mods.json` — the modifiers rare items can roll (with the level they need, their spawn weight
  per item tag and their tags), essences with the modifier each gives per item type, and the
  crafting bench options (`src/Data/ModExplicit.lua`, `ModVeiled.lua`, `ModDelve.lua`,
  `Essence.lua`, `ModMaster.lua`), by `scripts/extract-pob-mods.mjs`.
- `tree.json` — the passive tree of 3.30 as a graph: every node with its name, kind, stats and
  links, plus the class starts (`src/TreeData/3_30/tree.lua`), by `scripts/extract-pob-tree.mjs`.

To refresh after a patch: check out the repository and run
`node scripts/extract-pob-data.mjs <path to checkout>`,
`node scripts/extract-pob-mods.mjs <path to checkout>` and
`node scripts/extract-pob-tree.mjs <path to checkout>/src/TreeData/<version>/tree.lua <version>`.
