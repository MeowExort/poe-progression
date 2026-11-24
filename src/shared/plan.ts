export const CHARACTER_CLASSES = ['Marauder', 'Duelist', 'Ranger', 'Shadow', 'Witch', 'Templar', 'Scion'] as const
export type CharacterClass = (typeof CHARACTER_CLASSES)[number]

export const BANDITS = ['kill', 'alira', 'oak', 'kraityn'] as const
export type Bandit = (typeof BANDITS)[number]

// ── Campaign route ─────────────────────────────────────────────

/** One piece of a route step: plain text or a highlighted game term. */
export type Fragment =
  | { type: 'text'; text: string }
  | { type: 'enter'; areaId: string; name: string }
  | { type: 'waypoint_use'; areaId: string; name: string }
  | { type: 'waypoint' }
  | { type: 'waypoint_get' }
  | { type: 'logout'; areaId: string; name: string }
  | { type: 'portal_set' }
  | { type: 'portal_use'; areaId: string; name: string }
  | { type: 'area'; areaId: string; name: string }
  | { type: 'arena'; name: string }
  | { type: 'kill'; name: string }
  | { type: 'quest'; questId: string; name: string }
  | { type: 'quest_text'; text: string }
  | { type: 'generic'; text: string }
  | { type: 'trial' }
  | { type: 'ascend'; lab: string }
  | { type: 'crafting'; recipes: string[] }
  /** Compass direction on the minimap: 0 is up, 1 is up-right, … 7 is up-left. */
  | { type: 'dir'; index: number }
  /** A gem the build needs, picked up as a quest reward or bought from a vendor. */
  | {
      type: 'gem'
      reward: 'quest' | 'vendor'
      npc: string
      gemId: string
      name: string
      attribute: GemAttribute
      count: number
      /** What the gem is for: the skill set and link group it first appears in. */
      note: string
    }

export type GemAttribute = 'strength' | 'dexterity' | 'intelligence' | 'none'

export interface RouteStep {
  index: number
  act: number
  /** The area the player is in while doing this step. */
  areaId: string
  areaName: string
  parts: Fragment[]
  subSteps: Fragment[][]
  /** Set when completing the step moves the player to another area. */
  arrivesAt: string | null
}

export interface RouteOptions {
  bandit: Bandit
  /** A fresh character with no waypoints or trials: include the steps that collect them. */
  leagueStart: boolean
  /** Detour to the Library in Act 3 (Siosa sells gems other classes get as rewards). */
  library: boolean
}

// ── Builds and questionnaire ───────────────────────────────────

export const STYLES = ['minion', 'totem', 'caster', 'bow', 'melee', 'dot'] as const
export type Style = (typeof STYLES)[number]

/** 1 = weak side, 2 = average, 3 = strong side. */
export type Rating = 1 | 2 | 3

export interface BuildCard {
  id: string
  name: string
  class: CharacterClass
  ascendancy: string
  mainSkill: string
  styles: Style[]
  /** Rough archetype-level estimates, not figures from the guide. */
  traits: { clear: Rating; bossing: Rating; tank: Rating; simplicity: Rating }
  /** True when the build does not work without specific unique items. */
  needsUniques: boolean
  uniquesNote: string | null
  summary: string
  caveats: string[]
  guide: { site: string; author: string | null; url: string }
  /** False until the card has been checked against the guide itself. */
  verified: boolean
}

export interface Answers {
  liked: Style[]
  avoided: Style[]
  priority: 'clear' | 'bossing' | 'tank' | 'balance'
  buttons: 'few' | 'any'
  farmUniques: boolean
}

export interface RankedBuild {
  build: BuildCard
  score: number
  /** Why the build was moved up or down, in Russian, ready to show. */
  reasons: { text: string; positive: boolean }[]
  /** True when the build uses a style the player said they do not want. */
  excluded: boolean
}

// ── Path of Building import ────────────────────────────────────

export interface PobGem {
  /** Id in the game data (Vaal and Awakened gems map to their base gem); null if unknown. */
  id: string | null
  /** Name as written in the build, e.g. a transfigured "Storm Rain of the Conduit". */
  name: string
  /** Name of the gem to pick up in the campaign when it differs from `name`. */
  baseName: string | null
  level: number
  attribute: GemAttribute
  support: boolean
}

export interface PobSkillGroup {
  label: string
  slot: string | null
  gems: PobGem[]
}

export interface PobSkillSet {
  title: string
  groups: PobSkillGroup[]
}

