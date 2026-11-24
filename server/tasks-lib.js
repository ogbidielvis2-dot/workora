// Task query and stage helpers shared by the classic Tasks routes and OVO Flow, so both keep
// a task's status and its workflow stage in step.

export const taskSelect = `
  SELECT t.id, t.title, t.description, t.status, t.priority, t.due_date AS "dueDate", t.progress,
         (SELECT max(tu.created_at) FROM task_updates tu WHERE tu.task_id = t.id) AS "lastUpdateAt",
         t.project_id AS "projectId", p.name AS "projectName",
         t.assignee_id AS "assigneeId", u.full_name AS "assigneeName",
         t.stage_id AS "stageId", t.position, t.tags,
         (SELECT count(*)::int FROM task_subtasks s WHERE s.task_id = t.id) AS "subtaskTotal",
         (SELECT count(*)::int FROM task_subtasks s WHERE s.task_id = t.id AND s.done) AS "subtaskDone",
         (SELECT count(*)::int FROM task_comments c WHERE c.task_id = t.id) AS "commentCount",
         t.created_by AS "createdBy", t.created_at AS "createdAt"
  FROM tasks t
  LEFT JOIN users u ON u.id = t.assignee_id
  LEFT JOIN projects p ON p.id = t.project_id`

export const DEFAULT_STAGES = [
  { name: 'Backlog', category: 'To Do', color: '#8b8aa3' },
  { name: 'To Do', category: 'To Do', color: '#4f86f7' },
  { name: 'In Progress', category: 'In Progress', color: '#e8a02d' },
  { name: 'In Review', category: 'Review', color: '#9468f0' },
  { name: 'Completed', category: 'Completed', color: '#2bb673' },
]

// The stage whose name best matches a status: "In Review" for Review, otherwise the status itself.
const bestStage = `
  SELECT s.id FROM flow_stages s
  WHERE s.project_id = $1 AND s.category = $2
  ORDER BY (s.name = CASE $2 WHEN 'Review' THEN 'In Review' ELSE $2 END) DESC, s.position
  LIMIT 1`

// Gives a project its default workflow the first time it is opened, and attaches every existing
// task to the stage matching its status. Safe to call repeatedly and from concurrent requests.
export async function ensureStages(db, organizationId, projectId) {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`flow:${projectId}`])
  const existing = await db.query('SELECT count(*)::int AS count FROM flow_stages WHERE project_id = $1', [projectId])
  if (!existing.rows[0].count) {
    for (const [index, stage] of DEFAULT_STAGES.entries()) {
      await db.query(
        'INSERT INTO flow_stages (organization_id, project_id, name, color, category, position) VALUES ($1, $2, $3, $4, $5, $6)',
        [organizationId, projectId, stage.name, stage.color, stage.category, index],
      )
    }
  }
  await db.query(
    `UPDATE tasks t SET stage_id = (
       SELECT s.id FROM flow_stages s WHERE s.project_id = t.project_id AND s.category = t.status
       ORDER BY (s.name = CASE t.status WHEN 'Review' THEN 'In Review' ELSE t.status END) DESC, s.position LIMIT 1)
     WHERE t.project_id = $1 AND t.organization_id = $2 AND t.stage_id IS NULL`,
    [projectId, organizationId],
  )
  // A project whose stages no longer cover a task's status: park the task in the first stage and follow it.
  await db.query(
    `UPDATE tasks t SET stage_id = f.id, status = f.category
     FROM (SELECT id, category FROM flow_stages WHERE project_id = $1 ORDER BY position LIMIT 1) f
     WHERE t.project_id = $1 AND t.organization_id = $2 AND t.stage_id IS NULL`,
    [projectId, organizationId],
  )
  // First time in Flow every card has position 0: order each stage by due date, then age.
  await db.query(
    `UPDATE tasks t SET position = r.p
     FROM (SELECT id, row_number() OVER (PARTITION BY stage_id ORDER BY due_date NULLS LAST, created_at) * 1000.0 AS p
           FROM tasks WHERE project_id = $1 AND organization_id = $2
             AND stage_id IN (SELECT stage_id FROM tasks WHERE project_id = $1 AND position = 0 AND stage_id IS NOT NULL)) r
     WHERE t.id = r.id`,
    [projectId, organizationId],
  )
}

// After a status or project change made outside Flow, put the task in a matching stage.
export async function reconcileStage(db, taskId) {
  const found = await db.query(
    `SELECT t.status, t.project_id, t.stage_id, s.category AS stage_category, s.project_id AS stage_project
     FROM tasks t LEFT JOIN flow_stages s ON s.id = t.stage_id WHERE t.id = $1`,
    [taskId],
  )
  const task = found.rows[0]
  if (!task) return
  if (!task.project_id) {
    if (task.stage_id) await db.query('UPDATE tasks SET stage_id = NULL WHERE id = $1', [taskId])
    return
  }
  if (task.stage_id && task.stage_project === task.project_id && task.stage_category === task.status) return
  const target = await db.query(bestStage, [task.project_id, task.status])
  if (!target.rowCount) {
    // No workflow for this project yet (or none matching): Flow attaches the task when the project is opened.
    if (task.stage_id) await db.query('UPDATE tasks SET stage_id = NULL WHERE id = $1', [taskId])
    return
  }
  await db.query(
    `UPDATE tasks SET stage_id = $1,
            position = COALESCE((SELECT max(position) FROM tasks WHERE stage_id = $1), 0) + 1000
     WHERE id = $2`,
    [target.rows[0].id, taskId],
  )
}

export function recordHistory(db, auth, taskId, action) {
  return db.query(
    'INSERT INTO task_history (organization_id, task_id, user_id, action) VALUES ($1, $2, $3, $4)',
    [auth.organizationId, taskId, auth.userId, action],
  )
}
