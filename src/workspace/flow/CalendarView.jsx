import { useDraggable } from '@dnd-kit/core'
import Icon from '../../components/Icon.jsx'
import { Avatar, Button, IconButton } from '../../components/ui.jsx'
import { todayKey } from '../../lib/format.js'
import { DropZone } from './BoardView.jsx'
import { addDays, isOverdue, monthGrid, priorityColor, priorityLabel, weekStart } from './utils.js'

function Chip({ task, canDrag, onOpen }) {
  const drag = useDraggable({ id: task.id, data: { type: 'task' }, disabled: !canDrag })
  return (
    <button
      type="button" ref={drag.setNodeRef} {...drag.attributes} {...drag.listeners}
      className={`fl-event${isOverdue(task) ? ' overdue' : ''}${task.status === 'Completed' ? ' complete' : ''}${drag.isDragging ? ' dragging' : ''}`}
      onClick={() => onOpen(task)} title={`${task.title} · ${priorityLabel(task.priority)}`} data-task={task.id}
    >
      <i style={{ background: priorityColor(task.priority) }} />
      <span>{task.title}</span>
      {task.assigneeName && <Avatar name={task.assigneeName} size="xs" />}
    </button>
  )
}

function UnscheduledItem({ task, canDrag, onOpen }) {
  const drag = useDraggable({ id: task.id, data: { type: 'task' }, disabled: !canDrag })
  return (
    <li ref={drag.setNodeRef} {...drag.attributes} {...drag.listeners} className={drag.isDragging ? 'dragging' : ''}>
      <button type="button" onClick={() => onOpen(task)} data-task={task.id}><i style={{ background: priorityColor(task.priority) }} />{task.title}</button>
    </li>
  )
}

// Tasks on the days they are due. Drag a task to a day to set or change its deadline; tasks with no
// deadline wait on the right and only get one when someone drops them on a date.
export default function CalendarView({ tasks, mode, onMode, anchor, onAnchor, canManage, canDrag, handlers }) {
  const today = todayKey()
  const days = mode === 'month' ? monthGrid(anchor) : Array.from({ length: 7 }, (_, index) => addDays(weekStart(anchor), index))
  const dated = new Map()
  for (const task of tasks) if (task.dueDate) dated.set(task.dueDate, [...(dated.get(task.dueDate) || []), task])
  const undated = tasks.filter((task) => !task.dueDate && task.status !== 'Completed')
  const overdue = tasks.filter(isOverdue).length

  const shift = (direction) => onAnchor(mode === 'month' ? new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1) : addDays(anchor, direction * 7))
  const title = mode === 'month'
    ? anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    : `${days[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${days[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`

  return (
    <div className="fl-calendar">
      <section className="fl-cal-main">
        <div className="fl-cal-head">
          <h2>{title}</h2>
          {overdue > 0 && <span className="fl-chip overdue"><Icon name="alert" size={12} />{overdue} overdue</span>}
          <span className="fl-spacer" />
          <div className="segmented" role="tablist" aria-label="Calendar range">
            {['week', 'month'].map((value) => (
              <button key={value} type="button" role="tab" aria-selected={mode === value} className={mode === value ? 'active' : ''} onClick={() => onMode(value)}>{value === 'week' ? 'Week' : 'Month'}</button>
            ))}
          </div>
          <Button size="sm" onClick={() => onAnchor(new Date())}>Today</Button>
          <IconButton icon="left" label={mode === 'month' ? 'Previous month' : 'Previous week'} onClick={() => shift(-1)} />
          <IconButton icon="right" label={mode === 'month' ? 'Next month' : 'Next week'} onClick={() => shift(1)} />
        </div>
        <div className={`fl-cal-grid ${mode}`} role="grid" aria-label={`${mode} calendar`}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => <div key={label} className="fl-weekday" role="columnheader">{label}</div>)}
          {days.map((day) => {
            const key = todayKey(day)
            const items = dated.get(key) || []
            const outside = mode === 'month' && day.getMonth() !== anchor.getMonth()
            return (
              <DropZone key={key} id={`day:${key}`} className={`fl-day${outside ? ' outside' : ''}${key === today ? ' today' : ''}`}>
                <div className="fl-day-head">
                  <span className="fl-day-number">{day.getDate()}<small>{day.toLocaleDateString(undefined, { weekday: 'short' })}</small></span>
                  {canManage && <button type="button" className="fl-day-add" aria-label={`Add a task on ${day.toDateString()}`} onClick={() => handlers.onCreateOn(key)}><Icon name="plus" size={13} /></button>}
                </div>
                <div className="fl-day-items">
                  {items.map((task) => <Chip key={task.id} task={task} canDrag={canDrag(task)} onOpen={handlers.onOpen} />)}
                </div>
              </DropZone>
            )
          })}
        </div>
      </section>
      <aside className="fl-cal-side">
        <h3>No due date <em>{undated.length}</em></h3>
        <p className="muted-note">Drag a task onto a day to give it a deadline.</p>
        <ul>
          {undated.map((task) => <UnscheduledItem key={task.id} task={task} canDrag={canDrag(task)} onOpen={handlers.onOpen} />)}
          {!undated.length && <li className="fl-empty">Every open task has a date.</li>}
        </ul>
      </aside>
    </div>
  )
}
