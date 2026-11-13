-- Conexiones con proveedores (una por espacio de trabajo y proveedor) y autorización de YouTube por canal.
CREATE TABLE integrations (
  workspace_id    bigint NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider        text NOT NULL,
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,   -- datos no secretos (p. ej. client_id de Google)
  secret_enc      text,                                -- llave o secreto cifrado con AES-256-GCM
  secret_hint     text,
  status          text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error')),
  last_checked_at timestamptz,
  last_error      text,
  account_label   text,
  updated_by      bigint REFERENCES users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider)
);

ALTER TABLE channels
  ADD COLUMN oauth_enc      text,
  ADD COLUMN handle         text,
  ADD COLUMN thumbnail_url  text,
  ADD COLUMN connected_at   timestamptz,
  ADD COLUMN connected_by   bigint REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN last_synced_at timestamptz,
  ADD COLUMN last_error     text;

CREATE UNIQUE INDEX channels_external_key ON channels (workspace_id, provider, external_id) WHERE external_id IS NOT NULL;
