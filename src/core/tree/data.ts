import treeJson from '@data/vendor/pob/tree.json'

export type TreeNodeKind = 'start' | 'ascendancyStart' | 'small' | 'notable' | 'keystone' | 'mastery' | 'jewel'

export interface TreeNode {
  name: string
  kind: TreeNodeKind
  /** Ids of the neighbouring nodes; a mastery is linked to every notable of its cluster. */
  links: number[]
  /** Set on the nodes of an ascendancy tree. */
  ascendancy?: string
  classStart?: number
  stats?: string[]
  /** For a mastery: effect id → what it gives. */
  effects?: Record<string, string[]>
}

export interface PassiveTree {
  version: string
  classes: { name: string; start: number; ascendancies: string[] }[]
  nodes: Record<string, TreeNode>
}

/** The passive tree of the current game version as a graph. */
export const TREE = treeJson as unknown as PassiveTree
