import type { Fragment, GemSource, LabAdvice, RouteOptions, RouteStep } from '@shared/plan'
import { AREAS, QUESTS, ROUTE_SOURCES, START_AREA, START_TOWN, type Area } from './data'
import { GemCollector, type GemPlan } from './gems'
import { translateParts } from './ru'

/**
 * Turns the route sources into a flat list of steps.
 *
 * The step language (from exile-leveling):
 *   #section Act 1          starts an act
 *   #ifdef NAME / #ifndef NAME / #endif   conditional blocks
 *   #sub text               a hint attached to the previous step
 *   text {fragment|arg} #comment          a step; fragments are game terms
 *
 * While parsing we simulate where the player is, so every step knows its area and
 * whether completing it moves the player somewhere else. Position tracking relies on that.
 */

interface WalkState {
  areaId: string
  townId: string
  portalAreaId: string | null
  /** Quests handed in on the line being parsed, with the reward offers the line names. */
  handIns: { questId: string; offerIds: string[] }[]
}

export interface BuiltRoute {
  steps: RouteStep[]
  /** Where each gem of the plan is first obtained; empty without a gem plan. */
  gemSources: Record<string, GemSource>
}

export function routeDefinitions(options: RouteOptions): Set<string> {
  const definitions = new Set<string>()
  if (options.leagueStart) definitions.add('LEAGUE_START')
  if (options.library) definitions.add('LIBRARY')
  definitions.add(`BANDIT_${options.bandit.toUpperCase()}`)
  return definitions
}

export function buildRoute(options: RouteOptions, sources: string[] = ROUTE_SOURCES): RouteStep[] {
  return buildPlanRoute(options, null, sources).steps
}

/** Like `buildRoute`, plus a step for every gem of the plan at the quest that first provides it. */
export function buildPlanRoute(
  options: RouteOptions,
  gemPlan: GemPlan | null,
  sources: string[] = ROUTE_SOURCES,
  labs: LabAdvice[] = []
): BuiltRoute {
  const definitions = routeDefinitions(options)
  const state: WalkState = { areaId: START_AREA, townId: START_TOWN, portalAreaId: null, handIns: [] }
  const collector = gemPlan ? new GemCollector(gemPlan) : null
  const steps: RouteStep[] = []
  let act = 1

  for (const source of sources) {
    const conditions: boolean[] = []
    for (const rawLine of source.split(/\r\n|\r|\n/)) {
      const line = rawLine.trim()
      if (!line) continue

      const section = /^#section\s*(.*)$/.exec(line)
      if (section) {
        const number = /(\d+)/.exec(section[1])
        if (number) act = +number[1]
        continue
      }
      if (line.startsWith('#endif')) {
        conditions.pop()
        continue
      }
      const conditional = /^#(ifdef|ifndef)\s+(\S+)/.exec(line)
      if (conditional) {
        const defined = definitions.has(conditional[2])
        conditions.push(conditional[1] === 'ifdef' ? defined : !defined)
        continue
      }
      if (conditions.includes(false)) continue

      const sub = /^#sub\s*(.*)$/.exec(line)
      if (sub) {
        // Hints never move the player, so they are parsed against a throwaway state.
        const parts = translateParts(sub[1], true, parseFragments(sub[1], { ...state, handIns: [] }))
        // A hint belongs to the route step above it, not to gem steps added after that step.
        const owner = steps.findLast((step) => !step.parts.some((part) => part.type === 'gem'))
        if (parts.length) owner?.subSteps.push(parts)
        continue
      }

      const before = state.areaId
      state.handIns = []
      const parts = translateParts(line, false, parseFragments(line, state))
      if (!parts.length) continue
      steps.push({
        index: steps.length,
        act,
        areaId: before,
        areaName: AREAS[before]?.name ?? before,
        parts,
        subSteps: [],
        arrivesAt: state.areaId !== before ? state.areaId : null
      })

      const lab = parts.find((part) => part.type === 'ascend')
      if (lab?.type === 'ascend') steps[steps.length - 1].subSteps.push(...labHints(lab.lab, labs))

      for (const handIn of state.handIns) {
        for (const gem of collector?.collect(handIn.questId, handIn.offerIds, act, steps.length) ?? []) {
          steps.push({
            index: steps.length,
            act,
            areaId: state.areaId,
            areaName: AREAS[state.areaId]?.name ?? state.areaId,
            parts: [gem],
            subSteps: [],
            arrivesAt: null
          })
        }
      }
    }
  }
  return { steps, gemSources: collector?.sources ?? {} }
}

/** Splits a line into text and `{fragment}` pieces; a `#` outside braces starts a comment. */
/** A level at which each Labyrinth is comfortable: a rule of thumb, not something the game sets. */
const LAB_LEVEL: Record<string, number> = { normal: 33, cruel: 55, merciless: 68 }

