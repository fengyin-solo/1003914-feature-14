import { listRows, saveRows } from '@/data/local-store'
import { moduleMeta, runAction } from '@/api/local-service'
import type {
  CheckinEntry,
  DrillDraft,
  DrillSaveResult,
  DrillStepKey,
  PrepItem,
  ReviewTodo,
} from '@/data/types'

// 演练断点续做草稿：与业务清单分开存，四个阶段分段落盘，
// 网络中断、刷新、重开浏览器后都能从最后完成节点继续。
const DRAFT_STORAGE_KEY = 'geohazard-monitor-prevention:drill-drafts'

type DrillWorkspace = {
  drafts: Record<string, DrillDraft>
  todos: ReviewTodo[]
}

export const DRILL_STEPS: { key: DrillStepKey; label: string }[] = [
  { key: 'preparation', label: '筹备清单' },
  { key: 'checkin', label: '签到' },
  { key: 'evacuation', label: '撤离确认' },
  { key: 'summary', label: '总结' },
]

function now(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

// 每次操作都重新读 localStorage，不做内存缓存：
// 版本号比对（乐观锁）必须基于最新落盘内容，否则并发提交拦不住。
function loadWorkspace(): DrillWorkspace {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { drafts: {}, todos: [] }
  }
  const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY)
  if (!raw) {
    return { drafts: {}, todos: [] }
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DrillWorkspace>
    return { drafts: parsed.drafts ?? {}, todos: parsed.todos ?? [] }
  } catch {
    return { drafts: {}, todos: [] }
  }
}

function persistWorkspace(workspace: DrillWorkspace): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(workspace))
    }
    return null
  } catch {
    return '本地保存失败，请检查浏览器存储空间'
  }
}

export function defaultPreparationItems(): PrepItem[] {
  return [
    '演练方案与脚本已制定',
    '物资器材已到位',
    '参演人员已通知到位',
    '演练场地已布置',
    '通讯设备已测试',
  ].map((label, index) => ({ key: `prep-${index + 1}`, label, done: false }))
}

function createEmptyDraft(drillId: number): DrillDraft {
  return {
    drillId,
    revision: 0,
    updatedAt: '',
    completed: [],
    preparation: { items: defaultPreparationItems(), savedAt: null },
    checkin: { onsite: [], manual: [], effective: [], savedAt: null },
    evacuation: { confirmed: [], allClear: false, savedAt: null },
    summary: { content: '', evaluation: '', savedAt: null, archivedAt: null },
  }
}

/** 读取路径：进入工作台时调用，刷新、重新进入拿到的都是同一份草稿。 */
export function getDraft(drillId: number): DrillDraft | null {
  return loadWorkspace().drafts[String(drillId)] ?? null
}

export function listDraftIds(): number[] {
  return Object.keys(loadWorkspace().drafts).map(Number)
}

/** 断点续做：最后完成节点的下一个节点就是续做入口。 */
export function currentStepOf(draft: DrillDraft | null): DrillStepKey {
  if (!draft) {
    return 'preparation'
  }
  for (const step of DRILL_STEPS) {
    if (!draft.completed.includes(step.key)) {
      return step.key
    }
  }
  return 'summary'
}

function stepLabel(key: DrillStepKey): string {
  return DRILL_STEPS.find((step) => step.key === key)?.label ?? key
}

/**
 * 分段保存的公共骨架：读最新工作区 → 比对版本号 → 执行变更 → 一次性落盘。
 * mutate 返回错误串则放弃本次写入；返回 null 表示通过。
 */
function mutateDraft(
  drillId: number,
  expectedRevision: number,
  mutate: (draft: DrillDraft, workspace: DrillWorkspace) => string | null,
): DrillSaveResult {
  const workspace = loadWorkspace()
  const key = String(drillId)
  const existing = workspace.drafts[key]
  if ((existing?.revision ?? 0) !== expectedRevision) {
    return { ok: false, message: '这份草稿已被其他窗口更新，请重新进入工作台再试' }
  }
  const draft = existing ?? createEmptyDraft(drillId)
  const error = mutate(draft, workspace)
  if (error) {
    return { ok: false, message: error }
  }
  draft.revision += 1
  draft.updatedAt = now()
  workspace.drafts[key] = draft
  const persistError = persistWorkspace(workspace)
  if (persistError) {
    return { ok: false, message: persistError }
  }
  return { ok: true, message: '', draft }
}

