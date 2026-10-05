<template>
  <section class="page" data-module="drill">
    <header class="page-head">
      <div>
        <h2>应急演练管理</h2>
        <p class="page-desc">维护演练记录，围绕演练编号、隐患点编号、演练主题、演练日期做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记演练记录</button>
        <button class="btn" type="button" @click="exportRows">导出应急演练清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            {{ row.status }}
            <span v-if="draftIds.has(Number(row.id))" class="draft-badge">草稿</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openWorkspace(row)">
              {{ draftIds.has(Number(row.id)) ? '继续演练' : '演练工作台' }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无应急演练数据，可先登记演练记录</td>
        </tr>
      </tbody>
    </table>

    <section v-if="activeRow" class="workspace">
      <header class="workspace-head">
        <h3>演练工作台：{{ activeRow['演练编号'] }} · {{ activeRow['演练主题'] }}</h3>
        <button class="btn ghost" type="button" @click="closeWorkspace">收起工作台</button>
      </header>

      <ol class="step-bar">
        <li
          v-for="step in stepDefs"
          :key="step.key"
          class="step-item"
          :class="stepClass(step.key)"
        >
          <span class="step-name">{{ step.label }}</span>
          <span class="step-time">{{ savedAtOf(step.key) ?? '未保存' }}</span>
        </li>
      </ol>
      <p class="resume-hint">{{ resumeHint }}</p>

      <section class="stage">
        <h4>一、筹备清单</h4>
        <ul v-if="isCompleted('preparation')" class="readonly-list">
          <li v-for="item in draft?.preparation.items ?? []" :key="item.key">✓ {{ item.label }}</li>
        </ul>
        <template v-else-if="currentStep === 'preparation'">
          <label v-for="item in prepForm" :key="item.key" class="check-item">
            <input v-model="item.done" type="checkbox" />
            {{ item.label }}
          </label>
          <button class="btn primary" type="button" :disabled="saving" @click="savePreparationStage">
            保存筹备清单
          </button>
        </template>
        <p v-else class="stage-locked">按顺序推进，完成上一阶段后解锁</p>
      </section>

      <section class="stage">
        <h4>二、签到</h4>
        <template v-if="isCompleted('checkin')">
          <p class="hint">有效参演 {{ draft?.checkin.effective.length ?? 0 }} 人：</p>
          <p>
            <span v-for="person in draft?.checkin.effective ?? []" :key="person.name" class="name-tag">
              {{ person.name }}（{{ person.source === 'onsite' ? '现场签到' : '人工补录' }}）
            </span>
          </p>
        </template>
        <template v-else-if="currentStep === 'checkin'">
          <label class="check-item">
            <span class="field-label">现场签到名单（每行一个姓名）</span>
            <textarea v-model="onsiteText" placeholder="张三&#10;李四"></textarea>
          </label>
          <label class="check-item">
            <span class="field-label">人工补录名单（每行一个姓名）</span>
            <textarea v-model="manualText" placeholder="王五"></textarea>
          </label>
          <p class="hint">同一人同时出现在两份名单时，以现场签到为准，人工补录只补充现场未覆盖的人员。</p>
          <button class="btn primary" type="button" :disabled="saving" @click="saveCheckinStage">
            保存签到
          </button>
        </template>
        <p v-else class="stage-locked">按顺序推进，完成上一阶段后解锁</p>
      </section>

      <section class="stage">
        <h4>三、撤离确认</h4>
        <template v-if="isCompleted('evacuation')">
          <p>
            <span v-for="name in draft?.evacuation.confirmed ?? []" :key="name" class="name-tag">
              {{ name }}（已撤离）
            </span>
          </p>
          <p class="hint">全部参演人员已确认安全撤离。</p>
        </template>
        <template v-else-if="currentStep === 'evacuation'">
          <label v-for="person in evacForm" :key="person.name" class="check-item">
            <input v-model="person.confirmed" type="checkbox" />
            {{ person.name }} 已安全撤离
          </label>
          <button class="btn" type="button" @click="checkAllEvacuated">全部勾选</button>
          <button class="btn primary" type="button" :disabled="saving" @click="saveEvacuationStage">
            保存撤离确认
          </button>
        </template>
        <p v-else class="stage-locked">按顺序推进，完成上一阶段后解锁</p>
      </section>

      <section class="stage">
        <h4>四、总结</h4>
        <template v-if="draft?.summary.archivedAt">
          <p class="summary-content">{{ draft.summary.content }}</p>
          <p class="hint">
            演练评价：{{ draft.summary.evaluation || '—' }} · 已归档于 {{ draft.summary.archivedAt }}，归档后不可更改
          </p>
        </template>
        <template v-else-if="currentStep === 'summary'">
          <label class="check-item">
            <span class="field-label">演练总结（过程、暴露问题、改进措施）</span>
            <textarea v-model="summaryContent" placeholder="记录演练全过程与复盘要点"></textarea>
          </label>
          <label class="check-item">
            <span class="field-label">演练评价</span>
            <input v-model="summaryEval" placeholder="如：优秀 / 良好 / 待改进" />
          </label>
          <button class="btn" type="button" :disabled="saving" @click="saveSummaryDraftStage">
            保存总结草稿
          </button>
          <button class="btn primary" type="button" :disabled="submitting" @click="submitSummaryStage">
            {{ submitting ? '提交中…' : '提交总结' }}
          </button>
        </template>
        <p v-else class="stage-locked">按顺序推进，完成上一阶段后解锁</p>
      </section>
    </section>

    <section class="todo-panel">
      <h3>复盘待办</h3>
      <p v-if="!reviewTodos.length" class="hint">总结提交后会同步生成复盘待办。</p>
      <ul v-else>
        <li v-for="todo in reviewTodos" :key="todo.id" :class="{ done: todo.done }">
          <label>
            <input type="checkbox" :checked="todo.done" @change="toggleTodo(todo)" />
            {{ todo.title }}
          </label>
          <span class="todo-time">{{ todo.createdAt }}</span>
        </li>
      </ul>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条应急演练记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  DRILL_STEPS,
  currentStepOf,
  defaultPreparationItems,
  getDraft,
  listDraftIds,
  listReviewTodos,
  saveCheckin,
  saveEvacuation,
  savePreparation,
  saveSummaryDraft,
  setTodoDone,
  submitSummary,
} from '@/api/drill-service'
import type {
  DrillDraft,
  DrillSaveResult,
  DrillStepKey,
  EntryRow,
  PrepItem,
  ReviewTodo,
} from '@/data/types'

