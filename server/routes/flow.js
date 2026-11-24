// OVO Flow: workflow stages, ordered tasks, task details, subtasks, comments and history.
// Permissions follow OVO's existing rules: managers (owner, admin, manager) run projects and
// workflows; everyone else only sees and moves the tasks assigned to them.
import express from 'express'
import { z } from 'zod'
import { pool } from '../db.js'
import { runAutomations } from '../automation.js'
import { requireAuth, requireRole } from '../auth.js'
import { ensureStages, recordHistory, taskSelect } from '../tasks-lib.js'
import {
  HttpError, MANAGERS, assertMember, logActivity, notify, optionalDate, route, validationError, withTransaction,
} from '../lib.js'

const router = express.Router()
router.use(requireAuth)
const managersOnly = requireRole(...MANAGERS)
const isManager = (auth) => MANAGERS.includes(auth.role)

const categories = ['To Do', 'In Progress', 'Review', 'Completed']
const priorities = ['Low', 'Medium', 'High', 'Urgent']
const nullableId = z.union([z.uuid(), z.literal(''), z.null()]).optional()
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colours look like #4f86f7.')
const tags = z.array(z.string().trim().min(1).max(32)).max(12)

function parse(schema, body, response) {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    validationError(response, parsed.error)
    return null
  }
  return parsed.data
}

const cleanTags = (list) => [...new Set(list.map((tag) => tag.replace(/\s+/g, ' ').trim()).filter(Boolean))]

// A task the caller may touch: managers any task in the workspace, others only their own.
async function loadTask(db, auth, id, { lock = false } = {}) {
  const result = await db.query(
    `SELECT t.* FROM tasks t WHERE t.id = $1 AND t.organization_id = $2 AND ($3 OR t.assignee_id = $4)${lock ? ' FOR UPDATE OF t' : ''}`,
    [id, auth.organizationId, isManager(auth), auth.userId],
  )
  if (!result.rowCount) throw new HttpError(404, 'Task not found or you do not have access to it.')
  return result.rows[0]
}

async function loadStage(db, auth, id) {
  const result = await db.query('SELECT * FROM flow_stages WHERE id = $1 AND organization_id = $2', [id, auth.organizationId])
  if (!result.rowCount) throw new HttpError(404, 'Stage not found in this workspace.')
  return result.rows[0]
}

const fetchTask = async (db, id) => (await db.query(`${taskSelect} WHERE t.id = $1`, [id])).rows[0]

async function notifyAssignee(db, auth, task, previousAssigneeId) {
  if (task.assigneeId && task.assigneeId !== auth.userId && task.assigneeId !== previousAssigneeId) {
    await notify(db, auth.organizationId, task.assigneeId, {
      title: 'New task assigned to you',
      message: `${auth.fullName} assigned you “${task.title}”.`,
      resourceType: 'task',
      resourceId: task.id,
    })
  }
}

async function appendPosition(db, stageId) {
  const result = await db.query('SELECT COALESCE(max(position), 0) + 1000 AS next FROM tasks WHERE stage_id = $1', [stageId])
  return result.rows[0].next
}

// Everything that should happen once a task newly reaches Completed, the same as the classic board.
async function afterCompleted(auth, task) {
  if (task.createdBy && task.createdBy !== auth.userId) {
    const creator = await pool.query('SELECT 1 FROM organization_members WHERE organization_id = $1 AND user_id = $2', [auth.organizationId, task.createdBy])
    if (creator.rowCount) {
      await notify(pool, auth.organizationId, task.createdBy, {
        title: 'Task completed', message: `${auth.fullName} completed “${task.title}”.`, resourceType: 'task', resourceId: task.id,
      })
    }
  }
  await runAutomations({ organizationId: auth.organizationId, actorId: auth.userId, type: 'task_completed', task })
}

// ---------------------------------------------------------------- Project workspace

