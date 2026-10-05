/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 应急演练断点续做：四个阶段节点，按执行顺序排列。 */
export type DrillStepKey = 'preparation' | 'checkin' | 'evacuation' | 'summary'

export type PrepItem = { key: string; label: string; done: boolean }

export type CheckinEntry = {
  name: string
  /** onsite=现场签到，manual=人工补录；冲突时以现场签到为准。 */
  source: 'onsite' | 'manual'
  time: string
}

export type DrillDraft = {
  drillId: number
  /** 乐观锁版本号：每次持久化 +1，提交时比对，并发提交只放行一个结果。 */
  revision: number
  updatedAt: string
  /** 已完成节点，按阶段顺序追加；恢复时从最后完成节点的下一节点继续。 */
  completed: DrillStepKey[]
  preparation: { items: PrepItem[]; savedAt: string | null }
  checkin: {
    onsite: CheckinEntry[]
    manual: CheckinEntry[]
    /** 合并后的有效名单：现场签到为准，人工补录只补充现场未覆盖的人员。 */
    effective: CheckinEntry[]
    savedAt: string | null
  }
  evacuation: { confirmed: string[]; allClear: boolean; savedAt: string | null }
  summary: {
    content: string
    evaluation: string
    savedAt: string | null
    /** 归档时间；一旦归档，重复恢复和重复提交都不得覆盖这份总结。 */
    archivedAt: string | null
  }
}

export type ReviewTodo = {
  id: string
  drillId: number
  title: string
  createdAt: string
  done: boolean
}

export type DrillSaveResult = {
  ok: boolean
  message: string
  draft?: DrillDraft
}