export interface PobTreeSpec {
  title: string
  /** Link to the tree on pathofexile.com, when the build carries one. */
  url: string | null
  /** Allocated nodes, including the class start and ascendancy nodes. */
  nodes: number
  /** Ids of those nodes. */
  nodeIds: number[]
  /** The effect chosen on each allocated mastery: node id → effect id. */
  masteries: Record<number, number>
}

/** One passive point: a node of the tree, with what it gives. */
export interface TreePoint {
  id: number
  name: string
  kind: 'small' | 'notable' | 'keystone' | 'mastery' | 'jewel'
  /** For a mastery: the effect the build takes. */
  stats: string[]
}

/** What to put passive points into next. */
export interface TreeAdvice {
  /** The tree of the build being followed (an index into `pob.treeSpecs`). */
  specIndex: number
  specTitle: string
  /** The build's trees from the smallest to the largest, as indexes into `pob.treeSpecs`. */
  stages: number[]
  /** Points of that tree the character has, and how many it has in all (ascendancy apart). */
  taken: number
  total: number
  /** The next points, in the order to take them. */
  next: TreePoint[]
  /** How many more follow after `next`. */
  more: number
  /** Nodes of the tree that cannot be reached from what the character has. */
  unreachable: number
  /** Nodes the character has that no tree of the build contains. */
  extra: TreePoint[]
  /** False while the character's tree has not been read: the order then starts at the class start. */
  known: boolean
}

/** Which ascendancy points to take after one Labyrinth. */
export interface LabAdvice {
  lab: 'normal' | 'cruel' | 'merciless' | 'eternal'
  nodes: TreePoint[]
}

/** A string to paste into a vendor's search box. */
export interface VendorSearch {
  label: string
  pattern: string
  note: string | null
}

/** How reading the character's passive tree from the site went. */
export interface TreeReading {
  character: string | null
  /** When the tree was last read (epoch ms); null if never. */
  readAt: number | null
  busy: boolean
  /** Why the last attempt failed, ready to show. */
  error: string | null
}

export interface PobItem {
  slot: string
  name: string
  base: string | null
  rarity: string
  /** Size of the largest group of linked sockets; 0 when the item has none. */
  links: number
  /** "Shaper", "Hunter", "Searing Exarch" and so on. */
  influences: string[]
  /** Mods Path of Building marks as crafted: bench crafts, enchantments and anointments. */
  craftedMods: string[]
  /** The item level written in the build; null when it is not. */
  itemLevel: number | null
  /** The explicit modifiers, as written in the build. */
  mods: PobMod[]
  fractured: boolean
  corrupted: boolean
}

/** One explicit modifier line of an item. */
export interface PobMod {
  /** The text without Path of Building's marks: "+(100-114) to maximum Life" or "+92 to maximum Life". */
  text: string
  crafted: boolean
  fractured: boolean
}

export interface PobItemSet {
  title: string
  items: PobItem[]
}

export interface PobBuild {
  className: CharacterClass | null
  ascendancy: string | null
  level: number | null
  bandit: Bandit
  skillSets: PobSkillSet[]
  treeSpecs: PobTreeSpec[]
  itemSets: PobItemSet[]
  notes: string
}

/** Where a gem of the build is first obtained on the campaign route. */
export interface GemSource {
  kind: 'start' | 'quest' | 'vendor'
  act: number | null
  quest: string | null
  npc: string | null
  stepIndex: number | null
}

// ── Where to get the build's items in SSF ──────────────────────

export interface SourceNote {
  text: string
  tone: 'info' | 'good' | 'bad'
  /** Where the statement comes from, for the player to check. */
  ref?: { label: string; url: string }
}

/** One way of getting an item or one of its modifiers. */
export interface Way {
  /** Unique among the ways of its item or modifier; what the player's choice is stored as. */
  id: string
  kind: 'drop' | 'card' | 'chance' | 'genesis' | 'roll' | 'essence' | 'bench' | 'fossil' | 'harvest' | 'veiled' | 'delve' | 'influence'
  title: string
  /** What it takes, line by line. */
  details: string[]
  tone: 'info' | 'good' | 'bad'
  ref?: { label: string; url: string }
}

/** One modifier of a rare item and the ways to get it. */
export interface ModSourcing {
  /** Identifies the modifier within its item; what the player's choice is stored under. */
  key: string
  text: string
  crafted: boolean
  fractured: boolean
  /** Null when the modifier was not found in the game data. */
  affix: 'Prefix' | 'Suffix' | null
  /** Its tier among the modifiers of its kind this base can roll (1 is the best), and how many there are. */
  tier: number | null
  tiers: number | null
  /** The item level the modifier needs. */
  level: number | null
  ways: Way[]
  /** The id of the way the player picked; null if none. */
  chosen: string | null
}