router.get('/projects/:id', managersOnly, route(async (request, response) => {
  const payload = await withTransaction(async (client) => {
    const project = await client.query(
      `SELECT p.id, p.name, p.description, p.status, p.due_date AS "dueDate", p.client_id AS "clientId", c.name AS "clientName"
       FROM projects p LEFT JOIN clients c ON c.id = p.client_id AND c.organization_id = p.organization_id
       WHERE p.id = $1 AND p.organization_id = $2`,
      [request.params.id, request.auth.organizationId],
    )
    if (!project.rowCount) throw new HttpError(404, 'Project not found in this workspace.')
    await ensureStages(client, request.auth.organizationId, request.params.id)
    const stages = await client.query(
      'SELECT id, name, color, category, position FROM flow_stages WHERE project_id = $1 ORDER BY position, created_at',
      [request.params.id],
    )
    const tasks = await client.query(
      `${taskSelect} WHERE t.project_id = $1 AND t.organization_id = $2 ORDER BY t.position, t.created_at`,
      [request.params.id, request.auth.organizationId],
    )
    return { project: project.rows[0], stages: stages.rows, tasks: tasks.rows }
  })
  return response.json(payload)
}))

// ---------------------------------------------------------------- Stages

const stageSchema = z.object({ name: z.string().trim().min(1).max(60), color: color.optional(), category: z.enum(categories).optional() })

router.post('/projects/:id/stages', managersOnly, route(async (request, response) => {
  const values = parse(stageSchema, request.body, response)
  if (!values) return undefined
  const stage = await withTransaction(async (client) => {
    const project = await client.query('SELECT 1 FROM projects WHERE id = $1 AND organization_id = $2', [request.params.id, request.auth.organizationId])
    if (!project.rowCount) throw new HttpError(404, 'Project not found in this workspace.')
    await ensureStages(client, request.auth.organizationId, request.params.id)
    const count = await client.query('SELECT count(*)::int AS count, COALESCE(max(position), -1) + 1 AS next FROM flow_stages WHERE project_id = $1', [request.params.id])
    if (count.rows[0].count >= 20) throw new HttpError(400, 'A workflow can have up to 20 stages.')
    const inserted = await client.query(
      `INSERT INTO flow_stages (organization_id, project_id, name, color, category, position)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, color, category, position`,
      [request.auth.organizationId, request.params.id, values.name, values.color || '#8b8aa3', values.category || 'In Progress', count.rows[0].next],
    )
    await logActivity(client, request.auth, 'added workflow stage', 'project', values.name)
    return inserted.rows[0]
  })
  return response.status(201).json({ stage })
}))

router.patch('/stages/:id', managersOnly, route(async (request, response) => {
  const values = parse(stageSchema.partial().strict(), request.body, response)
  if (!values) return undefined
  const stage = await withTransaction(async (client) => {
    const current = await loadStage(client, request.auth, request.params.id)
    const updated = await client.query(
      `UPDATE flow_stages SET name = COALESCE($1, name), color = COALESCE($2, color), category = COALESCE($3, category)
       WHERE id = $4 RETURNING id, name, color, category, position`,
      [values.name ?? null, values.color ?? null, values.category ?? null, current.id],
    )
    // Tasks follow the stage's category so reports and the classic Tasks board stay accurate.
    if (values.category && values.category !== current.category) {
      await client.query(
        `UPDATE tasks SET status = $1, progress = CASE WHEN $1 = 'Completed' THEN 100 ELSE progress END WHERE stage_id = $2`,
        [values.category, current.id],
      )
    }
    return updated.rows[0]
  })
  return response.json({ stage })
}))

