import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, getFirstCollision, pointerWithin, rectIntersection,
  useSensor, useSensors,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import Icon from '../../components/Icon.jsx'
import { Avatar, Button, Empty, Pill, Segmented } from '../../components/ui.jsx'
import { api } from '../../lib/api.js'
import { projectTone } from '../../lib/constants.js'
import { dueLabel } from '../../lib/format.js'
import { useWorkspace } from '../context.js'
import BoardView from '../flow/BoardView.jsx'
import CalendarView from '../flow/CalendarView.jsx'
import { CardBody } from '../flow/FlowCard.jsx'
import { PriorityView, TeamView } from '../flow/LaneViews.jsx'
import { NewTaskModal, StageModal } from '../flow/Modals.jsx'
import QuickDrop from '../flow/QuickDrop.jsx'
import TaskPanel from '../flow/TaskPanel.jsx'
import {
  EMPTY_FILTERS, PRIORITIES, SORTS, activeFilterCount, byPosition, fullIndex, insights, matchesFilters, sortTasks,
} from '../flow/utils.js'

const VIEWS = [
  { value: 'board', label: 'Board', icon: 'board' },
  { value: 'team', label: 'Team', icon: 'team' },
  { value: 'priority', label: 'Priority', icon: 'target' },
  { value: 'calendar', label: 'Calendar', icon: 'calendar' },
]

const remember = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* a convenience only */ } },
}

const columnOf = (map, id) => {
  const key = String(id)
  if (key.startsWith('stage:')) return key.slice(6) in map ? key.slice(6) : undefined
  return Object.keys(map).find((stage) => map[stage].includes(id))
}

