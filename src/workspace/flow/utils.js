import { parseDay, todayKey } from '../../lib/format.js'

// The database keeps "Medium"; OVO Flow calls it "Normal".
export const PRIORITIES = [
  { value: 'Urgent', label: 'Urgent', color: '#e5484d' },
  { value: 'High', label: 'High', color: '#e8a02d' },
  { value: 'Medium', label: 'Normal', color: '#4f86f7' },
  { value: 'Low', label: 'Low', color: '#8d8aa3' },
]
export const priorityLabel = (value) => PRIORITIES.find((item) => item.value === value)?.label || value
export const priorityColor = (value) => PRIORITIES.find((item) => item.value === value)?.color || '#8d8aa3'

export const STAGE_COLORS = ['#8b8aa3', '#4f86f7', '#e8a02d', '#9468f0', '#2bb673', '#e5484d', '#0d9488', '#db2777']
export const CATEGORIES = [
  { value: 'To Do', label: 'To do' },
  { value: 'In Progress', label: 'In progress' },
  { value: 'Review', label: 'In review' },
  { value: 'Completed', label: 'Done' },
]

export const isOverdue = (task) => Boolean(task.dueDate) && task.status !== 'Completed' && task.dueDate < todayKey()
export const byPosition = (a, b) => (a.position - b.position) || String(a.createdAt).localeCompare(String(b.createdAt))

export const EMPTY_FILTERS = { search: '', assignee: '', priority: '', stage: '', due: '', tag: '' }
export const activeFilterCount = (filters) => Object.values(filters).filter(Boolean).length

function weekEnd() {
  const end = parseDay(todayKey())
  end.setDate(end.getDate() + 7)
  return todayKey(end)
}

export function matchesFilters(task, filters) {
  const query = filters.search.trim().toLowerCase()
  if (query && !`${task.title} ${task.description} ${(task.tags || []).join(' ')}`.toLowerCase().includes(query)) return false
  if (filters.assignee === 'none' ? task.assigneeId : filters.assignee && task.assigneeId !== filters.assignee) return false
  if (filters.priority && task.priority !== filters.priority) return false
  if (filters.stage && task.stageId !== filters.stage) return false
  if (filters.tag && !(task.tags || []).includes(filters.tag)) return false
  if (filters.due) {
    const today = todayKey()
    if (filters.due === 'overdue' && !isOverdue(task)) return false
    if (filters.due === 'today' && task.dueDate !== today) return false
    if (filters.due === 'week' && !(task.dueDate && task.dueDate >= today && task.dueDate <= weekEnd())) return false
    if (filters.due === 'none' && task.dueDate) return false
  }
  return true
}

const priorityRank = { Urgent: 0, High: 1, Medium: 2, Low: 3 }
export const SORTS = [
  { value: 'manual', label: 'Manual order' },
  { value: 'priority', label: 'Priority' },
  { value: 'due', label: 'Due date' },
  { value: 'title', label: 'Title A–Z' },
]
export function sortTasks(tasks, sort) {
  const list = [...tasks].sort(byPosition)
  if (sort === 'priority') return list.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority])
  if (sort === 'due') return list.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
  if (sort === 'title') return list.sort((a, b) => a.title.localeCompare(b.title))
  return list
}

// Where a card dropped at `visibleIndex` among the visible cards belongs among all of the column's cards.
export function fullIndex(fullIds, visibleIds, visibleIndex) {
  if (visibleIndex < visibleIds.length) {
    const found = fullIds.indexOf(visibleIds[visibleIndex])
    if (found >= 0) return found
  }
  if (visibleIds.length) {
    const last = fullIds.indexOf(visibleIds[visibleIds.length - 1])
    if (last >= 0) return last + 1
  }
  return fullIds.length
}

// Real numbers from the project's tasks; nothing here is estimated.
export function insights(tasks, stages) {
  const category = new Map(stages.map((stage) => [stage.id, stage.category]))
  const total = tasks.length
  const completed = tasks.filter((task) => task.status === 'Completed').length
  return {
    total,
    completed,
    percent: total ? Math.round((completed / total) * 100) : 0,
    overdue: tasks.filter(isOverdue).length,
    inProgress: tasks.filter((task) => task.status === 'In Progress').length,
    review: tasks.filter((task) => (category.get(task.stageId) || task.status) === 'Review').length,
  }
}

// Weeks start on Monday, like the rest of OVO.
export function weekStart(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  return start
}
export function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}
export function monthGrid(month) {
  const start = weekStart(new Date(month.getFullYear(), month.getMonth(), 1))
  return Array.from({ length: 42 }, (_, index) => addDays(start, index))
}
