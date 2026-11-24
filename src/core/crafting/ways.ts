import type { ModSourcing, PobItem, PobMod, Way } from '@shared/plan'
import { BENCH, ESSENCES, GENESIS, METHODS, MODS, type BaseData, type FossilData, type ModData } from './data'
import { itemTags, matchLines, spawnWeight, statKey, statRanges, tiersOf, TOP_ITEM_LEVEL, type MatchedMod } from './match'

const POB_REF = { label: 'данные Path of Building', url: 'https://github.com/PathOfBuildingCommunity/PathOfBuilding' }
const FOSSILS_SHOWN = 2

function percent(share: number): string {
  if (share <= 0) return '0%'
  const value = share * 100
  if (value < 0.1) return 'меньше 0,1%'
  return `${value >= 10 ? Math.round(value) : value.toFixed(1).replace('.', ',')}%`
}

/** A chance as the start of a sentence: "Примерно 9,2%" or "Меньше 0,1%". */
function about(share: number): string {
  const text = percent(share)
  return text.startsWith('меньше') ? `М${text.slice(1)}` : `Примерно ${text}`
}

/** A fossil or a craft is worth listing when it raises the chance by at least this much. */
const WORTHWHILE = 1.25

const affixWord = (type: ModData['type']): string => (type === 'Prefix' ? 'префикс' : 'суффикс')

interface Context {
  base: BaseData | undefined
  tags: Set<string>
  itemLevel: number
  /** Tags of the item's other modifiers: a fossil that forbids one of them cannot be used. */
  otherTags: Set<string>
}

/** Everything that can roll on the item at its level without help, of one affix type or of both. */
function pool(context: Context, type: ModData['type'] | null): { mod: ModData; weight: number }[] {
  const entries: { mod: ModData; weight: number }[] = []
  for (const mod of Object.values(MODS)) {
    if (mod.source || (type && mod.type !== type) || mod.level > context.itemLevel) continue
    const weight = spawnWeight(mod, context.tags)
    if (weight > 0) entries.push({ mod, weight })
  }
  return entries
}

/** How a fossil changes the weight of a modifier with these tags. */
function fossilFactor(fossil: FossilData, tags: string[]): number {
  const has = (list: string[] | undefined): boolean => !!list?.some((tag) => tags.includes(tag))
  if (has(fossil.none)) return METHODS.fossilFactor.none
  let factor = 1
  if (has(fossil.more)) factor *= fossil.moreFactor ?? METHODS.fossilFactor.more
  if (has(fossil.fewer)) factor *= METHODS.fossilFactor.fewer
  return factor
}

function benchWay(mod: ModData | null, line: PobMod, base: BaseData | undefined): Way | null {
  const key = statKey(line.text)
  // The same modifier as on the item: a craft that adds a second stat to it is another modifier.
  const shape = mod ? mod.stats.map(statKey).join('|') : key
  const options = BENCH.filter(
    (craft) => (!base || craft.types.includes(base.type)) && craft.stats.map(statKey).join('|') === shape
  ).sort((a, b) => b.level - a.level)
  const best = options[0]
  if (!best) return null
  // Enough when the best the bench can give reaches the lowest value the build asks for.
  const wanted = statRanges(line.text)[0]
  const offered = statRanges(best.stats[0])[0]
  const enough = line.crafted || !wanted || !offered || offered[1] >= wanted[0]
  return {
    id: 'bench',
    kind: 'bench',
    title: 'Станок в убежище',
    details: [
      `Лучший вариант станка: ${best.stats.join(' / ')}.`,
      enough ? 'Этого хватает для значения из билда.' : 'Это слабее, чем значение в билде.',
      'Рецепт сначала нужно открыть; занимает слот крафта — на вещи может быть один такой мод.'
    ],
    tone: enough ? 'good' : 'info',
    ref: POB_REF
  }
}

function essenceWay(matched: MatchedMod, base: BaseData | undefined): Way | null {
  if (!base) return null
  const shape = matched.mod.stats.map(statKey).join('|')
  const same = ESSENCES.map((essence) => ({ essence, mod: MODS[essence.mods[base.type] ?? ''] }))
    .filter((entry) => entry.mod && entry.mod.group === matched.mod.group && entry.mod.stats.map(statKey).join('|') === shape)
    .sort((a, b) => a.essence.tier - b.essence.tier)
  if (!same.length) return null
  const wanted = statRanges(matched.mod.stats[0])[0]
  const reaches = (mod: ModData): boolean => {
    const offered = statRanges(mod.stats[0])[0]
    return !wanted || !offered || offered[1] >= wanted[0]
  }
  const enough = same.find((entry) => reaches(entry.mod))
  const shown = enough ?? same[same.length - 1]
  return {
    id: 'essence',
    kind: 'essence',
    title: `Эссенция: ${shown.essence.name}`,
    details: [
      `Гарантирует на этой базе: ${shown.mod.stats.join(' / ')}. Остальные моды выпадают случайно.`,
      enough
        ? 'Это самая младшая эссенция, которой хватает для значения из билда.'
        : 'Даже старшая эссенция даёт меньше, чем значение в билде.'
    ],
    tone: enough ? 'good' : 'info',
    ref: POB_REF
  }
}