/** 状态只能往前走：旧记录状态更靠后时不动它，避免把「已实施」退回「筹备中」。 */
function advanceDrillStatus(drillId: number, action: string): void {
  const meta = moduleMeta('drill')
  const target = meta.actionTargets[action]
  const row = listRows('drill').find((item) => Number(item.id) === drillId)
  if (!row || !target) {
    return
  }
  if (meta.statuses.indexOf(String(row.status)) < meta.statuses.indexOf(target)) {
    runAction('drill', drillId, action)
  }
}

export function savePreparation(
  drillId: number,
  items: PrepItem[],
  expectedRevision: number,
): DrillSaveResult {
  if (items.some((item) => !item.done)) {
    return { ok: false, message: '筹备清单尚有未完成项，全部勾选后才能保存' }
  }
  const result = mutateDraft(drillId, expectedRevision, (draft) => {
    if (draft.completed.includes('preparation')) {
      return '筹备清单已完成，不能重复保存'
    }
    draft.preparation = { items: items.map((item) => ({ ...item })), savedAt: now() }
    draft.completed.push('preparation')
    return null
  })
  if (result.ok) {
    advanceDrillStatus(drillId, '开始筹备')
    result.message = `筹备清单已保存，从「${stepLabel('checkin')}」继续`
  }
  return result
}

function toEntries(names: string[], source: CheckinEntry['source']): CheckinEntry[] {
  const stamp = now()
  return names.map((name) => ({ name, source, time: stamp }))
}

/**
 * 冲突裁决：现场签到为准。同一人两边都有时保留现场签到记录，
 * 人工补录只补充现场签到未覆盖的人员。
 */
export function mergeCheckins(onsite: string[], manual: string[]): CheckinEntry[] {
  const seen = new Set<string>()
  const effective: CheckinEntry[] = []
  for (const entry of [...toEntries(onsite, 'onsite'), ...toEntries(manual, 'manual')]) {
    if (!seen.has(entry.name)) {
      seen.add(entry.name)
      effective.push(entry)
    }
  }
  return effective
}

export function saveCheckin(
  drillId: number,
  onsiteNames: string[],
  manualNames: string[],
  expectedRevision: number,
): DrillSaveResult {
  const effective = mergeCheckins(onsiteNames, manualNames)
  if (effective.length === 0) {
    return { ok: false, message: '签到名单为空，至少登记一名参演人员' }
  }
  const result = mutateDraft(drillId, expectedRevision, (draft) => {
    if (!draft.completed.includes('preparation')) {
      return `请先完成「${stepLabel('preparation')}」`
    }
    if (draft.completed.includes('checkin')) {
      return '签到已完成，不能重复保存'
    }
    draft.checkin = {
      onsite: toEntries(onsiteNames, 'onsite'),
      manual: toEntries(manualNames, 'manual'),
      effective,
      savedAt: now(),
    }
    draft.completed.push('checkin')
    return null
  })
  if (result.ok) {
    syncParticipantCount(drillId, effective.length)
    result.message = `签到已保存（有效 ${effective.length} 人，冲突以现场签到为准），从「${stepLabel('evacuation')}」继续`
  }
  return result
}

/**
 * 参与人员保存：按有效名单人数更新演练记录的参演人数。
 * 旧演练原本缺参演人数（空白）的，保留原空白，不回填。
 */
function syncParticipantCount(drillId: number, count: number): void {
  const rows = listRows('drill')
  const index = rows.findIndex((row) => Number(row.id) === drillId)
  if (index < 0) {
    return
  }
  if (String(rows[index]['参演人数'] ?? '').trim() === '') {
    return
  }
  const next = [...rows]
  next[index] = { ...rows[index], '参演人数': String(count) }
  saveRows('drill', next)
}

