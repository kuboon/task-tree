DROP TABLE task_deps;
DROP TABLE tasks;

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES tasks (id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  assignee_id TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX tasks_team ON tasks (team_id);
CREATE INDEX tasks_parent ON tasks (parent_id);

CREATE TABLE task_deps (
  task_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  depends_on_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_id),
  CHECK (task_id <> depends_on_id)
);
CREATE INDEX task_deps_depends_on ON task_deps (depends_on_id);
