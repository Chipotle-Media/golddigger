import { CAMPAIGN_DEFAULTS } from '../validate.js';

/**
 * Datos de ejemplo para un espacio de trabajo nuevo, para que el panel no arranque vacío.
 * Las métricas son simuladas (no hay YouTube conectado) y la interfaz lo indica.
 */
export const DEMO_CHANNELS = [
  { name: 'Archivo Infinito', niche: 'Historia · Español', mark: 'AI', theme: '', metrics: { subscribers: 48200 } },
  { name: 'Mente en Foco', niche: 'Desarrollo personal · Español', mark: 'MF', theme: 'pink', metrics: { subscribers: 26800 } },
  { name: 'Órbita Tech', niche: 'Tecnología · Español', mark: 'OT', theme: 'blue', metrics: { subscribers: 18400 } }
];

export const DEMO_CAMPAIGNS = [
  { channel: 0, name: 'Misterios de la historia', niche: 'Historia · Español', budgetMonthly: 300, metrics: { revenue: 2480, cost: 186, videos: 24, views: 840000 } },
  { channel: 1, name: 'Hábitos que transforman', niche: 'Desarrollo personal · Español', budgetMonthly: 200, metrics: { revenue: 1340, cost: 124, videos: 20, views: 510000 } },
  { channel: 2, name: 'El futuro, explicado', niche: 'Tecnología · Español', budgetMonthly: 250, metrics: { revenue: 860, cost: 150, videos: 16, views: 320000 } }
].map((c) => ({
  ...CAMPAIGN_DEFAULTS, ...c,
  instructions: 'Narración original, fuentes verificables, ritmo ágil y un gancho inicial claro.',
  autoPublish: true
}));
