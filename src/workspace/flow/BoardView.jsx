import { useRef, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Icon from '../../components/Icon.jsx'
import { IconButton } from '../../components/ui.jsx'
import { CardMenu, SortableCard } from './FlowCard.jsx'

function AddTask({ onAdd }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const input = useRef(null)
  async function submit(event) {
    event.preventDefault()
    const title = draft.trim()
    if (!title) return
    setDraft('')
    await onAdd(title)
    input.current?.focus()
  }
  if (!open) return <button type="button" className="fl-add" onClick={() => setOpen(true)}><Icon name="plus" size={14} />Add task</button>
  return (
    <form className="fl-add-form" onSubmit={submit}>
      <input
        ref={input} autoFocus value={draft} maxLength={240} placeholder="Task title, then Enter" aria-label="New task title"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Escape') { setOpen(false); setDraft('') } }}
        onBlur={() => { if (!draft.trim()) setOpen(false) }}
      />
    </form>
  )
}

function Column({ stage, ids, total, collapsed, taskMap, canManage, canDrag, menuFor, onOpen, onToggle, onAddTask, onEdit }) {
  const sortable = useSortable({ id: `stage:${stage.id}`, data: { type: 'column' }, disabled: { draggable: !canManage } })
  const filtered = ids.length !== total
  const style = { transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }

  if (collapsed) {
    return (
      <section ref={sortable.setNodeRef} style={style} className={`fl-col collapsed${sortable.isOver ? ' over' : ''}`} data-stage={stage.id}>
        <button type="button" className="fl-col-expand" onClick={onToggle} aria-label={`Expand ${stage.name}`} title="Expand">
          <i style={{ background: stage.color }} /><strong>{stage.name}</strong><em>{filtered ? `${ids.length}/${total}` : total}</em>
        </button>
      </section>
    )
  }

  return (
    <section ref={sortable.setNodeRef} style={style} className={`fl-col${sortable.isDragging ? ' dragging' : ''}${sortable.isOver ? ' over' : ''}`} data-stage={stage.id} aria-label={`${stage.name} stage`}>
      <header>
        {canManage && (
          <button type="button" className="fl-grip" ref={sortable.setActivatorNodeRef} {...sortable.attributes} {...sortable.listeners} aria-label={`Reorder stage ${stage.name}`} title="Drag to reorder stages">
            <Icon name="more" size={14} />
          </button>
        )}
        <i className="fl-dot" style={{ background: stage.color }} />
        <h3>{stage.name}</h3>
        <em title={filtered ? `${ids.length} shown of ${total}` : undefined}>{filtered ? `${ids.length}/${total}` : total}</em>
        <span className="fl-spacer" />
        <IconButton icon="up" label={`Collapse ${stage.name}`} onClick={onToggle} className="fl-collapse" />
        {canManage && <IconButton icon="settings" label={`Edit stage ${stage.name}`} onClick={() => onEdit(stage)} />}
      </header>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="fl-cards">
          {ids.map((id) => {
            const task = taskMap.get(id)
            return task ? <SortableCard key={id} task={task} canDrag={canDrag(task)} onOpen={onOpen} menu={menuFor(task)} /> : null
          })}
          {!ids.length && <p className="fl-empty">{filtered ? 'No tasks match the filters.' : 'Drop tasks here'}</p>}
        </div>
      </SortableContext>
      {canManage && <AddTask onAdd={(title) => onAddTask(stage.id, title)} />}
    </section>
  )
}

export default function BoardView({ stages, columns, totals, taskMap, collapsed, canManage, canDrag, members, handlers, onToggle, onAddStage }) {
  const menuFor = (task) => (
    <CardMenu task={task} members={members} canManage={canManage} onOpen={() => handlers.onOpen(task)} onDuplicate={handlers.onDuplicate} onDelete={handlers.onDelete} onPriority={handlers.onPriority} onAssign={handlers.onAssign} />
  )
  return (
    <SortableContext items={stages.map((stage) => `stage:${stage.id}`)} strategy={horizontalListSortingStrategy}>
      <div className="fl-board">
        {stages.map((stage) => (
          <Column
            key={stage.id} stage={stage} ids={columns[stage.id] || []} total={totals[stage.id] || 0} collapsed={collapsed.has(stage.id)}
            taskMap={taskMap} canManage={canManage} canDrag={canDrag} menuFor={menuFor} onOpen={handlers.onOpen}
            onToggle={() => onToggle(stage.id)} onAddTask={handlers.onAddTask} onEdit={handlers.onEditStage}
          />
        ))}
        {canManage && (
          <button type="button" className="fl-add-stage" onClick={onAddStage}><Icon name="plus" size={16} />Add stage</button>
        )}
      </div>
    </SortableContext>
  )
}

export function DropZone({ id, className = '', children, data }) {
  const { setNodeRef, isOver } = useDroppable({ id, data })
  return <div ref={setNodeRef} className={`${className}${isOver ? ' over' : ''}`}>{children}</div>
}