function Flow() {
  const { data, params, navigate, toast, reload, isManager, openForm, confirm, loaded } = useWorkspace()
  const projectId = params.project || ''
  const [flow, setFlow] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [view, setView] = useState(() => (VIEWS.some((item) => item.value === remember.get('ovo.flow.view')) ? remember.get('ovo.flow.view') : 'board'))
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [sort, setSort] = useState('manual')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => new Set())
  const [openTask, setOpenTask] = useState(null)
  const [stageModal, setStageModal] = useState(null)
  const [newTask, setNewTask] = useState(null)
  const [quickDrop, setQuickDrop] = useState(false)
  const [dragging, setDragging] = useState(null)
  const [preview, setPreview] = useState(null)
  const [calendarMode, setCalendarMode] = useState(() => (remember.get('ovo.flow.calendar') === 'month' ? 'month' : 'week'))
  const [anchor, setAnchor] = useState(() => new Date())
  const members = data.members
  const flowRef = useRef(flow)
  flowRef.current = flow
  const syncTimer = useRef(null)

  // ---------------------------------------------------------------- Loading
  const load = useCallback(async (id, { silent = false } = {}) => {
    if (!silent) { setFlow(null); setLoadError('') }
    try {
      const result = await api(`/api/flow/projects/${id}`)
      setFlow(result)
    } catch (error) {
      if (!silent) setLoadError(error.message)
      else toast(error.message, 'error')
    }
  }, [toast])

  useEffect(() => {
    if (!projectId) return
    load(projectId)
    setCollapsed(new Set(remember.get(`ovo.flow.collapsed.${projectId}`, [])))
    setFilters(EMPTY_FILTERS)
    setSort('manual')
  }, [projectId, load])

  // With no project chosen, open the first active one.
  useEffect(() => {
    if (projectId || !loaded) return
    const first = data.projects.find((project) => !['Completed', 'Cancelled'].includes(project.status)) || data.projects[0]
    if (first) navigate('flow', { project: first.id })
  }, [projectId, loaded, data.projects, navigate])

  useEffect(() => () => clearTimeout(syncTimer.current), [])
  // Keep the rest of OVO (Tasks, Projects, Home) in step without refetching on every drag.
  const syncOthers = useCallback(() => {
    clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(() => reload(['tasks', 'projects', 'dashboard']), 600)
  }, [reload])

  const closePanel = useCallback(() => setOpenTask(null), [])
  const closeStageModal = useCallback(() => setStageModal(null), [])
  const closeNewTask = useCallback(() => setNewTask(null), [])
  const changeView = (next) => { setView(next); remember.set('ovo.flow.view', next) }
  const changeCalendarMode = (next) => { setCalendarMode(next); remember.set('ovo.flow.calendar', next) }
  const toggleCollapsed = (id) => setCollapsed((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    remember.set(`ovo.flow.collapsed.${projectId}`, [...next])
    return next
  })

  // ---------------------------------------------------------------- Derived data
  const stages = useMemo(() => flow?.stages || [], [flow])
  const allTasks = useMemo(() => flow?.tasks || [], [flow])
  const inbox = useMemo(() => {
    const here = new Set(allTasks.map((task) => task.id))
    return data.tasks.filter((task) => !task.projectId && !here.has(task.id) && task.status !== 'Completed')
  }, [data.tasks, allTasks])
  const taskMap = useMemo(() => new Map([...inbox, ...allTasks].map((task) => [task.id, task])), [inbox, allTasks])
  const visible = useMemo(() => allTasks.filter((task) => matchesFilters(task, filters)), [allTasks, filters])
  const columnsBase = useMemo(() => Object.fromEntries(stages.map((stage) => [stage.id, sortTasks(visible.filter((task) => task.stageId === stage.id), sort).map((task) => task.id)])), [stages, visible, sort])
  const totals = useMemo(() => Object.fromEntries(stages.map((stage) => [stage.id, allTasks.filter((task) => task.stageId === stage.id).length])), [stages, allTasks])
  const stats = useMemo(() => insights(allTasks, stages), [allTasks, stages])
  const tags = useMemo(() => [...new Set(allTasks.flatMap((task) => task.tags || []))].sort(), [allTasks])
  const project = data.projects.find((item) => item.id === projectId) || flow?.project
  const people = useMemo(() => {
    const seen = new Map()
    for (const task of allTasks) if (task.assigneeId && !seen.has(task.assigneeId)) seen.set(task.assigneeId, task.assigneeName)
    return [...seen].map(([id, name]) => ({ id, name }))
  }, [allTasks])
  const filterCount = activeFilterCount(filters)
  const canDrag = useCallback(() => isManager, [isManager])
  const columns = preview || columnsBase
  const defaultStage = stages.find((stage) => stage.name === 'To Do') || stages.find((stage) => stage.category === 'To Do') || stages[0]

  // ---------------------------------------------------------------- Saving (optimistic, with rollback)
  const mutate = useCallback(async (apply, request) => {
    const before = flowRef.current
    setFlow(apply)
    try {
      const result = await request()
      if (result?.task) setFlow((current) => current && { ...current, tasks: current.tasks.map((task) => (task.id === result.task.id ? result.task : task)) })
      syncOthers()
      return result || true
    } catch (error) {
      setFlow(before)
      toast(error.message, 'error')
      return null
    }
  }, [toast, syncOthers])

  const updateTask = useCallback((taskId, changes) => {
    const local = { ...changes }
    if ('assigneeId' in changes) local.assigneeName = members.find((member) => member.id === changes.assigneeId)?.fullName || null
    return mutate(
      (state) => ({ ...state, tasks: state.tasks.map((task) => (task.id === taskId ? { ...task, ...local } : task)) }),
      () => api(`/api/flow/tasks/${taskId}`, { method: 'PATCH', body: changes }),
    )
  }, [mutate, members])

  // visibleIds: the cards shown in the destination column (without this one); visibleIndex: where it landed among them.
  const moveTask = useCallback((taskId, stageId, visibleIds = [], visibleIndex = null) => {
    const state = flowRef.current
    const stage = state.stages.find((item) => item.id === stageId)
    const source = state.tasks.find((task) => task.id === taskId) || taskMap.get(taskId)
    if (!stage || !source) return Promise.resolve(null)
    const full = state.tasks.filter((task) => task.stageId === stageId && task.id !== taskId).sort(byPosition).map((task) => task.id)
    const index = visibleIndex === null ? full.length : fullIndex(full, visibleIds, visibleIndex)
    const order = [...full]
    order.splice(index, 0, taskId)
    const positions = new Map(order.map((id, position) => [id, (position + 1) * 1000]))
    return mutate(
      (current) => {
        const base = current.tasks.some((task) => task.id === taskId) ? current.tasks : [...current.tasks, source]
        return {
          ...current,
          tasks: base.map((task) => {
            if (task.id === taskId) {
              return { ...task, stageId, status: stage.category, progress: stage.category === 'Completed' ? 100 : task.progress, projectId: current.project.id, projectName: current.project.name, position: positions.get(task.id) }
            }
            return positions.has(task.id) ? { ...task, position: positions.get(task.id) } : task
          }),
        }
      },
      () => api(`/api/flow/tasks/${taskId}/move`, { method: 'POST', body: { stageId, index } }),
    )
  }, [mutate, taskMap])

  // Dropping a QuickDrop task on a lane, priority or date first files it into the workflow, then applies the change.
  const placeThen = useCallback(async (taskId, stageId, changes) => {
    const inWorkflow = flowRef.current.tasks.find((task) => task.id === taskId)
    if (!inWorkflow || (stageId && inWorkflow.stageId !== stageId)) {
      const moved = await moveTask(taskId, stageId || defaultStage.id)
      if (!moved) return
    }
    if (Object.keys(changes).length) await updateTask(taskId, changes)
  }, [moveTask, updateTask, defaultStage])

  const createTask = useCallback(async (values) => {
    try {
      const result = await api('/api/flow/tasks', { method: 'POST', body: { ...values, projectId } })
      setFlow((current) => current && { ...current, tasks: [...current.tasks, result.task] })
      syncOthers()
      return true
    } catch (error) {
      toast(error.message, 'error')
      return false
    }
  }, [projectId, toast, syncOthers])

  const capture = useCallback(async (title) => {
    try {
      await api('/api/flow/tasks', { method: 'POST', body: { title } })
      await reload(['tasks'])
    } catch (error) {
      toast(error.message, 'error')
    }
  }, [reload, toast])

  const duplicateTask = useCallback(async (task) => {
    try {
      const result = await api(`/api/flow/tasks/${task.id}/duplicate`, { method: 'POST' })
      setFlow((current) => current && { ...current, tasks: [...current.tasks, result.task] })
      syncOthers()
      toast('Task duplicated')
    } catch (error) {
      toast(error.message, 'error')
    }
  }, [toast, syncOthers])

  const deleteTask = useCallback((task) => {
    confirm({
      title: 'Delete task?',
      message: `“${task.title}” and its subtasks and comments will be permanently deleted.`,
      onConfirm: async () => {
        await api(`/api/tasks/${task.id}`, { method: 'DELETE' })
        setFlow((current) => current && { ...current, tasks: current.tasks.filter((item) => item.id !== task.id) })
        setOpenTask((current) => (current === task.id ? null : current))
        syncOthers()
        toast('Task deleted')
      },
    })
  }, [confirm, toast, syncOthers])

  // ---------------------------------------------------------------- Stages
  async function saveStage(values) {
    const editing = stageModal?.stage
    try {
      if (editing) {
        await mutateOrThrow(
          (state) => ({
            ...state,
            stages: state.stages.map((stage) => (stage.id === editing.id ? { ...stage, ...values } : stage)),
            tasks: values.category !== editing.category
              ? state.tasks.map((task) => (task.stageId === editing.id ? { ...task, status: values.category, progress: values.category === 'Completed' ? 100 : task.progress } : task))
              : state.tasks,
          }),
          () => api(`/api/flow/stages/${editing.id}`, { method: 'PATCH', body: values }),
        )
      } else {
        const result = await api(`/api/flow/projects/${projectId}/stages`, { method: 'POST', body: values })
        setFlow((current) => current && { ...current, stages: [...current.stages, result.stage] })
      }
      setStageModal(null)
      syncOthers()
      return true
    } catch (error) {
      toast(error.message, 'error')
      return false
    }
  }

  async function mutateOrThrow(apply, request) {
    const before = flowRef.current
    setFlow(apply)
    try { return await request() } catch (error) { setFlow(before); throw error }
  }

  async function deleteStage(stage, moveTo) {
    try {
      await api(`/api/flow/stages/${stage.id}`, { method: 'DELETE', body: moveTo ? { moveTo } : {} })
      await load(projectId, { silent: true })
      setStageModal(null)
      syncOthers()
      toast(`Stage “${stage.name}” deleted`)
      return true
    } catch (error) {
      toast(error.message, 'error')
      return false
    }
  }

  // ---------------------------------------------------------------- Drag and drop
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] } }),
  )
  const previewRef = useRef(preview)
  previewRef.current = preview

  const collision = useCallback((args) => {
    if (args.active.data.current?.type === 'column') {
      return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((container) => String(container.id).startsWith('stage:')) })
    }
    const pointer = pointerWithin(args)
    const hits = pointer.length ? pointer : rectIntersection(args)
    let overId = getFirstCollision(hits, 'id')
    const map = previewRef.current
    if (overId != null && map && String(overId).startsWith('stage:')) {
      const ids = map[String(overId).slice(6)] || []
      if (ids.length) {
        const nearest = closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((container) => container.id !== overId && ids.includes(container.id)) })
        overId = nearest[0]?.id ?? overId
      }
    }
    return overId != null ? [{ id: overId }] : []
  }, [])

  function onDragStart({ active }) {
    const type = active.data.current?.type
    setDragging({ id: active.id, type })
    if (type === 'task' && view === 'board') setPreview(Object.fromEntries(Object.entries(columnsBase).map(([id, ids]) => [id, [...ids]])))
  }

  function onDragOver({ active, over }) {
    if (!previewRef.current || active.data.current?.type !== 'task' || !over) return
    const from = columnOf(previewRef.current, active.id)
    const to = columnOf(previewRef.current, over.id)
    if (!to || from === to) return
    setPreview((current) => {
      if (!current) return current
      const target = current[to]
      let index = target.length
      if (!String(over.id).startsWith('stage:')) {
        const translated = active.rect.current.translated
        const below = translated && translated.top > over.rect.top + over.rect.height
        index = target.indexOf(over.id) + (below ? 1 : 0)
      }
      return { ...current, ...(from ? { [from]: current[from].filter((id) => id !== active.id) } : {}), [to]: [...target.slice(0, index), active.id, ...target.slice(index)] }
    })
  }

  function onDragCancel() { setDragging(null); setPreview(null) }

  function onDragEnd({ active, over }) {
    const current = dragging
    const map = previewRef.current
    setDragging(null)
    setPreview(null)
    if (!over || !current) return

    if (current.type === 'column') {
      if (!String(over.id).startsWith('stage:')) return
      const ids = stages.map((stage) => `stage:${stage.id}`)
      const from = ids.indexOf(String(active.id))
      const to = ids.indexOf(String(over.id))
      if (from < 0 || to < 0 || from === to) return
      const next = arrayMove(stages, from, to)
      mutate((state) => ({ ...state, stages: next }), () => api(`/api/flow/projects/${projectId}/stages/order`, { method: 'PUT', body: { ids: next.map((stage) => stage.id) } }))
      return
    }

    const task = taskMap.get(active.id)
    if (!task) return
    const inWorkflow = allTasks.some((item) => item.id === task.id)

    if (view === 'board' && map) {
      const to = columnOf(map, over.id)
      if (!to) return
      let list = map[to]
      if (columnOf(map, active.id) === to && over.id !== active.id && !String(over.id).startsWith('stage:')) {
        const from = list.indexOf(active.id)
        const target = list.indexOf(over.id)
        if (from >= 0 && target >= 0 && from !== target) list = arrayMove(list, from, target)
      }
      const index = list.indexOf(active.id)
      const sameColumn = inWorkflow && task.stageId === to
      if (sameColumn && JSON.stringify(list) === JSON.stringify(columnsBase[to])) return
      if (sameColumn && sort !== 'manual') { toast('Switch the sort to “Manual order” to rearrange cards in a stage.'); return }
      const others = list.filter((id) => id !== active.id)
      moveTask(task.id, to, others, sort === 'manual' ? index : null)
      return
    }

    const target = String(over.id)
    if (target.startsWith('cell:')) {
      const [, member, stageId] = target.split(':')
      const assigneeId = member === 'none' ? null : member
      placeThen(task.id, stageId, (task.assigneeId || null) !== assigneeId ? { assigneeId } : {})
    } else if (target.startsWith('prio:')) {
      const priority = target.slice(5)
      placeThen(task.id, null, task.priority !== priority || !inWorkflow ? { priority } : {})
    } else if (target.startsWith('day:')) {
      const dueDate = target.slice(4)
      placeThen(task.id, null, task.dueDate !== dueDate || !inWorkflow ? { dueDate } : {})
    }
  }

  const handlers = {
    onOpen: (task) => setOpenTask(task.id),
    onAddTask: (stageId, title) => createTask({ title, stageId }),
    onEditStage: (stage) => setStageModal({ stage }),
    onDuplicate: duplicateTask,
    onDelete: deleteTask,
    onPriority: (task, priority) => updateTask(task.id, { priority }),
    onAssign: (task, assigneeId) => updateTask(task.id, { assigneeId }),
    onCreateOn: (dueDate) => setNewTask({ dueDate }),
  }

  const dragTask = dragging?.type === 'task' ? taskMap.get(dragging.id) : null
  const dragStage = dragging?.type === 'column' ? stages.find((stage) => `stage:${stage.id}` === dragging.id) : null

  // ---------------------------------------------------------------- Rendering
  if (!projectId && loaded && !data.projects.length) {
    return (
      <div className="stack">
        <div className="fl-head"><div><span className="eyebrow">Workspace / OVO Flow</span><h1>OVO Flow</h1></div></div>
        <Empty icon="board" title="Create a project to start" action={<Button variant="primary" icon="plus" onClick={() => openForm('project')}>New project</Button>}>
          OVO Flow turns a project into a drag-and-drop board you can also see by team, priority and date.
        </Empty>
      </div>
    )
  }

  const due = project && !['Completed', 'Cancelled'].includes(project.status) ? dueLabel(project.dueDate) : null

  return (
    <div className="fl-page">
      <header className="fl-head">
        <div className="fl-head-main">
          <span className="eyebrow">Workspace / OVO Flow</span>
          <div className="fl-title-row">
            <select className="fl-project-select" value={projectId} aria-label="Project" onChange={(event) => navigate('flow', { project: event.target.value })}>
              {data.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            {project && <Pill tone={projectTone[project.status]}>{project.status}</Pill>}
            {due && <span className={`fl-chip ${due.tone === 'danger' ? 'overdue' : ''}`}><Icon name="clock" size={12} />{due.text}</span>}
          </div>
          {project?.description && <p className="fl-desc">{project.description}</p>}
        </div>
        <div className="fl-head-side">
          <div className="fl-people" aria-label="People on this project">
            {people.slice(0, 5).map((person) => <Avatar key={person.id} name={person.name} size="sm" />)}
            {people.length > 5 && <span className="fl-more">+{people.length - 5}</span>}
          </div>
          {project && <Button size="sm" icon="settings" onClick={() => openForm('project', project)}>Project settings</Button>}
          <Button size="sm" icon="bolt" className={quickDrop ? 'fl-on' : ''} aria-pressed={quickDrop} onClick={() => setQuickDrop(!quickDrop)}>QuickDrop{inbox.length > 0 && <span className="fl-badge">{inbox.length}</span>}</Button>
          <Button variant="primary" size="sm" icon="plus" onClick={() => setNewTask({})} disabled={!flow}>Add task</Button>
        </div>
      </header>

      {flow && (
        <section className="fl-insights" aria-label="Project progress">
          <div className="fl-progress">
            <div><strong>{stats.percent}%</strong><span>{stats.completed} of {stats.total} tasks completed</span></div>
            <div className="fl-bar" role="progressbar" aria-valuenow={stats.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Project completion"><span style={{ width: `${stats.percent}%` }} /></div>
          </div>
          <dl>
            <div><dt>In progress</dt><dd>{stats.inProgress}</dd></div>
            <div><dt>In review</dt><dd>{stats.review}</dd></div>
            <div className={stats.overdue ? 'warn' : ''}><dt>Overdue</dt><dd>{stats.overdue}</dd></div>
          </dl>
        </section>
      )}

      <div className="fl-toolbar">
        <div className="fl-views"><Segmented label="View" value={view} onChange={changeView} options={VIEWS} /></div>
        <label className="fl-search">
          <Icon name="search" size={15} />
          <input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Search tasks" aria-label="Search tasks" />
        </label>
        <Button size="sm" icon="filter" className={`fl-filter-toggle${filterCount ? ' fl-on' : ''}`} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
          Filters{filterCount > 0 && <span className="fl-badge">{filterCount}</span>}
        </Button>
        <div className={`fl-filters${filtersOpen ? ' open' : ''}`}>
          <select value={filters.assignee} aria-label="Filter by assignee" onChange={(event) => setFilters({ ...filters, assignee: event.target.value })}>
            <option value="">Anyone</option><option value="none">Unassigned</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}
          </select>
          <select value={filters.stage} aria-label="Filter by status" onChange={(event) => setFilters({ ...filters, stage: event.target.value })}>
            <option value="">Any status</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
          </select>
          <select value={filters.priority} aria-label="Filter by priority" onChange={(event) => setFilters({ ...filters, priority: event.target.value })}>
            <option value="">Any priority</option>{PRIORITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <select value={filters.due} aria-label="Filter by due date" onChange={(event) => setFilters({ ...filters, due: event.target.value })}>
            <option value="">Any date</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="week">Due this week</option><option value="none">No due date</option>
          </select>
          <select value={filters.tag} aria-label="Filter by tag" onChange={(event) => setFilters({ ...filters, tag: event.target.value })} disabled={!tags.length}>
            <option value="">{tags.length ? 'Any tag' : 'No tags yet'}</option>{tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
          </select>
          {view === 'board' && (
            <select value={sort} aria-label="Sort cards" onChange={(event) => setSort(event.target.value)}>
              {SORTS.map((item) => <option key={item.value} value={item.value}>{item.value === 'manual' ? 'Sort: manual' : `Sort: ${item.label.toLowerCase()}`}</option>)}
            </select>
          )}
          {filterCount > 0 && <button type="button" className="text-link" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>}
        </div>
      </div>

      {loadError ? (
        <div className="fl-state error" role="alert"><Icon name="alert" size={18} /><p>{loadError}</p><Button size="sm" onClick={() => load(projectId)}>Try again</Button></div>
      ) : !flow ? (
        <div className="fl-loading" aria-busy="true" aria-label="Loading project">{[0, 1, 2, 3].map((n) => <div key={n} className="fl-skel-col"><span className="fl-skeleton short" /><span className="fl-skeleton" /><span className="fl-skeleton" /></div>)}</div>
      ) : (
        <div className={`fl-work${quickDrop ? ' with-qd' : ''}`}>
          <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
            <div className="fl-stage-area">
              {!allTasks.length && view !== 'calendar' && (
                <p className="fl-hint"><Icon name="sparkle" size={14} /> This project has no tasks yet. Add one in any stage, or drag something in from QuickDrop.</p>
              )}
              {view === 'board' && (
                <BoardView
                  stages={stages} columns={columns} totals={totals} taskMap={taskMap} collapsed={collapsed} canManage={isManager} canDrag={canDrag} members={members}
                  handlers={handlers} onToggle={toggleCollapsed} onAddStage={() => setStageModal({ stage: null })}
                />
              )}
              {view === 'team' && <TeamView stages={stages} members={members} tasks={visible} allTasks={allTasks} canManage={isManager} canDrag={canDrag} handlers={handlers} />}
              {view === 'priority' && <PriorityView stages={stages} members={members} tasks={visible} canManage={isManager} canDrag={canDrag} handlers={handlers} />}
              {view === 'calendar' && (
                <CalendarView tasks={visible} mode={calendarMode} onMode={changeCalendarMode} anchor={anchor} onAnchor={setAnchor} canManage={isManager} canDrag={canDrag} handlers={handlers} />
              )}
            </div>
            {quickDrop && <QuickDrop tasks={inbox} stages={stages} canManage={isManager} onCapture={capture} onOpen={(task) => setOpenTask(task.id)} onFile={(task, stageId) => moveTask(task.id, stageId)} onClose={() => setQuickDrop(false)} />}
            <DragOverlay dropAnimation={{ duration: 160 }}>
              {dragTask && <article className="fl-card overlay"><CardBody task={dragTask} overlay /></article>}
              {dragStage && <div className="fl-col overlay"><header><i className="fl-dot" style={{ background: dragStage.color }} /><h3>{dragStage.name}</h3><em>{totals[dragStage.id] || 0}</em></header></div>}
            </DragOverlay>
          </DndContext>
        </div>
      )}

      {openTask && (
        <TaskPanel
          taskId={openTask} members={members} canManage={isManager} toast={toast}
          onClose={closePanel}
          onChange={(task) => { setFlow((current) => current && { ...current, tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...task } : item)) }); syncOthers() }}
          onDelete={deleteTask}
        />
      )}
      {stageModal && <StageModal stage={stageModal.stage} stages={stages} taskCount={stageModal.stage ? totals[stageModal.stage.id] || 0 : 0} onSave={saveStage} onDelete={deleteStage} onClose={closeStageModal} />}
      {newTask && (
        <NewTaskModal
          stages={stages} members={members} stageId={newTask.stageId} dueDate={newTask.dueDate}
          onCreate={async (values) => { const ok = await createTask(values); if (ok) setNewTask(null); return ok }} onClose={closeNewTask}
        />
      )}
    </div>
  )
}

export default Flow
