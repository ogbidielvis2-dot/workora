import { useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import Icon from '../../components/Icon.jsx'
import { IconButton } from '../../components/ui.jsx'
import { priorityColor } from './utils.js'

function Item({ task, stages, canManage, onOpen, onFile }) {
  const drag = useDraggable({ id: task.id, data: { type: 'task', inbox: true }, disabled: !canManage })
  return (
    <li ref={drag.setNodeRef} {...drag.attributes} {...drag.listeners} className={`fl-qd-item${drag.isDragging ? ' dragging' : ''}`} data-task={task.id}>
      <button type="button" className="fl-qd-title" onClick={() => onOpen(task)}><i style={{ background: priorityColor(task.priority) }} />{task.title}</button>
      {canManage && stages.length > 0 && (
        <select
          className="fl-qd-file" value="" aria-label={`Add “${task.title}” to the project`}
          onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()}
          onChange={(event) => event.target.value && onFile(task, event.target.value)}
        >
          <option value="">Add to…</option>
          {stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
        </select>
      )}
    </li>
  )
}

// QuickDrop: capture a thought now, organise it later. Tasks here belong to no project, have no
// deadline unless someone sets one, and join the board when dragged (or filed) into a stage.
export default function QuickDrop({ tasks, stages, canManage, onCapture, onOpen, onFile, onClose }) {
  const [draft, setDraft] = useState('')
  async function submit(event) {
    event.preventDefault()
    const title = draft.trim()
    if (!title) return
    setDraft('')
    await onCapture(title)
  }
  return (
    <aside className="fl-quickdrop" aria-label="QuickDrop">
      <header>
        <span className="fl-qd-icon"><Icon name="bolt" size={15} /></span>
        <div><h3>QuickDrop</h3><small>{tasks.length ? `${tasks.length} waiting to be organised` : 'Your task inbox'}</small></div>
        <IconButton icon="close" label="Close QuickDrop" onClick={onClose} />
      </header>
      {canManage && (
        <form onSubmit={submit}>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Capture a task, press Enter" maxLength={240} aria-label="Capture a task" />
        </form>
      )}
      <ul>
        {tasks.map((task) => <Item key={task.id} task={task} stages={stages} canManage={canManage} onOpen={onOpen} onFile={onFile} />)}
      </ul>
      {!tasks.length && <p className="fl-empty">Nothing waiting. Capture a task above and drag it into a stage when you are ready.</p>}
      {tasks.length > 0 && <p className="muted-note">Drag a task onto a stage, a team lane, a priority or a date, or use “Add to…”.</p>}
    </aside>
  )
}
