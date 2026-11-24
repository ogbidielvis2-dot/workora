import { useState } from 'react'
import { Button, Field, Modal } from '../../components/ui.jsx'
import { CATEGORIES, PRIORITIES, STAGE_COLORS } from './utils.js'

// Add or edit a workflow stage. "Counts as" is what keeps reports and the classic Tasks board accurate.
export function StageModal({ stage, stages, taskCount, onSave, onDelete, onClose }) {
  const [name, setName] = useState(stage?.name || '')
  const [color, setColor] = useState(stage?.color || STAGE_COLORS[1])
  const [category, setCategory] = useState(stage?.category || 'In Progress')
  const [moveTo, setMoveTo] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const others = stages.filter((item) => item.id !== stage?.id)

  async function submit(event) {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    const ok = await onSave({ name: name.trim(), color, category })
    if (!ok) setBusy(false)
  }
  async function remove() {
    setBusy(true)
    const ok = await onDelete(stage, moveTo || null)
    if (!ok) setBusy(false)
  }

  return (
    <Modal title={stage ? 'Edit stage' : 'Add a stage'} eyebrow="Workflow" onClose={onClose} width={480} busy={busy}>
      <form onSubmit={submit}>
        <div className="modal-body stack-sm">
          <Field label="Name"><input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} placeholder="e.g. Client approval" required /></Field>
          <div className="field">
            <span className="field-label">Colour</span>
            <div className="fl-swatches" role="radiogroup" aria-label="Stage colour">
              {STAGE_COLORS.map((value) => (
                <button key={value} type="button" role="radio" aria-checked={color === value} aria-label={value} className={color === value ? 'active' : ''} style={{ background: value }} onClick={() => setColor(value)} />
              ))}
            </div>
          </div>
          <Field label="Counts as" hint="Tasks in this stage show as this status in reports, the Tasks board and automations.">
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </Field>
          {stage && (
            <div className="fl-danger-zone">
              {!confirmDelete ? (
                <Button type="button" variant="danger" size="sm" icon="trash" onClick={() => setConfirmDelete(true)} disabled={others.length === 0}>
                  {others.length === 0 ? 'A project needs at least one stage' : 'Delete this stage…'}
                </Button>
              ) : (
                <div className="stack-sm">
                  {taskCount > 0 ? (
                    <Field label={`Move its ${taskCount} task${taskCount === 1 ? '' : 's'} to`}>
                      <select value={moveTo} onChange={(event) => setMoveTo(event.target.value)}>
                        <option value="">Choose a stage…</option>
                        {others.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </Field>
                  ) : <p className="muted-note">This stage has no tasks.</p>}
                  <div className="fl-row">
                    <Button type="button" size="sm" onClick={() => setConfirmDelete(false)} disabled={busy}>Keep stage</Button>
                    <Button type="button" variant="danger" size="sm" onClick={remove} disabled={busy || (taskCount > 0 && !moveTo)}>Delete stage</Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="modal-foot">
          <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || !name.trim()}>{stage ? 'Save stage' : 'Add stage'}</Button>
        </div>
      </form>
    </Modal>
  )
}

// A title is all it takes; everything else is optional.
export function NewTaskModal({ stages, members, stageId, dueDate, onCreate, onClose }) {
  const [title, setTitle] = useState('')
  const [stage, setStage] = useState(stageId || '')
  const [priority, setPriority] = useState('Medium')
  const [assigneeId, setAssigneeId] = useState('')
  const [due, setDue] = useState(dueDate || '')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    const ok = await onCreate({ title: title.trim(), stageId: stage || undefined, priority, assigneeId: assigneeId || undefined, dueDate: due || undefined })
    if (!ok) setBusy(false)
  }

  return (
    <Modal title="New task" eyebrow="OVO Flow" onClose={onClose} width={480} busy={busy}>
      <form onSubmit={submit}>
        <div className="modal-body stack-sm">
          <Field label="Title"><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} placeholder="What needs doing?" required /></Field>
          <div className="fl-two">
            <Field label="Stage"><select value={stage} onChange={(event) => setStage(event.target.value)}><option value="">Default</option>{stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
            <Field label="Priority"><select value={priority} onChange={(event) => setPriority(event.target.value)}>{PRIORITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
            <Field label="Assignee"><select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}><option value="">Unassigned</option>{members.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}</select></Field>
            <Field label="Due date"><input type="date" value={due} onChange={(event) => setDue(event.target.value)} /></Field>
          </div>
        </div>
        <div className="modal-foot">
          <Button type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" icon="plus" disabled={busy || !title.trim()}>{busy ? 'Adding…' : 'Add task'}</Button>
        </div>
      </form>
    </Modal>
  )
}
