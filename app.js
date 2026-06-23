/* ───── DATOS ───── */
const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
/* datos de donación — reemplazar por los reales */
const DONACION = { alias: 'soji.pet', titular: 'Facundo Jesús Carmona' };
let DB = load();
let histFilter = 'todo';
let formPhoto = null;
/* troquel del formulario de vacuna: none | keep (id existente) | new (blob nuevo) | removed */
let formTroquel = { state: 'none' };
let petModalMode = 'create';
let editing = null; /* { type, id } cuando se edita un registro existente */
const REC_KEYS = { vacuna: 'vaccines', desp: 'dewormings', visita: 'visits', peso: 'weights' };

function load() {
  try {
    const db = JSON.parse(localStorage.getItem('soji')) || { pets: [], active: null };
    migrate(db);
    return db;
  }
  catch (e) {
    /* dato corrupto: preservarlo para un eventual rescate manual antes de pisar */
    try {
      const raw = localStorage.getItem('soji');
      if (raw) localStorage.setItem('soji-corrupt', raw);
    } catch (e2) {}
    return { pets: [], active: null };
  }
}
function migrate(db) {
  (db.pets || []).forEach(p => {
    /* los saves asumen que los 4 arrays existen (respaldos viejos o editados pueden no traerlos) */
    ['vaccines', 'dewormings', 'visits', 'weights'].forEach(k => {
      if (!Array.isArray(p[k])) p[k] = [];
      p[k].forEach(r => { if (!r.id) r.id = uid(); });
    });
    p.dewormings.forEach(d => { if (!d.type) d.type = 'Interna'; });
    /* la foto se inyecta en un atributo src: solo data-URLs de imagen */
    if (p.photo && !/^data:image\//.test(p.photo)) p.photo = null;
  });
}
function save() {
  try { localStorage.setItem('soji', JSON.stringify(DB)); }
  catch (e) {
    /* sin revertir, la UI mostraría como guardado algo que se pierde al recargar */
    DB = load();
    renderAll();
    showToast('Sin espacio: el último cambio no se guardó');
  }
}
function pet() { return DB.pets.find(p => p.id === DB.active) || DB.pets[0]; }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function isoLocal(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function today() { return isoLocal(new Date()); }
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.getDate() + ' ' + MESES[d.getMonth()] + ' ' + d.getFullYear();
}
function fmtShort(iso) {
  const d = new Date(iso + 'T00:00:00');
  return MESES[d.getMonth()] + " '" + String(d.getFullYear()).slice(2);
}
function daysUntil(iso) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((new Date(iso + 'T00:00:00') - now) / 86400000);
}
function addMonths(iso, m) {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDate();
  d.setMonth(d.getMonth() + Number(m));
  if (d.getDate() !== day) d.setDate(0); /* clamp a fin de mes (31 ene + 1 mes = 28 feb) */
  return isoLocal(d);
}
function ageOf(birth) {
  if (!birth) return '';
  const b = new Date(birth + 'T00:00:00'), n = new Date();
  let months = (n.getFullYear() - b.getFullYear()) * 12 + n.getMonth() - b.getMonth();
  if (n.getDate() < b.getDate()) months--;
  if (months < 12) return months <= 1 ? '1 mes' : months + ' meses';
  const y = Math.floor(months / 12);
  return y === 1 ? '1 año' : y + ' años';
}
function parseKg(s) {
  /* acepta coma o punto decimal (teclado iOS en español usa coma) */
  return parseFloat(String(s).trim().replace(',', '.'));
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
/* ───── IMÁGENES (IndexedDB) ─────
   Las fotos de troqueles viven acá, no en localStorage: pesan más (deben ser
   legibles) y en iPhone localStorage es chico y volátil. IndexedDB guarda blobs
   nativos, sin inflar a base64, con mucha más capacidad. */
const IMG_DB = 'soji-images', IMG_STORE = 'images';
const imagesOK = typeof indexedDB !== 'undefined';
let _imgdb = null;
function imgDB() {
  if (_imgdb) return Promise.resolve(_imgdb);
  return new Promise((res, rej) => {
    const req = indexedDB.open(IMG_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IMG_STORE);
    req.onsuccess = () => { _imgdb = req.result; res(_imgdb); };
    req.onerror = () => rej(req.error);
  });
}
function imgPut(id, blob) {
  return imgDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction(IMG_STORE, 'readwrite');
    tx.objectStore(IMG_STORE).put(blob, id);
    tx.oncomplete = () => res(id);
    tx.onerror = () => rej(tx.error);
  }));
}
function imgGet(id) {
  if (!id || !imagesOK) return Promise.resolve(null);
  return imgDB().then(db => new Promise((res) => {
    const r = db.transaction(IMG_STORE, 'readonly').objectStore(IMG_STORE).get(id);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => res(null);
  })).catch(() => null);
}
function imgDel(id) {
  if (!id || !imagesOK) return Promise.resolve();
  return imgDB().then(db => new Promise((res) => {
    const tx = db.transaction(IMG_STORE, 'readwrite');
    tx.objectStore(IMG_STORE).delete(id);
    tx.oncomplete = () => res(); tx.onerror = () => res();
  })).catch(() => {});
}
/* achica una imagen a maxEdge px en el lado largo y la entrega como Blob JPEG */
function resizeToBlob(file, maxEdge) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = function () {
      const img = new Image();
      img.onload = function () {
        const s = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => b ? res(b) : rej(new Error('toBlob')), 'image/jpeg', 0.82);
      };
      img.onerror = rej; img.src = reader.result;
    };
    reader.onerror = rej; reader.readAsDataURL(file);
  });
}
function blobToDataURL(blob) {
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
}
function dataURLToBlob(durl) {
  const parts = durl.split(','), mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
  const bin = atob(parts[1]), arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
/* ───── EVENTOS PRÓXIMOS ───── */
function upcoming(p) {
  const ev = [];
  /* vacunas: una alerta por nombre; solo el registro más reciente está "pendiente",
     los anteriores son historia (viven en el historial, no acá) */
  const vacGroups = {};
  (p.vaccines || []).forEach(v => {
    const key = (v.name || '').trim().toLowerCase();
    if (!vacGroups[key] || (v.date || '') > (vacGroups[key].date || '')) vacGroups[key] = v;
  });
  Object.keys(vacGroups).forEach(k => {
    const v = vacGroups[k];
    if (v.next) ev.push({ kind: 'vacuna', id: v.id, title: 'Vacuna ' + v.name, due: v.next });
  });
  /* desparasitaciones: una por cobertura; "Las dos" cubre interna y externa */
  const dews = (p.dewormings || []).filter(d => d.date && d.repeat);
  const latestOf = t => dews.filter(d => d.type === t).sort((a, b) => b.date.localeCompare(a.date))[0];
  const newer = (a, b) => !a ? b : !b ? a : (a.date >= b.date ? a : b);
  const both = latestOf('Las dos');
  const effInt = newer(latestOf('Interna'), both);
  const effExt = newer(latestOf('Externa'), both);
  const picked = [];
  [effInt, effExt].forEach(d => { if (d && picked.indexOf(d) === -1) picked.push(d); });
  picked.forEach(d => ev.push({ kind: 'desp', id: d.id, title: 'Desparasitación ' + (d.type || 'interna').toLowerCase(), due: addMonths(d.date, d.repeat) }));
  ev.forEach(e => e.days = daysUntil(e.due));
  return ev.filter(e => e.days <= 90).sort((a, b) => a.days - b.days);
}
/* ───── AVATAR HTML ───── */
function avatarHTML(p, pawSize) {
  if (p && p.photo) return '<img class="pet-photo" src="' + p.photo + '" alt="">';
  return '<svg viewBox="0 0 80 80" fill="#9DBBAF" style="width:' + (pawSize || 24) + 'px;height:' + (pawSize || 24) + 'px"><use href="#paw"/></svg>';
}
/* ───── RENDER: INICIO ───── */
function renderInicio() {
  const p = pet(); if (!p) return;
  document.getElementById('greet-name').textContent = p.name + '.';
  document.getElementById('inicio-avatar').innerHTML = avatarHTML(p, 26);
  /* selector de mascotas */
  const sw = document.getElementById('pet-switch');
  if (DB.pets.length > 1) {
    sw.style.display = 'flex';
    sw.innerHTML = DB.pets.map(x =>
      '<button class="pet-chip' + (x.id === p.id ? ' on' : '') + '" onclick="switchPet(\'' + x.id + '\')">' +
      '<span class="pet-chip-ava">' + avatarHTML(x, 16) + '</span>' + esc(x.name) + '</button>'
    ).join('') + '<button class="pet-chip add" onclick="openPetModal(\'create\')">+ Agregar</button>';
  } else {
    sw.style.display = 'none';
  }
  /* hero */
  const ws = (p.weights || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const lastW = ws.length ? ws[ws.length - 1].kg + ' kg' : '—';
  const visits = (p.visits || []).slice().sort((a, b) => b.date.localeCompare(a.date));
  const lastV = visits.length ? fmtShort(visits[0].date) : '—';
  document.getElementById('hero-box').innerHTML =
    '<div class="hero-card">' +
    '<svg class="hero-bg-paw" viewBox="0 0 80 80" fill="white"><use href="#paw"/></svg>' +
    '<svg class="hero-bg-paw-2" viewBox="0 0 80 80" fill="white"><use href="#paw"/></svg>' +
    '<div class="hero-top"><div>' +
    '<div class="hero-eyebrow">Tu mascota</div>' +
    '<div class="hero-pet-name">' + esc(p.name) + '</div>' +
    '<div class="hero-breed">' + esc([p.breed, ageOf(p.birth)].filter(Boolean).join(' · ') || p.species) + '</div>' +
    '</div><div class="hero-photo">' + avatarHTML(p, 34) + '</div></div>' +
    '<div class="hero-divider"></div>' +
    '<div class="hero-stats">' +
    '<div class="hero-stat"><div class="hero-stat-val">' + lastW + '</div><div class="hero-stat-label">Peso</div></div>' +
    '<div class="hero-stat"><div class="hero-stat-val">' + (p.vaccines || []).length + '</div><div class="hero-stat-label">Vacunas</div></div>' +
    '<div class="hero-stat"><div class="hero-stat-val">' + lastV + '</div><div class="hero-stat-label">Última visita</div></div>' +
    '</div></div>';
  /* alertas */
  const ev = upcoming(p);
  const box = document.getElementById('alerts-box');
  if (!ev.length) {
    box.innerHTML = '<div class="calm-card">' +
      '<svg class="ico green" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7"/><path d="M7 10l2 2 4-4"/></svg>' +
      ((p.vaccines || []).length || (p.dewormings || []).length
        ? 'Todo al día. Nada vence en los próximos 90 días.'
        : 'Registrá la primera vacuna o desparasitación y acá vas a ver cuándo toca la próxima.') +
      '</div>';
  } else {
    box.innerHTML = ev.map(e => {
      const red = e.days <= 7;
      const daysTxt = e.days < 0 ? '<div class="alert-pill-days" style="color:#B33A2B">¡!<small>vencida</small></div>'
        : '<div class="alert-pill-days"' + (red ? '' : ' style="color:var(--green)"') + '>' + e.days + '<small>días</small></div>';
      return '<div class="alert-pill" onclick="openAlertSheet(\'' + e.kind + '\',\'' + e.id + '\')">' +
        '<div class="alert-pill-dot ' + (red || e.days < 0 ? 'red' : 'green') + '">' +
        (e.kind === 'vacuna'
          ? '<svg class="ico accent" viewBox="0 0 20 20"><path d="M9 5l6 6-2 2-6-6 2-2z"/><path d="M5 15l1-1M14 6l1-1"/></svg>'
          : '<svg class="ico green" viewBox="0 0 20 20"><path d="M10 4c-3 0-5 2-5 5s2 5 5 5"/><path d="M10 14c3 0 5-2 5-5s-2-5-5-5"/></svg>') +
        '</div><div class="alert-pill-text">' +
        '<div class="alert-pill-title">' + esc(e.title) + '</div>' +
        '<div class="alert-pill-sub">Vence el ' + fmtDate(e.due) + '</div>' +
        '</div>' + daysTxt + '</div>';
    }).join('');
  }
}
/* ───── RENDER: HISTORIAL ───── */
function setFilter(el) {
  document.querySelectorAll('#hist-filters .chip').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  histFilter = el.dataset.f;
  renderHistorial();
}
function buildEvents(p) {
  const ev = [];
  /* solo la aplicación más reciente de cada vacuna lleva badge de estado:
     las anteriores ya fueron reemplazadas, son historia */
  const latest = {};
  (p.vaccines || []).forEach(v => {
    const key = (v.name || '').trim().toLowerCase();
    if (!latest[key] || (v.date || '') > (latest[key].date || '')) latest[key] = v;
  });
  (p.vaccines || []).forEach(v => {
    const isLatest = latest[(v.name || '').trim().toLowerCase()] === v;
    ev.push({
      id: v.id, type: 'vacuna', date: v.date, title: v.name,
      meta: 'Vacuna · ' + fmtDate(v.date) + (v.vet ? ' · ' + v.vet : ''),
      /* el refuerzo solo es "pendiente" en la aplicación vigente; en las viejas confunde */
      note: isLatest && v.next ? 'Refuerzo: ' + fmtDate(v.next) : '', next: v.next,
      isLatest: isLatest, troquel: v.troquel || null
    });
  });
  /* desparasitaciones vigentes por cobertura (mismo criterio que las alertas) */
  const dews = (p.dewormings || []).filter(d => d.date && d.repeat);
  const latestOf = t => dews.filter(d => d.type === t).sort((a, b) => b.date.localeCompare(a.date))[0];
  const newer = (a, b) => !a ? b : !b ? a : (a.date >= b.date ? a : b);
  const both = latestOf('Las dos');
  const vigentes = [newer(latestOf('Interna'), both), newer(latestOf('Externa'), both)];
  (p.dewormings || []).forEach(d => ev.push({
    id: d.id, type: 'desp', date: d.date, title: d.product || 'Desparasitación',
    meta: d.type + ' · ' + fmtDate(d.date),
    note: d.repeat && vigentes.indexOf(d) !== -1 ? 'Repetir: ' + fmtDate(addMonths(d.date, d.repeat)) : ''
  }));
  (p.visits || []).forEach(v => ev.push({
    id: v.id, type: 'visita', date: v.date, title: v.reason || 'Visita',
    meta: 'Visita' + (v.vet ? ' · ' + v.vet : '') + ' · ' + fmtDate(v.date),
    note: v.notes || ''
  }));
  (p.weights || []).forEach(w => ev.push({
    id: w.id, type: 'peso', date: w.date, title: w.kg + ' kg',
    meta: 'Peso · ' + fmtDate(w.date), note: ''
  }));
  return ev.sort((a, b) => b.date.localeCompare(a.date));
}
const HIST_ICONS = {
  vacuna: '<div class="hist-ico" style="background:var(--accent-soft)"><svg class="ico accent" viewBox="0 0 20 20"><path d="M9 5l6 6-2 2-6-6 2-2z"/><path d="M5 15l1-1M14 6l1-1"/></svg></div>',
  desp: '<div class="hist-ico" style="background:var(--green-soft)"><svg class="ico green" viewBox="0 0 20 20"><path d="M10 4c-3 0-5 2-5 5s2 5 5 5"/><path d="M10 14c3 0 5-2 5-5s-2-5-5-5"/></svg></div>',
  visita: '<div class="hist-ico" style="background:var(--cream)"><svg class="ico ink" viewBox="0 0 20 20"><path d="M4 17V7a2 2 0 012-2h8a2 2 0 012 2v10"/><path d="M8 17v-4h4v4"/></svg></div>',
  peso: '<div class="hist-ico" style="background:var(--cream)"><svg class="ico mid" viewBox="0 0 20 20"><path d="M3 7h14l-2 10H5L3 7z"/><path d="M7 7a3 3 0 016 0"/></svg></div>'
};
function vacBadge(next) {
  if (!next) return '';
  const d = daysUntil(next);
  if (d < 0) return '<span class="vac-badge over">Vencida</span>';
  if (d <= 30) return '<span class="vac-badge warn">' + d + ' días</span>';
  return '<span class="vac-badge ok">OK</span>';
}
function renderHistorial() {
  const p = pet(); if (!p) return;
  const all = buildEvents(p);
  const ev = histFilter === 'todo' ? all : all.filter(e => e.type === histFilter);
  document.getElementById('hist-sub').textContent = all.length
    ? 'Todo lo de ' + p.name + ' en un lugar'
    : 'Acá va a vivir la salud de ' + p.name;
  const list = document.getElementById('hist-list');
  if (!ev.length) {
    const msgs = {
      todo: ['Sin registros todavía', 'Arrancá con lo que tengas a mano: la última vacuna, el peso de hoy, lo que sea.'],
      vacuna: ['Sin vacunas registradas', 'Registrá la última que le dieron, aunque sea vieja: sirve para calcular el refuerzo.'],
      desp: ['Sin desparasitaciones', 'Registrá la última pipeta o pastilla y te avisamos cuándo repetir.'],
      visita: ['Sin visitas registradas', 'Después de cada consulta, anotá qué pasó. Tu yo del futuro te lo agradece.'],
      peso: ['Sin registros de peso', 'Pesalo cuando puedas: la curva de peso dice mucho de su salud.']
    };
    const m = msgs[histFilter] || msgs.todo;
    list.innerHTML = '<div class="empty">' +
      '<svg viewBox="0 0 80 80" fill="#547468"><use href="#paw"/></svg>' +
      '<div class="empty-title">' + m[0] + '</div>' +
      '<div class="empty-sub">' + m[1] + '</div>' +
      '<button class="btn-p" onclick="openRegSelector()">Registrar algo</button></div>';
    return;
  }
  /* agrupar por año cuando el historial abarca más de uno */
  const years = new Set(ev.map(e => e.date.slice(0, 4)));
  let lastYear = null;
  list.innerHTML = ev.map(e => {
    let header = '';
    const y = e.date.slice(0, 4);
    if (years.size > 1 && y !== lastYear) {
      header = '<div class="section-label" style="margin:' + (lastYear ? '18px' : '0') + ' 0 12px">' + y + '</div>';
      lastYear = y;
    }
    return header + '<div class="hist-entry">' + HIST_ICONS[e.type] +
    '<div class="hist-body"><div class="hist-title"><span>' + esc(e.title) + '</span>' +
    (e.type === 'vacuna' && e.isLatest ? vacBadge(e.next) : '') + '</div>' +
    '<div class="hist-meta">' + esc(e.meta) + '</div>' +
    (e.note ? '<div class="hist-note">' + esc(e.note) + '</div>' : '') +
    (e.troquel ? '<div class="troquel-thumb" data-troquel="' + e.troquel + '" onclick="openTroquel(\'' + e.troquel + '\')" role="button" tabindex="0" aria-label="Ver foto del troquel"></div>' : '') +
    '<div class="hist-actions">' +
    '<button class="hist-act" onclick="openEdit(\'' + e.type + '\',\'' + e.id + '\')">' +
    '<svg class="ico mid" viewBox="0 0 20 20"><path d="M13 4l3 3-8 8-4 1 1-4 8-8z"/></svg>Editar</button>' +
    '<button class="hist-act del" onclick="deleteRecord(\'' + e.type + '\',\'' + e.id + '\')">' +
    '<svg viewBox="0 0 20 20" fill="none" stroke="#B33A2B" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10"/></svg>Eliminar</button>' +
    '</div></div></div>';
  }).join('');
  hydrateTroquels();
}
/* carga las miniaturas de troquel (async) después de pintar el historial */
let _troquelURLs = [];
function hydrateTroquels() {
  _troquelURLs.forEach(u => URL.revokeObjectURL(u));
  _troquelURLs = [];
  document.querySelectorAll('#hist-list [data-troquel]').forEach(el => {
    imgGet(el.getAttribute('data-troquel')).then(b => {
      if (!b) return;
      const url = URL.createObjectURL(b);
      _troquelURLs.push(url);
      el.style.backgroundImage = 'url(' + url + ')';
      el.classList.add('loaded');
    });
  });
}
function openTroquel(id) {
  imgGet(id).then(b => {
    if (!b) { showToast('No encontré la foto'); return; }
    document.getElementById('viewer-img').src = URL.createObjectURL(b);
    openModal('m-viewer');
  });
}
/* ───── RENDER: PERFIL ───── */
function weightChartSVG(ws) {
  if (ws.length < 2) return '';
  const W = 300, H = 80, pad = 8;
  const kgs = ws.map(w => Number(w.kg));
  const min = Math.min.apply(null, kgs), max = Math.max.apply(null, kgs);
  const span = (max - min) || 1;
  const pts = ws.map((w, i) => {
    const x = pad + i * (W - 2 * pad) / (ws.length - 1);
    const y = H - pad - (Number(w.kg) - min) * (H - 2 * pad) / span;
    return [x.toFixed(1), y.toFixed(1)];
  });
  return '<div class="weight-chart-wrap"><svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto">' +
    '<polyline points="' + pts.map(p => p.join(',')).join(' ') + '" fill="none" stroke="#0E6B5C" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    pts.map((p, i) => '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3.5" fill="' + (i === pts.length - 1 ? '#0E6B5C' : '#E2EEE8') + '" stroke="#0E6B5C" stroke-width="1.5"/>').join('') +
    '</svg><div style="display:flex;justify-content:space-between;font-size:11px;color:var(--ink-light);margin-top:4px">' +
    '<span>' + fmtShort(ws[0].date) + '</span><span>' + min + '–' + max + ' kg</span><span>' + fmtShort(ws[ws.length - 1].date) + '</span></div></div>';
}
function renderPerfil() {
  const p = pet(); if (!p) return;
  const ws = (p.weights || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  document.getElementById('perfil-box').innerHTML =
    '<div class="perfil-hero"><div>' +
    '<div class="perfil-eyebrow">Perfil de mascota</div>' +
    '<div class="perfil-name">' + esc(p.name) + '</div>' +
    '<div class="perfil-breed">' + esc([p.breed || p.species, p.sex].filter(Boolean).join(' · ')) + '</div>' +
    '</div><div class="perfil-avatar-blob" onclick="openPetModal(\'edit\')">' + avatarHTML(p, 48) + '</div></div>' +
    '<div class="info-card"><div class="info-card-header">Información</div>' +
    (p.birth ? '<div class="info-row"><span class="info-key">Nacimiento</span><span class="info-val">' + fmtDate(p.birth) + '</span></div>' +
      '<div class="info-row"><span class="info-key">Edad</span><span class="info-val">' + ageOf(p.birth) + '</span></div>' : '') +
    '<div class="info-row"><span class="info-key">Especie</span><span class="info-val">' + esc(p.species) + '</span></div>' +
    (ws.length ? '<div class="info-row"><span class="info-key">Peso actual</span><span class="info-val">' + ws[ws.length - 1].kg + ' kg</span></div>' : '') +
    '</div>' +
    (ws.length >= 2 ? '<div class="info-card"><div class="info-card-header">Evolución del peso</div>' + weightChartSVG(ws) + '</div>' : '') +
    '<div class="info-card"><div class="info-card-header">Resumen de salud</div>' +
    '<div class="info-row"><span class="info-key">Vacunas</span><span class="info-val">' + (p.vaccines || []).length + ' registradas</span></div>' +
    '<div class="info-row"><span class="info-key">Desparasitaciones</span><span class="info-val">' + (p.dewormings || []).length + ' registradas</span></div>' +
    '<div class="info-row"><span class="info-key">Visitas al vet.</span><span class="info-val">' + (p.visits || []).length + ' registradas</span></div>' +
    '</div>' +
    '<div class="info-card"><div class="info-card-header">Recordatorios</div>' +
    '<div class="info-row"><span class="info-key">Avisos de vencimiento</span>' +
    '<button class="hist-act" style="background:var(--cream)" onclick="toggleNotif()">' +
    ({ on: 'Activados ✓', off: 'Activar', denied: 'Bloqueados', unsupported: 'No disponible' }[notifState()]) +
    '</button></div>' +
    '<div class="info-row" style="border:none;padding-top:0"><span style="font-size:12px;color:var(--ink-light);line-height:1.5">Al abrir la app, te avisamos si algo vence en los próximos 7 días.</span></div>' +
    '</div>' +
    '<div class="info-card"><div class="info-card-header">Tus datos</div>' +
    '<div class="info-row"><span class="info-key">Exportar respaldo</span>' +
    '<button class="hist-act" style="background:var(--cream)" onclick="exportData()">Descargar .json</button></div>' +
    '<div class="info-row"><span class="info-key">Restaurar respaldo</span>' +
    '<button class="hist-act" style="background:var(--cream)" onclick="importData()">Elegir archivo</button></div>' +
    '<div class="info-row" style="border:none;padding-top:0"><span style="font-size:12px;color:var(--ink-light);line-height:1.5">Todo vive en este dispositivo. Guardá un respaldo de vez en cuando, o para pasar a otro teléfono.</span></div>' +
    '</div>' +
    '<div class="info-card" onclick="showScreen(\'donaciones\')" style="cursor:pointer">' +
    '<div class="info-row"><span class="info-key" style="display:flex;align-items:center;gap:10px">' +
    '<svg class="ico green" style="width:18px;height:18px" viewBox="0 0 20 20"><path d="M10 16s-7-4.5-7-9a4 4 0 018 0 4 4 0 018 0c0 4.5-7 9-7 9z"/></svg>' +
    'Apoyar a Soji</span><span class="info-val" style="color:var(--ink-light)">›</span></div>' +
    '</div>' +
    '<div style="padding:0 24px;">' +
    '<button class="btn-p" onclick="openPetModal(\'edit\')" style="background:var(--ink);box-shadow:none;">Editar perfil de ' + esc(p.name) + '</button>' +
    '<button class="btn-g" onclick="openPetModal(\'create\')">Agregar otra mascota</button>' +
    '</div>';
}
/* ───── FOTO ───── */
function pickPhoto() {
  const inp = document.getElementById('photo-input');
  inp.onchange = function () {
    const f = inp.files && inp.files[0];
    inp.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = function () {
      const img = new Image();
      img.onload = function () {
        const MAX = 320;
        const s = Math.min(1, MAX / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        formPhoto = c.toDataURL('image/jpeg', 0.82);
        const ph = document.getElementById('pm-photo');
        ph.classList.add('has');
        ph.innerHTML = '<img class="pet-photo" src="' + formPhoto + '" alt="">';
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  };
  inp.click();
}
/* ───── TROQUEL: SELECTOR EN EL FORM DE VACUNA ───── */
function pickTroquel() {
  if (!imagesOK) { showToast('Tu navegador no permite guardar fotos'); return; }
  const inp = document.getElementById('troquel-input');
  inp.onchange = function () {
    const f = inp.files && inp.files[0];
    inp.value = '';
    if (!f) return;
    resizeToBlob(f, 1600).then(blob => {
      formTroquel = { state: 'new', blob: blob };
      showTroquelPreview(URL.createObjectURL(blob));
    }).catch(() => showToast('No pude procesar la foto'));
  };
  inp.click();
}
function showTroquelPreview(url) {
  const el = document.getElementById('v-troquel-pick');
  el.classList.add('has');
  el.style.backgroundImage = 'url(' + url + ')';
}
function resetTroquelPick() {
  const el = document.getElementById('v-troquel-pick');
  el.classList.remove('has');
  el.style.backgroundImage = '';
}
function removeTroquel(e) {
  e.stopPropagation();
  formTroquel = { state: 'removed' };
  resetTroquelPick();
}
/* carga en el form el troquel de un registro existente (al editar) */
function loadTroquelInto(id) {
  if (id) {
    formTroquel = { state: 'keep', id: id };
    imgGet(id).then(b => { if (b && formTroquel.id === id) showTroquelPreview(URL.createObjectURL(b)); });
  } else {
    formTroquel = { state: 'none' };
    resetTroquelPick();
  }
}
/* resuelve el id final del troquel al guardar: persiste el nuevo, borra el viejo */
function commitTroquel(oldId) {
  if (formTroquel.state === 'new') {
    const id = uid();
    return imgPut(id, formTroquel.blob).then(() => { if (oldId) imgDel(oldId); return id; });
  }
  if (formTroquel.state === 'removed') {
    if (oldId) imgDel(oldId);
    return Promise.resolve(null);
  }
  return Promise.resolve(oldId || null); /* keep / none */
}
/* ───── MASCOTA: CREAR / EDITAR ───── */
function setChips(groupId, value) {
  document.querySelectorAll('#' + groupId + ' .chip').forEach(c =>
    c.classList.toggle('on', c.textContent.trim() === value));
}
function getChip(groupId) {
  const on = document.querySelector('#' + groupId + ' .chip.on');
  return on ? on.textContent.trim() : '';
}
function openPetModal(mode) {
  petModalMode = mode;
  formPhoto = null;
  const p = mode === 'edit' ? pet() : null;
  document.getElementById('pm-title').textContent = p ? 'Editar perfil de ' + p.name : 'Tu mascota';
  document.getElementById('pm-save').textContent = p ? 'Guardar cambios' : 'Crear su perfil';
  document.getElementById('pm-name').value = p ? p.name : '';
  document.getElementById('pm-breed').value = p ? (p.breed || '') : '';
  document.getElementById('pm-birth').value = p ? (p.birth || '') : '';
  document.getElementById('pm-weight').value = '';
  document.getElementById('pm-weight-wrap').style.display = p ? 'none' : 'block';
  document.getElementById('pm-delete').style.display = p ? 'block' : 'none';
  setChips('pm-species', p ? p.species : 'Perro');
  setChips('pm-sex', p ? p.sex : 'Macho');
  const ph = document.getElementById('pm-photo');
  if (p && p.photo) {
    formPhoto = p.photo;
    ph.classList.add('has');
    ph.innerHTML = '<img class="pet-photo" src="' + p.photo + '" alt="">';
  } else {
    ph.classList.remove('has');
    ph.innerHTML = '<svg class="ico light" viewBox="0 0 20 20"><path d="M3 7h3l1.5-2h5L14 7h3v9H3V7z"/><circle cx="10" cy="11" r="2.5"/></svg><span class="photo-pick-label">Agregar foto</span>';
  }
  openModal('m-mascota');
}
function savePetForm() {
  const name = document.getElementById('pm-name').value.trim();
  if (!name) { showToast('Falta el nombre'); return; }
  const data = {
    name: name,
    species: getChip('pm-species'),
    breed: document.getElementById('pm-breed').value.trim(),
    birth: document.getElementById('pm-birth').value,
    sex: getChip('pm-sex'),
    photo: formPhoto
  };
  if (petModalMode === 'edit') {
    Object.assign(pet(), data);
    showToast('Perfil de ' + name + ' actualizado');
  } else {
    const kg = parseKg(document.getElementById('pm-weight').value);
    const np = Object.assign({ id: uid(), vaccines: [], dewormings: [], visits: [], weights: [] }, data);
    if (kg > 0) np.weights.push({ date: today(), kg: kg });
    DB.pets.push(np);
    DB.active = np.id;
    showToast('¡Hola, ' + name + '!');
  }
  save();
  closeOverlay('m-mascota');
  if (document.body.classList.contains('onboarding')) {
    document.body.classList.remove('onboarding');
    showScreen('inicio');
    /* activación: que la primera sesión termine con la app funcionando */
    setTimeout(function () {
      openRegSelector('¿Te acordás de su última vacuna o antiparasitario? Cargalo y te avisamos cuándo toca de nuevo.');
    }, 900);
  } else { renderAll(); }
}
function deletePet() {
  const p = pet();
  askConfirm('Vas a eliminar a ' + p.name + ' y todo su historial. Esto no se puede deshacer.', 'Sí, eliminar a ' + p.name, function () {
    (p.vaccines || []).forEach(v => { if (v.troquel) imgDel(v.troquel); });
    DB.pets = DB.pets.filter(x => x.id !== p.id);
    DB.active = DB.pets.length ? DB.pets[0].id : null;
    save();
    closeOverlay('m-mascota');
    if (!DB.pets.length) {
      document.body.classList.add('onboarding');
      showScreen('onboarding');
    } else { renderAll(); showScreen('inicio'); }
  });
}
function switchPet(id) { DB.active = id; save(); renderAll(); }
/* ───── GUARDAR REGISTROS ───── */
function openReg(id) {
  editing = null;
  /* arranca limpio: un cancelar de edición no debe dejar valores colgados */
  const fields = { 'm-vacuna': ['v-name', 'v-next', 'v-vet'], 'm-desp': ['d-product'], 'm-visita': ['vi-reason', 'vi-vet', 'vi-notes'], 'm-peso': ['w-kg'] };
  (fields[id] || []).forEach(f => document.getElementById(f).value = '');
  const dates = { 'm-vacuna': 'v-date', 'm-desp': 'd-date', 'm-visita': 'vi-date', 'm-peso': 'w-date' };
  document.getElementById(dates[id]).value = today();
  if (id === 'm-vacuna') { formTroquel = { state: 'none' }; resetTroquelPick(); }
  openModal(id);
}
function findRecord(type, id) {
  return (pet()[REC_KEYS[type]] || []).find(r => r.id === id);
}
function openEdit(type, id) {
  const r = findRecord(type, id);
  if (!r) return;
  editing = { type: type, id: id };
  if (type === 'vacuna') {
    document.getElementById('v-name').value = r.name;
    document.getElementById('v-date').value = r.date;
    document.getElementById('v-next').value = r.next || '';
    document.getElementById('v-vet').value = r.vet || '';
    loadTroquelInto(r.troquel);
    openModal('m-vacuna');
  } else if (type === 'desp') {
    setChips('d-type', r.type);
    document.getElementById('d-product').value = r.product || '';
    document.getElementById('d-date').value = r.date;
    document.getElementById('d-repeat').value = String(r.repeat || 3);
    openModal('m-desp');
  } else if (type === 'visita') {
    document.getElementById('vi-reason').value = r.reason || '';
    document.getElementById('vi-date').value = r.date;
    document.getElementById('vi-vet').value = r.vet || '';
    document.getElementById('vi-notes').value = r.notes || '';
    openModal('m-visita');
  } else if (type === 'peso') {
    document.getElementById('w-kg').value = r.kg;
    document.getElementById('w-date').value = r.date;
    openModal('m-peso');
  }
}
function deleteRecord(type, id) {
  const labels = { vacuna: 'esta vacuna', desp: 'esta desparasitación', visita: 'esta visita', peso: 'este registro de peso' };
  askConfirm('Vas a eliminar ' + labels[type] + '. Esto no se puede deshacer.', 'Sí, eliminar', function () {
    const p = pet();
    if (type === 'vacuna') { const r = findRecord('vacuna', id); if (r && r.troquel) imgDel(r.troquel); }
    p[REC_KEYS[type]] = (p[REC_KEYS[type]] || []).filter(r => r.id !== id);
    save(); renderAll(); showToast('Registro eliminado');
  });
}
function upsert(type, data) {
  if (editing && editing.type === type) {
    const r = findRecord(type, editing.id);
    if (r) Object.assign(r, data);
    editing = null;
    return true; /* editado */
  }
  pet()[REC_KEYS[type]].push(Object.assign({ id: uid() }, data));
  return false;
}
function saveVacuna() {
  const name = document.getElementById('v-name').value.trim();
  const date = document.getElementById('v-date').value;
  if (!name || !date) { showToast('Falta el nombre o la fecha'); return; }
  const existing = editing && editing.type === 'vacuna' ? findRecord('vacuna', editing.id) : null;
  const oldId = existing ? existing.troquel : null;
  commitTroquel(oldId).then(troquelId => {
    const edited = upsert('vacuna', { name: name, date: date, next: document.getElementById('v-next').value || null, vet: document.getElementById('v-vet').value.trim(), troquel: troquelId });
    save();
    ['v-name', 'v-next', 'v-vet'].forEach(i => document.getElementById(i).value = '');
    formTroquel = { state: 'none' }; resetTroquelPick();
    closeOverlay('m-vacuna'); renderAll(); showToast(edited ? 'Vacuna actualizada' : 'Vacuna guardada');
  }).catch(() => showToast('No pude guardar la foto del troquel'));
}
function saveDesp() {
  const date = document.getElementById('d-date').value;
  if (!date) { showToast('Falta la fecha'); return; }
  const edited = upsert('desp', { type: getChip('d-type'), product: document.getElementById('d-product').value.trim(), date: date, repeat: Number(document.getElementById('d-repeat').value) });
  save();
  document.getElementById('d-product').value = '';
  closeOverlay('m-desp'); renderAll(); showToast(edited ? 'Desparasitación actualizada' : 'Desparasitación guardada');
}
function saveVisita() {
  const reason = document.getElementById('vi-reason').value.trim();
  const date = document.getElementById('vi-date').value;
  if (!reason || !date) { showToast('Falta el motivo o la fecha'); return; }
  const edited = upsert('visita', { reason: reason, date: date, vet: document.getElementById('vi-vet').value.trim(), notes: document.getElementById('vi-notes').value.trim() });
  save();
  ['vi-reason', 'vi-vet', 'vi-notes'].forEach(i => document.getElementById(i).value = '');
  closeOverlay('m-visita'); renderAll(); showToast(edited ? 'Visita actualizada' : 'Visita registrada');
}
function savePeso() {
  const kg = parseKg(document.getElementById('w-kg').value);
  const date = document.getElementById('w-date').value;
  if (!(kg > 0) || !date) { showToast('Falta el peso o la fecha'); return; }
  const edited = upsert('peso', { date: date, kg: kg });
  save();
  document.getElementById('w-kg').value = '';
  closeOverlay('m-peso'); renderAll(); showToast(edited ? 'Peso actualizado' : 'Peso registrado');
}
/* ───── RESPALDO: EXPORTAR / IMPORTAR ───── */
function exportData() {
  if (!DB.pets.length) { showToast('No hay nada para exportar todavía'); return; }
  /* incluir las fotos de troqueles (de IndexedDB) para que el respaldo sea completo */
  const ids = [];
  DB.pets.forEach(p => (p.vaccines || []).forEach(v => { if (v.troquel) ids.push(v.troquel); }));
  if (ids.length) showToast('Preparando respaldo…');
  const images = {};
  Promise.all(ids.map(id => imgGet(id).then(b => b ? blobToDataURL(b).then(d => { images[id] = d; }) : null)))
    .then(() => {
      const blob = new Blob([JSON.stringify({ app: 'soji', version: 2, exported: new Date().toISOString(), data: DB, images: images }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'soji-respaldo-' + today() + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      showToast('Respaldo descargado');
    });
}
function importData() {
  const inp = document.getElementById('import-input');
  inp.onchange = function () {
    const f = inp.files && inp.files[0];
    inp.value = '';
    if (!f) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const parsed = JSON.parse(reader.result);
        const db = parsed && parsed.app === 'soji' ? parsed.data : parsed;
        if (!db || !Array.isArray(db.pets)) throw new Error('formato');
        const names = db.pets.map(p => p.name).join(', ') || '(sin mascotas)';
        askConfirm('Esto reemplaza los datos actuales por el respaldo (' + db.pets.length + ' mascota/s: ' + names + ').', 'Sí, restaurar', function () {
          migrate(db);
          if (parsed.images && imagesOK) {
            Object.keys(parsed.images).forEach(id => { try { imgPut(id, dataURLToBlob(parsed.images[id])); } catch (e) {} });
          }
          DB = db;
          if (!DB.pets.find(p => p.id === DB.active)) DB.active = DB.pets.length ? DB.pets[0].id : null;
          save();
          if (DB.pets.length) {
            document.body.classList.remove('onboarding');
            renderAll(); showScreen('inicio');
          } else {
            document.body.classList.add('onboarding');
            showScreen('onboarding');
          }
          showToast('Datos restaurados');
        });
      } catch (e) { showToast('Ese archivo no parece un respaldo de Soji'); }
    };
    reader.readAsText(f);
  };
  inp.click();
}
/* ───── RECORDATORIOS (NOTIFICACIONES) ───── */
function notifState() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted' && localStorage.getItem('soji-notif') === '1') return 'on';
  if (Notification.permission === 'denied') return 'denied';
  return 'off';
}
function toggleNotif() {
  const st = notifState();
  if (st === 'unsupported') { showToast('Tu navegador no soporta notificaciones'); return; }
  if (st === 'denied') { showToast('Bloqueadas: activalas en la configuración del navegador'); return; }
  if (st === 'on') {
    localStorage.setItem('soji-notif', '0');
    renderPerfil(); showToast('Recordatorios desactivados');
    return;
  }
  Notification.requestPermission().then(perm => {
    if (perm === 'granted') {
      localStorage.setItem('soji-notif', '1');
      localStorage.removeItem('soji-notif-day');
      checkReminders();
      showToast('Recordatorios activados');
    } else { showToast('Sin permiso para notificar'); }
    renderPerfil();
  });
}
function notify(title, body) {
  const opts = { body: body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
  if (navigator.serviceWorker) {
    navigator.serviceWorker.getRegistration().then(reg => {
      if (reg && reg.showNotification) reg.showNotification(title, opts);
      else new Notification(title, opts);
    }).catch(() => { try { new Notification(title, opts); } catch (e) {} });
  } else { try { new Notification(title, opts); } catch (e) {} }
}
function checkReminders() {
  /* al abrir la app, una vez por día, avisa lo que vence en ≤7 días */
  if (notifState() !== 'on') return;
  if (localStorage.getItem('soji-notif-day') === today()) return;
  localStorage.setItem('soji-notif-day', today());
  DB.pets.forEach(p => {
    upcoming(p).filter(e => e.days <= 7).forEach(e => {
      const when = e.days < 0 ? 'venció el ' + fmtDate(e.due)
        : e.days === 0 ? 'vence hoy'
        : 'vence en ' + e.days + (e.days === 1 ? ' día' : ' días');
      notify('Soji · ' + p.name, e.title + ' ' + when);
    });
  });
}
/* ───── ALERTAS: ACCIONES ───── */
let alertCtx = null; /* { kind, id } del vencimiento tocado */
function openAlertSheet(kind, id) {
  const r = findRecord(kind, id);
  if (!r) { showScreen('historial'); return; }
  alertCtx = { kind: kind, id: id };
  const due = kind === 'vacuna' ? r.next : addMonths(r.date, r.repeat);
  document.getElementById('al-title').textContent =
    (kind === 'vacuna' ? 'Vacuna ' + r.name : 'Desparasitación ' + r.type.toLowerCase()) +
    ' · vence el ' + fmtDate(due);
  openModal('m-alerta');
}
function alertAction(action) {
  const ctx = alertCtx;
  closeOverlay('m-alerta');
  if (!ctx) return;
  const r = findRecord(ctx.kind, ctx.id);
  if (!r) return;
  if (action === 'redo') {
    /* precarga el formulario con los datos del registro anterior, fecha hoy */
    editing = null;
    if (ctx.kind === 'vacuna') {
      document.getElementById('v-name').value = r.name;
      document.getElementById('v-date').value = today();
      document.getElementById('v-next').value = '';
      document.getElementById('v-vet').value = r.vet || '';
      formTroquel = { state: 'none' }; resetTroquelPick();
      openModal('m-vacuna');
    } else {
      setChips('d-type', r.type);
      document.getElementById('d-product').value = r.product || '';
      document.getElementById('d-date').value = today();
      document.getElementById('d-repeat').value = String(r.repeat || 3);
      openModal('m-desp');
    }
  } else if (action === 'ics') {
    const due = ctx.kind === 'vacuna' ? r.next : addMonths(r.date, r.repeat);
    const title = (ctx.kind === 'vacuna' ? 'Vacuna ' + r.name : 'Desparasitación') + ' de ' + pet().name;
    downloadICS(title, due);
  } else if (action === 'hist') {
    showScreen('historial');
    const chip = document.querySelector('#hist-filters .chip[data-f="' + ctx.kind + '"]');
    if (chip) setFilter(chip);
  }
}
function icsEsc(s) {
  /* RFC 5545: comas, punto y coma, barras y saltos de línea van escapados */
  return String(s).replace(/\\/g, '\\\\').replace(/[,;]/g, m => '\\' + m).replace(/\r?\n/g, '\\n');
}
function downloadICS(title, dateIso) {
  const d = dateIso.replace(/-/g, '');
  const dEnd = isoLocal(new Date(new Date(dateIso + 'T00:00:00').getTime() + 86400000)).replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Soji//ES', 'BEGIN:VEVENT',
    'UID:' + uid() + '@soji', 'DTSTAMP:' + stamp,
    'DTSTART;VALUE=DATE:' + d, 'DTEND;VALUE=DATE:' + dEnd,
    'SUMMARY:' + icsEsc(title), 'DESCRIPTION:Recordatorio creado con Soji',
    'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEsc(title), 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'soji-recordatorio.ics';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  showToast('Listo: abrilo para sumarlo al calendario');
}
/* ───── CONFIRMACIÓN PROPIA ───── */
function askConfirm(msg, okLabel, cb) {
  document.getElementById('cf-msg').textContent = msg;
  const ok = document.getElementById('cf-ok');
  ok.textContent = okLabel;
  ok.onclick = function () { closeOverlay('m-confirm'); cb(); };
  openModal('m-confirm');
}
/* ───── SELECTOR REGISTRAR ───── */
function openRegSelector(title) {
  document.getElementById('reg-title').textContent = title || '¿Qué querés registrar?';
  openModal('m-registrar');
}
/* ───── VETERINARIAS CERCA ───── */
function openMaps(query) {
  /* siempre Google Maps: Apple Maps resuelve mal estas búsquedas en español
     (mandaba a Colombia/Brasil). En iOS el link universal abre la app de
     Google Maps si está instalada, o la web si no. */
  window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query), '_blank');
}
/* ───── DONACIÓN ───── */
function copyAlias() {
  const done = () => showToast('Alias copiado: ' + DONACION.alias);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(DONACION.alias).then(done).catch(() => showToast(DONACION.alias));
  } else { showToast(DONACION.alias); }
}
/* ───── NAVEGACIÓN / UI ───── */
function renderAll() { renderInicio(); renderHistorial(); renderPerfil(); }
function showScreen(name) {
  if (name === 'inicio') renderInicio();
  if (name === 'historial') renderHistorial();
  if (name === 'perfil') renderPerfil();
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => { t.classList.remove('active'); t.removeAttribute('aria-current'); });
  const sc = document.getElementById('screen-' + name);
  void sc.offsetWidth;
  sc.classList.add('active');
  const t = document.getElementById('tab-' + name);
  if (t) { t.classList.add('active'); t.setAttribute('aria-current', 'page'); }
  window.scrollTo({ top: 0 });
}
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeOverlay(id, e) {
  if (!e || e.target.classList.contains('overlay')) {
    document.getElementById(id).classList.remove('open');
    editing = null;
  }
}
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}
function pickChip(el) {
  el.closest('.chips').querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
}
/* teclado: Enter/Espacio activan los chips y otros role=button */
document.addEventListener('keydown', function (e) {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.getAttribute && e.target.getAttribute('role') === 'button') {
    e.preventDefault();
    e.target.click();
  }
});
/* ───── BOOT ───── */
(function () {
  const splash = document.getElementById('splash');
  try {
    if (sessionStorage.getItem('soji-splash')) splash.style.display = 'none';
    else { sessionStorage.setItem('soji-splash', '1'); setTimeout(() => splash.classList.add('hide'), 1300); }
  } catch (e) { setTimeout(() => splash.classList.add('hide'), 1300); }
  if (!DB.pets.length) {
    document.body.classList.add('onboarding');
    showScreen('onboarding');
  } else {
    if (!DB.pets.find(p => p.id === DB.active)) DB.active = DB.pets[0].id;
    showScreen('inicio');
  }
  document.getElementById('don-alias').textContent = DONACION.alias;
  document.getElementById('don-titular').textContent = DONACION.titular;
  if (!imagesOK) document.getElementById('v-troquel-wrap').style.display = 'none';
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  checkReminders();
})();