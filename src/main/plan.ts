import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { findBuild, rankBuilds } from '@core/builds'
import { parsePobCode, PobError } from '@core/pob/parse'
import { buildPlanRoute } from '@core/route/build'
import { requiredGems } from '@core/route/gems'
import { buildSourcing } from '@core/sources'
import { groupEnd, previousGroupStart } from '@core/route/groups'
import { advance } from '@core/route/tracker'
import {
  BANDITS,
  STYLES,
  type Answers,
  type CharacterClass,
  type GemSource,
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
      sourcing: this.sourcing,
      characterClass: this.characterClass(),
      options,
      steps: this.steps,
      position
    }
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
    if (!characterClass) {
      this.steps = []
      this.gemSources = {}
      return
    }
    const gemPlan = this.pob ? { characterClass, required: requiredGems(this.pob, this.selectedSets()) } : null
    const route = buildPlanRoute(this.stored.options, gemPlan)
    this.steps = route.steps
    this.gemSources = route.gemSources

    if (gemPlan && !this.stored.options.library) {
      // Some gems are sold to this class by Siosa alone: find them by trying the route with the detour.
      const withLibrary = buildPlanRoute({ ...this.stored.options, library: true }, gemPlan).gemSources
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
  return { answers: null, buildId: null, pobCode: null, pobSets: null, options: { ...DEFAULT_OPTIONS }, position: 0 }
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
      position: typeof raw.position === 'number' ? raw.position : 0
    }
  } catch {
    return emptyPlan()
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
