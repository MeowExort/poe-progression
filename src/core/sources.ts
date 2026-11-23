import methodsJson from '@data/methods.json'
import basesJson from '@data/vendor/pob/bases.json'
import uniquesJson from '@data/vendor/pob/uniques.json'
import cardsJson from '@data/vendor/poedb/divination-cards.json'
import type { ItemSourcing, PobBuild, PobItem, SourceNote, Sourcing, SourcingMethod } from '@shared/plan'

interface UniqueData {
  name: string
  base: string
  league?: string
  source?: string
  level?: number
}

interface CardData {
  name: string
  stack: number
  reward: string
  kind: string
  page: string
  details?: string[]
}

const UNIQUES = new Map((uniquesJson as UniqueData[]).map((unique) => [unique.name, unique]))
const BASES = basesJson as Record<string, { type: string; level: number }>
const CARDS = cardsJson as CardData[]
const METHODS: SourcingMethod[] = methodsJson.methods.map((method) => ({ ...method, ref: methodsJson.source }))

const POB_REF = { label: 'данные Path of Building', url: 'https://github.com/PathOfBuildingCommunity/PathOfBuilding' }
const cardRef = (card: CardData): SourceNote['ref'] => ({ label: 'PoEDB', url: `https://poedb.tw/us/${card.page}` })

const isUnique = (item: PobItem): boolean => item.rarity === 'UNIQUE' || item.rarity === 'RELIC'

/** Works out, for every item of the build that takes effort in SSF, what is known about getting it. */
export function buildSourcing(pob: PobBuild): Sourcing {
  // The same item usually sits in several item sets: describe it once and list where it is used.
  const seen = new Map<string, { item: PobItem; usedIn: string[] }>()
  for (const set of pob.itemSets) {
    for (const item of set.items) {
      const key = `${item.rarity}|${item.name}|${item.base ?? ''}`
      const entry = seen.get(key) ?? { item, usedIn: [] }
      entry.usedIn.push(`${item.slot} · ${set.title}`)
      // Keep the most demanding version: an endgame set may list the six-linked one.
      if (item.links > entry.item.links) entry.item = item
      seen.set(key, entry)
    }
  }

  const uniques: ItemSourcing[] = []
  const special: ItemSourcing[] = []
  for (const { item, usedIn } of seen.values()) {
    if (isUnique(item)) uniques.push(describeUnique(item, usedIn))
    else {
      const described = describeCrafted(item, usedIn)
      if (described) special.push(described)
    }
  }

  const used = new Set([...uniques, ...special].flatMap((item) => item.methods))
  // Item tiers are how any rare gear is found in 3.30, so they are worth showing for every build with items.
  if (seen.size > 0) used.add('item-tiers')
  return { uniques, special, methods: METHODS.filter((method) => used.has(method.id)) }
}

