-- OVO Flow: per-project workflow stages, ordered tasks, tags, subtasks, comments and task history.
-- Purely additive: existing tasks keep their status, and a stage is attached lazily when a project is first opened in Flow.

-- A project's workflow columns. `category` maps every stage onto one of the four built-in task
-- statuses, so reports, automations and the classic Tasks board keep working with custom stages.
CREATE TABLE IF NOT EXISTS flow_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#8b8aa3',
  category TEXT NOT NULL DEFAULT 'To Do' CHECK (category IN ('To Do', 'In Progress', 'Review', 'Completed')),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS flow_stages_project_idx ON flow_stages(project_id, position);

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS stage_id UUID REFERENCES flow_stages(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS position DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS tasks_stage_idx ON tasks(stage_id, position);

CREATE TABLE IF NOT EXISTS task_subtasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_subtasks_task_idx ON task_subtasks(task_id, position);

CREATE TABLE IF NOT EXISTS task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_comments_task_idx ON task_comments(task_id, created_at);

-- What happened to a task: moves, assignments, priority and date changes.
CREATE TABLE IF NOT EXISTS task_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_history_task_idx ON task_history(task_id, created_at DESC);
