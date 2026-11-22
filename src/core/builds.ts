import buildsJson from '@data/builds.json'
import type { Answers, BuildCard, RankedBuild, Style } from '@shared/plan'

export const BUILDS = buildsJson as BuildCard[]

export const STYLE_LABELS: Record<Style, string> = {
  minion: 'миньоны',
  totem: 'тотемы и баллисты',
  caster: 'заклинания',
  bow: 'лук',
  melee: 'ближний бой',
  dot: 'урон со временем'
}

const PRIORITY_LABELS = {
  clear: 'зачистка карт',
  bossing: 'убийство боссов',
  tank: 'живучесть'
} as const

export function findBuild(id: string | null): BuildCard | null {
  return BUILDS.find((build) => build.id === id) ?? null
}

/** Orders the builds by how well they fit the answers, best first; unwanted styles go last. */
export function rankBuilds(answers: Answers, builds: BuildCard[] = BUILDS): RankedBuild[] {
  const ranked = builds.map((build): RankedBuild => {
    const reasons: RankedBuild['reasons'] = []
    let score = 0

    const avoided = build.styles.filter((style) => answers.avoided.includes(style))
    const liked = build.styles.filter((style) => answers.liked.includes(style))
    if (avoided.length) {
      reasons.push({ text: `Ты не хочешь: ${avoided.map((style) => STYLE_LABELS[style]).join(', ')}`, positive: false })
    }
    if (liked.length) {
      score += 4
      reasons.push({ text: `Твой стиль: ${liked.map((style) => STYLE_LABELS[style]).join(', ')}`, positive: true })
    }

    if (answers.priority === 'balance') {
      score += (build.traits.clear + build.traits.bossing + build.traits.tank) / 3
    } else {
      const value = build.traits[answers.priority]
      score += value
      if (value === 3) reasons.push({ text: `Сильная сторона: ${PRIORITY_LABELS[answers.priority]}`, positive: true })
      if (value === 1) reasons.push({ text: `Слабая сторона: ${PRIORITY_LABELS[answers.priority]}`, positive: false })
    }

    if (answers.buttons === 'few') {
      score += build.traits.simplicity - 2
      if (build.traits.simplicity === 3) reasons.push({ text: 'Мало кнопок', positive: true })
    }

    if (build.needsUniques) {
      if (answers.farmUniques) {
        reasons.push({ text: 'Нужен уник — придётся фармить', positive: false })
      } else {
        score -= 4
        reasons.push({ text: 'Не работает без уника, а фармить его ты не хочешь', positive: false })
      }
    } else {
      score += 1
    }

    return { build, score: Math.round(score * 10) / 10, reasons, excluded: avoided.length > 0 }
  })

  return ranked.sort((a, b) => Number(a.excluded) - Number(b.excluded) || b.score - a.score)
}
