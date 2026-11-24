import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { findBuild, rankBuilds } from '@core/builds'
import { parsePobCode, PobError } from '@core/pob/parse'
import { buildPlanRoute } from '@core/route/build'
import { requiredGems } from '@core/route/gems'
import { AREAS } from '@core/route/data'
import { buildSourcing } from '@core/sources'
import { labAdvice, treeAdvice } from '@core/tree/advice'
import { vendorSearches } from '@core/vendor'
import { groupEnd, previousGroupStart } from '@core/route/groups'
import { advance } from '@core/route/tracker'
import {
  BANDITS,
  STYLES,
  type Answers,
  type CharacterClass,
  type GemSource,
  type LabAdvice,
  type PlanView,
  type PobBuild,
  type Sourcing,
  type RouteOptions,
  type RouteStep,
  type Style
} from '@shared/plan'

interface StoredPlan {
  answers: Answers | null
  buildId: string | null
  /** The imported Path of Building code, kept verbatim so it can be re-read after updates. */
  pobCode: string | null
  /** Skill sets whose gems are collected in the campaign; null means all of them. */
  pobSets: number[] | null
  options: RouteOptions
  position: number
  /** The tree of the build to follow; null picks the first unfinished one. */
  treeTarget: number | null
  /** The way the player picked for an item or a modifier, by the key of that item or modifier. */
  choices: Record<string, string>
  /** The character's passive tree as last read from the site. */
  allocated: { character: string; hashes: number[]; readAt: number } | null
}

const DEFAULT_OPTIONS: RouteOptions = { bandit: 'kill', leagueStart: true, library: false }

/** The player's plan: questionnaire answers, chosen build and progress through the campaign route. */
export class PlanStore {
  private stored: StoredPlan
  private pob: PobBuild | null = null
  private steps: RouteStep[] = []
  private gemSources: Record<string, GemSource> = {}
  private libraryOnlyGems: string[] = []
  private sourcing: Sourcing | null = null
  private labs: LabAdvice[] = []
  /** The character's level as the game log shows it; null until a level-up is seen. */
  private level: number | null = null
  private reading: { busy: boolean; error: string | null } = { busy: false, error: null }

  constructor(
    private readonly file: string | null,
    private readonly onChange: (view: PlanView) => void = () => {}
  ) {
    this.stored = file ? load(file) : emptyPlan()
    if (this.stored.pobCode) {
      try {
        this.pob = parsePobCode(this.stored.pobCode)
      } catch {
        this.stored.pobCode = null
      }
    }
    this.rebuild()
    this.stored.position = clamp(this.stored.position, this.steps.length)
  }

  view(): PlanView {
    const { answers, buildId, options, position } = this.stored
    return {
      answers,
      ranked: answers ? rankBuilds(answers) : [],
      build: findBuild(buildId),
      pob: this.pob,
      pobSets: this.selectedSets(),
      gemSources: this.gemSources,
      libraryOnlyGems: this.libraryOnlyGems,
      sourcing: this.sourcing ? withChoices(this.sourcing, this.stored.choices) : null,
      characterClass: this.characterClass(),
      options,
      steps: this.steps,
      position,
      tree: this.pob ? treeAdvice(this.pob, this.characterClass(), this.stored.allocated, this.stored.treeTarget) : null,
      treeTarget: this.stored.treeTarget,
      treeReading: {
        character: this.stored.allocated?.character ?? null,
        readAt: this.stored.allocated?.readAt ?? null,
        ...this.reading
      },
      labs: this.labs,
      vendorSearches: this.pob ? vendorSearches(this.pob, this.selectedSets(), this.currentLevel()) : []
    }
  }

  /** What the loot filter is built from: the class and the imported build with its chosen skill sets. */
  filterInput(): { characterClass: CharacterClass | null; pob: PobBuild | null; setIndexes: number[] } {
    return { characterClass: this.characterClass(), pob: this.pob, setIndexes: this.selectedSets() }
  }

  /** True when there is a build whose tree the character's own could be compared with. */
  get followsTree(): boolean {
    return (this.pob?.treeSpecs.length ?? 0) > 0
  }

  /** Remembers which way of getting an item (or one of its modifiers) the player goes for. */
  chooseWay(key: string, wayId: string | null): void {
    if (typeof key !== 'string' || !key) return
    const choices = { ...this.stored.choices }
    if (typeof wayId === 'string' && wayId) choices[key] = wayId
    else delete choices[key]
    this.stored.choices = choices
    this.commit()
  }

  /** The character's level, from the game log. */
  setLevel(level: number): void {
    if (level === this.level) return
    this.level = level
    this.onChange(this.view())
  }

  setTreeReading(reading: { busy: boolean; error: string | null }): void {
    this.reading = reading
    this.onChange(this.view())
  }

