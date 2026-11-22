import type { Answers, Bandit, Style } from '@shared/plan'

export const STYLE_LABELS: Record<Style, string> = {
  minion: 'Миньоны',
  totem: 'Тотемы и баллисты',
  caster: 'Заклинания',
  bow: 'Лук',
  melee: 'Ближний бой',
  dot: 'Урон со временем'
}

export const PRIORITY_LABELS: Record<Answers['priority'], string> = {
  clear: 'Быстрая зачистка карт',
  bossing: 'Убийство боссов',
  tank: 'Живучесть',
  balance: 'Всего понемногу'
}

export const BANDIT_LABELS: Record<Bandit, string> = {
  kill: 'Убить всех',
  alira: 'Помочь Alira',
  oak: 'Помочь Oak',
  kraityn: 'Помочь Kraityn'
}

export const TRAIT_LABELS = {
  clear: 'Зачистка',
  bossing: 'Боссы',
  tank: 'Живучесть',
  simplicity: 'Простота'
} as const
