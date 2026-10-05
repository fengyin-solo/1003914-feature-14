import {
  formatNow,
  loadDraft,
  loadReviewTodos,
  persistDraft,
  persistReviewTodos,
} from '@/data/drill-drafts'
import type {
  ChecklistItem,
  DrillDraft,
  DrillStage,
  Participant,
  ParticipantSource,
  ReviewTodo,
  SummaryPayload,
} from '@/data/drill-drafts'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'
import { runAction } from './local-service'

// 断点续做的四个节点，顺序即流转顺序；每段单独保存，恢复时从最后完成节点的下一段继续。
export const DRILL_STAGES: DrillStage[] = ['筹备清单', '签到', '撤离确认', '总结']

const DEFAULT_CHECKLIST = ['演练方案', '物资器材', '人员通知', '场地布置', '安全评估']

export type ResumeResult = {
  draft: DrillDraft
  nextStage: DrillStage | null
  readonly: boolean
}

function findRow(drillId: number): EntryRow | null {
  return listRows('drill').find((row) => Number(row.id) === drillId) ?? null
}

function newToken(drillId: number): string {
  return `drill-${drillId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function ensureDraft(drillId: number): DrillDraft {
  const existing = loadDraft(drillId)
  if (existing) {
    return existing
  }
  const draft: DrillDraft = {
    drillId,
    checklist: DEFAULT_CHECKLIST.map((name) => ({ name, done: false })),
    participants: [],
    evacuated: [],
    summary: { content: '', evaluation: '' },
    completedStages: [],
    submitToken: newToken(drillId),
    submittedAt: '',
    archived: false,
    updatedAt: formatNow(),
  }
  persistDraft(draft)
  return draft
}

// 已归档的总结是受保护的：重复恢复、再次保存都不能覆盖，一律拒绝写入。
function writableDraft(drillId: number): { draft: DrillDraft; error?: never } | { draft?: never; error: ActionResult } {
  const row = findRow(drillId)
  if (!row) {
    return { error: { ok: false, message: `没有找到编号为 ${drillId} 的演练记录` } }
  }
  const draft = ensureDraft(drillId)
  if (draft.archived || String(row.status) === '已归档') {
    return { error: { ok: false, message: '演练总结已归档，草稿只读，恢复与保存都不会覆盖它' } }
  }
  return { draft }
}

function markCompleted(draft: DrillDraft, stage: DrillStage): DrillDraft {
  const completedStages = draft.completedStages.includes(stage)
    ? draft.completedStages
    : [...draft.completedStages, stage]
  const next = { ...draft, completedStages, updatedAt: formatNow() }
  persistDraft(next)
  return next
}

// 现场签到与人工补录冲突时以现场签到为准：同名人员只保留现场签到那条，
// 人工补录只补充未签到的人；已存在的人员保留原签到时间。
function mergeParticipants(onsite: string[], manual: string[], previous: Participant[]): Participant[] {
  const prevByKey = new Map(previous.map((item) => [`${item.source}:${item.name}`, item]))
  const seen = new Set<string>()
  const merged: Participant[] = []
  const push = (rawName: string, source: ParticipantSource) => {
    const name = rawName.trim()
    if (!name || seen.has(name)) {
      return
    }
    seen.add(name)
    const prev = prevByKey.get(`${source}:${name}`)
    merged.push({ name, source, signedAt: prev?.signedAt ?? formatNow() })
  }
  onsite.forEach((name) => push(name, '现场签到'))
  manual.forEach((name) => push(name, '人工补录'))
  return merged
}

// 读取路径：页面打开面板时从这里拿草稿，并算出该从哪一段继续。
export function resumeDraft(drillId: number): ResumeResult {
  const draft = ensureDraft(drillId)
  const row = findRow(drillId)
  const readonly = draft.archived || String(row?.status ?? '') === '已归档'
  const nextStage = DRILL_STAGES.find((stage) => !draft.completedStages.includes(stage)) ?? null
  return { draft, nextStage, readonly }
}

export function saveChecklist(drillId: number, items: ChecklistItem[]): ActionResult {
  const result = writableDraft(drillId)
  if (result.error) {
    return result.error
  }
  const checklist = items.map((item) => ({ name: item.name, done: Boolean(item.done) }))
  markCompleted({ ...result.draft, checklist }, '筹备清单')
  return { ok: true, message: '筹备清单已保存，可从签到节点继续' }
}

export function saveSignin(drillId: number, onsite: string[], manual: string[]): ActionResult {
  const result = writableDraft(drillId)
  if (result.error) {
    return result.error
  }
  const participants = mergeParticipants(onsite, manual, result.draft.participants)
  const valid = new Set(participants.map((item) => item.name))
  const evacuated = result.draft.evacuated.filter((name) => valid.has(name))
  markCompleted({ ...result.draft, participants, evacuated }, '签到')
  return { ok: true, message: `签到已保存，共 ${participants.length} 人（同名冲突以现场签到为准）` }
}

export function saveEvacuation(drillId: number, names: string[]): ActionResult {
  const result = writableDraft(drillId)
  if (result.error) {
    return result.error
  }
  const valid = new Set(result.draft.participants.map((item) => item.name))
  const evacuated = names.filter((name) => valid.has(name))
  markCompleted({ ...result.draft, evacuated }, '撤离确认')
  return { ok: true, message: `撤离确认已保存，已确认 ${evacuated.length} 人撤离` }
}

export function saveSummaryDraft(drillId: number, summary: SummaryPayload): ActionResult {
  const result = writableDraft(drillId)
  if (result.error) {
    return result.error
  }
  if (result.draft.submittedAt) {
    return { ok: false, message: '总结已提交，草稿不能再改' }
  }
  markCompleted({ ...result.draft, summary: { ...summary } }, '总结')
  return { ok: true, message: '总结草稿已保存' }
}

// 参演人数同步：旧演练记录该字段为空白的保留原空白，不拿签到数去补。
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

// 总结提交后同步生成复盘待办；同一演练只留一条未完成的，重复提交在入口处已被拦截。
function createReviewTodo(row: EntryRow, draft: DrillDraft): void {
  const todos = loadReviewTodos()
  if (todos.some((todo) => todo.drillId === draft.drillId && !todo.done)) {
    return
  }
  todos.push({
    id: `todo-${draft.drillId}-${Date.now()}`,
    drillId: draft.drillId,
    drillCode: String(row['演练编号'] ?? ''),
    drillTopic: String(row['演练主题'] ?? ''),
    content: `复盘「${String(row['演练主题'] ?? '')}」：签到 ${draft.participants.length} 人、撤离确认 ${draft.evacuated.length} 人，核对总结后归档`,
    createdAt: formatNow(),
    done: false,
  })
  persistReviewTodos(todos)
}

// 并发提交只允许一个结果持久化：提交凭证 + 已提交标记在同一同步块里校验后立刻占位，
// 重复点击、重复恢复出的旧面板都会被挡下。
export function submitSummary(drillId: number, token: string): ActionResult {
  const result = writableDraft(drillId)
  if (result.error) {
    return result.error
  }
  const draft = result.draft
  if (draft.submittedAt) {
    return { ok: false, message: '总结已提交，重复提交被拦截' }
  }
  if (!token || token !== draft.submitToken) {
    return { ok: false, message: '提交凭证已失效，请重新进入总结节点再提交' }
  }
  const missing = DRILL_STAGES.slice(0, 3).filter((stage) => !draft.completedStages.includes(stage))
  if (missing.length > 0) {
    return { ok: false, message: `还有未完成的节点：${missing.join('、')}` }
  }
  if (!draft.summary.content.trim()) {
    return { ok: false, message: '总结内容为空，请先保存总结草稿' }
  }
  const row = findRow(drillId)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${drillId} 的演练记录` }
  }
  const submittedAt = formatNow()
  persistDraft({ ...draft, submittedAt, updatedAt: submittedAt })
  if (!['已总结', '已归档'].includes(String(row.status))) {
    runAction('drill', drillId, '提交总结')
  }
  syncParticipantCount(drillId, draft.participants.length)
  createReviewTodo(row, draft)
  return { ok: true, message: '总结已提交，已同步生成复盘待办' }
}

// 归档后草稿转为只读：writableDraft 的守卫会挡住之后的一切写入。
export function archiveDrill(drillId: number): ActionResult {
  const row = findRow(drillId)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${drillId} 的演练记录` }
  }
  if (String(row.status) !== '已总结') {
    return { ok: false, message: '只有已总结的演练才能归档' }
  }
  const result = runAction('drill', drillId, '归档演练')
  if (!result.ok) {
    return result
  }
  const draft = loadDraft(drillId)
  if (draft) {
    persistDraft({ ...draft, archived: true, updatedAt: formatNow() })
  }
  return { ok: true, message: '演练已归档，总结与草稿转为只读' }
}

export function listReviewTodos(): ReviewTodo[] {
  return loadReviewTodos()
}

export function completeReviewTodo(id: string): ActionResult {
  const todos = loadReviewTodos()
  const index = todos.findIndex((todo) => todo.id === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这条复盘待办' }
  }
  todos[index] = { ...todos[index], done: true }
  persistReviewTodos(todos)
  return { ok: true, message: '复盘待办已完成' }
}
