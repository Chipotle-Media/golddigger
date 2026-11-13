/* Golddigger · pantalla de Conexiones: llaves de proveedores, cliente de Google y canales de YouTube. */
(() => {
  const gd = window.gd;
  const root = document.getElementById('golddigger');
  let open = null;      // proveedor con el formulario abierto
  let googleForm = false;

  const ui = () => gd.ui;
  const prov = (id) => gd.catalog.providers.find((p) => p.id === id);
  const state = (id) => gd.integrations?.providers.find((p) => p.id === id) || { status: 'disconnected' };
  const when = (iso) => (iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const statusBadge = (s) => ({
    connected: ui().badge('Conectado'), error: ui().badge('Revisar', 'red'), unavailable: ui().badge('Sin API pública', 'wait')
  }[s] || ui().badge('Sin conectar', ''));

  /** ¿La herramienta del flujo tiene su proveedor conectado? Las herramientas internas siempre están listas. */
  gd.toolReady = (tool) => {
    if (gd.catalog.builtinTools.includes(tool)) return true;
    const p = gd.catalog.providers.find((x) => x.tools.includes(tool));
    if (!p) return true;
    return state(p.id).status === 'connected';
  };

  gd.loadIntegrations = async () => {
    try { gd.integrations = await gd.api.get('/api/integrations'); } catch (err) { if (err.status !== 401) gd.integrations = null; }
    return gd.integrations;
  };

  // ── Vista ──────────────────────────────────────────────────────────────────
  function keyCard(p) {
    const s = state(p.id), manage = gd.integrations.canManage, { esc, button } = ui();
    const meta = s.status === 'disconnected' ? `<p>${esc(p.purpose)}</p>`
      : `<p>${esc(p.purpose)}</p><div class="gd-details"><div><span>Llave</span><b>${esc(s.secretHint || '')}</b></div>${s.accountLabel ? `<div><span>Cuenta</span><b>${esc(s.accountLabel)}</b></div>` : ''}<div><span>Última prueba</span><b>${esc(when(s.lastCheckedAt))}</b></div>${s.updatedBy ? `<div><span>Configuró</span><b>${esc(s.updatedBy)}</b></div>` : ''}</div>${s.lastError ? `<p class="gd-error">${esc(s.lastError)}</p>` : ''}`;
    const form = open === p.id ? `<form class="gd-form gd-keyform" data-provider="${p.id}" novalidate>
        <label class="wide">Llave de API<input name="key" type="password" autocomplete="off" spellcheck="false" placeholder="${esc(p.placeholder || '')}" required></label>
        <p class="wide"><a href="${esc(p.keyUrl)}" target="_blank" rel="noopener noreferrer">Obtener una llave en ${esc(p.name)} ↗</a> · Se guarda cifrada en el servidor y no se vuelve a mostrar.</p>
        <p class="gd-error" role="alert"></p>
        <div class="wide gd-flex"><button class="gd-action" type="submit">Probar y guardar</button><button type="button" class="gd-button" data-act="key-force" hidden>Guardar de todos modos</button>${button('Cancelar', 'key-cancel')}</div>
      </form>` : '';
    const actions = manage ? (s.status === 'disconnected'
      ? (open === p.id ? '' : `<button type="button" class="gd-action" data-act="key-open:${p.id}">Conectar</button>`)
      : `${button('Probar', 'key-test:' + p.id)}${open === p.id ? '' : button('Cambiar llave', 'key-open:' + p.id)}${button('Quitar', 'key-remove:' + p.id)}`)
      : (s.status === 'connected' ? button('Probar', 'key-test:' + p.id) : '');
    return `<article class="gd-card" id="conn-${p.id}"><div class="gd-cardtop"><h3>${esc(p.name)}</h3>${statusBadge(s.status)}</div>${meta}${form}<div class="gd-flex" style="margin-top:14px">${actions}</div></article>`;
  }

  function googleSection() {
    const g = gd.integrations.google, manage = gd.integrations.canManage, { esc, button } = ui();
    if (g.configured && !googleForm) {
      return `<div class="gd-cardtop"><h3>1 · Cliente de Google Cloud</h3>${ui().badge('Listo')}</div><div class="gd-details"><div><span>ID de cliente</span><b class="gd-mono">${esc(g.clientId)}</b></div><div><span>Secreto</span><b>${esc(g.secretHint || '')}</b></div></div>${manage ? `<div class="gd-flex" style="margin-top:12px">${button('Cambiar cliente', 'google-edit')}</div>` : ''}`;
    }
    const guide = `<ol class="gd-steps">
      <li>Entra a <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener noreferrer">Google Cloud ↗</a> y crea un proyecto (por ejemplo «Golddigger»).</li>
      <li>Habilita la <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noopener noreferrer">YouTube Data API v3 ↗</a> y la <a href="https://console.cloud.google.com/apis/library/youtubeanalytics.googleapis.com" target="_blank" rel="noopener noreferrer">YouTube Analytics API ↗</a>.</li>
      <li>En <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noopener noreferrer">Google Auth Platform ↗</a> configura la pantalla de consentimiento: tipo <b>Externo</b>, nombre «Golddigger» y tu correo. En <b>Desarrollo de la marca</b> usa:<div class="gd-copyrow"><span>Página principal</span><code>${esc(g.origin)}</code>${button('Copiar', 'copy:' + g.origin)}</div><div class="gd-copyrow"><span>Política de Privacidad</span><code>${esc(g.origin)}/privacidad</code>${button('Copiar', 'copy:' + g.origin + '/privacidad')}</div><div class="gd-copyrow"><span>Condiciones del Servicio</span><code>${esc(g.origin)}/terminos</code>${button('Copiar', 'copy:' + g.origin + '/terminos')}</div></li>
      <li>En <b>Público</b>, pulsa <b>Publicar app</b> (pasa a «En producción»). Si la dejas en «Prueba», Google corta el acceso cada 7 días.</li>
      <li>En <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noopener noreferrer">Clientes ↗</a> crea un cliente de tipo <b>Aplicación web</b> con estos datos:
        <div class="gd-copyrow"><span>Origen autorizado</span><code>${esc(g.origin)}</code>${button('Copiar', 'copy:' + g.origin)}</div>
        <div class="gd-copyrow"><span>URI de redireccionamiento</span><code>${esc(g.redirectUri)}</code>${button('Copiar', 'copy:' + g.redirectUri)}</div></li>
      <li>Copia el <b>ID de cliente</b> y el <b>Secreto del cliente</b> y pégalos aquí.</li></ol>`;
    const form = manage ? `<form id="gd-googleform" class="gd-form" novalidate>
        <label class="wide">ID de cliente<input name="clientId" value="${esc(g.clientId || '')}" placeholder="123456-abc.apps.googleusercontent.com" spellcheck="false" required></label>
        <label class="wide">Secreto del cliente<input name="clientSecret" type="password" autocomplete="off" placeholder="${g.configured ? 'Déjalo vacío para conservar el actual' : 'GOCSPX-…'}" spellcheck="false"></label>
        <p class="gd-error" role="alert"></p>
        <div class="wide gd-flex"><button class="gd-action" type="submit">Validar y guardar</button>${g.configured ? button('Cancelar', 'google-cancel') : ''}</div>
      </form>` : '<p class="gd-note">Un propietario debe configurar el cliente de Google.</p>';
    return `<div class="gd-cardtop"><h3>1 · Cliente de Google Cloud</h3>${ui().badge(g.configured ? 'Editando' : 'Pendiente', 'wait')}</div><p>YouTube se conecta con tu propio proyecto de Google Cloud. Se hace una sola vez y sirve para todos tus canales.</p>${guide}${form}`;
  }

  function channelRow(ch) {
    const { esc, button } = ui(), manage = gd.integrations.canManage;
    const thumb = ch.thumbnailUrl ? `<img class="gd-thumb" src="${esc(ch.thumbnailUrl)}" alt="" referrerpolicy="no-referrer">` : `<div class="gd-mini">${esc(ch.mark)}</div>`;
    const subs = ch.metrics?.subscribers;
    const info = ch.connected
      ? `${esc(ch.handle || ch.externalId)} · ${subs === null || subs === undefined ? 'suscriptores ocultos' : Number(subs).toLocaleString('es-MX') + ' suscriptores'} · ${Number(ch.metrics?.videos || 0).toLocaleString('es-MX')} videos${ch.lastSyncedAt ? ' · actualizado ' + esc(when(ch.lastSyncedAt)) : ''}`
      : (ch.isDemo ? 'Canal de ejemplo' : 'Sin conectar a YouTube');
    const actions = ch.connected
      ? `${button('Actualizar', 'yt-sync:' + ch.id)}${ch.lastError ? button('Reconectar', 'yt-connect:' + ch.id) : ''}${manage ? button('Desconectar', 'yt-disconnect:' + ch.id) : ''}`
      : (gd.integrations.google.configured ? button('Conectar con YouTube', 'yt-connect:' + ch.id) : '');
    return `<tr><td><div class="gd-titlecell">${thumb}<div>${esc(ch.name)}<small>${info}</small>${ch.lastError ? `<small class="gd-error">${esc(ch.lastError)}</small>` : ''}</div></div></td><td>${ch.connected ? (ch.lastError ? ui().badge('Revisar', 'red') : ui().badge('Conectado')) : ui().badge(ch.isDemo ? 'Ejemplo' : 'Sin conectar', '')}</td><td class="num"><div class="gd-flex" style="justify-content:flex-end">${actions}</div></td></tr>`;
  }

  gd.pages = gd.pages || {};
  gd.pages.connections = function connectionsView() {
    const { heading, empty, button, stat, esc } = ui();
    const head = heading('Conexiones', 'Conecta las herramientas y cuentas con las que Golddigger produce y publica.');
    if (!gd.integrations) { gd.loadIntegrations().then(() => gd.render()); return head + empty('Cargando conexiones…'); }
    const I = gd.integrations;
    const keyProviders = gd.catalog.providers.filter((p) => p.kind === 'apikey');
    const connectedKeys = keyProviders.filter((p) => state(p.id).status === 'connected').length;
    const ytChannels = I.channels.filter((c) => c.connected);
    const g = I.google;
    const ytBody = `<section class="gd-panel" id="conn-youtube"><div class="gd-panelhead"><div><h2>YouTube</h2><p>Carga, programación y métricas de cada canal.</p></div>${statusBadge(state('youtube').status)}</div>
      <div class="gd-card gd-section">${googleSection()}</div>
      <div class="gd-card gd-section"><div class="gd-cardtop"><h3>2 · Canales</h3>${g.configured ? `<button type="button" class="gd-action" data-act="yt-connect:new">+ Conectar canal de YouTube</button>` : ''}</div>
        ${g.configured ? '<p>Al conectar, Google te pide elegir la cuenta y el canal (incluidas cuentas de marca). Cada canal se autoriza por separado. Al conectar aceptas las <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener">Condiciones del Servicio de YouTube</a> y nuestra <a href="/privacidad" target="_blank">Política de Privacidad</a>.</p>' : '<p>Configura primero el cliente de Google Cloud.</p>'}
        ${I.channels.length ? `<div class="gd-tablewrap"><table><thead><tr><th>Canal</th><th>Estado</th><th class="num">Acciones</th></tr></thead><tbody>${I.channels.map(channelRow).join('')}</tbody></table></div>` : ''}
      </div>
      <div class="gd-callout"><strong>Antes de publicar en automático</strong><p>Google deja en privado los videos que sube un proyecto de Google Cloud que no ha pasado la <a href="https://support.google.com/youtube/contact/yt_api_form" target="_blank" rel="noopener noreferrer">auditoría de la API de YouTube ↗</a>. Golddigger sube siempre en privado primero; para publicar sin pasos manuales, solicita esa auditoría con tu proyecto.</p></div>
    </section>`;
    const others = gd.catalog.providers.filter((p) => p.kind === 'unavailable').map((p) => `<article class="gd-card"><div class="gd-cardtop"><h3>${esc(p.name)}</h3>${statusBadge('unavailable')}</div><p>${esc(p.purpose)}</p><p class="gd-note">${esc(p.note)}</p></article>`).join('');
    return head +
      `<div class="gd-stats">${stat('Proveedores de IA', `${connectedKeys} / ${keyProviders.length}`, 'Conectados y probados', connectedKeys > 0)}${stat('Canales de YouTube', ytChannels.length, ytChannels.length ? 'Autorizados' : 'Ninguno conectado', ytChannels.length > 0)}${stat('Cliente de Google', g.configured ? 'Listo' : 'Pendiente', 'Necesario para YouTube', g.configured)}${stat('Credenciales', 'Cifradas', 'AES-256 en el servidor')}</div>` +
      ytBody +
      `<section class="gd-panel"><div class="gd-panelhead"><div><h2>Inteligencia artificial y recursos</h2><p>Cada llave se prueba contra el proveedor antes de guardarse.</p></div></div><div class="gd-grid two">${keyProviders.map(keyCard).join('')}${others}</div></section>` +
      (I.canManage ? '' : '<div class="gd-note">Solo un propietario puede capturar llaves o desconectar canales. Puedes conectar canales de YouTube y probar las conexiones.</div>');
  };

  // ── Acciones ───────────────────────────────────────────────────────────────
  const rerender = (data) => { if (data) gd.integrations = { ...gd.integrations, ...data }; gd.render(); };

  async function syncChannels() {
    try { gd.channels = (await gd.api.get('/api/channels')).channels; } catch { /* se mantiene la lista actual */ }
  }

  root.addEventListener('submit', async (e) => {
    const form = e.target;
    if (form.classList?.contains('gd-keyform')) {
      e.preventDefault();
      const provider = form.dataset.provider, key = form.key.value.trim(), force = form.dataset.force === '1';
      if (!key) return ui().showFormError(form, { message: 'Pega la llave.', field: 'key' });
      await ui().submitting(form, async () => {
        try {
          const data = await gd.api.put(`/api/integrations/${provider}`, { key, force });
          open = null; rerender(data);
          gd.notify(`${prov(provider).name}: ${state(provider).status === 'connected' ? 'conectado y probado.' : 'guardado, pero la prueba falló.'}`);
        } catch (err) {
          if (err.data?.canForce) form.querySelector('[data-act="key-force"]').hidden = false;
          throw err;
        }
      });
    } else if (form.id === 'gd-googleform') {
      e.preventDefault();
      const f = new FormData(form);
      await ui().submitting(form, async () => {
        const data = await gd.api.put('/api/integrations/google_oauth/client', { clientId: f.get('clientId'), clientSecret: f.get('clientSecret') });
        googleForm = false; rerender(data);
        gd.notify('Cliente de Google listo. Ya puedes conectar tus canales de YouTube.');
      });
    }
  });

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !document.getElementById('conn-youtube')?.closest('#gd-content')) return;
    const a = b.dataset.act;
    const busy = async (fn) => { b.disabled = true; try { await fn(); } catch (err) { if (err.status !== 401) gd.notify(err.message); } finally { b.disabled = false; } };
    if (a.startsWith('key-open:')) { open = a.split(':')[1]; gd.render(); document.querySelector(`#conn-${open} input[name=key]`)?.focus(); }
    else if (a === 'key-cancel') { open = null; gd.render(); }
    else if (a === 'key-force') { const form = b.closest('form'); form.dataset.force = '1'; form.requestSubmit(); }
    else if (a.startsWith('key-test:')) busy(async () => {
      const id = a.split(':')[1];
      rerender(await gd.api.post(`/api/integrations/${id}/test`));
      gd.notify(state(id).status === 'connected' ? `${prov(id).name} responde correctamente.` : `${prov(id).name}: ${state(id).lastError}`);
    });
    else if (a.startsWith('key-remove:')) {
      const id = a.split(':')[1];
      if (!confirm(`¿Quitar la llave de ${prov(id).name}? Los procesos que la usan quedarán sin conexión.`)) return;
      busy(async () => { rerender(await gd.api.del(`/api/integrations/${id}`)); gd.notify(`Se quitó la llave de ${prov(id).name}.`); });
    }
    else if (a === 'google-edit') { googleForm = true; gd.render(); }
    else if (a === 'google-cancel') { googleForm = false; gd.render(); }
    else if (a.startsWith('copy:')) {
      const text = a.slice(5);
      try { await navigator.clipboard.writeText(text); gd.notify('Copiado: ' + text); } catch { gd.notify('Copia manualmente: ' + text); }
    }
    else if (a.startsWith('yt-connect:')) busy(async () => {
      const target = a.split(':')[1];
      const { url } = await gd.api.post('/api/youtube/connect', target === 'new' ? {} : { channelId: Number(target) });
      gd.notify('Abriendo Google para autorizar el canal…');
      window.location.assign(url);
    });
    else if (a.startsWith('yt-sync:')) busy(async () => {
      const { channel } = await gd.api.post(`/api/channels/${a.split(':')[1]}/sync`);
      await Promise.all([gd.loadIntegrations(), syncChannels()]); gd.render();
      gd.notify(channel.lastError ? channel.lastError : `«${channel.name}» actualizado desde YouTube.`);
    });
    else if (a.startsWith('yt-disconnect:')) {
      const ch = gd.integrations.channels.find((c) => c.id === Number(a.split(':')[1]));
      if (!confirm(`¿Desconectar «${ch?.name}» de YouTube? Se revoca el permiso en Google; el canal y sus campañas se conservan.`)) return;
      busy(async () => { await gd.api.post(`/api/channels/${ch.id}/disconnect`); await Promise.all([gd.loadIntegrations(), syncChannels()]); gd.render(); gd.notify(`«${ch.name}» se desconectó de YouTube.`); });
    }
  });

  /** Regreso desde Google: muestra el resultado y limpia la dirección. */
  gd.handleOAuthReturn = async () => {
    const q = new URLSearchParams(location.search);
    const yt = q.get('yt');
    if (!yt) return false;
    history.replaceState(null, '', '/');
    await Promise.all([gd.loadIntegrations(), syncChannels()]);
    gd.notify(yt === 'ok' ? `Canal «${q.get('canal')}» conectado con YouTube.` : yt === 'cancelado' ? 'Se canceló la autorización en Google.' : 'No se pudo conectar: ' + (q.get('msg') || 'error desconocido.'));
    return true;
  };
})();