function labHints(lab: string, labs: LabAdvice[]): Fragment[][] {
  const hints: Fragment[][] = []
  const nodes = labs.find((entry) => entry.lab === lab)?.nodes ?? []
  if (nodes.length) {
    const hint: Fragment[] = [{ type: 'text', text: 'Очки возвышения: ' }]
    nodes.forEach((node, i) => {
      if (i > 0) hint.push({ type: 'text', text: ' и ' })
      hint.push({ type: 'generic', text: node.name })
    })
    hints.push(hint)
  }
  const level = LAB_LEVEL[lab]
  if (level) hints.push([{ type: 'text', text: `Рекомендуемый уровень: ${level}+` }])
  return hints
}

function parseFragments(line: string, state: WalkState): Fragment[] {
  const parts: Fragment[] = []
  const pattern = /\{([^}]+)\}|#.*$|[^{#]+/g
  for (const match of line.matchAll(pattern)) {
    const token = match[0]
    if (token.startsWith('#')) break
    if (match[1] === undefined) {
      parts.push({ type: 'text', text: token })
      continue
    }
    const fragment = evaluate(match[1].split('|'), state)
    if (fragment) parts.push(fragment)
  }
  // Tidy the text pieces: no leading or trailing whitespace on the step as a whole.
  const first = parts[0]
  if (first?.type === 'text') first.text = first.text.trimStart()
  const last = parts[parts.length - 1]
  if (last?.type === 'text') last.text = last.text.trimEnd()
  return parts.filter((part) => part.type !== 'text' || part.text.length > 0)
}

function moveTo(state: WalkState, area: Area): void {
  if (area.is_town_area) state.townId = area.id
  state.areaId = area.id
}

function evaluate(raw: string[], state: WalkState): Fragment | null {
  const [kind, arg] = raw
  switch (kind) {
    case 'enter': {
      const area = AREAS[arg]
      if (!area) return { type: 'generic', text: arg }
      moveTo(state, area)
      return { type: 'enter', areaId: area.id, name: area.name }
    }
    case 'waypoint': {
      if (arg === undefined) return { type: 'waypoint' }
      const area = AREAS[arg]
      if (!area) return { type: 'generic', text: arg }
      moveTo(state, area)
      return { type: 'waypoint_use', areaId: area.id, name: area.name }
    }
    case 'waypoint_get':
      return { type: 'waypoint_get' }
    case 'logout': {
      const town = AREAS[state.townId]
      moveTo(state, town)
      state.portalAreaId = null
      return { type: 'logout', areaId: town.id, name: town.name }
    }
    case 'portal': {
      const current = AREAS[state.areaId]
      if (arg === 'set') {
        state.portalAreaId = state.areaId
        return { type: 'portal_set' }
      }
      // Using a portal outside town always means "open one here and go to town".
      if (!current.is_town_area) state.portalAreaId = current.id
      const portalArea = state.portalAreaId ? AREAS[state.portalAreaId] : null
      if (current.is_town_area && portalArea) {
        moveTo(state, portalArea)
        state.portalAreaId = null
      } else if (current.parent_town_area_id) {
        moveTo(state, AREAS[current.parent_town_area_id])
      }
      const destination = AREAS[state.areaId]
      return { type: 'portal_use', areaId: destination.id, name: destination.name }
    }
    case 'ascend': {
      // Finishing the Labyrinth puts the player back in town.
      moveTo(state, AREAS[state.townId])
      return { type: 'ascend', lab: arg ?? '' }
    }
    case 'area': {
      const area = AREAS[arg]
      return area ? { type: 'area', areaId: area.id, name: area.name } : { type: 'generic', text: arg }
    }
    case 'arena':
      return { type: 'arena', name: arg }
    case 'kill':
      return { type: 'kill', name: arg }
    case 'quest': {
      const quest = QUESTS[arg]
      state.handIns.push({ questId: arg, offerIds: raw.slice(2) })
      return { type: 'quest', questId: arg, name: quest?.name ?? arg }
    }
    case 'quest_text':
      return { type: 'quest_text', text: arg }
    case 'generic':
      return { type: 'generic', text: arg }
    case 'trial':
      return { type: 'trial' }
    case 'crafting': {
      const area = AREAS[arg ?? state.areaId]
      return { type: 'crafting', recipes: area?.crafting_recipes ?? [] }
    }
    case 'dir': {
      const degrees = ((Number.parseFloat(arg) % 360) + 360) % 360
      return Number.isNaN(degrees) ? null : { type: 'dir', index: Math.floor(degrees / 45) }
    }
    default:
      // Unknown fragment kinds degrade to their first argument as plain highlighted text.
      return arg ? { type: 'generic', text: arg } : null
  }
}
