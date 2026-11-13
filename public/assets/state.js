/* Preferencias de navegación por navegador (sección y canal abiertos). Los datos viven en el servidor. */
(() => {
  const key = 'golddigger:ui:v2';
  let state = {};
  try { state = JSON.parse(localStorage.getItem(key) || '{}'); } catch { state = {}; }
  if (!state || typeof state !== 'object' || Array.isArray(state)) state = {};
  try { localStorage.removeItem('golddigger:workspace:v1'); } catch { /* versión anterior, datos de demostración */ }
  window.golddiggerState = {
    get() { return { ...state }; },
    set(next) {
      state = { ...state, ...next };
      try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* almacenamiento no disponible */ }
    }
  };
})();