/** The ways to get one modifier of a rare item, with what it is in the game's terms. */
function describeMod(line: PobMod, index: number, matched: MatchedMod | null, context: Context): ModSourcing {
  const result: ModSourcing = {
    key: `mod${index}`,
    text: line.text,
    crafted: line.crafted,
    fractured: line.fractured,
    affix: matched?.mod.type ?? null,
    tier: null,
    tiers: null,
    level: matched?.mod.level ?? null,
    ways: [],
    chosen: null
  }

  if (line.crafted) {
    const bench = benchWay(matched?.mod ?? null, line, context.base)
    if (line.text.startsWith('Allocates ')) {
      result.ways.push({
        id: 'anoint',
        kind: 'bench',
        title: 'Анойнт маслами (Blight)',
        details: ['Пассивка наносится на вещь тремя маслами у Cassia. Какие масла нужны, смотри в Path of Building или на вики.'],
        tone: 'info'
      })
    } else if (bench) {
      result.ways.push({ ...bench, details: [bench.details[0], bench.details[2]], tone: 'good' })
    } else {
      result.ways.push({
        id: 'bench',
        kind: 'bench',
        title: 'Крафт или зачарование',
        details: ['Path of Building помечает так крафты станка и зачарования. Такого рецепта станка для этой базы в моих данных нет.'],
        tone: 'info'
      })
    }
    result.level = null
    return result
  }
  if (line.fractured) {
    result.ways.push({
      id: 'fractured',
      kind: 'drop',
      title: 'Fractured-мод: только с базой, на которой он уже есть',
      details: ['Такой мод нельзя добавить крафтом и нельзя убрать. В 3.30 fractured-вещи — редкая находка: шанс у вещей 5-го тира.'],
      tone: 'bad'
    })
    return result
  }
  if (!matched) return result

  const { mod } = matched
  const tiers = tiersOf(mod, context.tags)
  const place = tiers.findIndex((tier) => tier.mod.level <= mod.level)
  if (!mod.source && tiers.length && place !== -1) {
    result.tier = place + 1
    result.tiers = tiers.length
  }

  if (mod.source === 'veiled') {
    result.ways.push({
      id: 'veiled',
      kind: 'veiled',
      title: 'Veiled-мод (Betrayal)',
      details: ['Раскрывается у Jun на вещи с Veiled-модом; после раскрытия рецепт появляется на станке.'],
      tone: 'info',
      ref: POB_REF
    })
  } else if (mod.source === 'delve') {
    result.ways.push({
      id: 'delve',
      kind: 'delve',
      title: 'Мод только от фоссилов (Delve)',
      details: ['Случайным роллом не выпадает. Какой именно фоссил его даёт, в моих данных нет — смотри Craft of Exile.'],
      tone: 'info',
      ref: POB_REF
    })
  }

  const weight = spawnWeight(mod, context.tags)
  // The tag that decided the weight: an influence tag means the modifier needs that influence.
  const deciding = mod.weights?.find(([tag]) => context.tags.has(tag))?.[0] ?? ''
  const influence = /_(shaper|elder|crusader|eyrie|basilisk|adjudicator)$/.exec(deciding)?.[1]
  if (influence) {
    result.ways.push({
      id: 'influence',
      kind: 'influence',
      title: 'Мод влияния',
      details: ['Выпадает только на базе с тем же влиянием, что в билде: сначала нужна такая база.'],
      tone: 'bad',
      ref: POB_REF
    })
  }

  const sameType = pool(context, mod.type)
  const total = sameType.reduce((sum, entry) => sum + entry.weight, 0)
  const wanted = new Set(tiers.filter((tier) => tier.mod.level >= mod.level).map((tier) => tier.mod))
  const tooLow = mod.level > context.itemLevel
  if (!mod.source && weight > 0) {
    const share = total > 0 ? sameType.filter((entry) => wanted.has(entry.mod)).reduce((sum, entry) => sum + entry.weight, 0) / total : 0
    result.ways.push({
      id: 'roll',
      kind: 'roll',
      title: 'Случайный ролл: дроп, Orb of Alchemy, Chaos Orb',
      details: [
        result.tier ? `Это T${result.tier} из ${result.tiers}; нужен уровень предмета ${mod.level}+.` : `Нужен уровень предмета ${mod.level}+.`,
        tooLow
          ? `В билде уровень предмета ${context.itemLevel}: на нём этот тир не выпадет.`
          : `${about(share)} на каждый случайный ${affixWord(mod.type)}, что выпадет этот тир или лучше.`
      ],
      tone: tooLow ? 'bad' : 'info',
      ref: POB_REF
    })

    if (!tooLow) {
      const fossils = METHODS.fossils
        .map((fossil) => {
          const factor = fossilFactor(fossil, mod.tags)
          if (factor <= 1) return null
          const weighted = sameType.map((entry) => ({ ...entry, weight: entry.weight * fossilFactor(fossil, entry.mod.tags) }))
          const sum = weighted.reduce((acc, entry) => acc + entry.weight, 0)
          const hit = weighted.filter((entry) => wanted.has(entry.mod)).reduce((acc, entry) => acc + entry.weight, 0)
          const blocked = (fossil.none ?? []).filter((tag) => context.otherTags.has(tag))
          return { fossil, share: sum > 0 ? hit / sum : 0, blocked }
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null && entry.share >= share * WORTHWHILE)
        .sort((a, b) => a.blocked.length - b.blocked.length || b.share - a.share)
        .slice(0, FOSSILS_SHOWN)
      for (const { fossil, share: withFossil, blocked } of fossils) {
        result.ways.push({
          id: `fossil:${fossil.name}`,
          kind: 'fossil',
          title: `Фоссил: ${fossil.name}`,
          details: [
            `${about(withFossil)} на каждый случайный ${affixWord(mod.type)} вместо ${percent(share)}.`,
            ...(fossil.none?.length ? [`Исключает моды с тегами: ${fossil.none.join(', ')}.`] : []),
            ...(blocked.length ? [`У вещи есть мод с тегом ${blocked.join(', ')} — вместе с этим фоссилом он не выпадет.`] : [])
          ],
          tone: blocked.length ? 'bad' : 'good',
          ref: METHODS.source
        })
      }

      const everything = pool(context, null)
      for (const craft of METHODS.harvest.filter((entry) => mod.tags.includes(entry.tag))) {
        const tagged = everything.filter((entry) => entry.mod.tags.includes(craft.tag))
        const sum = tagged.reduce((acc, entry) => acc + entry.weight, 0)
        const hit = tagged.filter((entry) => wanted.has(entry.mod)).reduce((acc, entry) => acc + entry.weight, 0)
        result.ways.push({
          id: `harvest:${craft.tag}`,
          kind: 'harvest',
          title: `Harvest: Reforge с гарантированным ${craft.label}-модом`,
          details: [
            `Стоит ${craft.cost}.`,
            `${about(sum > 0 ? hit / sum : 0)}, что гарантированный мод окажется этим (нужного тира или лучше).`
          ],
          tone: 'info',
          ref: METHODS.source
        })
      }
    }
  }

  const essence = essenceWay(matched, context.base)
  if (essence) result.ways.push(essence)
  const bench = benchWay(mod, line, context.base)
  if (bench) result.ways.push(bench)
  return result
}

/** Passives of the Genesis Tree by name within a subtree. */
function genesisNode(tree: string, name: string): string | null {
  return GENESIS.find((node) => node.tree === tree && node.name === name)?.name ?? null
}

const ATTRIBUTE_WORD: Record<string, string> = { str: 'Strength', dex: 'Dexterity', int: 'Intelligence' }

/** Growing a rare armour or jewellery piece on the Genesis Tree, with the passives that steer it. */
function genesisEquipmentWay(base: BaseData | undefined, mods: ModSourcing[], matchedTags: string[], links: number): Way | null {
  const slot = base ? METHODS.genesis.equipmentSlots[base.type] : undefined
  if (!base || !slot) return null
  const nodes: string[] = []
  const add = (name: string | null): void => {
    if (name && !nodes.includes(name)) nodes.push(name)
  }
  add(genesisNode('Equipment', `Increased ${slot} Chance`))
  if (base.type !== 'Jewel') add(genesisNode('Equipment', ['Ring', 'Amulet', 'Belt'].includes(base.type) ? 'Glittering Flesh' : 'Guardian Flesh'))
  for (const attribute of base.attributes ?? []) add(genesisNode('Equipment', `More ${ATTRIBUTE_WORD[attribute]} Items`))
  for (const tag of matchedTags) {
    const label = METHODS.genesis.modifierNodes[tag]
    if (label) add(genesisNode('Equipment', `Increased ${label} Modifier Chance`))
  }
  add(genesisNode('Equipment', 'Modifier Tier Rating'))
  if (links >= 5) add(genesisNode('Equipment', 'Arterial Mesh'))
  const level = Math.max(0, ...mods.map((mod) => (mod.crafted ? 0 : (mod.level ?? 0))))
  return {
    id: 'genesis',
    kind: 'genesis',
    title: 'Вырастить на Genesis Tree (Provisioning Wombgift)',
    details: [
      'Provisioning Wombgift кладётся в гнездо Equipment Item Womb и выращивается за Hiveblood; из него рождается редкая броня или бижутерия.',
      `Пассивки поддерева Equipment под эту вещь: ${nodes.join(', ')}.`,
      ...(level ? [`Модам вещи нужен уровень предмета ${level}+: уровень задаёт Wombgift.`] : []),
      'Какие именно моды выпадут, решает случай: пассивки только повышают шансы.'
    ],
    tone: 'info',
    ref: METHODS.genesis.source
  }
}

/** Growing a unique on the Genesis Tree, with the passives that steer towards its slot. */
export function genesisUniqueWay(base: BaseData | undefined, foulborn: boolean, breach: boolean): Way {
  const nodes: string[] = []
  const add = (name: string | null): void => {
    if (name && !nodes.includes(name)) nodes.push(name)
  }
  const slot = base ? METHODS.genesis.uniqueSlots[base.type] : undefined
  if (slot) add(genesisNode('Unique Items', `Increased ${slot} Chance`))
  if (base) {
    const lineage = ['Ring', 'Amulet', 'Belt'].includes(base.type)
      ? 'Glittering Lineage'
      : ['Body Armour', 'Helmet', 'Gloves', 'Boots', 'Shield'].includes(base.type)
        ? 'Guardian Lineage'
        : base.tags?.includes('weapon')
          ? 'Martial Lineage'
          : null
    if (lineage) add(genesisNode('Unique Items', lineage))
    for (const attribute of base.attributes ?? []) add(genesisNode('Unique Items', `More ${ATTRIBUTE_WORD[attribute]} Items`))
  }
  if (breach) add(genesisNode('Unique Items', "Lord's Descent"))
  add(genesisNode('Unique Items', foulborn ? 'Foulborn Ancestry' : 'Cleansed of Impurity'))
  if (foulborn) add(genesisNode('Unique Items', 'Corrupted Flesh'))
  add(genesisNode('Unique Items', 'Recessive Genes'))
  return {
    id: 'genesis',
    kind: 'genesis',
    title: 'Вырастить на Genesis Tree (Ancient Wombgift)',
    details: [
      'Ancient Wombgift кладётся в гнездо Unique Item Womb и выращивается за Hiveblood; из него рождается случайный уник.',
      nodes.length ? `Пассивки поддерева Unique Items под этот уник: ${nodes.join(', ')}.` : 'Тип этого уника я не определил: пассивки подбери по его слоту.',
      'Пассивки сужают выбор до слота и атрибутов, но не до конкретного уника. Входит ли он в число тех, что могут родиться, в моих данных нет.'
    ],
    tone: 'info',
    ref: METHODS.genesis.source
  }
}

export interface RareSourcing {
  mods: ModSourcing[]
  ways: Way[]
  needsItemLevel: number | null
}

/** The modifiers of a non-unique item with the ways to get each, and the ways to get the item whole. */
export function describeRare(item: PobItem, base: BaseData | undefined): RareSourcing {
  const tags = itemTags(base, item.influences)
  const itemLevel = item.itemLevel ?? TOP_ITEM_LEVEL
  const matches = matchLines(item.mods, tags)
  const matchedTags = item.mods.map((line, index) => (line.crafted ? [] : (matches[index]?.mod.tags ?? [])))
  const seen = new Map<string, ModSourcing>()
  const mods: ModSourcing[] = []
  item.mods.forEach((line, index) => {
    const matched = matches[index]
    // Both lines of a two-stat modifier lead to the same modifier: show it once.
    const shared = matched && matched.mod.stats.length > 1 && !line.crafted && !line.fractured ? matched.id : null
    const first = shared ? seen.get(shared) : undefined
    if (first) {
      first.text = `${first.text} / ${line.text}`
      return
    }
    const otherTags = new Set(matchedTags.filter((_, i) => i !== index && matches[i]?.id !== matched?.id).flat())
    const described = describeMod(line, index, matched, { base, tags, itemLevel, otherTags })
    if (shared) seen.set(shared, described)
    mods.push(described)
  })
  const genesis = genesisEquipmentWay(base, mods, [...new Set(matchedTags.flat())], item.links)
  const levels = mods.filter((mod) => !mod.crafted && mod.level !== null).map((mod) => mod.level!)
  return { mods, ways: genesis ? [genesis] : [], needsItemLevel: levels.length ? Math.max(...levels) : null }
}
