import { useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { Empty, Pill, Segmented } from '../../components/ui.jsx'
import { api } from '../../lib/api.js'
import { dueLabel, todayKey } from '../../lib/format.js'
import { useWorkspace } from '../context.js'
import { PRIORITIES, isOverdue, priorityColor, priorityLabel } from './utils.js'

const TABS = ['today', 'upcoming', 'overdue', 'mine', 'done']

function readTab() {
  try {
    const saved = localStorage.getItem('ovo.focus.tab')
    return TABS.includes(saved) ? saved : 'today'
  } catch {
    return 'today'
  }
}

const byDate = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.title.localeCompare(b.title)

// OVO Focus: everything assigned to you, across every project, without copying anything anywhere.
export default function Focus({ onOpen }) {
  const { account, data, isManager, patch, reload, toast } = useWorkspace()
  const [tab, setTab] = useState(readTab)
  const today = todayKey()
  const mine = data.tasks.filter((task) => task.assigneeId === account.user.id)
  const open = mine.filter((task) => task.status !== 'Completed')
  const groups = {
    today: open.filter((task) => task.dueDate === today).sort(byDate),
    upcoming: open.filter((task) => task.dueDate && task.dueDate > today).sort(byDate),
    overdue: open.filter((task) => task.dueDate && task.dueDate < today).sort(byDate),
    mine: [...open].sort(byDate),
    done: mine.filter((task) => task.status === 'Completed').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 50),
  }
  const labels = { today: 'Today', upcoming: 'Upcoming', overdue: 'Overdue', mine: 'Assigned to me', done: 'Completed' }
  const list = groups[tab]

  const choose = (next) => {
    setTab(next)
    try { localStorage.setItem('ovo.focus.tab', next) } catch { /* a convenience only */ }
  }

  function toggle(task) {
    const done = task.status === 'Completed'
    patch(`/api/tasks/${task.id}`, { status: done ? 'To Do' : 'Completed' }, ['tasks', 'dashboard', 'projects'], done ? 'Task reopened' : 'Task completed — nice work!')
  }

  // Priorities and dates are managers' to change, as everywhere else in OVO.
  async function edit(task, changes) {
    try {
      await api(`/api/flow/tasks/${task.id}`, { method: 'PATCH', body: changes })
      await reload(['tasks', 'projects', 'dashboard'])
    } catch (error) {
      toast(error.message, 'error')
    }
  }

  return (
    <div className="stack fo">
      <Segmented
        label="Focus"
        value={tab}
        onChange={choose}
        options={TABS.map((key) => ({ value: key, label: labels[key], count: key === 'done' ? undefined : groups[key].length }))}
      />
      {list.length ? (
        <ul className="fo-list">
          {list.map((task) => {
            const done = task.status === 'Completed'
            const due = !done ? dueLabel(task.dueDate) : null
            return (
              <li key={task.id} className={done ? 'done' : ''}>
                <input type="checkbox" checked={done} onChange={() => toggle(task)} aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`} />
                <button type="button" className="fo-title" onClick={() => onOpen(task)}>
                  <span>{task.title}</span>
                  <small>{task.projectName || 'No project'}{task.subtaskTotal ? ` · ${task.subtaskDone}/${task.subtaskTotal} subtasks` : ''}</small>
                </button>
                {isManager && !done ? (
                  <>
                    <select value={task.priority} onChange={(event) => edit(task, { priority: event.target.value })} aria-label={`Priority for ${task.title}`} className="inline-select">
                      {PRIORITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                    </select>
                    <input type="date" value={task.dueDate || ''} onChange={(event) => edit(task, { dueDate: event.target.value || null })} aria-label={`Due date for ${task.title}`} className="fo-date" />
                  </>
                ) : (
                  <>
                    <span className="fo-prio"><i style={{ background: priorityColor(task.priority) }} />{priorityLabel(task.priority)}</span>
                    {due ? <Pill tone={isOverdue(task) ? 'danger' : due.tone === 'warning' ? 'warning' : 'muted'}>{due.text}</Pill> : <span className="muted">{done ? 'Done' : 'No date'}</span>}
                  </>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <Empty icon={tab === 'done' ? 'check' : 'target'} title={tab === 'overdue' ? 'Nothing overdue' : tab === 'done' ? 'Nothing completed yet' : tab === 'today' ? 'Nothing due today' : 'Nothing here'}>
          {tab === 'mine' ? 'When a manager assigns you a task you will get a notification and it appears here.' : tab === 'done' ? 'Tasks you finish will collect here.' : 'You are all caught up.'}
        </Empty>
      )}
      <p className="muted-note"><Icon name="sparkle" size={13} /> Tasks assigned to you from every project appear here automatically.</p>
    </div>
  )
}
