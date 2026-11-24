import { useEffect, useRef, useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Icon from '../../components/Icon.jsx'
import { Avatar, IconButton } from '../../components/ui.jsx'
import { dueLabel, formatDay } from '../../lib/format.js'
import { PRIORITIES, isOverdue, priorityColor, priorityLabel } from './utils.js'

// The compact card: title, then only the details this task actually has.
export function CardBody({ task, stageName, overlay = false }) {
  const overdue = isOverdue(task)
  const due = task.dueDate && task.status !== 'Completed' ? dueLabel(task.dueDate) : null
  const tags = task.tags || []
  return (
    <>
      <div className="fl-card-title">
        <span className="fl-prio" style={{ background: priorityColor(task.priority) }} title={`${priorityLabel(task.priority)} priority`} role="img" aria-label={`${priorityLabel(task.priority)} priority`} />
        <span className={task.status === 'Completed' ? 'done' : ''}>{task.title}</span>
      </div>
      {(tags.length > 0 || stageName) && (
        <div className="fl-card-tags">
          {stageName && <span className="fl-tag stage">{stageName}</span>}
          {tags.slice(0, 2).map((tag) => <span key={tag} className="fl-tag">{tag}</span>)}
          {tags.length > 2 && <span className="fl-tag more">+{tags.length - 2}</span>}
        </div>
      )}
      <div className="fl-card-meta">
        {due && <span className={`fl-chip ${overdue ? 'overdue' : due.tone === 'warning' ? 'soon' : ''}`}><Icon name="clock" size={12} />{overdue ? due.text : formatDay(task.dueDate)}</span>}
        {task.subtaskTotal > 0 && <span className={`fl-chip${task.subtaskDone === task.subtaskTotal ? ' ok' : ''}`} title="Subtasks done"><Icon name="check" size={12} />{task.subtaskDone}/{task.subtaskTotal}</span>}
        {task.commentCount > 0 && <span className="fl-chip" title="Comments"><Icon name="chat" size={12} />{task.commentCount}</span>}
        <span className="fl-spacer" />
        {task.assigneeName ? <Avatar name={task.assigneeName} size="xs" /> : !overlay && <span className="fl-unassigned" title="Unassigned" />}
      </div>
    </>
  )
}

// Click, right-click or the ⋯ button: open, duplicate, delete, plus quick priority and assignee.
export function CardMenu({ task, members, canManage, onOpen, onDuplicate, onDelete, onPriority, onAssign }) {
  const [open, setOpen] = useState(false)
  const root = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => { if (!root.current?.contains(event.target)) setOpen(false) }
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  const run = (action) => () => { setOpen(false); action() }
  return (
    <div className="fl-menu" ref={root} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()}>
      <IconButton icon="more" label={`Actions for ${task.title}`} aria-expanded={open} onClick={(event) => { event.stopPropagation(); setOpen(!open) }} />
      {open && (
        <div className="fl-menu-list" role="menu" onClick={(event) => event.stopPropagation()}>
          <button type="button" role="menuitem" onClick={run(onOpen)}><Icon name="expand" size={15} />Open details</button>
          {canManage && (
            <>
              <div className="fl-menu-group">
                <span>Priority</span>
                <div>{PRIORITIES.map((item) => (
                  <button key={item.value} type="button" className={task.priority === item.value ? 'active' : ''} onClick={run(() => onPriority(task, item.value))}>
                    <i style={{ background: item.color }} />{item.label}
                  </button>
                ))}</div>
              </div>
              <label className="fl-menu-group">
                <span>Assign to</span>
                <select value={task.assigneeId || ''} onChange={(event) => { setOpen(false); onAssign(task, event.target.value || null) }} aria-label="Assign to">
                  <option value="">Unassigned</option>
                  {members.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}
                </select>
              </label>
              <button type="button" role="menuitem" onClick={run(() => onDuplicate(task))}><Icon name="copy" size={15} />Duplicate</button>
              <button type="button" role="menuitem" className="danger" onClick={run(() => onDelete(task))}><Icon name="trash" size={15} />Delete…</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function cardProps({ task, menu, onOpen, dragging, extra = '' }) {
  return {
    className: `fl-card${dragging ? ' dragging' : ''}${task.status === 'Completed' ? ' complete' : ''}${extra}`,
    'data-task': task.id,
    onClick: () => onOpen(task),
    onContextMenu: menu ? (event) => { event.preventDefault(); event.currentTarget.querySelector('.fl-menu .icon-btn')?.click() } : undefined,
  }
}

// Enter opens the task; the drag library keeps Space for lifting and dropping a card from the keyboard.
const withEnter = (onOpen, task, listener) => (event) => {
  if (event.key === 'Enter' && event.target === event.currentTarget) { event.preventDefault(); onOpen(task) } else listener?.(event)
}

// Board cards sort within their column; the other views only need to pick a card up.
export function SortableCard({ task, menu, onOpen, stageName, canDrag }) {
  const sortable = useSortable({ id: task.id, data: { type: 'task' }, disabled: { draggable: !canDrag } })
  const props = cardProps({ task, menu, onOpen, dragging: sortable.isDragging })
  return (
    <article ref={sortable.setNodeRef} style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }} {...sortable.attributes} {...sortable.listeners}
      {...props} onKeyDown={withEnter(onOpen, task, sortable.listeners?.onKeyDown)} aria-roledescription="draggable task" aria-label={task.title}>
      <CardBody task={task} stageName={stageName} />
      {menu}
    </article>
  )
}

export function DraggableCard({ task, menu, onOpen, stageName, canDrag, compact = false }) {
  const draggable = useDraggable({ id: task.id, data: { type: 'task' }, disabled: !canDrag })
  const props = cardProps({ task, menu, onOpen, dragging: draggable.isDragging, extra: compact ? ' compact' : '' })
  return (
    <article ref={draggable.setNodeRef} {...draggable.attributes} {...draggable.listeners}
      {...props} onKeyDown={withEnter(onOpen, task, draggable.listeners?.onKeyDown)} aria-roledescription="draggable task" aria-label={task.title}>
      <CardBody task={task} stageName={stageName} />
      {menu}
    </article>
  )
}

