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
}

export interface PobItem {
  slot: string
  name: string
  base: string | null
  rarity: string
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
  /** From the PoB build when imported, otherwise from the chosen card. */
  characterClass: CharacterClass | null
  options: RouteOptions
  /** Empty until a build is chosen or imported. */
  steps: RouteStep[]
  /** Index of the first step that is not done yet; equals steps.length when the campaign is finished. */
  position: number
}

export interface PlanApi {
  get(): Promise<PlanView>
  onChange(listener: (plan: PlanView) => void): () => void
  setAnswers(answers: Answers | null): Promise<void>
  chooseBuild(buildId: string | null): Promise<void>
  /** Imports a Path of Building code. Resolves to an error message, or null on success. */
  importPob(code: string): Promise<string | null>
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
  clearPob: 'plan:clear-pob',
  setPobSets: 'plan:set-pob-sets',
  setOptions: 'plan:set-options',
  setPosition: 'plan:set-position',
  moveGroup: 'plan:move-group'
} as const