const meta = moduleMeta('drill')
const columns = ["演练编号", "隐患点编号", "演练主题", "演练日期", "参演人数", "演练类型", "演练评价", "演练状态"]
const actions = ["开始筹备", "实施演练", "提交总结"]
const statuses = ["待筹备", "筹备中", "已实施", "已总结", "已归档"]
const stats = [{"label": "年度演练次数", "value": 0}, {"label": "已实施场次", "value": 0}, {"label": "待筹备计划", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 断点续做工作台状态
const stepDefs = DRILL_STEPS
const activeRow = ref<EntryRow | null>(null)
const draft = ref<DrillDraft | null>(null)
const draftRevision = ref(0)
const saving = ref(false)
const submitting = ref(false)
const prepForm = ref<PrepItem[]>([])
const onsiteText = ref('')
const manualText = ref('')
const evacForm = ref<{ name: string; confirmed: boolean }[]>([])
const summaryContent = ref('')
const summaryEval = ref('')
const reviewTodos = ref<ReviewTodo[]>([])
const draftIds = ref<Set<number>>(new Set())

const currentStep = computed<DrillStepKey>(() => currentStepOf(draft.value))

const resumeHint = computed(() => {
  const current = draft.value
  if (!current) {
    return '暂无草稿，从「筹备清单」开始，各阶段分段保存。'
  }
  if (current.summary.archivedAt) {
    return '总结已归档，本次为只读查看，重复恢复不会覆盖归档总结。'
  }
  if (current.completed.length === 0) {
    return '草稿已恢复，从「筹备清单」继续。'
  }
  const label = stepDefs.find((step) => step.key === currentStep.value)?.label ?? ''
  return `草稿已恢复，已完成 ${current.completed.length} 个节点，从「${label}」继续。`
})

function isCompleted(step: DrillStepKey): boolean {
  return draft.value?.completed.includes(step) ?? false
}

function savedAtOf(step: DrillStepKey): string | null {
  const current = draft.value
  if (!current) {
    return null
  }
  return current[step].savedAt
}

function stepClass(step: DrillStepKey) {
  return {
    done: isCompleted(step),
    current: !isCompleted(step) && currentStep.value === step,
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '演练记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

// 读取路径：每次进入工作台都重新读 localStorage，刷新、重进拿到的都是同一份草稿。
function openWorkspace(row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  activeRow.value = row
  restoreDraft(Number(row.id))
}

function closeWorkspace() {
  activeRow.value = null
  draft.value = null
}

function restoreDraft(drillId: number) {
  const restored = getDraft(drillId)
  draft.value = restored
  draftRevision.value = restored?.revision ?? 0
  prepForm.value = (restored?.preparation.items.length
    ? restored.preparation.items
    : defaultPreparationItems()
  ).map((item) => ({ ...item }))
  onsiteText.value = restored?.checkin.onsite.map((person) => person.name).join('\n') ?? ''
  manualText.value = restored?.checkin.manual.map((person) => person.name).join('\n') ?? ''
  evacForm.value = (restored?.checkin.effective ?? []).map((person) => ({
    name: person.name,
    confirmed: restored?.evacuation.confirmed.includes(person.name) ?? false,
  }))
  summaryContent.value = restored?.summary.content ?? ''
  summaryEval.value = restored?.summary.evaluation ?? ''
}

function applyResult(result: DrillSaveResult): boolean {
  if (!result.ok) {
    errorMessage.value = result.message
    return false
  }
  errorMessage.value = ''
  noticeMessage.value = result.message
  if (result.draft) {
    draft.value = result.draft
    draftRevision.value = result.draft.revision
  }
  refreshDraftIds()
  reload()
  return true
}

function savePreparationStage() {
  if (!activeRow.value) {
    return
  }
  saving.value = true
  try {
    applyResult(savePreparation(Number(activeRow.value.id), prepForm.value, draftRevision.value))
  } finally {
    saving.value = false
  }
}

function parseNames(text: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const line of text.split('\n')) {
    const name = line.trim()
    if (name && !seen.has(name)) {
      seen.add(name)
      names.push(name)
    }
  }
  return names
}

function saveCheckinStage() {
  if (!activeRow.value) {
    return
  }
  saving.value = true
  try {
    const result = saveCheckin(
      Number(activeRow.value.id),
      parseNames(onsiteText.value),
      parseNames(manualText.value),
      draftRevision.value,
    )
    if (applyResult(result) && result.draft) {
      evacForm.value = result.draft.checkin.effective.map((person) => ({
        name: person.name,
        confirmed: false,
      }))
    }
  } finally {
    saving.value = false
  }
}

function checkAllEvacuated() {
  evacForm.value = evacForm.value.map((person) => ({ ...person, confirmed: true }))
}

function saveEvacuationStage() {
  if (!activeRow.value) {
    return
  }
  saving.value = true
  try {
    applyResult(
      saveEvacuation(
        Number(activeRow.value.id),
        evacForm.value.filter((person) => person.confirmed).map((person) => person.name),
        draftRevision.value,
      ),
    )
  } finally {
    saving.value = false
  }
}

function saveSummaryDraftStage() {
  if (!activeRow.value) {
    return
  }
  saving.value = true
  try {
    applyResult(
      saveSummaryDraft(Number(activeRow.value.id), summaryContent.value, summaryEval.value, draftRevision.value),
    )
  } finally {
    saving.value = false
  }
}

function submitSummaryStage() {
  if (!activeRow.value || submitting.value) {
    return
  }
  submitting.value = true
  try {
    if (applyResult(submitSummary(Number(activeRow.value.id), summaryContent.value, summaryEval.value, draftRevision.value))) {
      refreshTodos()
    }
  } finally {
    submitting.value = false
  }
}

function toggleTodo(todo: ReviewTodo) {
  setTodoDone(todo.id, !todo.done)
  refreshTodos()
}

function refreshTodos() {
  reviewTodos.value = listReviewTodos()
}

function refreshDraftIds() {
  draftIds.value = new Set(listDraftIds())
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '应急演练列表读取失败'
  }
}

onMounted(() => {
  reload()
  refreshTodos()
  refreshDraftIds()
})
</script>
