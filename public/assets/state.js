/* Browser-only demo persistence. Never store API credentials here. */
(() => {
  const key = 'golddigger:workspace:v1';
  let state = {};
  try { state = JSON.parse(localStorage.getItem(key) || '{}'); } catch { state = {}; }
  if (!state || typeof state !== 'object' || Array.isArray(state)) state = {};
  window.golddiggerState = {
    get widgetState() { return structuredClone(state); },
    async setWidgetState(next) {
      state = {
        modelContent: next.modelContent ?? state.modelContent,
        privateContent: { ...state.privateContent, ...next.privateContent }
      };
      try { localStorage.setItem(key, JSON.stringify(state)); }
      catch {
        const notice = document.getElementById('gd-notice');
        if (notice) notice.textContent = 'No se pudo guardar en este navegador. Revisa el espacio disponible y los permisos de almacenamiento.';
      }
    }
  };
})();
