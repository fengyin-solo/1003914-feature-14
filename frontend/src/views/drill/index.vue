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
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openFlow(row)">断点续做</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无应急演练数据，可先登记演练记录</td>
        </tr>
      </tbody>
    </table>

    <section v-if="activeDrill" class="drill-flow">
      <header class="flow-head">
        <h3>断点续做 · {{ activeDrill['演练编号'] }}（{{ activeDrill['演练主题'] }}）</h3>
        <button class="btn ghost" type="button" @click="closeFlow">收起</button>
      </header>
      <p class="flow-resume">{{ resumeHint }}</p>
      <p v-if="flowReadonly" class="flow-notice">
        总结已归档，草稿只读；重复恢复或再次保存都不会覆盖已归档的总结。
      </p>
      <ol class="stage-bar">
        <li v-for="stage in stages" :key="stage">
          <button type="button" :class="stageClass(stage)" @click="gotoStage(stage)">
            {{ stage }}{{ isDone(stage) ? ' ✓' : '' }}
          </button>
        </li>
      </ol>

      <div v-if="currentStage === '筹备清单'" class="stage-panel">
        <label v-for="item in checklistEdit" :key="item.name" class="check-item">
          <input v-model="item.done" type="checkbox" :disabled="flowReadonly" />
          <span>{{ item.name }}</span>
        </label>
        <div class="stage-actions">
          <button class="btn primary" type="button" :disabled="flowReadonly" @click="onSaveChecklist">
            保存筹备清单
          </button>
        </div>
      </div>

      <div v-else-if="currentStage === '签到'" class="stage-panel">
        <div class="signin-grid">
          <div>
            <h4>现场签到</h4>
            <div class="add-row">
              <input
                v-model="onsiteInput"
                placeholder="输入姓名后添加"
                :disabled="flowReadonly"
                @keyup.enter="addName(onsiteEdit, onsiteInput, 'onsite')"
              />
              <button class="btn" type="button" :disabled="flowReadonly" @click="addName(onsiteEdit, onsiteInput, 'onsite')">
                添加
              </button>
            </div>
            <ul class="name-list">
              <li v-for="name in onsiteEdit" :key="`onsite-${name}`">
                <span>{{ name }}</span>
                <button v-if="!flowReadonly" class="link" type="button" @click="removeName(name)">移除</button>
              </li>
              <li v-if="!onsiteEdit.length" class="empty-line">暂无现场签到人员</li>
            </ul>
          </div>
          <div>
            <h4>人工补录</h4>
            <div class="add-row">
              <input
                v-model="manualInput"
                placeholder="输入姓名后添加"
                :disabled="flowReadonly"
                @keyup.enter="addName(manualEdit, manualInput, 'manual')"
              />
              <button class="btn" type="button" :disabled="flowReadonly" @click="addName(manualEdit, manualInput, 'manual')">
                添加
              </button>
            </div>
            <ul class="name-list">
              <li v-for="name in manualEdit" :key="`manual-${name}`">
                <span>{{ name }}</span>
                <button v-if="!flowReadonly" class="link" type="button" @click="removeName(name)">移除</button>
              </li>
              <li v-if="!manualEdit.length" class="empty-line">暂无人工补录人员</li>
            </ul>
          </div>
        </div>
        <p class="flow-notice">同一人同时出现在现场签到与人工补录时，以现场签到为准，补录只补充未签到人员。</p>
        <p v-if="conflictNames.length" class="conflict-text">
          冲突人员：{{ conflictNames.join('、') }}（保存时按现场签到计）
        </p>
        <div class="stage-actions">
          <button class="btn primary" type="button" :disabled="flowReadonly" @click="onSaveSignin">
            保存签到
          </button>
        </div>
      </div>

      <div v-else-if="currentStage === '撤离确认'" class="stage-panel">
        <p v-if="!draft || !draft.participants.length" class="flow-resume">
          暂无签到人员，请先在「签到」节点保存名单。
        </p>
        <template v-else>
          <label v-for="person in draft.participants" :key="person.name" class="check-item">
            <input
              v-model="evacuatedEdit"
              type="checkbox"
              :value="person.name"
              :disabled="flowReadonly"
            />
            <span>{{ person.name }}（{{ person.source }} · {{ person.signedAt }}）</span>
          </label>
        </template>
        <div class="stage-actions">
          <button class="btn primary" type="button" :disabled="flowReadonly" @click="onSaveEvacuation">
            保存撤离确认
          </button>
        </div>
      </div>

      <div v-else class="stage-panel">
        <textarea
          v-model="summaryContent"
          rows="4"
          placeholder="演练过程、暴露问题与改进措施"
          :disabled="summaryLocked"
        ></textarea>
        <input
          v-model="summaryEvaluation"
          class="summary-eval"
          placeholder="演练评价"
          :disabled="summaryLocked"
        />
        <div class="stage-actions">
          <template v-if="!summaryLocked">
            <button class="btn" type="button" @click="onSaveSummary">保存总结草稿</button>
            <button class="btn primary" type="button" :disabled="submitting" @click="onSubmitSummary">
              {{ submitting ? '提交中…' : '提交总结' }}
            </button>
          </template>
          <span v-else class="flow-resume">总结已于 {{ draft?.submittedAt }} 提交</span>
          <button v-if="canArchive" class="btn" type="button" @click="onArchive">归档演练</button>
        </div>
      </div>

      <p v-if="flowMessage" class="flow-message">{{ flowMessage }}</p>
    </section>

    <section class="review-todos">
      <h3>复盘待办</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>演练编号</th>
            <th>演练主题</th>
            <th>待办内容</th>
            <th>生成时间</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="todo in todos" :key="todo.id">
            <td>{{ todo.drillCode }}</td>
            <td>{{ todo.drillTopic }}</td>
            <td>{{ todo.content }}</td>
            <td>{{ todo.createdAt }}</td>
            <td>{{ todo.done ? '已完成' : '待复盘' }}</td>
            <td>
              <button v-if="!todo.done" class="link" type="button" @click="onCompleteTodo(todo)">
                标记完成
              </button>
              <span v-else>—</span>
            </td>
          </tr>
          <tr v-if="!todos.length">
            <td colspan="6" class="empty-state">提交演练总结后会自动生成复盘待办</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条应急演练记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  DRILL_STAGES,
  archiveDrill,
  completeReviewTodo,
  listReviewTodos,
  resumeDraft,
  saveChecklist,
  saveEvacuation,
  saveSignin,
  saveSummaryDraft,
  submitSummary,
} from '@/api/drill-flow'
import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { ChecklistItem, DrillDraft, DrillStage, ReviewTodo } from '@/data/drill-drafts'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('drill')
const columns = ["演练编号", "隐患点编号", "演练主题", "演练日期", "参演人数", "演练类型", "演练评价", "演练状态"]
const actions = ["开始筹备", "实施演练", "提交总结"]
const statuses = ["待筹备", "筹备中", "已实施", "已总结", "已归档"]
const stats = [{"label": "年度演练次数", "value": 0}, {"label": "已实施场次", "value": 0}, {"label": "待筹备计划", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 断点续做面板状态：草稿从本地存储恢复，刷新或重进都回到同一份草稿。
const stages = DRILL_STAGES
const activeDrill = ref<EntryRow | null>(null)
const draft = ref<DrillDraft | null>(null)
const currentStage = ref<DrillStage>('筹备清单')
const nextStage = ref<DrillStage | null>(null)
const flowReadonly = ref(false)
const flowMessage = ref('')
const submitting = ref(false)

const checklistEdit = ref<ChecklistItem[]>([])
const onsiteEdit = ref<string[]>([])
const manualEdit = ref<string[]>([])
const evacuatedEdit = ref<string[]>([])
const onsiteInput = ref('')
const manualInput = ref('')
const summaryContent = ref('')
const summaryEvaluation = ref('')

const todos = ref<ReviewTodo[]>([])

const activeRow = computed(() => {
  if (!activeDrill.value) {
    return null
  }
  return rows.value.find((row) => Number(row.id) === Number(activeDrill.value?.id)) ?? null
})

const summaryLocked = computed(() => flowReadonly.value || Boolean(draft.value?.submittedAt))

const canArchive = computed(
  () =>
    !flowReadonly.value &&
    Boolean(draft.value?.submittedAt) &&
    String(activeRow.value?.status ?? '') === '已总结',
)

const resumeHint = computed(() => {
  if (!draft.value) {
    return ''
  }
  if (flowReadonly.value) {
    return '该演练已归档，以下内容为归档时的最终草稿。'
  }
  if (nextStage.value) {
    return `已完成 ${draft.value.completedStages.length}/${stages.length} 段，从「${nextStage.value}」节点继续。`
  }
  return '四个节点均已完成，可提交总结。'
})

const conflictNames = computed(() => {
  const onsite = new Set(onsiteEdit.value.map((name) => name.trim()).filter(Boolean))
  return manualEdit.value.map((name) => name.trim()).filter((name) => name && onsite.has(name))
})

function isDone(stage: DrillStage): boolean {
  return draft.value?.completedStages.includes(stage) ?? false
}

function stageClass(stage: DrillStage) {
  return {
    'stage-btn': true,
    done: isDone(stage),
    current: currentStage.value === stage,
  }
}

function syncEditors() {
  const current = draft.value
  if (!current) {
    return
  }
  checklistEdit.value = current.checklist.map((item) => ({ ...item }))
  onsiteEdit.value = current.participants
    .filter((person) => person.source === '现场签到')
    .map((person) => person.name)
  manualEdit.value = current.participants
    .filter((person) => person.source === '人工补录')
    .map((person) => person.name)
  evacuatedEdit.value = [...current.evacuated]
  summaryContent.value = current.summary.content
  summaryEvaluation.value = current.summary.evaluation
}

function refreshFlow() {
  if (!activeDrill.value) {
    return
  }
  const result = resumeDraft(Number(activeDrill.value.id))
  draft.value = result.draft
  nextStage.value = result.nextStage
  flowReadonly.value = result.readonly
  currentStage.value = result.nextStage ?? '总结'
  syncEditors()
}

function openFlow(row: EntryRow) {
  activeDrill.value = row
  flowMessage.value = ''
  refreshFlow()
}

function closeFlow() {
  activeDrill.value = null
  draft.value = null
  flowMessage.value = ''
}

function gotoStage(stage: DrillStage) {
  currentStage.value = stage
  flowMessage.value = ''
  syncEditors()
}

function addName(list: string[], input: string, which: 'onsite' | 'manual') {
  const name = input.trim()
  if (!name) {
    return
  }
  if (!list.includes(name)) {
    list.push(name)
  }
  if (which === 'onsite') {
    onsiteInput.value = ''
  } else {
    manualInput.value = ''
  }
}

function removeName(name: string) {
  onsiteEdit.value = onsiteEdit.value.filter((item) => item !== name)
  manualEdit.value = manualEdit.value.filter((item) => item !== name)
  evacuatedEdit.value = evacuatedEdit.value.filter((item) => item !== name)
}

function afterSave(message: string, ok: boolean) {
  flowMessage.value = message
  if (!ok || !activeDrill.value) {
    return
  }
  const result = resumeDraft(Number(activeDrill.value.id))
  draft.value = result.draft
  nextStage.value = result.nextStage
  flowReadonly.value = result.readonly
  const currentIndex = stages.indexOf(currentStage.value)
  if (result.nextStage && currentIndex >= 0 && currentIndex < stages.indexOf(result.nextStage)) {
    currentStage.value = result.nextStage
  }
  syncEditors()
}

function onSaveChecklist() {
  if (!activeDrill.value) {
    return
  }
  const result = saveChecklist(Number(activeDrill.value.id), checklistEdit.value)
  afterSave(result.message, result.ok)
}

function onSaveSignin() {
  if (!activeDrill.value) {
    return
  }
  const result = saveSignin(Number(activeDrill.value.id), onsiteEdit.value, manualEdit.value)
  afterSave(result.message, result.ok)
}

function onSaveEvacuation() {
  if (!activeDrill.value) {
    return
  }
  const result = saveEvacuation(Number(activeDrill.value.id), evacuatedEdit.value)
  afterSave(result.message, result.ok)
}

function onSaveSummary() {
  if (!activeDrill.value) {
    return
  }
  const result = saveSummaryDraft(Number(activeDrill.value.id), {
    content: summaryContent.value,
    evaluation: summaryEvaluation.value,
  })
  afterSave(result.message, result.ok)
}

function onSubmitSummary() {
  if (!activeDrill.value || submitting.value) {
    return
  }
  submitting.value = true
  try {
    const id = Number(activeDrill.value.id)
    const saved = saveSummaryDraft(id, {
      content: summaryContent.value,
      evaluation: summaryEvaluation.value,
    })
    if (!saved.ok) {
      flowMessage.value = saved.message
      return
    }
    const result = submitSummary(id, draft.value?.submitToken ?? '')
    flowMessage.value = result.message
    if (result.ok) {
      reload()
      loadTodos()
      refreshFlow()
    }
  } finally {
    submitting.value = false
  }
}

function onArchive() {
  if (!activeDrill.value) {
    return
  }
  const result = archiveDrill(Number(activeDrill.value.id))
  flowMessage.value = result.message
  if (result.ok) {
    reload()
    refreshFlow()
  }
}

function onCompleteTodo(todo: ReviewTodo) {
  const result = completeReviewTodo(todo.id)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  loadTodos()
}

function loadTodos() {
  todos.value = listReviewTodos()
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
  loadTodos()
})
</script>
