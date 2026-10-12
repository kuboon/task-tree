-- Tasks no longer form a parent/child tree; dependencies (`task_deps`) are the only structure.
-- SQLite cannot drop a column that carries a foreign key, so the tables are rebuilt. Existing
-- tasks are discarded (agreed: nothing in production needs keeping yet).
DROP TABLE task_deps;
DROP TABLE tasks;

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  assignee_id TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX tasks_team ON tasks (team_id);

-- `task_id` cannot start until `depends_on_id` is done. Kept acyclic by the service.
CREATE TABLE task_deps (
  task_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  depends_on_id TEXT NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_id),
  CHECK (task_id <> depends_on_id)
);
CREATE INDEX task_deps_depends_on ON task_deps (depends_on_id);