  /** The character's passive tree, freshly read from the site. */
  setAllocated(character: string, hashes: number[], readAt: number): void {
    this.stored.allocated = { character, hashes, readAt }
    this.reading = { busy: false, error: null }
    this.commit()
  }

  setTreeTarget(index: number | null): void {
    const valid = index !== null && Number.isInteger(index) && index >= 0 && index < (this.pob?.treeSpecs.length ?? 0)
    this.stored.treeTarget = valid ? index : null
    this.commit()
  }

  /** The level to pick vendor searches for: the character's, else that of the area the route is in. */
  private currentLevel(): number {
    if (this.level !== null) return this.level
    const step = this.steps[Math.min(this.stored.position, this.steps.length - 1)]
    return (step && AREAS[step.areaId]?.level) || 1
  }

  /** Imports a Path of Building code. Returns an error message for the player, or null on success. */
  importPob(code: string): string | null {
    let pob: PobBuild
    try {
      pob = parsePobCode(code)
    } catch (error) {
      return error instanceof PobError ? error.message : 'Не удалось прочитать код Path of Building.'
    }
    if (!pob.className) return 'В билде не указан класс персонажа.'

    const sameCharacter = this.characterClass() === pob.className
    this.pob = pob
    this.stored.pobCode = code.replace(/\s+/g, '')
    this.stored.pobSets = null
    this.stored.treeTarget = null
    if (!sameCharacter) {
      this.stored.allocated = null
      this.stored.choices = {}
    }
    this.stored.options = { ...this.stored.options, bandit: pob.bandit }
    this.relocate(() => this.rebuild(), sameCharacter)
    this.commit()
    return null
  }

  clearPob(): void {
    if (!this.pob) return
    this.pob = null
    this.stored.pobCode = null
    this.stored.pobSets = null
    this.stored.treeTarget = null
    this.relocate(() => this.rebuild(), true)
    this.commit()
  }

  setPobSets(indexes: number[]): void {
    if (!this.pob) return
    const valid = [...new Set(indexes)].filter((i) => Number.isInteger(i) && i >= 0 && i < this.pob!.skillSets.length)
    this.stored.pobSets = valid.sort((a, b) => a - b)
    this.relocate(() => this.rebuild(), true)
    this.commit()
  }

  setAnswers(answers: Answers | null): void {
    this.stored.answers = answers ? sanitizeAnswers(answers) : null
    this.commit()
  }

  chooseBuild(buildId: string | null): void {
    const build = findBuild(buildId)
    if ((build?.id ?? null) === this.stored.buildId) return
    this.stored.buildId = build?.id ?? null
    // Another build means another character: start the campaign over, and the imported
    // Path of Building data belonged to the previous build.
    this.pob = null
    this.stored.pobCode = null
    this.stored.pobSets = null
    this.stored.treeTarget = null
    this.stored.allocated = null
    this.stored.position = 0
    this.rebuild()
    this.commit()
  }

  setOptions(patch: Partial<RouteOptions>): void {
    const options: RouteOptions = {
      bandit: BANDITS.includes(patch.bandit as never) ? patch.bandit! : this.stored.options.bandit,
      leagueStart: typeof patch.leagueStart === 'boolean' ? patch.leagueStart : this.stored.options.leagueStart,
      library: typeof patch.library === 'boolean' ? patch.library : this.stored.options.library
    }
    this.relocate(() => {
      this.stored.options = options
      this.rebuild()
    }, true)
    this.commit()
  }

  setPosition(position: number): void {
    this.move(clamp(Math.round(position), this.steps.length))
  }

  moveGroup(delta: number): void {
    let position = this.stored.position
    for (let i = 0; i < Math.abs(delta); i++) {
      position = delta > 0 ? groupEnd(this.steps, position) : previousGroupStart(this.steps, position)
    }
    this.move(position)
  }

  /** Called when the game log shows the player entered an area. */
  enterArea(areaId: string): void {
    this.move(advance(this.steps, this.stored.position, areaId))
  }

  private move(position: number): void {
    if (position === this.stored.position) return
    this.stored.position = position
    this.commit()
  }

  private characterClass(): CharacterClass | null {
    return this.pob?.className ?? findBuild(this.stored.buildId)?.class ?? null
  }

  private selectedSets(): number[] {
    if (!this.pob) return []
    return this.stored.pobSets ?? this.pob.skillSets.map((_, i) => i)
  }

