// 演练断点续做的本地持久化：草稿与复盘待办按演练记录 id 分开存，
// 和 entries 一样放在 localStorage 里，刷新、断网后重进都还在。
const DRAFT_STORAGE_KEY = 'geohazard-monitor-prevention:drill-drafts'
const TODO_STORAGE_KEY = 'geohazard-monitor-prevention:drill-review-todos'

export type DrillStage = '筹备清单' | '签到' | '撤离确认' | '总结'

export type ChecklistItem = {
  name: string
  done: boolean
}

export type ParticipantSource = '现场签到' | '人工补录'

export type Participant = {
  name: string
  source: ParticipantSource
  signedAt: string
}

export type SummaryPayload = {
  content: string
  evaluation: string
}

export type DrillDraft = {
  drillId: number
  checklist: ChecklistItem[]
  participants: Participant[]
  evacuated: string[]
  summary: SummaryPayload
  completedStages: DrillStage[]
  submitToken: string
  submittedAt: string
  archived: boolean
  updatedAt: string
}

export type ReviewTodo = {
  id: string
  drillId: number
  drillCode: string
  drillTopic: string
  content: string
  createdAt: string
  done: boolean
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

function readJson<T>(key: string, fallback: T): T {
  if (!canUseStorage()) {
    return clone(fallback)
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
}

function writeJson(key: string, value: unknown): void {
  if (canUseStorage()) {
    window.localStorage.setItem(key, JSON.stringify(value))
  }
}

let draftCache: Record<string, DrillDraft> | null = null
let todoCache: ReviewTodo[] | null = null

function allDrafts(): Record<string, DrillDraft> {
  if (draftCache === null) {
    draftCache = readJson<Record<string, DrillDraft>>(DRAFT_STORAGE_KEY, {})
  }
  return draftCache
}

export function loadDraft(drillId: number): DrillDraft | null {
  const draft = allDrafts()[String(drillId)]
  return draft ? clone(draft) : null
}

export function persistDraft(draft: DrillDraft): void {
  const next = { ...allDrafts(), [String(draft.drillId)]: clone(draft) }
  draftCache = next
  writeJson(DRAFT_STORAGE_KEY, next)
}

export function loadReviewTodos(): ReviewTodo[] {
  if (todoCache === null) {
    todoCache = readJson<ReviewTodo[]>(TODO_STORAGE_KEY, [])
  }
  return clone(todoCache)
}

export function persistReviewTodos(todos: ReviewTodo[]): void {
  todoCache = clone(todos)
  writeJson(TODO_STORAGE_KEY, todoCache)
}

export function formatNow(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  return `${date} ${time}`
}
