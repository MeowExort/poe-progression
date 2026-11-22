import type { RouteStep } from '@shared/plan'
import { AREAS } from './data'

/** How many area changes ahead of the current position an entered area may match. */
const LOOKAHEAD = 2

/**
 * Returns the new position after the player enters `areaId`.
 *
 * The position only moves when the area is where the route goes next. One planned area
 * change may be skipped (the player took a shortcut), except into towns: a town visit is
 * usually just a portal trip to sell loot and must not skip the steps in between.
 */
export function advance(steps: RouteStep[], position: number, areaId: string): number {
  const current = steps[position]
  if (!current) return position
  // Re-entering the area the route expects us to be in (death, portal back) changes nothing.
  if (current.areaId === areaId) return position

  let travelSteps = 0
  for (let i = position; i < steps.length && travelSteps < LOOKAHEAD; i++) {
    const arrivesAt = steps[i].arrivesAt
    if (!arrivesAt) continue
    travelSteps++
    if (arrivesAt !== areaId) continue
    if (travelSteps === 1 || !AREAS[areaId]?.is_town_area) return i + 1
  }
  return position
}
