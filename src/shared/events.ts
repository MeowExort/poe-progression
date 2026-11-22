/** Events extracted from Path of Exile's Client.txt. `ts` is epoch milliseconds (log's local time). */

export interface AreaGeneratedEvent {
  type: 'area_generated'
  ts: number
  level: number
  /** Internal area id, e.g. "1_1_1" or "MapWorldsStrand". Language independent. */
  areaId: string
  /** Instance seed: the same seed means the same instance was re-entered. */
  seed: string
}

export interface AreaEnteredEvent {
  type: 'area_entered'
  ts: number
  name: string
  /** Filled in by the session from the preceding `area_generated` line. */
  level?: number
  areaId?: string
  seed?: string
}

export interface LevelUpEvent {
  type: 'level_up'
  ts: number
  character: string
  class: string
  level: number
}

export interface DeathEvent {
  type: 'death'
  ts: number
  character: string
}

export interface AfkEvent {
  type: 'afk'
  ts: number
  on: boolean
}

/** A "Speaker: text" line without a chat-channel prefix: NPC and boss voice lines (and local chat). */
export interface DialogueEvent {
  type: 'dialogue'
  ts: number
  speaker: string
  text: string
}

/** A ": text" system message that no specific rule matched. */
export interface SystemEvent {
  type: 'system'
  ts: number
  text: string
}

export type LogEvent =
  | AreaGeneratedEvent
  | AreaEnteredEvent
  | LevelUpEvent
  | DeathEvent
  | AfkEvent
  | DialogueEvent
  | SystemEvent

export type FeedEntry = LogEvent & { id: number }
