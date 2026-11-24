import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Avatar, Button, IconButton, Pill } from '../../components/ui.jsx'
import { api } from '../../lib/api.js'
import { formatDateTime, timeAgo } from '../../lib/format.js'
import { PRIORITIES, isOverdue } from './utils.js'

// The task drawer: every detail of one task, editable in place. Used by OVO Flow and by OVO Focus.
// Managers edit everything; assignees can move their task, tick subtasks and comment.
export default function TaskPanel({ taskId, members, canManage, onClose, onChange, onDelete, toast }) {
  const [detail, setDetail] = useState(null)
  const [failed, setFailed] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const [subtaskDraft, setSubtaskDraft] = useState('')
  const [commentDraft, setCommentDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const closeRef = useRef(null)

  const load = useCallback(async (silent = false) => {
    try {
      const result = await api(`/api/flow/tasks/${taskId}`)
      setDetail(result)
      if (!silent) { setTitle(result.task.title); setDescription(result.task.description || '') }
    } catch (error) {
      if (!silent) setFailed(error.message)
    }
  }, [taskId])

  useEffect(() => { setDetail(null); setFailed(''); load() }, [load])
  // Set up once: re-running this on every parent render would pull focus away from whatever is being typed.
  const closeOnEscape = useEffectEvent((event) => { if (event.key === 'Escape') onClose() })
  useEffect(() => {
    closeRef.current?.focus()
    document.addEventListener('keydown', closeOnEscape)
    document.body.classList.add('modal-open')
    return () => { document.removeEventListener('keydown', closeOnEscape); document.body.classList.remove('modal-open') }
  }, [])

  const task = detail?.task
  const patchLocal = (changes) => setDetail((current) => current && { ...current, task: { ...current.task, ...changes } })

  // Optimistic: show the change at once, put it back if the save is refused.
  async function save(changes, { history = true } = {}) {
    const before = detail.task
    patchLocal(changes)
    try {
      const result = await api(`/api/flow/tasks/${taskId}`, { method: 'PATCH', body: changes })
      patchLocal(result.task)
      onChange?.(result.task)
      if (history) load(true)
      return true
    } catch (error) {
      patchLocal(before)
      if ('title' in changes) setTitle(before.title)
      if ('description' in changes) setDescription(before.description || '')
      toast(error.message, 'error')
      return false
    }
  }

  async function moveToStage(stageId) {
    if (!stageId || stageId === task.stageId) return
    const stage = detail.stages.find((item) => item.id === stageId)
    const before = detail.task
    patchLocal({ stageId, status: stage.category })
    try {
      const result = await api(`/api/flow/tasks/${taskId}/move`, { method: 'POST', body: { stageId } })
      patchLocal(result.task)
      onChange?.(result.task)
      load(true)
    } catch (error) {
      patchLocal(before)
      toast(error.message, 'error')
    }
  }

  async function mutateList(key, optimistic, request) {
    const before = detail[key]
    setDetail((current) => ({ ...current, [key]: optimistic(current[key]) }))
    try {
      await request()
      return true
    } catch (error) {
      setDetail((current) => ({ ...current, [key]: before }))
      toast(error.message, 'error')
      return false
    }
  }

  const syncCounts = (subtasks) => {
    const counts = { subtaskTotal: subtasks.length, subtaskDone: subtasks.filter((item) => item.done).length }
    patchLocal(counts)
    onChange?.({ ...detail.task, ...counts })
  }

  async function addSubtask(event) {
    event.preventDefault()
    const text = subtaskDraft.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      const result = await api(`/api/flow/tasks/${taskId}/subtasks`, { method: 'POST', body: { title: text } })
      const next = [...detail.subtasks, result.subtask]
      setDetail((current) => ({ ...current, subtasks: next }))
      syncCounts(next)
      setSubtaskDraft('')
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function toggleSubtask(subtask) {
    const next = detail.subtasks.map((item) => (item.id === subtask.id ? { ...item, done: !item.done } : item))
    const saved = await mutateList('subtasks', () => next, () => api(`/api/flow/subtasks/${subtask.id}`, { method: 'PATCH', body: { done: !subtask.done } }))
    if (saved) syncCounts(next)
  }

  async function removeSubtask(subtask) {
    const next = detail.subtasks.filter((item) => item.id !== subtask.id)
    const saved = await mutateList('subtasks', () => next, () => api(`/api/flow/subtasks/${subtask.id}`, { method: 'DELETE' }))
    if (saved) syncCounts(next)
  }

  async function addComment(event) {
    event.preventDefault()
    const text = commentDraft.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      const result = await api(`/api/flow/tasks/${taskId}/comments`, { method: 'POST', body: { body: text } })
      setDetail((current) => ({ ...current, comments: [...current.comments, result.comment] }))
      patchLocal({ commentCount: detail.comments.length + 1 })
      onChange?.({ ...detail.task, commentCount: detail.comments.length + 1 })
      setCommentDraft('')
    } catch (error) {
      toast(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  function addTags(raw) {
    const incoming = raw.split(',').map((item) => item.trim()).filter(Boolean)
    setTagDraft('')
    const next = [...new Set([...(task.tags || []), ...incoming])].slice(0, 12)
    if (next.length !== (task.tags || []).length) save({ tags: next }, { history: false })
  }

  const activity = useMemo(() => {
    if (!detail) return []
    return [
      ...detail.history.map((item) => ({ key: `h${item.id}`, who: item.userName, text: item.action, at: item.createdAt })),
      ...detail.updates.map((item) => ({ key: `u${item.id}`, who: item.userName, text: `Posted an update — ${item.progress}%${item.note ? `: ${item.note}` : ''}`, at: item.createdAt })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 30)
  }, [detail])

  const stage = task && detail.stages.find((item) => item.id === task.stageId)
  const overdue = task && isOverdue(task)

  return (
    <div className="fl-panel-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <aside className="fl-panel" role="dialog" aria-modal="true" aria-label="Task details">
        <header className="fl-panel-head">
          <span className="fl-panel-crumb">{task?.projectName || 'QuickDrop'}{stage ? ` · ${stage.name}` : ''}</span>
          {canManage && task && <IconButton icon="trash" label="Delete task" onClick={() => onDelete?.(task)} />}
          <IconButton icon="close" label="Close task" onClick={onClose} ref={closeRef} />
        </header>

        {failed ? <p className="fl-panel-state error">{failed}</p> : !task ? (
          <div className="fl-panel-state"><span className="fl-skeleton" /><span className="fl-skeleton short" /><span className="fl-skeleton" /></div>
        ) : (
          <div className="fl-panel-body">
            <input
              className="fl-title-input" value={title} readOnly={!canManage} aria-label="Task title" maxLength={240}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => { const next = title.trim(); if (!next) setTitle(task.title); else if (next !== task.title) save({ title: next }) }}
              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
            />

            <div className="fl-fields">
              <label>
                <span>Stage</span>
                {task.projectId ? (
                  <select value={task.stageId || ''} onChange={(event) => moveToStage(event.target.value)} aria-label="Stage">
                    {!task.stageId && <option value="">—</option>}
                    {detail.stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                ) : <em className="fl-static">Not in a project yet</em>}
              </label>
              <label>
                <span>Priority</span>
                <select value={task.priority} disabled={!canManage} onChange={(event) => save({ priority: event.target.value })} aria-label="Priority">
                  {PRIORITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </label>
              <label>
                <span>Assignee</span>
                <select value={task.assigneeId || ''} disabled={!canManage} onChange={(event) => save({ assigneeId: event.target.value || null })} aria-label="Assignee">
                  <option value="">Unassigned</option>
                  {members.map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}
                </select>
              </label>
              <label>
                <span>Due date{overdue && <Pill tone="danger">Overdue</Pill>}</span>
                <span className="fl-date">
                  <input type="date" value={task.dueDate || ''} disabled={!canManage} onChange={(event) => save({ dueDate: event.target.value || null })} aria-label="Due date" />
                  {canManage && task.dueDate && <button type="button" className="text-link" onClick={() => save({ dueDate: null })}>Clear</button>}
                </span>
              </label>
            </div>

            <section className="fl-section">
              <h3>Tags</h3>
              <div className="fl-tags">
                {(task.tags || []).map((tag) => (
                  <span key={tag} className="fl-tag">{tag}{canManage && <button type="button" aria-label={`Remove tag ${tag}`} onClick={() => save({ tags: task.tags.filter((item) => item !== tag) }, { history: false })}>×</button>}</span>
                ))}
                {canManage && (
                  <input
                    value={tagDraft} placeholder="Add a tag" maxLength={32} aria-label="Add a tag"
                    onChange={(event) => { const value = event.target.value; if (value.includes(',')) addTags(value); else setTagDraft(value) }}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTags(tagDraft) } }}
                    onBlur={() => tagDraft.trim() && addTags(tagDraft)}
                  />
                )}
                {!canManage && !(task.tags || []).length && <span className="muted-note">No tags</span>}
              </div>
            </section>

            <section className="fl-section">
              <h3>Description</h3>
              <textarea
                rows={4} value={description} readOnly={!canManage} maxLength={5000} aria-label="Description"
                placeholder={canManage ? 'Add more detail…' : 'No description'}
                onChange={(event) => setDescription(event.target.value)}
                onBlur={() => { if (description.trim() !== (task.description || '')) save({ description: description.trim() }, { history: false }) }}
              />
            </section>

            <section className="fl-section">
              <h3>Subtasks {detail.subtasks.length > 0 && <small>{detail.subtasks.filter((item) => item.done).length}/{detail.subtasks.length}</small>}</h3>
              {detail.subtasks.length > 0 && (
                <div className="fl-subbar" aria-hidden="true"><span style={{ width: `${(detail.subtasks.filter((item) => item.done).length / detail.subtasks.length) * 100}%` }} /></div>
              )}
              <ul className="fl-subtasks">
                {detail.subtasks.map((item) => (
                  <li key={item.id}>
                    <label><input type="checkbox" checked={item.done} onChange={() => toggleSubtask(item)} /><span className={item.done ? 'done' : ''}>{item.title}</span></label>
                    <button type="button" className="fl-x" aria-label={`Remove ${item.title}`} onClick={() => removeSubtask(item)}>×</button>
                  </li>
                ))}
              </ul>
              <form className="fl-inline-form" onSubmit={addSubtask}>
                <input value={subtaskDraft} onChange={(event) => setSubtaskDraft(event.target.value)} placeholder="Add a subtask" maxLength={240} aria-label="Add a subtask" />
                <Button type="submit" size="sm" disabled={!subtaskDraft.trim() || busy}>Add</Button>
              </form>
            </section>

            <section className="fl-section">
              <h3>Comments {detail.comments.length > 0 && <small>{detail.comments.length}</small>}</h3>
              <ul className="fl-comments">
                {detail.comments.map((item) => (
                  <li key={item.id}>
                    <Avatar name={item.userName || '?'} size="xs" />
                    <div><strong>{item.userName || 'Former member'}</strong> <small title={formatDateTime(item.createdAt)}>{timeAgo(item.createdAt)}</small><p>{item.body}</p></div>
                  </li>
                ))}
                {!detail.comments.length && <li className="muted-note">No comments yet.</li>}
              </ul>
              <form className="fl-comment-form" onSubmit={addComment}>
                <textarea rows={2} value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} placeholder="Write a comment…" maxLength={2000} aria-label="Write a comment" />
                <Button type="submit" variant="primary" size="sm" icon="send" disabled={!commentDraft.trim() || busy}>Comment</Button>
              </form>
            </section>

            <section className="fl-section">
              <h3>Activity</h3>
              <ul className="fl-activity">
                {activity.map((item) => (
                  <li key={item.key}><Icon name="clock" size={12} /><span><strong>{item.who || 'Someone'}</strong> {item.text}</span><small title={formatDateTime(item.at)}>{timeAgo(item.at)}</small></li>
                ))}
                {!activity.length && <li className="muted-note">Nothing yet.</li>}
              </ul>
            </section>
          </div>
        )}
      </aside>
    </div>
  )
}
