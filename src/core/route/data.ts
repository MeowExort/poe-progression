import areasJson from '@data/vendor/exile-leveling/json/areas.json'
import questsJson from '@data/vendor/exile-leveling/json/quests.json'
import act1 from '@data/vendor/exile-leveling/routes/act-1.txt?raw'
import act2 from '@data/vendor/exile-leveling/routes/act-2.txt?raw'
import act3 from '@data/vendor/exile-leveling/routes/act-3.txt?raw'
import act4 from '@data/vendor/exile-leveling/routes/act-4.txt?raw'
import act5 from '@data/vendor/exile-leveling/routes/act-5.txt?raw'
import act6 from '@data/vendor/exile-leveling/routes/act-6.txt?raw'
import act7 from '@data/vendor/exile-leveling/routes/act-7.txt?raw'
import act8 from '@data/vendor/exile-leveling/routes/act-8.txt?raw'
import act9 from '@data/vendor/exile-leveling/routes/act-9.txt?raw'
import act10 from '@data/vendor/exile-leveling/routes/act-10.txt?raw'

export interface Area {
  id: string
  name: string
  act: number
  level: number
  has_waypoint: boolean
  is_town_area: boolean
  parent_town_area_id: string | null
  connection_ids: string[]
  crafting_recipes: string[]
}

export interface Quest {
  id: string
  name: string
  act: string
}

export const AREAS = areasJson as unknown as Record<string, Area>
export const QUESTS = questsJson as unknown as Record<string, Quest>

/** Route sources in play order, one per act. */
export const ROUTE_SOURCES: string[] = [act1, act2, act3, act4, act5, act6, act7, act8, act9, act10]

export const START_AREA = '1_1_1'
export const START_TOWN = '1_1_town'