  private rebuild(): void {
    const characterClass = this.characterClass()
    this.libraryOnlyGems = []
    this.sourcing = this.pob ? buildSourcing(this.pob) : null
    this.labs = this.pob ? labAdvice(this.pob) : []
    if (!characterClass) {
      this.steps = []
      this.gemSources = {}
      return
    }
    const gemPlan = this.pob ? { characterClass, required: requiredGems(this.pob, this.selectedSets()) } : null
    const route = buildPlanRoute(this.stored.options, gemPlan, undefined, this.labs)
    this.steps = route.steps
    this.gemSources = route.gemSources

    if (gemPlan && !this.stored.options.library) {
      // Some gems are sold to this class by Siosa alone: find them by trying the route with the detour.
      const withLibrary = buildPlanRoute({ ...this.stored.options, library: true }, gemPlan, undefined, this.labs).gemSources
      this.libraryOnlyGems = gemPlan.required
        .filter((gem) => !route.gemSources[gem.id] && withLibrary[gem.id])
        .map((gem) => gem.name)
    }
  }

  /**
   * Runs a change that rebuilds the step list, then puts the position back at the same place
   * in the story (or at the start when the change means a different character).
   */
  private relocate(change: () => void, keepPlace: boolean): void {
    const current = this.steps[this.stored.position]
    const finished = this.steps.length > 0 && this.stored.position >= this.steps.length
    change()
    if (!keepPlace) {
      this.stored.position = 0
    } else if (finished) {
      this.stored.position = this.steps.length
    } else if (current) {
      const same = this.steps.findIndex((step) => step.act === current.act && step.areaId === current.areaId)
      this.stored.position = Math.max(0, same)
    } else {
      this.stored.position = 0
    }
  }

  private commit(): void {
    if (this.file) {
      try {
        mkdirSync(dirname(this.file), { recursive: true })
        writeFileSync(this.file, JSON.stringify(this.stored, null, 2))
      } catch {
        // Losing the saved plan is not worth crashing the overlay mid-game.
      }
    }
    this.onChange(this.view())
  }
}

function emptyPlan(): StoredPlan {
  return {
    answers: null,
    buildId: null,
    pobCode: null,
    pobSets: null,
    options: { ...DEFAULT_OPTIONS },
    position: 0,
    treeTarget: null,
    choices: {},
    allocated: null
  }
}

function clamp(position: number, length: number): number {
  return Number.isFinite(position) ? Math.min(Math.max(0, position), length) : 0
}

function load(file: string): StoredPlan {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<StoredPlan>
    return {
      answers: raw.answers ? sanitizeAnswers(raw.answers) : null,
      buildId: findBuild(raw.buildId ?? null)?.id ?? null,
      pobCode: typeof raw.pobCode === 'string' ? raw.pobCode : null,
      pobSets: Array.isArray(raw.pobSets) ? raw.pobSets.filter((i) => Number.isInteger(i)) : null,
      options: { ...DEFAULT_OPTIONS, ...raw.options },
      position: typeof raw.position === 'number' ? raw.position : 0,
      treeTarget: Number.isInteger(raw.treeTarget) ? (raw.treeTarget as number) : null,
      choices: readChoices(raw.choices),
      allocated: readAllocated(raw.allocated)
    }
  } catch {
    return emptyPlan()
  }
}

function readChoices(raw: unknown): Record<string, string> {
  const choices: Record<string, string> = {}
  if (!raw || typeof raw !== 'object') return choices
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) if (typeof value === 'string') choices[key] = value
  return choices
}

/** Marks the ways the player picked; a choice that no longer exists (another build, new data) is dropped. */
function withChoices(sourcing: Sourcing, choices: Record<string, string>): Sourcing {
  const pick = (key: string, ways: { id: string }[]): string | null =>
    ways.some((way) => way.id === choices[key]) ? choices[key] : null
  const mark = (item: Sourcing['uniques'][number]): Sourcing['uniques'][number] => ({
    ...item,
    chosen: pick(item.key, item.ways),
    mods: item.mods.map((mod) => ({ ...mod, chosen: pick(`${item.key}#${mod.key}`, mod.ways) }))
  })
  return { ...sourcing, uniques: sourcing.uniques.map(mark), special: sourcing.special.map(mark) }
}

function readAllocated(raw: unknown): StoredPlan['allocated'] {
  const value = raw as { character?: unknown; hashes?: unknown; readAt?: unknown } | null | undefined
  if (!value || typeof value.character !== 'string' || !Array.isArray(value.hashes)) return null
  return {
    character: value.character,
    hashes: value.hashes.filter((id): id is number => Number.isInteger(id)),
    readAt: typeof value.readAt === 'number' ? value.readAt : 0
  }
}

function sanitizeAnswers(answers: Answers): Answers {
  const styles = (value: unknown): Style[] =>
    Array.isArray(value) ? STYLES.filter((style) => value.includes(style)) : []
  const liked = styles(answers.liked)
  return {
    liked,
    avoided: styles(answers.avoided).filter((style) => !liked.includes(style)),
    priority: (['clear', 'bossing', 'tank', 'balance'] as const).includes(answers.priority) ? answers.priority : 'balance',
    buttons: answers.buttons === 'few' ? 'few' : 'any',
    farmUniques: answers.farmUniques === true
  }
}