export function saveEvacuation(
  drillId: number,
  confirmedNames: string[],
  expectedRevision: number,
): DrillSaveResult {
  const result = mutateDraft(drillId, expectedRevision, (draft) => {
    if (!draft.completed.includes('checkin')) {
      return `请先完成「${stepLabel('checkin')}」`
    }
    if (draft.completed.includes('evacuation')) {
      return '撤离确认已完成，不能重复保存'
    }
    const missing = draft.checkin.effective
      .map((person) => person.name)
      .filter((name) => !confirmedNames.includes(name))
    if (missing.length > 0) {
      return `以下人员尚未确认撤离：${missing.join('、')}`
    }
    draft.evacuation = { confirmed: [...confirmedNames], allClear: true, savedAt: now() }
    draft.completed.push('evacuation')
    return null
  })
  if (result.ok) {
    advanceDrillStatus(drillId, '实施演练')
    result.message = `撤离确认已保存，从「${stepLabel('summary')}」继续`
  }
  return result
}

/** 总结草稿：只存内容，不完成节点、不归档；已归档的总结不允许再改。 */
export function saveSummaryDraft(
  drillId: number,
  content: string,
  evaluation: string,
  expectedRevision: number,
): DrillSaveResult {
  const result = mutateDraft(drillId, expectedRevision, (draft) => {
    if (draft.summary.archivedAt) {
      return '总结已归档，草稿不能再改'
    }
    if (!draft.completed.includes('evacuation')) {
      return `请先完成「${stepLabel('evacuation')}」`
    }
    draft.summary = { ...draft.summary, content, evaluation, savedAt: now() }
    return null
  })
  if (result.ok) {
    result.message = '总结草稿已保存'
  }
  return result
}

function buildReviewTodos(drillId: number, subject: string): ReviewTodo[] {
  const stamp = Date.now()
  return [
    `整理「${subject}」签到与影像资料并归档`,
    `组织「${subject}」参演人员复盘讲评会`,
    `对照「${subject}」总结修订应急预案薄弱项`,
  ].map((title, index) => ({
    id: `review-${drillId}-${stamp}-${index}`,
    drillId,
    title,
    createdAt: now(),
    done: false,
  }))
}

/**
 * 总结入口：提交即归档，并在同一次落盘里同步生成复盘待办。
 * 并发/重复提交只放行一个结果：先拦已归档（幂等），再拦版本号（乐观锁）。
 */
export function submitSummary(
  drillId: number,
  content: string,
  evaluation: string,
  expectedRevision: number,
): DrillSaveResult {
  const text = content.trim()
  if (!text) {
    return { ok: false, message: '总结内容不能为空' }
  }
  const workspace = loadWorkspace()
  const key = String(drillId)
  const existing = workspace.drafts[key]
  if (existing?.summary.archivedAt) {
    return { ok: false, message: '总结已提交并归档，重复提交被忽略' }
  }
  if ((existing?.revision ?? 0) !== expectedRevision) {
    return { ok: false, message: '这份草稿已被其他窗口更新，请重新进入工作台再试' }
  }
  const draft = existing ?? createEmptyDraft(drillId)
  const unfinished = DRILL_STEPS.filter(
    (step) => step.key !== 'summary' && !draft.completed.includes(step.key),
  )
  if (unfinished.length > 0) {
    return { ok: false, message: `请先完成「${unfinished.map((step) => step.label).join('」「')}」` }
  }
  const stamp = now()
  draft.summary = { content: text, evaluation: evaluation.trim(), savedAt: stamp, archivedAt: stamp }
  draft.completed.push('summary')
  draft.revision += 1
  draft.updatedAt = stamp
  workspace.drafts[key] = draft
  const row = listRows('drill').find((item) => Number(item.id) === drillId)
  const subject = String(row?.['演练主题'] ?? `演练${drillId}`)
  workspace.todos.push(...buildReviewTodos(drillId, subject))
  const persistError = persistWorkspace(workspace)
  if (persistError) {
    return { ok: false, message: persistError }
  }
  advanceDrillStatus(drillId, '提交总结')
  return { ok: true, message: '总结已提交并归档，复盘待办已同步生成', draft }
}

export function listReviewTodos(): ReviewTodo[] {
  return loadWorkspace().todos
}

export function setTodoDone(todoId: string, done: boolean): void {
  const workspace = loadWorkspace()
  const todo = workspace.todos.find((item) => item.id === todoId)
  if (todo) {
    todo.done = done
    persistWorkspace(workspace)
  }
}
