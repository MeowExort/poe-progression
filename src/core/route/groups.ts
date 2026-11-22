import type { RouteStep } from '@shared/plan'

/**
 * A "group" is what the player does before the next area change: the steps from a position
 * through the first one that moves them elsewhere. No game data needed, so the UI uses this too.
 */

/** Index just past the group that starts at `position`. */
export function groupEnd(steps: RouteStep[], position: number): number {
  for (let i = position; i < steps.length; i++) {
    if (steps[i].arrivesAt) return i + 1
  }
  return steps.length
}

export function currentGroup(steps: RouteStep[], position: number): RouteStep[] {
  return steps.slice(position, groupEnd(steps, position))
}

/** Index where the group before `position` starts. */
export function previousGroupStart(steps: RouteStep[], position: number): number {
  // Step back over the area change that ended the previous group, then to that group's start.
  let i = Math.min(position, steps.length) - 2
  while (i >= 0 && !steps[i].arrivesAt) i--
  return Math.max(0, i + 1)
}
