import { useMemo } from 'react'
import { Avatar } from '../../components/ui.jsx'
import { DropZone } from './BoardView.jsx'
import { CardMenu, DraggableCard } from './FlowCard.jsx'
import { PRIORITIES, byPosition, isOverdue } from './utils.js'

function useMenu(members, canManage, handlers) {
  return (task) => (
    <CardMenu task={task} members={members} canManage={canManage} onOpen={() => handlers.onOpen(task)} onDuplicate={handlers.onDuplicate} onDelete={handlers.onDelete} onPriority={handlers.onPriority} onAssign={handlers.onAssign} />
  )
}

// One lane per teammate: their tasks laid out across the workflow, with their workload on the left.
// Dropping a card on a lane assigns it to that person (and to that stage).
export function TeamView({ stages, members, tasks, allTasks, canManage, canDrag, handlers }) {
  const menuFor = useMenu(members, canManage, handlers)
  const lanes = useMemo(() => {
    const openCount = (id) => allTasks.filter((task) => (task.assigneeId || null) === id && task.status !== 'Completed').length
    const people = members.map((member) => ({ id: member.id, name: member.fullName }))
      .sort((a, b) => openCount(b.id) - openCount(a.id) || a.name.localeCompare(b.name))
    return [{ id: null, name: 'Unassigned' }, ...people]
  }, [members, allTasks])

  return (
    <div className="fl-team" style={{ '--fl-stages': stages.length }}>
      <div className="fl-team-head">
        <span className="fl-team-corner">Team</span>
        {stages.map((stage) => <span key={stage.id}><i style={{ background: stage.color }} />{stage.name}</span>)}
      </div>
      {lanes.map((lane) => {
        const mine = tasks.filter((task) => (task.assigneeId || null) === lane.id)
        const all = allTasks.filter((task) => (task.assigneeId || null) === lane.id)
        const open = all.filter((task) => task.status !== 'Completed')
        const overdue = all.filter(isOverdue).length
        return (
          <div key={lane.id || 'none'} className={`fl-lane${mine.length ? '' : ' idle'}`}>
            <div className="fl-lane-who">
              {lane.id ? <Avatar name={lane.name} size="sm" /> : <span className="fl-avatar-none" aria-hidden="true" />}
              <div><strong>{lane.name}</strong><small>{open.length} open{overdue ? ` · ${overdue} overdue` : ''}</small></div>
              {all.length > 0 && <div className="fl-load" title={`${all.length - open.length} of ${all.length} done`}><span style={{ width: `${((all.length - open.length) / all.length) * 100}%` }} /></div>}
            </div>
            {stages.map((stage) => {
              const cell = mine.filter((task) => task.stageId === stage.id).sort(byPosition)
              return (
                <DropZone key={stage.id} id={`cell:${lane.id || 'none'}:${stage.id}`} className="fl-cell">
                  {cell.map((task) => <DraggableCard key={task.id} task={task} canDrag={canDrag(task)} onOpen={handlers.onOpen} menu={menuFor(task)} compact />)}
                </DropZone>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// The same tasks grouped by urgency; dragging a card to another group changes its priority.
export function PriorityView({ stages, members, tasks, canManage, canDrag, handlers }) {
  const menuFor = useMenu(members, canManage, handlers)
  const stageName = new Map(stages.map((stage) => [stage.id, stage.name]))
  return (
    <div className="fl-board fl-priority">
      {PRIORITIES.map((priority) => {
        const group = tasks.filter((task) => task.priority === priority.value)
          .sort((a, b) => (a.status === 'Completed') - (b.status === 'Completed') || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || byPosition(a, b))
        return (
          <DropZone key={priority.value} id={`prio:${priority.value}`} className="fl-col">
            <header>
              <i className="fl-dot" style={{ background: priority.color }} />
              <h3>{priority.label}</h3>
              <em>{group.length}</em>
            </header>
            <div className="fl-cards">
              {group.map((task) => <DraggableCard key={task.id} task={task} canDrag={canDrag(task)} onOpen={handlers.onOpen} menu={menuFor(task)} stageName={stageName.get(task.stageId)} />)}
              {!group.length && <p className="fl-empty">Drop tasks here</p>}
            </div>
          </DropZone>
        )
      })}
    </div>
  )
}
