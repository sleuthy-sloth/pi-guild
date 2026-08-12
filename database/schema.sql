-- Pi Studio schema (SQLite, spec §9).
-- Applied by database/db.ts via the migrations table.

PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  goals TEXT NOT NULL DEFAULT '[]',
  policies TEXT NOT NULL DEFAULT '[]',
  workflows TEXT NOT NULL DEFAULT '[]',
  budgets TEXT NOT NULL DEFAULT '{}',
  integrations TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  goals TEXT NOT NULL DEFAULT '[]',
  roadmap TEXT NOT NULL DEFAULT '[]',
  repository_id TEXT,
  documentation TEXT NOT NULL DEFAULT '',
  metrics TEXT NOT NULL DEFAULT '{}',
  settings TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  responsibilities TEXT NOT NULL DEFAULT '[]',
  tools TEXT NOT NULL DEFAULT '[]',
  permissions TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  system_prompt TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role_id TEXT REFERENCES agent_roles(id) ON DELETE SET NULL,
  role_name TEXT NOT NULL,
  model TEXT,
  provider TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  current_task_id TEXT,
  state TEXT NOT NULL DEFAULT 'CREATED',
  session_id TEXT,
  session_file TEXT,
  kind TEXT NOT NULL DEFAULT 'persistent',
  schedule TEXT,
  trigger_event TEXT,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  last_activity_at INTEGER
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  acceptance_criteria TEXT NOT NULL DEFAULT '[]',
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  assignee_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  creator_id TEXT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  labels TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT 'BACKLOG',
  repository TEXT,
  branch TEXT,
  pr TEXT,
  artifacts TEXT NOT NULL DEFAULT '[]',
  depth INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  sender_id TEXT,
  sender_name TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  project_id TEXT,
  task_id TEXT,
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  message_type TEXT NOT NULL,
  content TEXT NOT NULL,
  parent_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'UNREAD',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  project_id TEXT,
  parent_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'goal',
  status TEXT NOT NULL DEFAULT 'open',
  depth INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  project_id TEXT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'all',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  scope_id TEXT,
  kind TEXT NOT NULL DEFAULT 'note',
  content TEXT NOT NULL,
  source TEXT,
  author TEXT,
  confidence REAL NOT NULL DEFAULT 1.0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  payload TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS integrations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'local',
  url TEXT,
  path TEXT,
  default_branch TEXT NOT NULL DEFAULT 'main',
  protected_branches TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS commits (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  sha TEXT,
  message TEXT,
  author TEXT,
  branch TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pull_requests (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  number INTEGER,
  title TEXT,
  state TEXT,
  branch TEXT,
  base_branch TEXT,
  url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  pull_request_id TEXT NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  reviewer_id TEXT,
  verdict TEXT,
  comments TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS escalations (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  task_id TEXT,
  problem TEXT NOT NULL,
  context TEXT,
  options TEXT NOT NULL DEFAULT '[]',
  recommendation TEXT,
  risk TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id TEXT,
  project_id TEXT,
  agent_id TEXT,
  task_id TEXT,
  model TEXT,
  provider TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  model_calls INTEGER NOT NULL DEFAULT 1,
  elapsed_ms INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
