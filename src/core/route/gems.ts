import type { Fragment, GemAttribute, GemSource, PobBuild } from '@shared/plan'
import { CHARACTERS, GEMS, QUESTS } from './data'

export interface RequiredGem {
  id: string
  name: string
  attribute: GemAttribute
  /** How many copies the build socketed at once. */
  count: number
  note: string
}

export interface GemPlan {
  characterClass: string
  required: RequiredGem[]
}

/**
 * The gems to collect during the campaign: every known gem of the given skill sets,
 * in the order the build introduces them. That order is also the priority when one
 * quest offers several of them as a reward.
 */
export function requiredGems(pob: PobBuild, setIndexes: number[]): RequiredGem[] {
  const required = new Map<string, RequiredGem>()
  for (const index of [...setIndexes].sort((a, b) => a - b)) {
    const set = pob.skillSets[index]
    if (!set) continue
    const inThisSet = new Map<string, number>()
    for (const group of set.groups) {
      for (const gem of group.gems) {
        if (!gem.id) continue
        const count = (inThisSet.get(gem.id) ?? 0) + 1
        inThisSet.set(gem.id, count)
        const known = required.get(gem.id)
        if (known) {
          known.count = Math.max(known.count, count)
        } else {
          required.set(gem.id, {
            id: gem.id,
            name: GEMS[gem.id]?.name ?? gem.name,
            attribute: gem.attribute,
            count,
            note: `${set.title} · ${group.label}`
          })
        }
      }
    }
  }
  return [...required.values()]
}

/** Tracks which required gems the character already has while the route is being built. */
export class GemCollector {
  private readonly owned = new Map<string, number>()
  readonly sources: Record<string, GemSource> = {}

  constructor(private readonly plan: GemPlan) {
    const character = CHARACTERS[plan.characterClass]
    for (const gem of plan.required) {
      if (character && (gem.id === character.start_gem_id || gem.id === character.chest_gem_id)) {
        this.owned.set(gem.id, 1)
        this.sources[gem.id] = { kind: 'start', act: 1, quest: null, npc: null, stepIndex: null }
      }
    }
  }

  /**
   * Gems to take when a quest is handed in: one reward per offer, then everything still
   * missing that the vendor now sells to this class. Each returned fragment becomes a step.
   */
  collect(questId: string, offerIds: string[], act: number, nextStepIndex: number): Fragment[] {
    const quest = QUESTS[questId]
    if (!quest) return []
    const offers = (offerIds.length ? offerIds : Object.keys(quest.reward_offers))
      .map((id) => quest.reward_offers[id])
      .filter(Boolean)
    const fragments: Fragment[] = []
    const record = (gem: RequiredGem, kind: 'quest' | 'vendor', npc: string, count: number): void => {
      this.owned.set(gem.id, (this.owned.get(gem.id) ?? 0) + count)
      this.sources[gem.id] ??= { kind, act, quest: quest.name, npc, stepIndex: nextStepIndex + fragments.length }
      fragments.push({
        type: 'gem',
        reward: kind,
        npc,
        gemId: gem.id,
        name: gem.name,
        attribute: gem.attribute,
        count,
        note: gem.note
      })
    }

    for (const offer of offers) {
      const reward = this.plan.required.find((gem) => this.missing(gem) > 0 && this.allowed(offer.quest[gem.id]))
      if (reward) record(reward, 'quest', offer.quest_npc, 1)
    }
    for (const offer of offers) {
      for (const gem of this.plan.required) {
        const vendor = offer.vendor[gem.id]
        const missing = this.missing(gem)
        if (missing > 0 && vendor && this.allowed(vendor)) record(gem, 'vendor', vendor.npc, missing)
      }
    }
    return fragments
  }

  private missing(gem: RequiredGem): number {
    return gem.count - (this.owned.get(gem.id) ?? 0)
  }

  private allowed(reward: { classes: string[] } | undefined): boolean {
    return !!reward && (reward.classes.length === 0 || reward.classes.includes(this.plan.characterClass))
  }
}