router.delete('/stages/:id', managersOnly, route(async (request, response) => {
  const values = parse(z.object({ moveTo: nullableId }).strict(), request.body || {}, response)
  if (!values) return undefined
  await withTransaction(async (client) => {
    const stage = await loadStage(client, request.auth, request.params.id)
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`flow:${stage.project_id}`])
    const siblings = await client.query('SELECT id FROM flow_stages WHERE project_id = $1', [stage.project_id])
    if (siblings.rowCount <= 1) throw new HttpError(400, 'A project needs at least one stage.')
    const count = await client.query('SELECT count(*)::int AS count FROM tasks WHERE stage_id = $1', [stage.id])
    if (count.rows[0].count) {
      if (!values.moveTo) throw new HttpError(409, `This stage has ${count.rows[0].count} task${count.rows[0].count === 1 ? '' : 's'}. Choose a stage to move them to.`, 'stage_not_empty')
      if (values.moveTo === stage.id) throw new HttpError(400, 'Choose a different stage to move the tasks to.')
      const target = await loadStage(client, request.auth, values.moveTo)
      if (target.project_id !== stage.project_id) throw new HttpError(400, 'Tasks can only move to a stage in the same project.')
      const base = await appendPosition(client, target.id)
      await client.query(
        `UPDATE tasks t SET stage_id = $1, status = $2, progress = CASE WHEN $2 = 'Completed' THEN 100 ELSE t.progress END,
                position = $3 + r.n * 1000
         FROM (SELECT id, row_number() OVER (ORDER BY position, created_at) AS n FROM tasks WHERE stage_id = $4) r
         WHERE t.id = r.id`,
        [target.id, target.category, base, stage.id],
      )
    }
    await client.query('DELETE FROM flow_stages WHERE id = $1', [stage.id])
    await logActivity(client, request.auth, 'removed workflow stage', 'project', stage.name)
  })
  return response.status(204).end()
}))

router.put('/projects/:id/stages/order', managersOnly, route(async (request, response) => {
  const values = parse(z.object({ ids: z.array(z.uuid()).min(1).max(20) }).strict(), request.body, response)
  if (!values) return undefined
  const stages = await withTransaction(async (client) => {
    const project = await client.query('SELECT 1 FROM projects WHERE id = $1 AND organization_id = $2', [request.params.id, request.auth.organizationId])
    if (!project.rowCount) throw new HttpError(404, 'Project not found in this workspace.')
    const current = await client.query('SELECT id FROM flow_stages WHERE project_id = $1', [request.params.id])
    const known = new Set(current.rows.map((row) => row.id))
    if (values.ids.length !== known.size || new Set(values.ids).size !== known.size || values.ids.some((id) => !known.has(id))) {
      throw new HttpError(400, 'The stage order must list every stage in the project exactly once.')
    }
    await client.query(
      'UPDATE flow_stages s SET position = o.n FROM (SELECT id, ord - 1 AS n FROM unnest($1::uuid[]) WITH ORDINALITY AS t(id, ord)) o WHERE s.id = o.id',
      [values.ids],
    )
    return (await client.query('SELECT id, name, color, category, position FROM flow_stages WHERE project_id = $1 ORDER BY position', [request.params.id])).rows
  })
  return response.json({ stages })
}))

// ---------------------------------------------------------------- Tasks

const createSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(5000).optional(),
  projectId: nullableId,
  stageId: nullableId,
  priority: z.enum(priorities).optional(),
  assigneeId: nullableId,
  dueDate: optionalDate,
  tags: tags.optional(),
})

