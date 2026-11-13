-- Golddigger · esquema inicial: usuarios, espacios de trabajo, sesiones, canales, campañas y versiones de flujo.

CREATE TABLE users (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email         text NOT NULL,
  name          text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE workspaces (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id bigint NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role         text NOT NULL DEFAULT 'editor' CHECK (role IN ('owner', 'editor')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, workspace_id)
);

CREATE TABLE sessions (
  token_hash   text PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id bigint NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  user_agent   text,
  ip           text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

CREATE TABLE channels (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id bigint NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  niche        text NOT NULL DEFAULT '',
  mark         text NOT NULL DEFAULT '',
  theme        text NOT NULL DEFAULT '',
  provider     text NOT NULL DEFAULT 'youtube',
  external_id  text,
  is_demo      boolean NOT NULL DEFAULT false,
  metrics      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX channels_workspace_idx ON channels (workspace_id);

CREATE TABLE campaigns (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id   bigint NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id     bigint NOT NULL REFERENCES channels(id) ON DELETE RESTRICT,
  name           text NOT NULL,
  niche          text NOT NULL DEFAULT '',
  "references"   text NOT NULL DEFAULT '',
  format         text NOT NULL,
  days           text NOT NULL,
  time           text NOT NULL,
  budget_monthly numeric(12,2) NOT NULL DEFAULT 0,
  max_per_piece  numeric(12,2) NOT NULL DEFAULT 0,
  script_tool    text NOT NULL,
  clips_tool     text NOT NULL,
  instructions   text NOT NULL DEFAULT '',
  auto_publish   boolean NOT NULL DEFAULT false,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  metrics        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX campaigns_workspace_idx ON campaigns (workspace_id);

-- Cada guardado del editor crea una versión inmutable; la ejecución futura fijará una versión concreta.
CREATE TABLE workflow_versions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id bigint NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  version     integer NOT NULL,
  nodes       jsonb NOT NULL,
  created_by  bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, version)
);
