import type { RelicInfo } from './relics'

/** What the player carries at one moment, reduced to what matters for counting loot. */
export interface InventorySnapshot {
  takenAt: number
  league: string | null
  characterClass: string | null
  level: number | null
  /** Null when the site did not report gold. */
  gold: number | null
  /** Stackable items: name → total count across all stacks. */
  stacks: Record<string, number>
  /** Everything else: item id → display name. The id survives moving the item around. */
  singles: Record<string, string>
  /** What is known about each item name seen: its picture and whether it is a currency item. */
  info: Record<string, ItemInfo>
  /** Sanctum relics by item id, with what is needed to price them. */
  relics: Record<string, RelicInfo>
}

export interface ItemInfo {
  icon: string | null
  currency: boolean
}

export interface RawLoot {
  gold: number
  lines: ({ name: string; count: number; relic?: RelicInfo & { itemId: string } } & ItemInfo)[]
}

/** The site's "frame type" of currency items. */
const CURRENCY_FRAME = 5
/** The site's "frame type" of unique items. */
const UNIQUE_FRAME = 3

interface SiteItem {
  id?: unknown
  inventoryId?: unknown
  name?: unknown
  typeLine?: unknown
  stackSize?: unknown
  maxStackSize?: unknown
  icon?: unknown
  frameType?: unknown
  baseType?: unknown
  rarity?: unknown
  identified?: unknown
  explicitMods?: unknown
}

/**
 * Modifier lines of an item. The site sends each as an object with a `description`;
 * older answers had plain strings.
 */
function modLines(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((mod) => (typeof mod === 'string' ? mod : text((mod as { description?: unknown } | null)?.description)))
    .filter(Boolean)
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/**
 * Reads the answer of the site's character items request. Only the main inventory counts:
 * equipped gear is not loot. Returns null when the answer is not a character at all.
 */
export function toSnapshot(body: unknown, takenAt: number): InventorySnapshot | null {
  if (!body || typeof body !== 'object') return null
  const { items, character, inventory } = body as {
    items?: unknown
    character?: { league?: unknown; class?: unknown; level?: unknown }
    inventory?: { gold?: unknown }
  }
  if (!Array.isArray(items)) return null

  const stacks: Record<string, number> = {}
  const singles: Record<string, string> = {}
  const info: Record<string, ItemInfo> = {}
  const relics: Record<string, RelicInfo> = {}
  for (const item of items as SiteItem[]) {
    if (!item || item.inventoryId !== 'MainInventory') continue
    const name = [text(item.name), text(item.typeLine)].filter(Boolean).join(' ')
    if (!name) continue
    info[name] = { icon: text(item.icon) || null, currency: item.frameType === CURRENCY_FRAME }
    if (typeof item.maxStackSize === 'number' || typeof item.stackSize === 'number') {
      stacks[name] = (stacks[name] ?? 0) + (typeof item.stackSize === 'number' ? item.stackSize : 1)
    } else if (typeof item.id === 'string') {
      singles[item.id] = name
      const baseType = text(item.baseType) || text(item.typeLine)
      const unique = item.rarity === 'Unique' || item.frameType === UNIQUE_FRAME ? text(item.name) || null : null
      if (item.identified === false) continue
      if (baseType.endsWith(' Relic')) {
        relics[item.id] = { baseType, unique, mods: modLines(item.explicitMods) }
      } else if (unique && baseType) {
        // A unique found on the way is priced like a unique relic: by its name on the trade site.
        relics[item.id] = { baseType, unique, mods: [] }
      }
    }
  }

  return {
    takenAt,
    league: text(character?.league) || null,
    characterClass: text(character?.class) || null,
    level: typeof character?.level === 'number' ? character.level : null,
    gold: typeof inventory?.gold === 'number' ? inventory.gold : null,
    stacks,
    singles,
    info,
    relics
  }
}

/** Everything that is in `after` but was not in `before`. Things that left the inventory are ignored. */
export function diffSnapshots(before: InventorySnapshot, after: InventorySnapshot): RawLoot {
  const gained = new Map<string, number>()
  const relics: RawLoot['lines'] = []
  for (const [name, count] of Object.entries(after.stacks)) {
    const more = count - (before.stacks[name] ?? 0)
    if (more > 0) gained.set(name, more)
  }
  for (const [id, name] of Object.entries(after.singles)) {
    if (id in before.singles) continue
    const relic = after.relics[id]
    // Two relics of one name can be worth very different amounts: each gets a line of its own.
    if (relic) relics.push({ name, count: 1, icon: after.info[name]?.icon ?? null, currency: false, relic: { ...relic, itemId: id } })
    else gained.set(name, (gained.get(name) ?? 0) + 1)
  }
  return {
    gold: before.gold != null && after.gold != null ? Math.max(0, after.gold - before.gold) : 0,
    lines: [
      ...[...gained].map(([name, count]) => ({
        name,
        count,
        icon: after.info[name]?.icon ?? null,
        currency: after.info[name]?.currency ?? false
      })),
      ...relics
    ]
  }
}

export function entryCount(snapshot: InventorySnapshot): number {
  return Object.keys(snapshot.stacks).length + Object.keys(snapshot.singles).length
}

/**
 * From the site's list of the account's characters, the name of the one that logged in last:
 * that is the character being played. Returns null when the answer is not such a list.
 */
export function lastPlayedCharacter(body: unknown): string | null {
  if (!Array.isArray(body)) return null
  let best: { name: string; at: number } | null = null
  for (const entry of body as { name?: unknown; lastLoginTime?: unknown }[]) {
    if (typeof entry?.name !== 'string' || typeof entry.lastLoginTime !== 'number') continue
    if (!best || entry.lastLoginTime > best.at) best = { name: entry.name, at: entry.lastLoginTime }
  }
  return best?.name ?? null
}
