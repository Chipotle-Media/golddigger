-- Marca las campañas de ejemplo para poder limpiarlas sin tocar las creadas por el equipo.
ALTER TABLE campaigns ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
-- Las campañas sembradas son las únicas con métricas simuladas en canales de ejemplo.
UPDATE campaigns c SET is_demo = true
FROM channels ch
WHERE ch.id = c.channel_id AND ch.is_demo AND c.metrics <> '{}'::jsonb;