// Quick capture: a title is all that is required. With no project the task lands in QuickDrop.
router.post('/tasks', managersOnly, route(async (request, response) => {
  const values = parse(createSchema, request.body, response)
  if (!values) return undefined
  const task = await withTransaction(async (client) => {
    await assertMember(client, values.assigneeId || null, request.auth.organizationId)
    let projectId = values.projectId || null
    let stage = null
    if (values.stageId) {
      stage = await loadStage(client, request.auth, values.stageId)
      if (projectId && projectId !== stage.project_id) throw new HttpError(400, 'That stage belongs to a different project.')
      projectId = stage.project_id
    } else if (projectId) {
      const project = await client.query('SELECT 1 FROM projects WHERE id = $1 AND organization_id = $2', [projectId, request.auth.organizationId])
      if (!project.rowCount) throw new HttpError(404, 'Project not found in this workspace.')
      await ensureStages(client, request.auth.organizationId, projectId)
      stage = (await client.query(
        `SELECT * FROM flow_stages WHERE project_id = $1 ORDER BY (category = 'To Do') DESC, (name = 'To Do') DESC, position LIMIT 1`,
        [projectId],
      )).rows[0]
    }
    const status = stage?.category || 'To Do'
    const position = stage ? await appendPosition(client, stage.id) : (await client.query(
      'SELECT COALESCE(max(position), 0) + 1000 AS next FROM tasks WHERE organization_id = $1 AND project_id IS NULL', [request.auth.organizationId],
    )).rows[0].next
    const inserted = await client.query(
      `INSERT INTO tasks (organization_id, project_id, stage_id, title, description, priority, status, progress, due_date, assignee_id, tags, position, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [request.auth.organizationId, projectId, stage?.id || null, values.title, values.description || '', values.priority || 'Medium', status,
        status === 'Completed' ? 100 : 0, values.dueDate || null, values.assigneeId || null, cleanTags(values.tags || []), position, request.auth.userId],
    )
    await recordHistory(client, request.auth, inserted.rows[0].id, stage ? `Created in ${stage.name}` : 'Captured in QuickDrop')
    await logActivity(client, request.auth, 'created task', 'task', values.title)
    const created = await fetchTask(client, inserted.rows[0].id)
    await notifyAssignee(client, request.auth, created, null)
    return created
  })
  return response.status(201).json({ task })
}))

const moveSchema = z.object({ stageId: z.uuid(), index: z.number().int().min(0).max(100000).optional() }).strict()

// Drag a task to a stage (and a place in it). Drops onto another project's stage adopt the task into
// that project, which is how QuickDrop tasks join a workflow.
router.post('/tasks/:id/move', route(async (request, response) => {
  const values = parse(moveSchema, request.body, response)
  if (!values) return undefined
  let completedNow = false
  const task = await withTransaction(async (client) => {
    const current = await loadTask(client, request.auth, request.params.id, { lock: true })
    const stage = await loadStage(client, request.auth, values.stageId)
    if (stage.project_id !== current.project_id && !isManager(request.auth)) {
      throw new HttpError(403, 'Only managers can move a task into another project.')
    }
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`flow:${stage.project_id}`])
    const others = await client.query(
      'SELECT id FROM tasks WHERE stage_id = $1 AND id <> $2 ORDER BY position, created_at',
      [stage.id, current.id],
    )
    const ids = others.rows.map((row) => row.id)
    // Only managers see a whole column, so only they can choose a place inside it.
    const at = isManager(request.auth) && values.index !== undefined ? Math.min(values.index, ids.length) : ids.length
    ids.splice(at, 0, current.id)
    const done = stage.category === 'Completed'
    await client.query(
      `UPDATE tasks SET stage_id = $1, project_id = $2, status = $3, progress = CASE WHEN $4 THEN 100 ELSE progress END WHERE id = $5`,
      [stage.id, stage.project_id, stage.category, done, current.id],
    )
    await client.query(
      'UPDATE tasks t SET position = o.n * 1000 FROM (SELECT id, ord AS n FROM unnest($1::uuid[]) WITH ORDINALITY AS u(id, ord)) o WHERE t.id = o.id',
      [ids],
    )
    if (current.stage_id !== stage.id) {
      const from = current.stage_id ? (await client.query('SELECT name FROM flow_stages WHERE id = $1', [current.stage_id])).rows[0]?.name : null
      await recordHistory(client, request.auth, current.id, from ? `Moved from ${from} to ${stage.name}` : `Moved to ${stage.name}`)
      await logActivity(client, request.auth, `moved task to ${stage.name}`, 'task', current.title)
    }
    completedNow = current.status !== 'Completed' && stage.category === 'Completed'
    return fetchTask(client, current.id)
  })
  if (completedNow) await afterCompleted(request.auth, task)
  return response.json({ task })
}))

const updateSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(5000),
  priority: z.enum(priorities),
  assigneeId: nullableId,
  dueDate: optionalDate,
  tags,
}).partial().strict()

// Editing a task's details is a manager's job, as it is on the classic Tasks screen.
router.patch('/tasks/:id', managersOnly, route(async (request, response) => {
  const values = parse(updateSchema, request.body, response)
  if (!values) return undefined
  const task = await withTransaction(async (client) => {
    const current = await loadTask(client, request.auth, request.params.id, { lock: true })
    const sets = []
    const args = []
    const set = (column, value) => { args.push(value); sets.push(`${column} = $${args.length}`) }
    if (values.title !== undefined) set('title', values.title)
    if (values.description !== undefined) set('description', values.description)
    if (values.priority !== undefined) set('priority', values.priority)
    if (values.tags !== undefined) set('tags', cleanTags(values.tags))
    if ('dueDate' in values) set('due_date', values.dueDate || null)
    if ('assigneeId' in values) {
      await assertMember(client, values.assigneeId || null, request.auth.organizationId)
      set('assignee_id', values.assigneeId || null)
    }
    if (!sets.length) throw new HttpError(400, 'Nothing to update.')
    args.push(current.id)
    await client.query(`UPDATE tasks SET ${sets.join(', ')} WHERE id = $${args.length}`, args)
    if (values.priority !== undefined && values.priority !== current.priority) await recordHistory(client, request.auth, current.id, `Priority changed to ${values.priority}`)
    if ('dueDate' in values && (values.dueDate || null) !== (current.due_date || null)) {
      await recordHistory(client, request.auth, current.id, values.dueDate ? `Due date set to ${values.dueDate}` : 'Due date cleared')
    }
    const updated = await fetchTask(client, current.id)
    if ('assigneeId' in values && (values.assigneeId || null) !== current.assignee_id) {
      await recordHistory(client, request.auth, current.id, updated.assigneeName ? `Assigned to ${updated.assigneeName}` : 'Unassigned')
      await notifyAssignee(client, request.auth, updated, current.assignee_id)
    }
    await logActivity(client, request.auth, 'updated task', 'task', updated.title)
    return updated
  })
  return response.json({ task })
}))

router.post('/tasks/:id/duplicate', managersOnly, route(async (request, response) => {
  const task = await withTransaction(async (client) => {
    const source = await loadTask(client, request.auth, request.params.id)
    const position = source.stage_id ? await appendPosition(client, source.stage_id) : source.position + 1
    const inserted = await client.query(
      `INSERT INTO tasks (organization_id, project_id, stage_id, title, description, priority, status, progress, due_date, assignee_id, tags, position, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [source.organization_id, source.project_id, source.stage_id, `${source.title} (copy)`.slice(0, 240), source.description, source.priority,
        source.status, source.status === 'Completed' ? 100 : 0, source.due_date, source.assignee_id, source.tags, position, request.auth.userId],
    )
    await client.query(
      `INSERT INTO task_subtasks (organization_id, task_id, title, done, position)
       SELECT organization_id, $1, title, false, position FROM task_subtasks WHERE task_id = $2`,
      [inserted.rows[0].id, source.id],
    )
    await recordHistory(client, request.auth, inserted.rows[0].id, `Duplicated from “${source.title}”`)
    return fetchTask(client, inserted.rows[0].id)
  })
  return response.status(201).json({ task })
}))

// Everything the task panel shows.
router.get('/tasks/:id', route(async (request, response) => {
  const current = await loadTask(pool, request.auth, request.params.id)
  const [task, subtasks, comments, history, updates, stages] = await Promise.all([
    fetchTask(pool, current.id),
    pool.query('SELECT id, title, done, position FROM task_subtasks WHERE task_id = $1 ORDER BY position, created_at', [current.id]),
    pool.query(
      `SELECT c.id, c.body, c.created_at AS "createdAt", c.user_id AS "userId", u.full_name AS "userName"
       FROM task_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.task_id = $1 ORDER BY c.created_at`,
      [current.id],
    ),
    pool.query(
      `SELECT h.id, h.action, h.created_at AS "createdAt", u.full_name AS "userName"
       FROM task_history h LEFT JOIN users u ON u.id = h.user_id WHERE h.task_id = $1 ORDER BY h.created_at DESC LIMIT 50`,
      [current.id],
    ),
    pool.query(
      `SELECT tu.id, tu.progress, tu.note, tu.created_at AS "createdAt", u.full_name AS "userName"
       FROM task_updates tu LEFT JOIN users u ON u.id = tu.user_id WHERE tu.task_id = $1 ORDER BY tu.created_at DESC LIMIT 50`,
      [current.id],
    ),
    current.project_id
      ? pool.query('SELECT id, name, color, category, position FROM flow_stages WHERE project_id = $1 ORDER BY position', [current.project_id])
      : { rows: [] },
  ])
  return response.json({ task, subtasks: subtasks.rows, comments: comments.rows, history: history.rows, updates: updates.rows, stages: stages.rows })
}))

// ---------------------------------------------------------------- Subtasks and comments

router.post('/tasks/:id/subtasks', route(async (request, response) => {
  const values = parse(z.object({ title: z.string().trim().min(1).max(240) }).strict(), request.body, response)
  if (!values) return undefined
  const task = await loadTask(pool, request.auth, request.params.id)
  const count = await pool.query('SELECT count(*)::int AS count, COALESCE(max(position), 0) + 1 AS next FROM task_subtasks WHERE task_id = $1', [task.id])
  if (count.rows[0].count >= 100) throw new HttpError(400, 'A task can have up to 100 subtasks.')
  const result = await pool.query(
    'INSERT INTO task_subtasks (organization_id, task_id, title, position) VALUES ($1, $2, $3, $4) RETURNING id, title, done, position',
    [request.auth.organizationId, task.id, values.title, count.rows[0].next],
  )
  return response.status(201).json({ subtask: result.rows[0] })
}))

async function loadSubtask(auth, id) {
  const result = await pool.query(
    `SELECT s.id FROM task_subtasks s JOIN tasks t ON t.id = s.task_id
     WHERE s.id = $1 AND s.organization_id = $2 AND ($3 OR t.assignee_id = $4)`,
    [id, auth.organizationId, isManager(auth), auth.userId],
  )
  if (!result.rowCount) throw new HttpError(404, 'Subtask not found or you do not have access to it.')
}

router.patch('/subtasks/:id', route(async (request, response) => {
  const values = parse(z.object({ title: z.string().trim().min(1).max(240).optional(), done: z.boolean().optional() }).strict(), request.body, response)
  if (!values) return undefined
  await loadSubtask(request.auth, request.params.id)
  const result = await pool.query(
    'UPDATE task_subtasks SET title = COALESCE($1, title), done = COALESCE($2, done) WHERE id = $3 RETURNING id, title, done, position',
    [values.title ?? null, values.done ?? null, request.params.id],
  )
  return response.json({ subtask: result.rows[0] })
}))

router.delete('/subtasks/:id', route(async (request, response) => {
  await loadSubtask(request.auth, request.params.id)
  await pool.query('DELETE FROM task_subtasks WHERE id = $1', [request.params.id])
  return response.status(204).end()
}))

router.post('/tasks/:id/comments', route(async (request, response) => {
  const values = parse(z.object({ body: z.string().trim().min(1).max(2000) }).strict(), request.body, response)
  if (!values) return undefined
  const task = await loadTask(pool, request.auth, request.params.id)
  const result = await pool.query(
    'INSERT INTO task_comments (organization_id, task_id, user_id, body) VALUES ($1, $2, $3, $4) RETURNING id, body, created_at AS "createdAt", user_id AS "userId"',
    [request.auth.organizationId, task.id, request.auth.userId, values.body],
  )
  const recipient = task.assignee_id && task.assignee_id !== request.auth.userId ? task.assignee_id : (task.created_by !== request.auth.userId ? task.created_by : null)
  if (recipient) {
    const member = await pool.query('SELECT 1 FROM organization_members WHERE organization_id = $1 AND user_id = $2', [request.auth.organizationId, recipient])
    if (member.rowCount) {
      await notify(pool, request.auth.organizationId, recipient, {
        title: 'New comment on a task', message: `${request.auth.fullName} commented on “${task.title}”.`, resourceType: 'task', resourceId: task.id,
      })
    }
  }
  return response.status(201).json({ comment: { ...result.rows[0], userName: request.auth.fullName } })
}))

router.delete('/comments/:id', route(async (request, response) => {
  const result = await pool.query(
    'DELETE FROM task_comments WHERE id = $1 AND organization_id = $2 AND ($3 OR user_id = $4) RETURNING id',
    [request.params.id, request.auth.organizationId, isManager(request.auth), request.auth.userId],
  )
  if (!result.rowCount) throw new HttpError(404, 'Comment not found or you cannot delete it.')
  return response.status(204).end()
}))

export default router
