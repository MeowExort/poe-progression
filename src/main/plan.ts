import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { findBuild, rankBuilds } from '@core/builds'
import { buildRoute } from '@core/route/build'
import { groupEnd, previousGroupStart } from '@core/route/groups'
import { advance } from '@core/route/tracker'
import {
  BANDITS,
  STYLES,
  type Answers,
  type PlanView,
  type RouteOptions,
  type RouteStep,
  type Style
} from '@shared/plan'

interface StoredPlan {
  answers: Answers | null
  buildId: string | null
  options: RouteOptions
  position: number
}

const DEFAULT_OPTIONS: RouteOptions = { bandit: 'kill', leagueStart: true, library: false }

/** The player's plan: questionnaire answers, chosen build and progress through the campaign route. */
export class PlanStore {
  private stored: StoredPlan
  private steps: RouteStep[] = []

  constructor(
    private readonly file: string | null,
    private readonly onChange: (view: PlanView) => void = () => {}
  ) {
    this.stored = file ? load(file) : emptyPlan()
    this.rebuild()
    this.stored.position = clamp(this.stored.position, this.steps.length)
  }

  view(): PlanView {
    const { answers, buildId, options, position } = this.stored
    return {
      answers,
      ranked: answers ? rankBuilds(answers) : [],
      build: findBuild(buildId),
      options,
      steps: this.steps,
      position
    }
  }

  setAnswers(answers: Answers | null): void {
    this.stored.answers = answers ? sanitizeAnswers(answers) : null
    this.commit()
  }

  chooseBuild(buildId: string | null): void {
    const build = findBuild(buildId)
    if ((build?.id ?? null) === this.stored.buildId) return
    this.stored.buildId = build?.id ?? null
    // Another build means another character: start the campaign over.
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
    const current = this.steps[this.stored.position]
    this.stored.options = options
    this.rebuild()
    // The step list changed under the position: stay at the same place in the story.
    this.stored.position = current
      ? Math.max(
          0,
          this.steps.findIndex((step) => step.act === current.act && step.areaId === current.areaId)
        )
      : clamp(this.stored.position, this.steps.length)
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

  private rebuild(): void {
    this.steps = this.stored.buildId ? buildRoute(this.stored.options) : []
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
  return { answers: null, buildId: null, options: { ...DEFAULT_OPTIONS }, position: 0 }
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