export interface ItemSourcing {
  /** Identifies the item within the build; what the player's choice is stored under. */
  key: string
  /** Ways of getting the item as a whole. */
  ways: Way[]
  chosen: string | null
  /** The modifiers of a non-unique item; empty for uniques. */
  mods: ModSourcing[]
  /** The item level the modifiers need together; null when unknown or irrelevant. */
  needsItemLevel: number | null
  name: string
  base: string | null
  rarity: string
  /** Every place the build uses the item: "Body Armour · Early maps". */
  usedIn: string[]
  notes: SourceNote[]
  /** Ids of the general methods that apply to this item. */
  methods: string[]
  /** A wiki page about the item, for uniques. */
  wikiUrl: string | null
}

/** A general way of getting items, backed by quotes from an official source. */
export interface SourcingMethod {
  id: string
  title: string
  text: string
  quotes: string[]
  ref: { label: string; url: string }
}

export interface Sourcing {
  uniques: ItemSourcing[]
  /** Non-unique items with something that takes work in SSF: links, influence, fractured mods, crafts. */
  special: ItemSourcing[]
  /** Only the methods referenced by at least one item, plus the always-relevant ones. */
  methods: SourcingMethod[]
}

// ── Plan ───────────────────────────────────────────────────────

export interface PlanView {
  answers: Answers | null
  ranked: RankedBuild[]
  build: BuildCard | null
  /** The imported Path of Building build, if any. */
  pob: PobBuild | null
  /** Indexes of the PoB skill sets whose gems are collected during the campaign. */
  pobSets: number[]
  /** Keyed by gem id; gems of the selected sets that the route never offers are absent. */
  gemSources: Record<string, GemSource>
  /** Names of gems this class can only get through the Library detour, while it is switched off. */
  libraryOnlyGems: string[]
  /** How to obtain the imported build's items without trading; null without a PoB build. */
  sourcing: Sourcing | null
  /** From the PoB build when imported, otherwise from the chosen card. */
  characterClass: CharacterClass | null
  options: RouteOptions
  /** Empty until a build is chosen or imported. */
  steps: RouteStep[]
  /** Index of the first step that is not done yet; equals steps.length when the campaign is finished. */
  position: number
  /** What to put passive points into next; null without a PoB build with a tree. */
  tree: TreeAdvice | null
  /** The tree to follow, as an index into `pob.treeSpecs`; null picks the first unfinished one. */
  treeTarget: number | null
  treeReading: TreeReading
  /** Which ascendancy points each Labyrinth is for. */
  labs: LabAdvice[]
  /** Strings for a vendor's search box, for the character's level. */
  vendorSearches: VendorSearch[]
}

export interface PlanApi {
  get(): Promise<PlanView>
  onChange(listener: (plan: PlanView) => void): () => void
  setAnswers(answers: Answers | null): Promise<void>
  chooseBuild(buildId: string | null): Promise<void>
  /** Imports a Path of Building code. Resolves to an error message, or null on success. */
  importPob(code: string): Promise<string | null>
  /** Picks a way of getting an item (`key` of the item) or a modifier (`key` of the modifier); null unpicks. */
  chooseWay(key: string, wayId: string | null): Promise<void>
  /** Reads the character's passive tree from the site again. */
  refreshTree(): Promise<void>
  /** Follows the given tree of the build; null goes back to picking the first unfinished one. */
  setTreeTarget(index: number | null): Promise<void>
  clearPob(): Promise<void>
  setPobSets(indexes: number[]): Promise<void>
  setOptions(patch: Partial<RouteOptions>): Promise<void>
  /** Moves to an absolute step index. */
  setPosition(position: number): Promise<void>
  /** Moves forward or back by whole "what to do in this area" groups. */
  moveGroup(delta: number): Promise<void>
}

export const PLAN_IPC = {
  get: 'plan:get',
  state: 'plan:state',
  setAnswers: 'plan:set-answers',
  chooseBuild: 'plan:choose-build',
  importPob: 'plan:import-pob',
  chooseWay: 'plan:choose-way',
  refreshTree: 'plan:refresh-tree',
  setTreeTarget: 'plan:set-tree-target',
  clearPob: 'plan:clear-pob',
  setPobSets: 'plan:set-pob-sets',
  setOptions: 'plan:set-options',
  setPosition: 'plan:set-position',
  moveGroup: 'plan:move-group'
} as const
