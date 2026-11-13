/* Golddigger · editor de flujo de producción. Carga y guarda versiones del flujo de cada campaña en el servidor. */
(() => {
  const root = document.getElementById('golddigger');
  const gd = () => window.gd;
  const esc = (s) => gd().esc(s);
  const cat = () => gd().catalog;
  const tools = (type) => cat().processes[type]?.tools || ['Manual'];

  let active = null;          // id de la campaña cuyo flujo se edita
  let selected = null;        // id del proceso seleccionado
  const flows = new Map();    // campaignId → { nodes, version, savedAt, savedBy, isDefault, dirty, loading, error }

  const campaign = (id) => gd().campaigns.find((c) => c.id === id);
  const flow = () => flows.get(active);
  const nodes = () => flow()?.nodes || [];
  const find = (id) => nodes().find((n) => n.id === id);
  const btn = (text, act, extra = '') => `<button type="button" class="gd-button" data-gf="${act}" ${extra}>${text}</button>`;
  const blockedTool = (t) => t.includes('por validar') || t.includes('por configurar');

  window.gd.hasUnsavedChanges = () => [...flows.values()].some((f) => f.dirty);

  function status(text, kind = '') {
    const s = root.querySelector('#gf-status');
    if (!s) return;
    s.textContent = text;
    s.classList.toggle('error', kind === 'error');
    s.classList.toggle('gf-dirty', kind === 'dirty');
  }
  function savedLabel(f) {
    if (!f) return '';
    if (f.isDefault) return 'Flujo predeterminado · todavía sin versiones guardadas.';
    const when = f.savedAt ? new Date(f.savedAt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '';
    return `Versión ${f.version} guardada${f.savedBy ? ' por ' + f.savedBy : ''}${when ? ' · ' + when : ''}`.replace(/\.?$/, '.');
  }
  function markDirty(message = 'Cambios sin guardar.') {
    const f = flow();
    if (f) f.dirty = true;
    status(message + ' Usa «Guardar flujo» para crear una nueva versión.', 'dirty');
  }

  async function load(id, { force = false } = {}) {
    if (!force && flows.get(id) && !flows.get(id).error) return;
    flows.set(id, { loading: true, nodes: [] });
    try {
      const { workflow } = await gd().api.get(`/api/campaigns/${id}/workflow`);
      flows.set(id, { ...workflow, dirty: false });
    } catch (err) {
      flows.set(id, { nodes: [], error: err.message });
    }
  }

  function validate() {
    const ns = nodes(), ids = new Set(ns.map((n) => n.id));
    if (!ns.length) return 'Agrega al menos un proceso.';
    if (ids.size !== ns.length) return 'Hay identificadores repetidos.';
    for (const n of ns) {
      if (!n.name.trim() || !n.output.trim()) return 'Completa el nombre y resultado esperado de cada proceso.';
      if (n.deps.some((id) => !ids.has(id) || id === n.id)) return 'Hay una conexión inválida.';
      if (!Number.isFinite(+n.limit) || +n.limit < 0 || +n.limit > 1000) return 'El límite de costo debe estar entre 0 y 1000.';
      if (!Number.isInteger(+n.retries) || +n.retries < 0 || +n.retries > 5) return 'Los reintentos deben ser un entero entre 0 y 5.';
    }
    const visiting = new Set(), done = new Set();
    const visit = (id) => {
      if (visiting.has(id)) return false;
      if (done.has(id)) return true;
      visiting.add(id);
      for (const d of find(id).deps) if (!visit(d)) return false;
      visiting.delete(id); done.add(id);
      return true;
    };
    if (!ns.every((n) => visit(n.id))) return 'Hay un ciclo: un proceso no puede depender de sí mismo a través de otros.';
    return '';
  }

  function draw() {
    const board = root.querySelector('.gf-board'), svg = root.querySelector('.gf-lines');
    if (!board || !svg) return;
    const b = board.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${b.width} ${b.height}`);
    let lines = '';
    for (const n of nodes()) {
      const to = root.querySelector(`[data-node="${CSS.escape(n.id)}"]`);
      if (!to) continue;
      const tr = to.getBoundingClientRect();
      for (const d of n.deps) {
        const from = root.querySelector(`[data-node="${CSS.escape(d)}"]`);
        if (!from) continue;
        const fr = from.getBoundingClientRect();
        const x1 = fr.left - b.left + fr.width / 2, y1 = fr.bottom - b.top, x2 = tr.left - b.left + tr.width / 2, y2 = tr.top - b.top;
        const bend = Math.max(16, Math.abs(y2 - y1) * 0.4);
        lines += `<path d="M${x1},${y1} C${x1},${y1 + bend} ${x2},${y2 - bend} ${x2},${y2}"/><path d="M${x2 - 3},${y2 - 5} L${x2},${y2} L${x2 + 3},${y2 - 5}"/>`;
      }
    }
    svg.innerHTML = lines;
  }

  function map() {
    const host = root.querySelector('#gf-map');
    if (!host) return;
    const f = flow();
    if (!f || f.loading) { host.innerHTML = '<p>Cargando flujo…</p>'; root.querySelector('#gf-summary').textContent = ''; return; }
    if (f.error) { host.innerHTML = `<p class="gd-error">${esc(f.error)}</p>${btn('Reintentar', 'reload')}`; return; }
    host.innerHTML = nodes().map((n, i) => `<button type="button" class="gf-node ${blockedTool(n.tool) ? 'gf-blocked' : ''}" data-node="${esc(n.id)}" aria-pressed="${n.id === selected}"><span class="gf-number">${String(i + 1).padStart(2, '0')} · ${n.deps.length > 1 ? 'UNIÓN' : n.deps.length ? 'PROCESO' : 'INICIO'}</span><strong>${esc(n.name)}</strong><small>${esc(n.tool)}</small>${n.approval ? '<small>Requiere aprobación</small>' : ''}<span class="gf-port gf-in"></span><span class="gf-port"></span></button>`).join('');
    requestAnimationFrame(draw);
    const total = nodes().reduce((a, n) => a + Number(n.limit || 0), 0);
    root.querySelector('#gf-summary').textContent = `${nodes().length} procesos · Límites sumados: $${total.toFixed(2)} USD por pieza (sin reintentos)`;
  }

  function inspector() {
    const host = root.querySelector('#gf-inspector');
    if (!host) return;
    const f = flow();
    if (!f || f.loading || f.error) { host.innerHTML = ''; return; }
    const n = find(selected) || nodes()[0];
    if (!n) { host.innerHTML = '<h3>Agrega un proceso para empezar</h3>'; return; }
    selected = n.id;
    host.innerHTML = `<h3>Configurar proceso</h3><form class="gf-fields" id="gf-form"><label>Nombre del paso<input data-field="name" maxlength="65" value="${esc(n.name)}" required></label><label>Función<select data-field="type">${Object.keys(cat().processes).map((t) => `<option ${t === n.type ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label><label>Herramienta<select data-field="tool">${tools(n.type).map((t) => `<option ${t === n.tool ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label><label>Modelo / preset<input data-field="model" maxlength="80" value="${esc(n.model)}" placeholder="Nombre del modelo o preset"></label><label class="gf-wide">Instrucciones del proceso<textarea data-field="prompt" rows="4" maxlength="1800">${esc(n.prompt)}</textarea></label><label class="gf-wide">Resultado esperado<input data-field="output" maxlength="150" value="${esc(n.output)}" required></label><fieldset class="gf-wide"><legend>Esperar a estos procesos · conexiones de entrada</legend>${nodes().filter((x) => x.id !== n.id).map((x) => `<label class="gf-check"><input type="checkbox" data-dependency="${esc(x.id)}" ${n.deps.includes(x.id) ? 'checked' : ''}>${esc(x.name)}</label>`).join('')}</fieldset><label>Límite por ejecución · USD<input type="number" data-field="limit" min="0" step="0.1" max="1000" value="${n.limit}"></label><label>Reintentos máximos<input type="number" data-field="retries" min="0" max="5" step="1" value="${n.retries}"></label><label>Si el proceso falla<select data-field="onfail">${cat().onFail.map((s) => `<option ${s === n.onfail ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label><label class="gf-check"><input type="checkbox" data-field="approval" ${n.approval ? 'checked' : ''}>Pedir aprobación antes de continuar</label><div class="gf-wide"><h3>Especificaciones extra</h3><div class="gf-extras">${n.extras.map((x, i) => `<div class="gf-extra"><input aria-label="Nombre de especificación ${i + 1}" data-extra="${i}" data-key="key" value="${esc(x.key)}" placeholder="Ej. Resolución" maxlength="60"><input aria-label="Valor de especificación ${i + 1}" data-extra="${i}" data-key="value" value="${esc(x.value)}" placeholder="Ej. 1920 × 1080" maxlength="180">${btn('Quitar', 'extra-remove:' + i)}</div>`).join('')}</div><div style="margin-top:8px">${btn('+ Especificación', 'extra-add')}</div></div><div class="gf-row gf-wide">${btn('↑ Antes', 'up')}${btn('↓ Después', 'down')}${btn('Eliminar paso', 'remove')}</div></form>`;
  }

  function renderEditor() { map(); inspector(); }

  async function selectCampaign(id, { force = false } = {}) {
    active = id;
    selected = null;
    renderEditor();
    status('Cargando flujo…');
    await load(id, { force });
    if (active !== id) return;
    selected = nodes()[1]?.id || nodes()[0]?.id || null;
    renderEditor();
    const f = flow();
    status(f.error ? f.error : f.dirty ? 'Cambios sin guardar.' : savedLabel(f), f.error ? 'error' : f.dirty ? 'dirty' : '');
  }

  function mount() {
    if (!gd()?.ready) return;
    const h = [...root.querySelectorAll('#gd-content h2')].find((x) => x.textContent === 'Reglas de producción');
    if (!h || root.querySelector('#gf-section')) return;
    const old = h.closest('section');
    const list = gd().campaigns;
    if (!old || !list.length) return;
    const channelFilter = root.querySelector('#gd-channel').value;
    const visible = channelFilter === 'all' ? list : list.filter((c) => String(c.channelId) === channelFilter);
    const focus = gd().flowFocus && campaign(gd().flowFocus) ? gd().flowFocus : null;
    gd().flowFocus = null;
    if (focus) active = focus;
    else if (!campaign(active) || (channelFilter !== 'all' && !visible.some((c) => c.id === active))) active = (visible[0] || list[0]).id;
    old.id = 'gf-section';
    old.innerHTML = `<div class="gd-panelhead"><div><h2>Reglas de producción</h2><p>Diseña el recorrido de cada pieza y configura cada herramienta. Cada guardado crea una versión.</p></div><span class="gd-tag">Editor de flujo</span></div><div class="gf-toolbar"><label>Flujo de la campaña<select id="gf-campaign">${list.map((c) => `<option value="${c.id}" ${c.id === active ? 'selected' : ''}>${esc(c.name)}${flows.get(c.id)?.dirty ? ' •' : ''}</option>`).join('')}</select></label><div class="gf-row">${btn('Validar flujo', 'validate')}${btn('Simular recorrido', 'simulate')}${btn('Descartar cambios', 'reload')}<button type="button" class="gd-action" data-gf="save">Guardar flujo</button></div></div><div class="gf-new"><input id="gf-new-name" maxlength="65" aria-label="Nombre del nuevo proceso" placeholder="Nombre del nuevo proceso"><select id="gf-new-type" aria-label="Función del nuevo proceso">${Object.keys(cat().processes).map((t) => `<option ${t === 'Personalizado' ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>${btn('+ Agregar paso', 'add')}</div><div class="gf-layout"><div><div class="gf-board"><svg class="gf-lines" role="img" aria-label="Conexiones y dependencias entre procesos"></svg><div class="gf-nodes" id="gf-map"></div></div><p class="gf-caption">Selecciona un paso para editarlo. Las conexiones indican qué resultados debe esperar; varias entradas permiten reunir procesos en paralelo.</p><div id="gf-summary" class="gf-summary"></div><p id="gf-status" class="gf-status" role="status" aria-live="polite"></p></div><section id="gf-inspector" class="gf-inspector" aria-label="Propiedades del proceso"></section></div>`;
    resize.observe(old);
    const keepSelected = flows.get(active) && !flows.get(active).loading ? selected : null;
    if (keepSelected && flows.get(active)?.nodes?.some((n) => n.id === keepSelected)) {
      renderEditor();
      const f = flow();
      status(f.dirty ? 'Cambios sin guardar.' : savedLabel(f), f.dirty ? 'dirty' : '');
    } else {
      selectCampaign(active);
    }
  }

  function refreshCampaignOption() {
    const opt = root.querySelector(`#gf-campaign option[value="${active}"]`);
    const c = campaign(active);
    if (opt && c) opt.textContent = c.name + (flow()?.dirty ? ' •' : '');
  }

  async function save() {
    const f = flow();
    if (!f || f.loading || f.error) return;
    const error = validate();
    if (error) return status(error, 'error');
    const saveBtn = root.querySelector('[data-gf="save"]');
    if (saveBtn) saveBtn.disabled = true;
    status('Guardando…');
    try {
      const { workflow } = await gd().api.put(`/api/campaigns/${active}/workflow`, { nodes: f.nodes, baseVersion: f.version });
      flows.set(active, { ...workflow, nodes: workflow.nodes, dirty: false });
      const c = campaign(active);
      if (c) c.workflowVersion = workflow.version;
      renderEditor();
      refreshCampaignOption();
      const blocked = nodes().filter((x) => blockedTool(x.tool)).length;
      status((workflow.unchanged ? 'Sin cambios respecto a la versión ' + workflow.version + '.' : `Guardado como versión ${workflow.version}.`) +
        (blocked ? ` Hay ${blocked} conector(es) pendiente(s) de configurar.` : '') + ' No activa producción real todavía.');
    } catch (err) {
      if (err.status === 409) status(err.message + ' Usa «Descartar cambios» para cargar la versión más reciente.', 'error');
      else if (err.status !== 401) status(err.message, 'error');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  // ── Eventos ───────────────────────────────────────────────────────────────
  root.addEventListener('click', (e) => {
    const node = e.target.closest('[data-node]');
    if (node && root.querySelector('#gf-map')?.contains(node)) { selected = node.dataset.node; renderEditor(); return; }
    const b = e.target.closest('[data-gf]');
    if (!b) return;
    const a = b.dataset.gf, n = find(selected), f = flow();
    if (a === 'reload') {
      if (f?.dirty && !confirm('¿Descartar los cambios sin guardar de este flujo?')) return;
      selectCampaign(active, { force: true }).then(() => refreshCampaignOption());
      return;
    }
    if (a === 'save') return void save();
    if (!f || f.loading || f.error) return;
    if (a === 'add') {
      if (nodes().length >= cat().limits.maxNodes) return status(`Máximo ${cat().limits.maxNodes} procesos por campaña.`, 'error');
      const type = root.querySelector('#gf-new-type').value;
      const name = root.querySelector('#gf-new-name').value.trim() || type;
      const id = 'step' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const spec = cat().processes[type];
      const added = { id, type, name, tool: spec.tools[0], deps: n ? [n.id] : [], output: spec.output, prompt: spec.prompt, model: 'Predeterminado de campaña', limit: 1, retries: 1, onfail: cat().onFail[0], approval: false, extras: [] };
      const i = n ? nodes().findIndex((x) => x.id === n.id) + 1 : nodes().length;
      nodes().splice(i, 0, added);
      selected = id;
      root.querySelector('#gf-new-name').value = '';
      renderEditor(); refreshCampaignOption();
      markDirty('Proceso agregado después del seleccionado.');
    } else if (a === 'up' || a === 'down') {
      const i = nodes().findIndex((x) => x.id === selected), j = i + (a === 'up' ? -1 : 1);
      if (j < 0 || j >= nodes().length) return status('El proceso ya está en ese extremo.');
      [nodes()[i], nodes()[j]] = [nodes()[j], nodes()[i]];
      renderEditor();
      markDirty('Orden visual actualizado; las dependencias se conservan.');
    } else if (a === 'remove') {
      if (nodes().length === 1) return status('Conserva al menos un proceso.', 'error');
      const depended = nodes().filter((x) => x.deps.includes(n.id));
      nodes().forEach((x) => (x.deps = x.deps.filter((d) => d !== n.id)));
      f.nodes = nodes().filter((x) => x.id !== n.id);
      selected = nodes()[0].id;
      renderEditor(); refreshCampaignOption();
      markDirty(depended.length ? 'Paso eliminado. Revisa los procesos que dependían de él: ' + depended.map((x) => x.name).join(', ') + '.' : 'Paso eliminado.');
    } else if (a === 'extra-add') {
      if (n.extras.length >= cat().limits.maxExtras) return status(`Máximo ${cat().limits.maxExtras} especificaciones extra por paso.`, 'error');
      n.extras.push({ key: '', value: '' });
      inspector(); markDirty();
    } else if (a.startsWith('extra-remove:')) {
      n.extras.splice(+a.split(':')[1], 1);
      inspector(); markDirty();
    } else if (a === 'validate' || a === 'simulate') {
      const error = validate();
      if (error) return status(error, 'error');
      const blocked = nodes().filter((x) => blockedTool(x.tool)).length;
      if (a === 'validate') return status('Estructura válida: sin ciclos ni conexiones inválidas.' + (blocked ? ` ${blocked} conector(es) pendiente(s) de validar.` : ''));
      let remaining = [...nodes()]; const done = new Set(), groups = [];
      while (remaining.length) {
        const ready = remaining.filter((x) => x.deps.every((d) => done.has(d)));
        if (!ready.length) break;
        groups.push(ready.map((x) => x.name).join(' + '));
        ready.forEach((x) => done.add(x.id));
        remaining = remaining.filter((x) => !done.has(x.id));
      }
      status('Simulación: ' + groups.join(' → ') + '. Solo recorrido; no consume tokens ni publica.');
    }
  });

  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'gf-campaign') { selectCampaign(Number(t.value)); return; }
    if (!root.querySelector('#gf-inspector')?.contains(t)) return;
    const n = find(selected);
    if (!n) return;
    if (t.dataset.dependency) {
      const prev = [...n.deps];
      n.deps = t.checked ? [...n.deps, t.dataset.dependency] : n.deps.filter((x) => x !== t.dataset.dependency);
      const error = validate();
      if (error) { n.deps = prev; t.checked = !t.checked; status(error, 'error'); }
      else { map(); refreshCampaignOption(); markDirty('Conexión actualizada.'); }
      return;
    }
    const key = t.dataset.field;
    if (!key) return;
    if (key === 'type') {
      const spec = cat().processes[t.value];
      Object.assign(n, { type: t.value, tool: spec.tools[0], output: spec.output, prompt: spec.prompt });
      renderEditor();
    } else {
      n[key] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) : t.value;
      map();
    }
    refreshCampaignOption();
    markDirty(blockedTool(n.tool) ? 'Este proveedor requiere acceso autorizado antes de ejecutar.' : 'Cambios en el proceso.');
  });

  root.addEventListener('input', (e) => {
    const t = e.target;
    if (!root.querySelector('#gf-inspector')?.contains(t)) return;
    const n = find(selected);
    if (!n) return;
    if (t.dataset.extra !== undefined) { n.extras[+t.dataset.extra][t.dataset.key] = t.value; markDirty(); }
    else if (t.dataset.field && ['name', 'prompt', 'output', 'model'].includes(t.dataset.field)) {
      n[t.dataset.field] = t.value;
      map(); refreshCampaignOption(); markDirty();
    }
  });

  root.addEventListener('submit', (e) => { if (e.target.id === 'gf-form') e.preventDefault(); });
  window.addEventListener('beforeunload', (e) => { if (window.gd.hasUnsavedChanges()) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('gd:logout', () => { flows.clear(); active = null; selected = null; });
  window.addEventListener('gd:data-reset', () => { for (const id of [...flows.keys()]) if (!campaign(id)) flows.delete(id); if (!campaign(active)) { active = null; selected = null; } });
  window.addEventListener('gd:ready', () => mount());

  const resize = new ResizeObserver(() => requestAnimationFrame(draw));
  new MutationObserver(() => mount()).observe(root.querySelector('#gd-content'), { childList: true, subtree: true });
})();
