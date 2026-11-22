import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PlanStore } from '../src/main/plan'
import type { Answers } from '../src/shared/plan'

const answers: Answers = { liked: ['bow'], avoided: ['minion'], priority: 'clear', buttons: 'any', farmUniques: false }

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'plan-'))
  file = join(dir, 'plan.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('PlanStore', () => {
  it('starts empty: no answers, no build, no route', () => {
    const view = new PlanStore(null).view()
    expect(view).toMatchObject({ answers: null, ranked: [], build: null, steps: [], position: 0 })
  })

  it('ranks builds once the questionnaire is answered', () => {
    const plan = new PlanStore(null)
    plan.setAnswers(answers)
    const view = plan.view()
    expect(view.ranked.length).toBeGreaterThan(5)
    expect(view.ranked[0].build.styles).toContain('bow')
  })

  it('builds the route when a build is chosen and follows the game through it', () => {
    const plan = new PlanStore(null)
    plan.chooseBuild('storm-rain-deadeye')
    expect(plan.view().steps.length).toBeGreaterThan(400)
    expect(plan.view().build?.class).toBe('Ranger')

    plan.enterArea('1_1_town')
    const afterTown = plan.view().position
    expect(afterTown).toBeGreaterThan(0)
    plan.enterArea('1_3_town')
    expect(plan.view().position).toBe(afterTown)
    plan.enterArea('1_1_2')
    expect(plan.view().position).toBeGreaterThan(afterTown)
  })

  it('moves by groups and clamps to the route', () => {
    const plan = new PlanStore(null)
    plan.chooseBuild('storm-rain-deadeye')
    plan.moveGroup(-1)
    expect(plan.view().position).toBe(0)
    plan.moveGroup(2)
    const forward = plan.view().position
    expect(plan.view().steps[forward - 1].arrivesAt).not.toBeNull()
    plan.moveGroup(-1)
    expect(plan.view().position).toBeLessThan(forward)
    plan.setPosition(99999)
    expect(plan.view().position).toBe(plan.view().steps.length)
  })

  it('keeps the place in the story when route options change', () => {
    const plan = new PlanStore(null)
    plan.chooseBuild('storm-rain-deadeye')
    const act3 = plan.view().steps.findIndex((step) => step.act === 3 && step.areaId === '1_3_town')
    plan.setPosition(act3)
    plan.setOptions({ bandit: 'alira' })
    const current = plan.view().steps[plan.view().position]
    expect(current).toMatchObject({ act: 3, areaId: '1_3_town' })
    expect(plan.view().options.bandit).toBe('alira')
  })

  it('restarts the campaign when another build is chosen', () => {
    const plan = new PlanStore(null)
    plan.chooseBuild('storm-rain-deadeye')
    plan.setPosition(50)
    plan.chooseBuild('srs-guardian')
    expect(plan.view().position).toBe(0)
    expect(plan.view().build?.id).toBe('srs-guardian')
  })

  it('persists across restarts and reports every change', () => {
    const changes: number[] = []
    const plan = new PlanStore(file, (view) => changes.push(view.position))
    plan.setAnswers(answers)
    plan.chooseBuild('storm-rain-deadeye')
    plan.setPosition(7)
    expect(changes).toEqual([0, 0, 7])

    const reopened = new PlanStore(file).view()
    expect(reopened).toMatchObject({ answers, position: 7 })
    expect(reopened.build?.id).toBe('storm-rain-deadeye')
  })

  it('drops contradictory and unknown answers', () => {
    const plan = new PlanStore(null)
    plan.setAnswers({ ...answers, liked: ['bow', 'nonsense' as never], avoided: ['bow', 'melee'] })
    expect(plan.view().answers).toMatchObject({ liked: ['bow'], avoided: ['melee'] })
  })
})
