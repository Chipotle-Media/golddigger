/* Golddigger Studio · pantallas, navegación, sesión y campañas (datos desde la API). */
(() => {
  const api = window.gdApi;
  const prefs = window.golddiggerState;
  const root = document.getElementById('golddigger');
  const $ = (sel) => root.querySelector(sel);
  const content = $('#gd-content');
  const nav = $('nav');

  const names = ['Resumen', 'Canales', 'Campañas', 'Producción', 'Calendario', 'Resultados y costos', 'Conexiones'];
  let page = 2, channel = 'all';

  // Estado compartido con el editor de flujo (flow-editor.js).
  const gd = (window.gd = { api, catalog: null, me: null, channels: [], campaigns: [], ready: false });

  // ── Utilidades ────────────────────────────────────────────────────────────
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  gd.esc = esc;
  const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const initials = (s) => String(s || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  const channelOf = (c) => gd.channels.find((ch) => ch.id === c.channelId) || { name: '—', mark: '?', theme: '' };
  const metric = (c, k) => Number(c.metrics?.[k] || 0);
  const selected = () => gd.campaigns.filter((c) => channel === 'all' || String(c.channelId) === channel);
  const selectedChannels = () => gd.channels.filter((ch) => channel === 'all' || String(ch.id) === channel);
  const sum = (k) => selected().reduce((a, c) => a + metric(c, k), 0);
  const firstChannelName = () => (selected()[0] ? channelOf(selected()[0]).name : selectedChannels()[0]?.name || 'Tu canal');
  const badge = (s, cls = 'live') => `<span class="gd-tag ${cls}">${s}</span>`;
  const button = (s, act = 'preview') => `<button type="button" class="gd-button" data-act="${act}">${s}</button>`;
  const heading = (title, sub, action = '') => `<div class="gd-heading"><div><h1>${title}</h1><p>${sub}</p></div>${action}</div>`;
  const action = (s, a) => `<button type="button" class="gd-action" data-act="${a}">${s}</button>`;
  const stat = (l, v, n, green = false) => `<div class="gd-stat"><span>${l}</span><strong>${v}</strong><small class="${green ? 'gd-positive' : ''}">${n}</small></div>`;
  const statusBadge = (c) => (c.status === 'paused' ? badge('Pausada', 'wait') : badge('Activa'));
  const titlecell = (c) => `<div class="gd-titlecell"><div class="gd-mini">${esc(channelOf(c).mark)}</div><div>${esc(c.name)}<small>${esc(channelOf(c).name)}</small></div></div>`;
  const note = '<div class="gd-note">Campañas y flujos se guardan en el servidor. Ingresos, vistas y costos son simulados hasta conectar YouTube y los proveedores.</div>';
  const empty = (text, act) => `<div class="gd-empty"><p>${text}</p>${act ? `<div style="margin-top:12px">${act}</div>` : ''}</div>`;

  function notify(s) { $('#gd-notice').textContent = s; }
  gd.notify = notify;

  // ── Pantallas ─────────────────────────────────────────────────────────────
  function chart() {
    const vals = [24, 36, 30, 45, 38, 51, 48, 65, 57, 72, 68, 86, 95];
    return `<div class="gd-chart" role="img" aria-label="Ejemplo ilustrativo de evolución diaria de ingresos">${vals.map((v, i) => `<div style="height:${v}%" title="Día ${i + 1} · tendencia ilustrativa"></div>`).join('')}</div><div class="gd-chartlabels"><span>Día 1</span><span>Día 4</span><span>Día 7</span><span>Día 10</span><span>Día 13</span></div>`;
  }
  function revenueTable() {
    if (!selected().length) return empty('No hay campañas en este canal.', action('+ Nueva campaña', 'new'));
    return `<div class="gd-tablewrap"><table><thead><tr><th>Campaña / canal</th><th>Estado</th><th class="num">Ingresos</th><th class="num">Costo</th><th class="num">Margen*</th></tr></thead><tbody>${selected().map((c) => `<tr><td>${titlecell(c)}</td><td>${statusBadge(c)}</td><td class="num">${money(metric(c, 'revenue'))}</td><td class="num">${money(metric(c, 'cost'))}</td><td class="num">${money(metric(c, 'revenue') - metric(c, 'cost'))}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="2">${channel === 'all' ? 'Total · todas las campañas' : 'Total · canal seleccionado'}</td><td class="num">${money(sum('revenue'))}</td><td class="num">${money(sum('cost'))}</td><td class="num">${money(sum('revenue') - sum('cost'))}</td></tr></tfoot></table></div><small>*Ingresos menos producción; no incluye impuestos ni gastos generales.</small>`;
  }
  function overview() {
    const active = selected().filter((c) => c.status === 'active').length;
    return heading('Tu operación, en un vistazo', 'Ingresos, producción y próximas publicaciones.', action('+ Nueva campaña', 'new')) +
      `<div class="gd-stats">${stat('Ingresos acumulados', money(sum('revenue')), 'YouTube · datos simulados', true)}${stat('Costos de producción', money(sum('cost')), 'Incluye recursos y reintentos')}${stat('Margen de producción', money(sum('revenue') - sum('cost')), 'Antes de gastos generales', true)}${stat('Videos publicados', sum('videos'), active + ' campañas activas')}</div><section class="gd-panel"><div class="gd-panelhead"><h2>Ingresos por campaña</h2><span class="gd-tag">Simulado · USD</span></div>${revenueTable()}</section><section class="gd-panel"><div class="gd-panelhead"><div><h2>Producción en marcha</h2><p>Vista ilustrativa hasta conectar la ejecución real.</p></div>${badge('Ejemplo', 'wait')}</div><div class="gd-flex"><span>${esc(firstChannelName())} · Próxima pieza</span><span class="gd-tag">18:00 · Ciudad de México</span></div><div class="gd-flow"><span class="gd-step done">✓ Guion</span><span class="gd-step done">✓ Voz</span><span class="gd-step current">● Escenas · 7/10</span><span class="gd-step">Montaje</span><span class="gd-step">YouTube</span></div>${button('Ver producción', 'production')}</section>` + note;
  }
  function channels() {
    const list = selectedChannels();
    return heading('Tus canales', 'Identidades independientes. Una sola operación.', action('+ Conectar canal', 'connect')) +
      (list.length ? `<div class="gd-grid">${list.map((ch) => {
        const camps = gd.campaigns.filter((c) => c.channelId === ch.id);
        const revenue = camps.reduce((a, c) => a + metric(c, 'revenue'), 0);
        return `<article class="gd-card"><div class="gd-cover ${esc(ch.theme)}">${esc(ch.mark)}</div><div class="gd-cardtop"><h3>${esc(ch.name)}</h3>${ch.isDemo ? badge('Demo', '') : badge('Conectado')}</div><p>${esc(ch.niche)}</p><div class="gd-details"><div><span>Suscriptores</span><b>${Number(ch.metrics?.subscribers || 0).toLocaleString('en-US')}</b></div><div><span>Campañas activas</span><b>${camps.filter((c) => c.status === 'active').length}</b></div><div><span>Ingresos del período</span><b>${money(revenue)}</b></div><div><span>Publicación</span><b>${camps.some((c) => c.autoPublish) ? 'Automática' : 'Manual'}</b></div></div>${button('Ver campañas', 'campaigns-of:' + ch.id)}</article>`;
      }).join('')}</div>` : empty('Todavía no hay canales.')) +
      `<section class="gd-panel gd-section"><h2>Cada canal conserva su identidad</h2><div class="gd-details"><div><span>Voz, idioma y marca visual</span><span>Por canal</span></div><div><span>Autorización de YouTube</span><span>Conexión independiente</span></div><div><span>Presupuesto y calendario</span><span>Por campaña</span></div></div></section>` + note;
  }
  function campaignView() {
    const list = selected();
    return heading('Campañas', 'Define el contenido. Golddigger coordina el proceso.', action('+ Nueva campaña', 'new')) +
      (list.length ? `<div class="gd-grid">${list.map((c) => {
        const ch = channelOf(c);
        const pct = c.budgetMonthly > 0 ? Math.min(100, (metric(c, 'cost') / c.budgetMonthly) * 100) : 0;
        return `<article class="gd-card" data-campaign="${c.id}"><div class="gd-cardtop"><div class="gd-mini">${esc(ch.mark)}</div>${statusBadge(c)}</div><h3>${esc(c.name)}</h3><p>${esc(ch.name)}</p><div class="gd-details"><div><span>Formato</span><b>${esc(c.format)}</b></div><div><span>Frecuencia</span><b>${esc(c.days)}, ${esc(c.time)}</b></div><div><span>Publicados</span><b>${metric(c, 'videos')} videos</b></div><div><span>Flujo</span><b>${c.workflowVersion ? 'Versión ' + c.workflowVersion : 'Predeterminado'}</b></div></div><small>Presupuesto consumido · ${money(metric(c, 'cost'))} / ${money(c.budgetMonthly)}</small><div class="gd-meter"><b style="width:${pct}%"></b></div><div class="gd-flex" style="margin-top:16px">${button('Configurar', 'edit:' + c.id)}${button(c.status === 'paused' ? 'Reanudar' : 'Pausar', 'toggle:' + c.id)}</div></article>`;
      }).join('')}</div>` : empty(channel === 'all' ? 'Todavía no tienes campañas.' : 'Este canal no tiene campañas.', action('+ Nueva campaña', 'new'))) +
      (gd.campaigns.length ? `<section class="gd-panel gd-section"><div class="gd-panelhead"><h2>Reglas de producción</h2>${badge('Piloto automático')}</div><p>Cargando editor de flujo…</p></section>` : '') + note;
  }
  function production() {
    return heading('Estudio de producción', 'De la idea a un video listo para tu audiencia.', button('Ver calendario', 'calendar')) +
      `<div class="gd-subnav"><button class="gd-button active" data-act="queue:all">Todas · 4</button><button class="gd-button" data-act="queue:process">En proceso · 2</button><button class="gd-button" data-act="queue:ready">Listas · 1</button><button class="gd-button" data-act="queue:review">Revisión · 1</button></div><div id="gd-queue">${videoCards('all')}</div>` +
      '<div class="gd-note">Piezas de ejemplo: la ejecución real de producción todavía no está conectada.</div>';
  }
  function videoCards(filter) {
    const rows = [
      ['La ciudad que desapareció del mapa', 'Escenas · 7 de 10', 'En proceso', 'process'],
      ['El hábito de los cinco minutos', 'Montaje final', 'En proceso', 'process'],
      ['Lo que viene después de la IA', 'Lista para el viernes · 18:00', 'Lista', 'ready'],
      ['Un imperio bajo la arena', 'Audio pendiente de revisión', 'Revisión', 'review']
    ];
    let rs = rows.filter((r) => filter === 'all' || r[3] === filter);
    if (channel !== 'all') rs = rs.slice(0, 2);
    const chs = selected().map(channelOf);
    return `<div class="gd-grid two">${rs.map((r, i) => `<article class="gd-card"><div class="gd-video">${r[0].toUpperCase()}</div><div class="gd-cardtop"><h3>${r[0]}</h3>${badge(r[2], r[3] === 'ready' ? 'live' : 'wait')}</div><p>${esc(chs.length ? chs[i % chs.length].name : firstChannelName())} · 7:42 · 16:9</p><div class="gd-details"><div><span>${r[1]}</span><b>Est. $8.40</b></div></div><div class="gd-flex">${button('Ver pieza', 'metadata')}${button('Metadatos', 'metadata')}</div></article>`).join('')}</div>`;
  }
  function calendar() {
    const first = esc(firstChannelName());
    return heading('Calendario de publicaciones', 'Vista ilustrativa · zona horaria: Ciudad de México', action('+ Programar pieza', 'schedule')) +
      `<div class="gd-panel"><div class="gd-panelhead"><h2>Semana de ejemplo</h2>${badge('Programación automática')}</div><div class="gd-calendar">${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => `<div class="gd-dayname">${d}</div>`).join('')}${[9, 10, 11, 12, 13, 14, 15].map((d, i) => `<div class="gd-day ${i === 4 ? 'today' : ''}"><span>${d}</span>${i % 2 === 0 ? `<span class="gd-event">18:00<br>${first}<br>${i < 4 ? '✓ Publicado' : 'Programado'}</span>` : ''}</div>`).join('')}</div></div><section class="gd-panel"><div class="gd-panelhead"><h2>Próximas salidas</h2><span class="gd-tag">Horario local</span></div><div class="gd-tablewrap"><table><thead><tr><th>Pieza</th><th>Publicación</th><th>Estado</th></tr></thead><tbody><tr><td>La ciudad que desapareció<small>${first}</small></td><td>Hoy · 18:00</td><td>${badge('Produciendo', 'wait')}</td></tr><tr><td>Un nuevo comienzo<small>${first}</small></td><td>Lunes · 18:00</td><td>${badge('En cola', '')}</td></tr></tbody></table></div></section>` +
      '<div class="gd-note">Calendario de ejemplo: la programación real llegará con la conexión a YouTube.</div>';
  }
  function results() {
    const views = sum('views'), videos = sum('videos');
    return heading('Resultados y costos', 'Entiende qué produce valor y cuánto cuesta conseguirlo.') +
      `<div class="gd-stats">${stat('Ingresos del período', money(sum('revenue')), 'Acumulado simulado', true)}${stat('Costo por video', money(videos ? sum('cost') / videos : 0), 'Producción total / publicados')}${stat('Visualizaciones', (views / 1e6).toFixed(2) + ' M', 'Videos largos · ejemplo')}${stat('RPM efectivo', money(views ? (sum('revenue') / views) * 1000 : 0), 'Ingresos / vistas × 1,000')}</div><section class="gd-panel"><div class="gd-panelhead"><h2>Tendencia de ingresos</h2><span class="gd-tag">Ilustrativa · no es pronóstico</span></div>${chart()}</section><section class="gd-panel"><div class="gd-panelhead"><h2>Desglose de producción</h2><span class="gd-tag">Costo simulado</span></div><div class="gd-tablewrap"><table><thead><tr><th>Concepto</th><th>Unidad de consumo</th><th class="num">Costo</th></tr></thead><tbody>${[
        ['Guion y revisión', 'Tokens de entrada, salida y caché', 0.12],
        ['Escenas e imágenes', 'Segundos y recursos generados', 0.53],
        ['Voz y música', 'Audio y licencias', 0.2],
        ['Montaje, almacenamiento y reintentos', 'Tiempo y uso de infraestructura', 0.15]
      ].map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td class="num">${money(sum('cost') * r[2])}</td></tr>`).join('')}</tbody><tfoot><tr><td colspan="2">Total de producción</td><td class="num">${money(sum('cost'))}</td></tr></tfoot></table></div></section>` + note;
  }
  function connections() {
    const providers = [
      ['Claude', 'Guion y estructura', 'Listo para conectar', 'API oficial'],
      ['OpenAI', 'Revisión, imágenes y voz', 'Listo para conectar', 'API oficial'],
      ['Google Veo', 'Clips generados', 'Listo para conectar', 'API de video · distinta de Flow'],
      ['Suno', 'Música original', 'Por validar', 'Acceso autorizado y derechos pendientes'],
      ['YouTube', 'Carga, programación y métricas', 'Listo para conectar', 'Autorización por canal'],
      ['Biblioteca musical', 'Música para tus piezas', 'Disponible en demo', 'Alternativa a Suno']
    ];
    return heading('Conexiones', 'Elige las herramientas que participan en tu producción.') +
      `<div class="gd-grid two">${providers.map((p, i) => `<article class="gd-card"><div class="gd-cardtop"><h3>${p[0]}</h3>${badge(p[2], i === 3 ? 'wait' : '')}</div><p>${p[1]}</p><div class="gd-details"><small>${p[3]}</small></div>${button(i === 3 ? 'Ver requisito' : 'Configurar', 'provider:' + i)}</article>`).join('')}</div><p class="gd-note">Esta vista no solicita ni almacena credenciales todavía. Las claves se guardarán solo en el servidor cuando se conecte cada proveedor.</p>`;
  }

  function renderChrome() {
    const sel = $('#gd-channel');
    sel.innerHTML = `<option value="all">Todos los canales</option>${gd.channels.map((ch) => `<option value="${ch.id}">${esc(ch.name)}</option>`).join('')}`;
    if (channel !== 'all' && !gd.channels.some((ch) => String(ch.id) === channel)) channel = 'all';
    sel.value = channel;
    $('#gd-ws-name').textContent = gd.me.workspace.name;
    $('#gd-ws-mark').textContent = initials(gd.me.workspace.name).slice(0, 1);
    $('#gd-ws-count').textContent = `${gd.channels.length} canales · ${gd.campaigns.length} campañas`;
    $('#gd-user-button').textContent = initials(gd.me.user.name);
    $('#gd-user-button').setAttribute('aria-label', 'Cuenta de ' + gd.me.user.name);
    $('#gd-user-name').textContent = gd.me.user.name;
    $('#gd-user-email').textContent = gd.me.user.email;
  }
  function render() {
    nav.innerHTML = names.map((n, i) => `<button type="button" class="${page === i ? 'active' : ''}" data-page="${i}" ${page === i ? 'aria-current="page"' : ''}>${n}</button>`).join('');
    $('#gd-crumb').textContent = gd.me.workspace.name + ' / ' + names[page];
    content.innerHTML = [overview, channels, campaignView, production, calendar, results, connections][page]();
  }
  gd.render = () => { renderChrome(); render(); };
  function go(p) { page = p; closeModal(); render(); savePrefs(); }
  function savePrefs() { prefs?.set({ page, channel }); }

  // ── Modales ───────────────────────────────────────────────────────────────
  function modal(body) {
    const m = $('#gd-modal');
    m.innerHTML = body;
    m.hidden = false;
    m.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    m.querySelector('input:not([type=hidden]), select, textarea')?.focus({ preventScroll: true });
  }
  function closeModal() { $('#gd-modal').hidden = true; $('#gd-modal').innerHTML = ''; }
  const options = (list, current) => list.map((v) => `<option ${v === current ? 'selected' : ''}>${esc(v)}</option>`).join('');

  function showFormError(form, err) {
    form.querySelectorAll('.gd-invalid').forEach((x) => x.classList.remove('gd-invalid'));
    const box = form.querySelector('.gd-error');
    box.textContent = err.message;
    const field = err.field && form.querySelector(`[name="${err.field}"]`);
    if (field) { field.classList.add('gd-invalid'); field.focus(); }
  }
  async function submitting(form, fn) {
    const btns = form.querySelectorAll('button[type=submit]');
    btns.forEach((b) => (b.disabled = true));
    try { await fn(); } catch (err) { if (err.status !== 401) showFormError(form, err); } finally { btns.forEach((b) => (b.disabled = false)); }
  }

  function editCampaign(id) {
    const cat = gd.catalog.campaign;
    const c = id ? gd.campaigns.find((x) => x.id === id) : null;
    if (id && !c) return notify('No se encontró la campaña.');
    if (!gd.channels.length) return notify('Primero necesitas un canal.');
    const preset = c || { channelId: channel !== 'all' ? Number(channel) : gd.channels[0].id, format: cat.formats[0], days: cat.days[0], time: '18:00', budgetMonthly: 100, maxPerPiece: 12, scriptTool: cat.scriptTools[0], clipsTool: cat.clipsTools[0], instructions: 'Narración original, fuentes verificables, ritmo ágil y un gancho inicial claro.', autoPublish: false, niche: '', references: '', name: '' };
    modal(`<div class="gd-panelhead"><div><h2>${c ? 'Configurar campaña' : 'Nueva campaña'}</h2><p>${c ? 'Los cambios se guardan en el servidor.' : 'Se crea con el flujo de producción predeterminado; puedes ajustarlo después.'}</p></div>${button('Cerrar', 'close')}</div>
      <form id="gd-campaignform" class="gd-form" novalidate>
        <label>Nombre<input name="name" maxlength="80" value="${esc(preset.name)}" placeholder="Ej. Historias del mundo" required></label>
        <label>Canal<select name="channelId">${gd.channels.map((ch) => `<option value="${ch.id}" ${ch.id === preset.channelId ? 'selected' : ''}>${esc(ch.name)}</option>`).join('')}</select></label>
        <label class="wide">Canales y videos de referencia<textarea name="references" rows="2" maxlength="2000" placeholder="Pega enlaces de referencia y describe qué te interesa de ellos">${esc(preset.references)}</textarea></label>
        <label>Nicho<input name="niche" maxlength="120" value="${esc(preset.niche)}" placeholder="Ej. Historia · Español"></label>
        <label>Formato<select name="format">${options(cat.formats, preset.format)}</select></label>
        <label>Días<select name="days">${options(cat.days, preset.days)}</select></label>
        <label>Hora local<input name="time" type="time" value="${esc(preset.time)}" required></label>
        <label>Presupuesto mensual · USD<input name="budgetMonthly" type="number" min="0" max="100000" step="1" value="${preset.budgetMonthly}"></label>
        <label>Máximo por pieza · USD<input name="maxPerPiece" type="number" min="0" max="10000" step="0.5" value="${preset.maxPerPiece}"></label>
        <label>Guion<select name="scriptTool">${options(cat.scriptTools, preset.scriptTool)}</select></label>
        <label>Clips<select name="clipsTool">${options(cat.clipsTools, preset.clipsTool)}</select></label>
        <label class="wide">Instrucciones editoriales<textarea name="instructions" rows="2" maxlength="2000">${esc(preset.instructions)}</textarea></label>
        <label class="gd-check wide"><input name="autoPublish" type="checkbox" ${preset.autoPublish ? 'checked' : ''}>Publicar automáticamente si supera la revisión y respeta el presupuesto</label>
        <p class="gd-error" role="alert"></p>
        <div class="wide gd-flex"><button class="gd-action" type="submit">${c ? 'Guardar cambios' : 'Crear campaña'}</button>${button('Cancelar', 'close')}</div>
      </form>`);
    const form = $('#gd-campaignform');
    form.onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const body = {
        name: f.get('name'), channelId: Number(f.get('channelId')), references: f.get('references'), niche: f.get('niche'),
        format: f.get('format'), days: f.get('days'), time: f.get('time'), budgetMonthly: Number(f.get('budgetMonthly')),
        maxPerPiece: Number(f.get('maxPerPiece')), scriptTool: f.get('scriptTool'), clipsTool: f.get('clipsTool'),
        instructions: f.get('instructions'), autoPublish: f.get('autoPublish') === 'on'
      };
      if (!String(body.name).trim()) return showFormError(form, { message: 'El nombre es obligatorio.', field: 'name' });
      submitting(form, async () => {
        const { campaign } = c ? await api.patch(`/api/campaigns/${c.id}`, body) : await api.post('/api/campaigns', body);
        upsertCampaign(campaign);
        closeModal();
        if (!c) { page = 2; channel = 'all'; gd.flowFocus = campaign.id; }
        gd.render();
        savePrefs();
        notify(c ? `Campaña «${campaign.name}» guardada.` : `Campaña «${campaign.name}» creada. Ajusta su flujo en Reglas de producción.`);
      });
    };
  }
  function upsertCampaign(campaign) {
    const i = gd.campaigns.findIndex((x) => x.id === campaign.id);
    if (i >= 0) gd.campaigns[i] = campaign; else gd.campaigns.push(campaign);
  }
  gd.upsertCampaign = upsertCampaign;

  async function toggleCampaign(id, btn) {
    const c = gd.campaigns.find((x) => x.id === id);
    if (!c) return;
    btn.disabled = true;
    try {
      const { campaign } = await api.patch(`/api/campaigns/${id}`, { status: c.status === 'paused' ? 'active' : 'paused' });
      upsertCampaign(campaign);
      render();
      notify(campaign.status === 'paused' ? `«${campaign.name}» quedó en pausa.` : `«${campaign.name}» está activa de nuevo.`);
    } catch (err) {
      btn.disabled = false;
      if (err.status !== 401) notify(err.message);
    }
  }

  function changePassword() {
    modal(`<div class="gd-panelhead"><div><h2>Cambiar contraseña</h2><p>Se cerrarán tus sesiones en otros dispositivos.</p></div>${button('Cerrar', 'close')}</div>
      <form id="gd-passform" class="gd-form" novalidate>
        <label class="wide">Contraseña actual<input name="current" type="password" autocomplete="current-password" required></label>
        <label>Nueva contraseña<input name="password" type="password" autocomplete="new-password" minlength="10" required></label>
        <label>Repite la nueva contraseña<input name="repeat" type="password" autocomplete="new-password" required></label>
        <p class="gd-error" role="alert"></p>
        <div class="wide gd-flex"><button class="gd-action" type="submit">Cambiar contraseña</button>${button('Cancelar', 'close')}</div>
      </form>`);
    const form = $('#gd-passform');
    form.onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(form);
      if (f.get('password') !== f.get('repeat')) return showFormError(form, { message: 'Las contraseñas nuevas no coinciden.', field: 'repeat' });
      submitting(form, async () => {
        await api.post('/api/auth/password', { current: f.get('current'), password: f.get('password') });
        closeModal();
        notify('Contraseña actualizada.');
      });
    };
  }

  // ── Eventos ───────────────────────────────────────────────────────────────
  nav.onclick = (e) => { const b = e.target.closest('[data-page]'); if (b) go(+b.dataset.page); };
  $('#gd-channel').onchange = (e) => { channel = e.target.value; closeModal(); render(); savePrefs(); };
  const userPanel = $('#gd-user-panel'), userButton = $('#gd-user-button');
  const setMenu = (open) => { userPanel.hidden = !open; userButton.setAttribute('aria-expanded', String(open)); };
  userButton.onclick = (e) => { e.stopPropagation(); setMenu(userPanel.hidden); };
  document.addEventListener('click', (e) => { if (!e.target.closest('.gd-usermenu')) setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act;
    if (a === 'new') editCampaign(null);
    else if (a.startsWith('edit:')) editCampaign(+a.split(':')[1]);
    else if (a.startsWith('toggle:')) toggleCampaign(+a.split(':')[1], b);
    else if (a === 'close') closeModal();
    else if (a === 'logout') logout();
    else if (a === 'password') { setMenu(false); changePassword(); }
    else if (a.startsWith('campaigns-of:')) { channel = a.split(':')[1]; renderChrome(); go(2); }
    else if (['production', 'calendar', 'campaigns', 'connect'].includes(a)) go({ production: 3, calendar: 4, campaigns: 2, connect: 6 }[a]);
    else if (a.startsWith('queue:')) {
      root.querySelectorAll('.gd-subnav button').forEach((x) => x.classList.toggle('active', x === b));
      $('#gd-queue').innerHTML = videoCards(a.split(':')[1]);
    } else if (a === 'metadata') {
      modal(`<div class="gd-panelhead"><h2>Ficha de publicación · ejemplo</h2>${button('Cerrar', 'close')}</div><div class="gd-form"><label class="wide">Título<input value="La ciudad que desapareció del mapa: lo que sabemos"></label><label class="wide">Descripción<textarea rows="3">Exploramos las pistas y las fuentes detrás de una ciudad olvidada.</textarea></label><label>Categoría<select><option>Educación</option><option>Ciencia y tecnología</option><option>Entretenimiento</option></select></label><label>Audiencia<select><option>No creado para niños</option><option>Creado para niños</option></select></label><label class="gd-check wide"><input type="checkbox" checked>Declarar contenido sintético realista cuando corresponda</label><div class="wide"><div class="gd-video">LA CIUDAD<br>QUE DESAPARECIÓ</div><small>Miniatura de ejemplo · sin archivo de video generado</small></div></div>`);
    } else if (a === 'schedule') notify('La programación real llegará con la conexión a YouTube.');
    else if (a.startsWith('provider:')) {
      notify(+a.split(':')[1] === 3
        ? 'Suno: confirmar acceso autorizado a generación y licencia comercial antes de habilitar la conexión.'
        : 'La conexión con este proveedor es el siguiente paso del desarrollo. No ingreses claves en esta vista.');
    }
  });

  // ── Sesión y arranque ─────────────────────────────────────────────────────
  function setView(v) { root.dataset.view = v; }

  function showLogin(message = '') {
    setView('login');
    closeModal();
    gd.ready = false;
    const form = $('#gd-login-form');
    $('#gd-login-error').textContent = message;
    form.querySelector('[name=password]').value = '';
    form.querySelector(form.email.value ? '[name=password]' : '[name=email]').focus();
  }
  function showUnavailable(title, text) {
    setView('login');
    const form = $('#gd-login-form');
    $('#gd-login-title').textContent = title;
    $('#gd-login-sub').textContent = text;
    form.querySelectorAll('label, button').forEach((x) => (x.hidden = true));
  }

  $('#gd-login-form').onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button');
    const email = form.email.value.trim(), password = form.password.value;
    if (!email || !password) { $('#gd-login-error').textContent = 'Escribe tu correo y contraseña.'; return; }
    btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      gd.me = await api.post('/api/auth/login', { email, password });
      $('#gd-login-error').textContent = '';
      await enterApp();
    } catch (err) {
      $('#gd-login-error').textContent = err.message;
      form.password.select();
    } finally {
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  };

  async function logout() {
    if (gd.hasUnsavedChanges?.() && !confirm('Tienes cambios sin guardar en un flujo. ¿Cerrar sesión de todos modos?')) return;
    try { await api.post('/api/auth/logout'); } catch { /* la cookie se limpia igual */ }
    gd.me = null; gd.campaigns = []; gd.channels = [];
    window.dispatchEvent(new CustomEvent('gd:logout'));
    showLogin();
  }

  async function enterApp() {
    const [{ channels }, { campaigns }] = await Promise.all([api.get('/api/channels'), api.get('/api/campaigns')]);
    gd.channels = channels;
    gd.campaigns = campaigns;
    const saved = prefs?.get() || {};
    if (Number.isInteger(saved.page) && saved.page >= 0 && saved.page < names.length) page = saved.page;
    if (typeof saved.channel === 'string') channel = saved.channel;
    gd.ready = true;
    renderChrome();
    setView('app');
    render();
    window.dispatchEvent(new CustomEvent('gd:ready'));
  }

  window.addEventListener('gd:unauthorized', () => {
    if (root.dataset.view === 'app') showLogin('Tu sesión terminó. Vuelve a iniciar sesión.');
  });

  async function boot() {
    try {
      gd.catalog = await fetch('/assets/catalog.json').then((r) => r.json());
      fetch('/api/health').then((r) => r.json()).then((h) => { $('#gd-version').textContent = 'Versión ' + h.version; }).catch(() => {});
      gd.me = await api.get('/api/auth/me');
      await enterApp();
    } catch (err) {
      if (err.status === 401) return showLogin();
      if (err.status === 503) return showUnavailable('Falta configurar la base de datos', 'El servidor todavía no tiene PostgreSQL configurado. Ejecuta de nuevo el instalador en el VPS.');
      showUnavailable('No se pudo cargar Golddigger', err.message || 'Inténtalo de nuevo en unos segundos.');
    }
  }
  boot();
})();