function describeUnique(item: PobItem, usedIn: string[]): ItemSourcing {
  const notes: SourceNote[] = []
  const methods: string[] = []
  // A Foulborn unique is a mutated version of a regular one: its source is the regular unique's.
  const foulborn = item.name.startsWith('Foulborn ')
  const lookupName = foulborn ? item.name.slice('Foulborn '.length) : item.name
  const data = UNIQUES.get(lookupName)
  const base = data?.base ?? item.base

  if (foulborn) {
    notes.push({
      text: 'Это Foulborn-версия уника. Как превращать обычный уник в Foulborn, в моих данных нет — смотри гайд.',
      tone: 'bad'
    })
  }

  if (!data) {
    notes.push({
      text: 'Этого уника нет в данных Path of Building — возможно, он новый или переименован. Источник смотри в гайде.',
      tone: 'bad'
    })
  } else if (data.source && /no longer obtainable/i.test(data.source)) {
    notes.push({ text: 'Больше не добывается в игре: в SSF его получить нельзя.', tone: 'bad', ref: POB_REF })
  } else {
    if (data.source) {
      notes.push({ text: `Источник: ${data.source}`, tone: 'info', ref: POB_REF })
    } else if (data.league) {
      notes.push({
        text: `Помечен как уник лиги ${data.league}, точного источника в данных нет: у таких он обычно свой — проверь на вики.`,
        tone: 'info',
        ref: POB_REF
      })
    }
    if (!data.source && !data.league) {
      notes.push({ text: 'Особого источника в данных нет: это обычный дроп, может выпасть где угодно.', tone: 'info', ref: POB_REF })
      if (base) {
        const level = BASES[base]?.level
        notes.push({
          text: `Целевой способ: Orb of Chance на белую ${base}${level ? ` (база с ${level} уровня)` : ''}.`,
          tone: 'good'
        })
        methods.push('chance-orb')
      }
    }
    if (data.level) notes.push({ text: `Требует ${data.level} уровень персонажа.`, tone: 'info' })
  }

  for (const card of CARDS.filter((card) => card.kind === 'unique' && card.reward === lookupName)) {
    notes.push(cardNote(card))
  }

  if (item.links >= 5) {
    notes.push({
      text: `В билде у предмета ${item.links} связей — уник выпадает со случайными, связывать придётся самому.`,
      tone: 'info'
    })
  }

  return {
    name: item.name,
    base,
    rarity: item.rarity,
    usedIn,
    notes,
    methods,
    wikiUrl: `https://www.poewiki.net/wiki/${encodeURIComponent(lookupName.replace(/ /g, '_'))}`
  }
}

/** Describes a non-unique item, or returns null when nothing about it takes special effort. */
function describeCrafted(item: PobItem, usedIn: string[]): ItemSourcing | null {
  const notes: SourceNote[] = []
  const methods: string[] = []
  const baseName = item.base ?? item.name
  const base = BASES[baseName]

  if (item.links >= 5) {
    notes.push({ text: `Нужно ${item.links} связей.`, tone: 'info' })
    methods.push('item-tiers')
    if (item.links === 6) {
      for (const card of sixLinkCards(baseName, base?.type)) notes.push(cardNote(card))
    }
  }
  if (item.influences.length) {
    notes.push({
      text: `Влияние: ${item.influences.join(', ')}. Где в 3.30 брать базы с этим влиянием, в моих данных нет — смотри гайд.`,
      tone: 'bad'
    })
  }
  if (item.fractured) {
    notes.push({ text: 'Есть fractured-мод.', tone: 'bad' })
    methods.push('fractured')
  }
  // Path of Building marks bench crafts, enchantments and anointments the same way.
  const anoints = item.craftedMods.filter((mod) => mod.startsWith('Allocates '))
  const crafts = item.craftedMods.filter((mod) => !mod.startsWith('Allocates '))
  if (anoints.length) {
    notes.push({ text: `Анойнт маслами: ${anoints.map((mod) => mod.slice('Allocates '.length)).join('; ')}`, tone: 'info' })
  }
  if (crafts.length) notes.push({ text: `Крафт или зачарование: ${crafts.join('; ')}`, tone: 'info' })
  if (item.corrupted) notes.push({ text: 'Предмет осквернён (Corrupted).', tone: 'info' })

  if (!notes.length) return null
  if (base) {
    notes.unshift({ text: `База: ${baseName} (${base.type}), с ${base.level} уровня.`, tone: 'info', ref: POB_REF })
  }
  return { name: item.name, base: item.base, rarity: item.rarity, usedIn, notes, methods, wikiUrl: null }
}

/** Divination cards whose reward is a six-linked item of this base or of this item class. */
function sixLinkCards(baseName: string, type: string | undefined): CardData[] {
  return CARDS.filter((card) => {
    const target = /^Six-Link(?:ed)? (.+)$/.exec(card.reward)?.[1]
    return target !== undefined && (target === baseName || target === type)
  })
}

function cardNote(card: CardData): SourceNote {
  const details = card.details?.length ? ` (${card.details.join(', ')})` : ''
  return {
    text: `Карта ${card.name}: набор из ${card.stack} шт. даёт ${card.reward}${details}. Где падает — по ссылке.`,
    tone: 'good',
    ref: cardRef(card)
  }
}
