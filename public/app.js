// Som — app de música caseira com o que o Spotify faz de essencial:
// tocar uma lista (playlist, pasta, favoritas, tudo), aleatório, repetir (tudo / uma),
// fila própria («adicionar à fila», «tocar a seguir»), várias playlists e retomar noutro aparelho.
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const audio = $('#audio');
let faixas = [];
const porId = new Map();

const ESTADO_BASE = {
  playlists: [], favoritas: [],
  contexto: null,        // { tipo, id, nome, base: [ids na ordem original] }
  ordem: [], idx: 0,     // ordem de reprodução (baralhada se aleatório) e posição nela
  proximas: [],          // fila manual: toca antes do resto
  atual: null, posicao: 0, aleatorio: false, repetir: 'nao', atualizado: 0,
};
let estado = structuredClone(ESTADO_BASE);
let vista = { aba: 'musicas', pasta: null, playlist: null };

// ---------- utilidades ----------
const tempo = s => !isFinite(s) ? '0:00' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const baralhar = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

// capas geradas com as cores da marca (sol, papel, verde, tinta)
const CORES = [['#FFC53D', '#12100D'], ['#E7DECD', '#12100D'], ['#147A53', '#F2ECE1'], ['#F2ECE1', '#147A53'], ['#27231D', '#FFC53D'], ['#174C3B', '#FFC53D']];
function corDe(txt) { let h = 0; for (const c of String(txt)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return CORES[h % CORES.length]; }
function capa(el, txt, letra) {
  const [fundo, frente] = corDe(txt);
  el.style.background = fundo; el.style.color = frente;
  el.textContent = letra ?? (String(txt).trim()[0] || '♪').toUpperCase();
}
const capaHTML = (txt, letra, extra = '') => {
  const [fundo, frente] = corDe(txt);
  return `<div class="capa" style="background:${fundo};color:${frente}" aria-hidden="true"${extra}>${esc(letra ?? (String(txt).trim()[0] || '♪').toUpperCase())}</div>`;
};
// capas reais (embutidas no ficheiro) ou geradas pelo servidor com as cores da marca
const idCapa = f => f.temCapa ? f.id : f.albumId;
const urlCapa = (id, t = 96) => `/capa/${encodeURIComponent(id)}?t=${t}&v=2`;
const capaImg = (id, t = 96, extra = '') => `<div class="capa"${extra}><img src="${urlCapa(id, t)}" alt="" loading="lazy" decoding="async"></div>`;
const capaFaixa = f => capaImg(idCapa(f));
function porCapa(el, id, t) { el.innerHTML = `<img src="${urlCapa(id, t)}" alt="">`; el.style.background = ''; }

let avisoTimer;
function aviso(txt) {
  const el = $('#aviso'); el.textContent = txt; el.classList.add('on');
  clearTimeout(avisoTimer); avisoTimer = setTimeout(() => el.classList.remove('on'), 1800);
}

// ---------- estado partilhado com o servidor ----------
let gravarTimer = null;
function mudou() {
  estado.atualizado = Date.now();
  clearTimeout(gravarTimer);
  gravarTimer = setTimeout(gravar, 700);
}
async function gravar() {
  try {
    const r = await fetch('/api/estado', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(estado) });
    if (r.status === 409) { aplicarEstado(await r.json()); }
  } catch { /* sem rede: grava na próxima mudança */ }
}
function aplicarEstado(e) {
  estado = Object.assign(structuredClone(ESTADO_BASE), e);
  const existe = id => porId.has(id);
  estado.ordem = (estado.ordem || []).filter(existe);
  estado.proximas = (estado.proximas || []).filter(existe);
  estado.favoritas = estado.favoritas.filter(existe);
  if (estado.atual && existe(estado.atual)) prepararFaixa(estado.atual, estado.posicao || 0, false);
  desenhar();
}
async function carregar() {
  const [b, e] = await Promise.all([fetch('/api/biblioteca').then(r => r.json()), fetch('/api/estado').then(r => r.json())]);
  faixas = b; porId.clear();
  for (const f of faixas) porId.set(f.id, f);
  aplicarEstado(e);
}
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !audio.paused) return;
  try {
    const e = await fetch('/api/estado').then(r => r.json());
    if ((e.atualizado || 0) > estado.atualizado) aplicarEstado(e);
  } catch {}
});

// ---------- reprodução ----------
function prepararFaixa(id, pos = 0, tocar = true) {
  const f = porId.get(id);
  if (!f) return;
  estado.atual = id;
  if (!audio.src.endsWith('/audio/' + id)) audio.src = '/audio/' + id;
  const aplicar = () => { if (pos) audio.currentTime = pos; if (tocar) audio.play().catch(() => {}); };
  if (audio.readyState >= 1 && audio.src.endsWith('/audio/' + id)) aplicar(); else audio.addEventListener('loadedmetadata', aplicar, { once: true });
  document.title = `${f.titulo} · Som`;
  if (!$('#ecra').hidden && verLetra) carregarLetra(id);
  if (window.sessaoMedia) window.sessaoMedia.meta(f);
  desenharLeitor();
}

// tocar uma lista inteira (playlist, pasta, favoritas, tudo)
function tocarContexto(ids, contexto, desde = null, forcarAleatorio = false, pos = 0) {
  if (!ids.length) return aviso('Esta lista está vazia');
  if (forcarAleatorio) estado.aleatorio = true;
  estado.contexto = { ...contexto, base: ids.slice() };
  if (estado.aleatorio) {
    const resto = baralhar(ids.filter(i => i !== desde));
    estado.ordem = desde ? [desde, ...resto] : resto;
  } else estado.ordem = ids.slice();
  estado.idx = desde ? Math.max(0, estado.ordem.indexOf(desde)) : 0;
  estado.posicao = pos;
  prepararFaixa(estado.ordem[estado.idx], pos, true);
  mudou(); desenhar();
}

function seguinte(automatico = false) {
  if (automatico && estado.repetir === 'um') { audio.currentTime = 0; audio.play(); return; }
  if (estado.proximas.length) {
    prepararFaixa(estado.proximas.shift(), 0, true);
  } else if (estado.idx + 1 < estado.ordem.length) {
    estado.idx++;
    prepararFaixa(estado.ordem[estado.idx], 0, true);
  } else if (estado.ordem.length && estado.repetir !== 'nao') {
    if (estado.aleatorio) estado.ordem = baralhar(estado.ordem);
    estado.idx = 0;
    prepararFaixa(estado.ordem[0], 0, true);
  } else {
    audio.pause();
    if (!automatico) aviso('Fim da lista');
    return;
  }
  mudou(); desenhar();
}
function anterior() {
  if (audio.currentTime > 3 || estado.idx === 0) { audio.currentTime = 0; return; }
  estado.idx--;
  prepararFaixa(estado.ordem[estado.idx], 0, true);
  mudou(); desenhar();
}
function alternarAleatorio() {
  estado.aleatorio = !estado.aleatorio;
  const base = estado.contexto?.base;
  if (base && estado.atual) {
    if (estado.aleatorio) {
      const tocadas = estado.ordem.slice(0, estado.idx + 1);
      estado.ordem = [...tocadas, ...baralhar(base.filter(i => !tocadas.includes(i)))];
    } else {
      estado.ordem = base.slice();
      estado.idx = Math.max(0, base.indexOf(estado.atual));
    }
  }
  aviso(estado.aleatorio ? 'Aleatório ligado' : 'Aleatório desligado');
  mudou(); desenhar();
}
function alternarRepetir() {
  estado.repetir = { nao: 'tudo', tudo: 'um', um: 'nao' }[estado.repetir] || 'tudo';
  aviso({ nao: 'Repetir desligado', tudo: 'Repetir a lista', um: 'Repetir esta música' }[estado.repetir]);
  mudou(); desenhar();
}
function alternarPlay() {
  if (!audio.src) {
    if (estado.ordem.length) return prepararFaixa(estado.ordem[estado.idx] || estado.ordem[0], 0, true);
    return tocarContexto(faixas.map(f => f.id), { tipo: 'tudo', nome: 'Todas as músicas' });
  }
  audio.paused ? audio.play() : audio.pause();
}

// fila manual
function adicionarFila(ids, primeiro = false) {
  ids = [].concat(ids);
  if (primeiro) estado.proximas.unshift(...ids); else estado.proximas.push(...ids);
  aviso(primeiro ? 'Toca a seguir' : (ids.length > 1 ? `${ids.length} músicas na fila` : 'Adicionada à fila'));
  mudou(); desenhar();
}

// favoritas e playlists
function alternarFavorita(id) {
  if (!id) return;
  const i = estado.favoritas.indexOf(id);
  if (i < 0) { estado.favoritas.unshift(id); aviso('Guardada nas favoritas'); }
  else { estado.favoritas.splice(i, 1); aviso('Tirada das favoritas'); }
  mudou(); desenhar();
}
function novaPlaylist(ids = []) {
  const nome = prompt('Nome da nova playlist');
  if (!nome || !nome.trim()) return null;
  const p = { id: Date.now().toString(36), nome: nome.trim(), faixas: [].concat(ids) };
  estado.playlists.unshift(p);
  aviso(`Playlist «${p.nome}» criada`);
  mudou(); desenhar();
  return p;
}
function adicionarAPlaylist(p, ids) {
  ids = [].concat(ids).filter(id => !p.faixas.includes(id));
  if (!ids.length) return aviso(`Já está em «${p.nome}»`);
  p.faixas.push(...ids);
  aviso(`Adicionada a «${p.nome}»`);
  mudou(); desenhar();
}

// ---------- eventos do áudio ----------
audio.addEventListener('ended', () => seguinte(true));
audio.addEventListener('play', () => { window.sessaoMedia?.estado('playing'); desenharLeitor(); });
audio.addEventListener('pause', () => { window.sessaoMedia?.estado('paused'); estado.posicao = audio.currentTime; mudou(); desenharLeitor(); });
let ultimaGravacao = 0, arrastar = false;
audio.addEventListener('timeupdate', () => {
  const d = audio.duration, t = audio.currentTime;
  if (!arrastar && d) for (const el of [$('#progresso'), $('#e-progresso')]) { el.value = Math.round(t / d * 1000); el.style.setProperty('--p', (t / d * 100) + '%'); }
  $('#e-atual').textContent = tempo(t); $('#e-total').textContent = tempo(d);
  if (d) window.sessaoMedia?.posicao(d, t);
  if (Date.now() - ultimaGravacao > 10000) { ultimaGravacao = Date.now(); estado.posicao = t; mudou(); }
  if (verLetra && !$('#ecra').hidden) marcarLinha(t);
});
for (const el of [$('#progresso'), $('#e-progresso')]) {
  el.addEventListener('input', () => { arrastar = true; el.style.setProperty('--p', el.value / 10 + '%'); });
  el.addEventListener('change', () => { arrastar = false; if (audio.duration) audio.currentTime = el.value / 1000 * audio.duration; });
}
$$('.b-play').forEach(b => b.onclick = alternarPlay);
$$('.b-seg').forEach(b => b.onclick = () => seguinte(false));
$$('.b-fav').forEach(b => b.onclick = () => alternarFavorita(estado.atual));
$('#b-ant').onclick = anterior;
$('#b-aleatorio').onclick = alternarAleatorio;
$('#b-repetir').onclick = alternarRepetir;
$('#info').onclick = () => { if (estado.atual) abrirEcra(); };
$('#mini-capa').onclick = () => { if (estado.atual) abrirEcra(); };
$('#fechar-ecra').onclick = fecharEcra;
$('#ver-fila').onclick = () => { fecharEcra(); mudarAba('fila'); };
$('#ecra-menu').onclick = () => estado.atual && menuFaixa(estado.atual, {});
function abrirEcra() { $('#ecra').hidden = false; desenharLeitor(); aplicarVerLetra(); }
function fecharEcra() { $('#ecra').hidden = true; }
// controlos da notificação e do ecrã de bloqueio: ver extras.js (sessaoMedia)

// dia / noite (fica guardado neste aparelho)
function aplicarTema(t) {
  document.documentElement.dataset.tema = t;
  $('#tema').setAttribute('aria-checked', String(t === 'noite'));
  document.querySelector('meta[name=theme-color]').content = t === 'noite' ? '#12100D' : '#F2ECE1';
}
$('#tema').onclick = () => {
  const t = document.documentElement.dataset.tema === 'noite' ? 'dia' : 'noite';
  try { localStorage.setItem('som-tema', t); } catch {}
  aplicarTema(t);
};
aplicarTema(document.documentElement.dataset.tema || 'noite');
document.addEventListener('keydown', e => {
  if (e.target.matches('input[type=search], input[type=text]') || $('#menu').open) return;
  if (e.code === 'Space') { e.preventDefault(); alternarPlay(); }
  else if (e.code === 'ArrowRight' && e.shiftKey) seguinte(false);
  else if (e.code === 'ArrowLeft' && e.shiftKey) anterior();
  else if (e.code === 'Escape') fecharEcra();
});

// ---------- menus ----------
function abrirMenu({ titulo, sub, capaTxt, capaId, acoes }) {
  $('#menu-titulo').textContent = titulo;
  $('#menu-sub').textContent = sub || '';
  if (capaId) porCapa($('#menu-capa'), capaId, 96); else { $('#menu-capa').innerHTML = ''; capa($('#menu-capa'), capaTxt || titulo); }
  const caixa = $('#menu-acoes'); caixa.innerHTML = '';
  for (const [icone, rotulo, fn] of acoes) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<i>${ICO[icone] || esc(icone)}</i><span>${esc(rotulo)}</span>`;
    b.onclick = () => { $('#menu').close(); fn(); };
    caixa.appendChild(b);
  }
  if (!$('#menu').open) $('#menu').showModal();
}
function escolherPlaylist(ids, titulo) {
  abrirMenu({
    titulo: 'Adicionar a playlist', sub: titulo, capaTxt: titulo,
    acoes: [
      ['juntar', 'Nova playlist', () => novaPlaylist(ids)],
      ...estado.playlists.map(p => ['letra', `${p.nome} (${p.faixas.length})`, () => adicionarAPlaylist(p, ids)]),
    ],
  });
}
function menuFaixa(id, ctx) {
  const f = porId.get(id);
  const fav = estado.favoritas.includes(id);
  const acoes = [
    ['aSeguir', 'Tocar a seguir', () => adicionarFila(id, true)],
    ['fila', 'Adicionar à fila', () => adicionarFila(id)],
    ['juntar', 'Adicionar a playlist', () => setTimeout(() => escolherPlaylist([id], f.titulo))],
    [fav ? 'coracaoCheio' : 'coracao', fav ? 'Tirar das favoritas' : 'Guardar nas favoritas', () => alternarFavorita(id)],
  ];
  acoes.push(['album', `Ir para o álbum «${f.album}»`, () => { fecharEcra(); vista = { aba: 'pastas', pasta: f.albumId, playlist: null }; marcarAba(); desenhar(); }]);
  if (ctx.playlist) acoes.push(['fechar', 'Tirar desta playlist', () => {
    const p = estado.playlists.find(x => x.id === ctx.playlist);
    if (p) { p.faixas = p.faixas.filter(x => x !== id); aviso('Tirada da playlist'); mudou(); desenhar(); }
  }]);
  if (ctx.filaIdx != null) acoes.push(['fechar', 'Tirar da fila', () => { estado.proximas.splice(ctx.filaIdx, 1); mudou(); desenhar(); }]);
  abrirMenu({ titulo: f.titulo, sub: [f.artista, f.album].filter(Boolean).join(' · '), capaId: idCapa(f), acoes });
}
function menuPlaylist(p) {
  abrirMenu({
    titulo: p.nome, sub: plural(p.faixas.length, 'música', 'músicas'), capaId: 'pl-' + p.id,
    acoes: [
      ['fila', 'Adicionar tudo à fila', () => adicionarFila(p.faixas.filter(id => porId.has(id)))],
      ['editar', 'Mudar o nome', () => { const n = prompt('Novo nome', p.nome); if (n && n.trim()) { p.nome = n.trim(); mudou(); desenhar(); } }],
      ['copiar', 'Duplicar', () => { estado.playlists.unshift({ id: Date.now().toString(36), nome: p.nome + ' (cópia)', faixas: p.faixas.slice() }); mudou(); desenhar(); }],
      ['lixo', 'Apagar playlist', () => {
        if (!confirm(`Apagar «${p.nome}»? As músicas ficam na biblioteca.`)) return;
        estado.playlists = estado.playlists.filter(x => x.id !== p.id); vista.playlist = null; aviso('Playlist apagada'); mudou(); desenhar();
      }],
    ],
  });
}

// ---------- desenhar ----------
function desenharLeitor() {
  const f = porId.get(estado.atual);
  const fav = f && estado.favoritas.includes(f.id);
  $('#l-titulo').textContent = f ? f.titulo : 'Nada a tocar';
  $('#l-artista').textContent = f ? [f.artista, f.album].filter(Boolean).join(' · ') : 'Escolhe uma música';
  if (f && desenharLeitor.capa !== idCapa(f)) {
    desenharLeitor.capa = idCapa(f);
    porCapa($('#mini-capa'), idCapa(f), 96);
    porCapa($('#ecra-capa'), idCapa(f), 600);
    $('#ecra-fundo').style.backgroundImage = `url("${urlCapa(idCapa(f), 96)}")`;
  } else if (!f) { $('#mini-capa').innerHTML = ''; capa($('#mini-capa'), 'Som', '♪'); }
  $('#e-titulo').textContent = f?.titulo || '';
  $('#e-artista').textContent = f ? [f.artista, f.album].filter(Boolean).join(' · ') : '';
  $('#ecra-contexto').textContent = estado.contexto ? `A tocar de ${estado.contexto.nome}` : 'A tocar';
  $$('.b-play').forEach(b => { const n = audio.paused ? 'play' : 'pausa'; if (b.dataset.estado !== n) { b.dataset.estado = n; b.innerHTML = ico(n); } b.setAttribute('aria-label', audio.paused ? 'Tocar' : 'Pausa'); });
  $$('.b-fav').forEach(b => { b.innerHTML = ico(fav ? 'coracaoCheio' : 'coracao'); b.classList.toggle('fav', !!fav); b.setAttribute('aria-label', fav ? 'Tirar das favoritas' : 'Guardar nas favoritas'); });
  $('#b-repetir').innerHTML = ico(estado.repetir === 'um' ? 'repetir1' : 'repetir');
  const ba = $('#b-aleatorio'), br = $('#b-repetir');
  ba.classList.toggle('on', !!estado.aleatorio); ba.dataset.ponto = '•';
  br.classList.toggle('on', estado.repetir !== 'nao'); br.dataset.ponto = estado.repetir === 'um' ? '1' : '•';
}

function linhaFaixa(f, ctx = {}, numero = null) {
  const fav = estado.favoritas.includes(f.id);
  const dados = Object.entries(ctx).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
  return `<div class="linha${f.id === estado.atual ? ' atual' : ''}" data-id="${f.id}"${dados}>
    ${numero != null ? `<span class="num">${numero}</span>` : ''}
    ${capaFaixa(f)}
    <button class="txt" data-tocar><b>${esc(f.titulo)}</b><span>${esc([f.artista, f.album].filter(Boolean).join(' · ') || ' ')}</span></button>
    ${f.duracao ? `<span class="dur">${tempo(f.duracao)}</span>` : ''}
    <button class="acao${fav ? ' fav' : ''}" data-fav aria-label="${fav ? 'Tirar das favoritas' : 'Guardar nas favoritas'}">${ico(fav ? 'coracaoCheio' : 'coracao')}</button>
    <button class="acao" data-menu aria-label="Mais opções">${ico('mais')}</button>
  </div>`;
}
const duracaoTotal = fs => {
  const s = fs.reduce((t, f) => t + (f.duracao || 0), 0);
  if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? ` · ${h} h ${m} min` : ` · ${m} min`;
};
function hero({ txt, letra, capaId, etiqueta, titulo, sub, extraBotoes = '' }) {
  return `<div class="hero">${capaId ? capaImg(capaId, 300) : capaHTML(txt, letra)}<div><span class="etiqueta">${esc(etiqueta)}</span><h2>${titulo}</h2><span class="etiqueta">${esc(sub)}</span></div></div>
  <div class="acoes-lista">
    <button class="play" data-acao="tocar" aria-label="Tocar">${ico('play')}</button>
    <button class="redondo vidro" data-acao="aleatorio" aria-label="Tocar em aleatório" title="Tocar em aleatório">${ico('aleatorio')}</button>
    <button class="redondo vidro" data-acao="fila" aria-label="Adicionar tudo à fila" title="Adicionar tudo à fila">${ico('fila')}</button>
    ${extraBotoes}
  </div>`;
}
const caixa = html => html ? `<div class="lista-vidro vidro">${html}</div>` : '';

let listaAtual = { ids: [], contexto: null }; // o que o ▶ e o ⤮ do cabeçalho tocam
function desenhar() {
  desenharLeitor();
  $('#contagem').textContent = faixas.length ? plural(faixas.length, 'música', 'músicas') : '';
  const q = norm($('#procura').value.trim());
  const el = $('#lista');
  listaAtual = { ids: [], contexto: null };
  if (!faixas.length) {
    el.innerHTML = `<p class="vazio"><em>Ainda não há música.</em>Põe ficheiros na pasta «musica» do servidor.<br><br><button class="texto-btn vidro" id="b-varrer">Atualizar biblioteca</button></p>`;
    $('#b-varrer').onclick = varrer;
    return;
  }
  let html = '';
  const lista = (fs, ctx = {}, numerar = false) => caixa(fs.map((f, i) => linhaFaixa(f, ctx, numerar ? i + 1 : null)).join(''));

  const linhaLista = (capa, attrs, titulo, sub, tocarAttr) => `<div class="linha">${capa}<button class="txt" ${attrs}><b>${esc(titulo)}</b><span>${esc(sub)}</span></button>${tocarAttr ? `<button class="acao" ${tocarAttr} aria-label="Tocar">${ico('play')}</button>` : ''}</div>`;
  const linhaPlaylist = p => linhaLista(capaImg('pl-' + p.id), `data-abrir-playlist="${p.id}"`, p.nome, 'Playlist · ' + plural(p.faixas.length, 'música', 'músicas'), `data-tocar-playlist="${p.id}"`);
  const albunsDe = () => {
    const m = new Map();
    for (const f of faixas) {
      if (!m.has(f.albumId)) m.set(f.albumId, { id: f.albumId, nome: f.album, artistas: new Set(), faixas: [] });
      const a = m.get(f.albumId); a.faixas.push(f); a.artistas.add(f.artista);
    }
    return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  };

  if (q) {
    const fs = faixas.filter(f => norm(`${f.titulo} ${f.artista} ${f.album} ${f.pasta}`).includes(q));
    const ps = estado.playlists.filter(p => norm(p.nome).includes(q));
    listaAtual = { ids: fs.map(f => f.id), contexto: { tipo: 'procura', nome: `«${$('#procura').value.trim()}»` } };
    html = (ps.length ? `<p class="etiqueta seccao">Playlists</p>` + caixa(ps.map(linhaPlaylist).join('')) : '')
      + (fs.length ? `<p class="etiqueta seccao">Músicas · ${fs.length}</p>` + lista(fs) : '')
      || '<p class="vazio"><em>Nada encontrado.</em>Experimenta outra palavra.</p>';
  } else if (vista.aba === 'musicas') {
    const fs = faixas;
    listaAtual = { ids: fs.map(f => f.id), contexto: { tipo: 'tudo', nome: 'Todas as músicas' } };
    html = hero({ txt: 'Som', letra: '♪', etiqueta: 'Biblioteca', titulo: 'Todas as <em>músicas</em>', sub: plural(fs.length, 'música', 'músicas') + duracaoTotal(fs) }) + lista(fs);
  } else if (vista.aba === 'pastas') {
    const todos = albunsDe();
    const al = todos.find(a => a.id === vista.pasta);
    if (al) {
      listaAtual = { ids: al.faixas.map(f => f.id), contexto: { tipo: 'album', id: al.id, nome: al.nome } };
      html = `<button class="voltar" data-voltar>← Álbuns</button>` +
        hero({ capaId: al.id, etiqueta: 'Álbum · ' + [...al.artistas].join(', '), titulo: esc(al.nome), sub: plural(al.faixas.length, 'música', 'músicas') + duracaoTotal(al.faixas) })
        + lista(al.faixas, {}, true);
    } else {
      html = caixa(todos.map(a => linhaLista(capaImg(a.id), `data-abrir-pasta="${a.id}"`, a.nome,
        [...a.artistas].join(', ') + ' · ' + plural(a.faixas.length, 'música', 'músicas'), `data-tocar-pasta="${a.id}"`)).join(''));
    }
  } else if (vista.aba === 'playlists') {
    const p = estado.playlists.find(x => x.id === vista.playlist);
    if (p) {
      const fs = p.faixas.map(id => porId.get(id)).filter(Boolean);
      listaAtual = { ids: fs.map(f => f.id), contexto: { tipo: 'playlist', id: p.id, nome: p.nome } };
      html = `<button class="voltar" data-voltar>← Playlists</button>` +
        hero({ capaId: 'pl-' + p.id, etiqueta: 'Playlist', titulo: esc(p.nome), sub: plural(fs.length, 'música', 'músicas') + duracaoTotal(fs),
          extraBotoes: `<span style="flex:1"></span><button class="redondo vidro" data-menu-playlist="${p.id}" aria-label="Opções da playlist">${ico('mais')}</button>` })
        + (fs.length ? lista(fs, { playlist: p.id }, true) : '<p class="vazio"><em>Playlist vazia.</em>Usa o ⋯ de qualquer música para a juntar aqui.</p>');
    } else {
      html = caixa(
        `<div class="linha"><div class="capa" style="background:var(--sol);color:var(--tinta)">${ico('juntar')}</div><button class="txt" id="b-nova"><b>Nova playlist</b><span>Cria uma lista tua</span></button></div>`
        + linhaLista(capaHTML('Favoritas', '♥'), 'data-ir-favoritas', 'Músicas favoritas', plural(estado.favoritas.length, 'música', 'músicas'))
        + estado.playlists.map(linhaPlaylist).join(''));
    }
  } else if (vista.aba === 'favoritas') {
    const fs = estado.favoritas.map(id => porId.get(id)).filter(Boolean);
    listaAtual = { ids: fs.map(f => f.id), contexto: { tipo: 'favoritas', nome: 'Favoritas' } };
    html = hero({ txt: 'Favoritas', letra: '♥', etiqueta: 'Playlist', titulo: 'Músicas <em>favoritas</em>', sub: plural(fs.length, 'música', 'músicas') + duracaoTotal(fs) })
      + (fs.length ? lista(fs, {}, true) : '<p class="vazio"><em>Ainda sem favoritas.</em>Toca no ♡ de uma música para a guardar aqui.</p>');
  } else if (vista.aba === 'momento') {
    if ($('#f-momento')) return desenharMomento();   // não apaga o que estás a escrever
    html = momentoHTML();
  } else if (vista.aba === 'fila') {
    const atual = porId.get(estado.atual);
    const proximas = estado.proximas.map(id => porId.get(id)).filter(Boolean);
    const resto = estado.ordem.slice(estado.idx + 1, estado.idx + 51).map(id => porId.get(id)).filter(Boolean);
    html = atual ? `<p class="etiqueta seccao">A tocar</p>` + caixa(linhaFaixa(atual)) : '<p class="vazio"><em>Nada a tocar.</em>Toca numa música ou numa playlist para começar.</p>';
    if (proximas.length) html += `<p class="etiqueta seccao" style="display:flex;justify-content:space-between">Na fila <button class="etiqueta" id="b-limpar">Limpar</button></p>`
      + caixa(proximas.map((f, i) => linhaFaixa(f, { 'fila-idx': i })).join(''));
    if (resto.length) html += `<p class="etiqueta seccao">A seguir de ${esc(estado.contexto?.nome || 'lista')}</p>` + lista(resto, { ordem: 1 });
  }
  if (vista.aba === 'musicas' && !q) html += `<div class="ligar vidro"><b>Usar numa app do telemóvel</b> (Symfonium, Substreamer, Ultrasonic…): servidor <code>${location.origin}</code>, utilizador <code>jaime</code>, qualquer senha. As playlists e as favoritas são as mesmas daqui.</div>
    <p class="creditos">Música de Kevin MacLeod (incompetech.com), licença CC BY 4.0 · <a href="/creditos.txt">créditos</a></p>`;
  el.innerHTML = html;
  if (vista.aba === 'momento' && !q) ligarMomento();
  const bv = $('#b-varrer'); if (bv) bv.onclick = varrer;
  const bn = $('#b-nova'); if (bn) bn.onclick = () => { const p = novaPlaylist(); if (p) { vista.playlist = p.id; desenhar(); } };
  const bl = $('#b-limpar'); if (bl) bl.onclick = () => { estado.proximas = []; aviso('Fila limpa'); mudou(); desenhar(); };
}
async function varrer() {
  aviso('A atualizar…');
  await fetch('/api/varrer', { method: 'POST' });
  await carregar();
  aviso(plural(faixas.length, 'música', 'músicas'));
}

$('#lista').addEventListener('click', e => {
  const alvo = e.target.closest('button');
  if (!alvo) return;
  const d = alvo.dataset;
  if ('voltar' in d) { vista.pasta = null; vista.playlist = null; return desenhar(); }
  if (d.momento != null) return tocarMomento(Number(d.momento));
  if (d.acao === 'tocar') return tocarContexto(listaAtual.ids, listaAtual.contexto, null, false);
  if (d.acao === 'aleatorio') return tocarContexto(listaAtual.ids, listaAtual.contexto, null, true);
  if (d.acao === 'fila') return adicionarFila(listaAtual.ids);
  if (d.abrirPasta != null) { vista.pasta = d.abrirPasta; return desenhar(); }
  if (d.tocarPasta != null) { const fs = faixas.filter(f => f.albumId === d.tocarPasta); return tocarContexto(fs.map(f => f.id), { tipo: 'album', id: d.tocarPasta, nome: fs[0]?.album || 'Álbum' }); }
  if (d.abrirPlaylist) { $('#procura').value = ''; vista = { aba: 'playlists', pasta: null, playlist: d.abrirPlaylist }; marcarAba(); return desenhar(); }
  if (d.tocarPlaylist) { const p = estado.playlists.find(x => x.id === d.tocarPlaylist); return tocarContexto(p.faixas.filter(id => porId.has(id)), { tipo: 'playlist', id: p.id, nome: p.nome }); }
  if (d.menuPlaylist) return menuPlaylist(estado.playlists.find(x => x.id === d.menuPlaylist));
  if ('irFavoritas' in d) return mudarAba('favoritas');
  const linha = alvo.closest('.linha[data-id]');
  if (!linha) return;
  const id = linha.dataset.id;
  if ('fav' in d) return alternarFavorita(id);
  if ('menu' in d) return menuFaixa(id, { playlist: linha.dataset.playlist, filaIdx: linha.dataset.filaIdx != null ? Number(linha.dataset.filaIdx) : null });
  if ('tocar' in d) {
    if (linha.dataset.filaIdx != null) { estado.proximas.splice(Number(linha.dataset.filaIdx), 1); prepararFaixa(id, 0, true); mudou(); return desenhar(); }
    if (linha.dataset.ordem) { estado.idx = estado.ordem.indexOf(id, estado.idx); prepararFaixa(id, 0, true); mudou(); return desenhar(); }
    if (id === estado.atual) return alternarPlay();
    return tocarContexto(listaAtual.ids.length ? listaAtual.ids : [id], listaAtual.contexto || { tipo: 'faixa', nome: porId.get(id).titulo }, id);
  }
});
function marcarAba() { $$('#abas button').forEach(x => x.classList.toggle('on', x.dataset.aba === vista.aba)); }
function mudarAba(aba) { vista = { aba, pasta: null, playlist: null }; $('#procura').value = ''; marcarAba(); desenhar(); $('#lista').scrollTop = 0; }
$('#abas').addEventListener('click', e => { const b = e.target.closest('button[data-aba]'); if (b) mudarAba(b.dataset.aba); });
$('#procura').addEventListener('input', desenhar);

// ---------- letra a acompanhar a música ----------
let verLetra = false;
try { verLetra = localStorage.getItem('som-letra') === '1'; } catch {}
let letraAtual = { id: null, dados: null, linha: -1 }, letraTimer = null;
function aplicarVerLetra() {
  $('#ecra').classList.toggle('com-letra', verLetra);
  $('#b-letra').setAttribute('aria-pressed', String(verLetra));
  $('#b-letra').classList.toggle('on', verLetra);
  if (verLetra && estado.atual) carregarLetra(estado.atual);
}
$('#b-letra').onclick = () => {
  verLetra = !verLetra;
  try { localStorage.setItem('som-letra', verLetra ? '1' : '0'); } catch {}
  aplicarVerLetra();
};
async function carregarLetra(id, forcar = false) {
  if (letraAtual.id === id && letraAtual.dados && !forcar) return desenharLetra();
  clearTimeout(letraTimer);
  if (letraAtual.id !== id) { letraAtual = { id, dados: null, linha: -1 }; desenharLetra(); }
  try {
    const d = await fetch('/api/letra/' + id).then(r => r.json());
    if (letraAtual.id !== id) return;
    letraAtual.dados = d; letraAtual.linha = -1;
    desenharLetra();
    // ainda na fila: pergunta outra vez daqui a pouco
    if (d.estado === 'na fila' || d.estado === 'a escrever') letraTimer = setTimeout(() => verLetra && !$('#ecra').hidden && carregarLetra(id, true), 15000);
  } catch { $('#ecra-letra').innerHTML = '<p class="letra-aviso">Sem ligação ao servidor.</p>'; }
}
function desenharLetra() {
  const el = $('#ecra-letra'), d = letraAtual.dados;
  if (!d) { el.innerHTML = '<p class="letra-aviso">A carregar a letra…</p>'; return; }
  if (d.instrumental) { el.innerHTML = '<p class="letra-aviso"><em>Instrumental.</em>Esta música não tem voz.</p>'; return; }
  if (!d.linhas?.length) {
    el.innerHTML = `<p class="letra-aviso"><em>${d.estado === 'a escrever' ? 'A escrever a letra…' : d.estado === 'na fila' ? 'A letra está na fila.' : 'Sem letra.'}</em>`
      + `${d.estado === 'sem letra' ? 'Não consegui ouvir esta música.' : 'O computador está a ouvir as músicas uma a uma. Aparece aqui sozinha.'}</p>`;
    return;
  }
  el.innerHTML = d.linhas.map((l, i) => `<button class="l" data-i="${i}" data-t="${l.inicio}">${esc(l.texto)}</button>`).join('')
    + `<p class="etiqueta letra-fonte">${esc(d.fonte || '')}</p>`;
  marcarLinha(audio.currentTime, true);
}
function marcarLinha(t, saltar = false) {
  const ls = letraAtual.dados?.linhas;
  if (!ls?.length || letraAtual.id !== estado.atual) return;
  let i = -1;
  for (let k = 0; k < ls.length; k++) if (ls[k].inicio <= t + 0.2) i = k; else break;
  if (i === letraAtual.linha && !saltar) return;
  letraAtual.linha = i;
  const el = $('#ecra-letra');
  el.querySelectorAll('.l').forEach((b, k) => { b.classList.toggle('on', k === i); b.classList.toggle('passou', k < i); });
  const alvo = el.querySelector(`.l[data-i="${Math.max(0, i)}"]`);
  if (alvo) el.scrollTo({ top: alvo.offsetTop - el.clientHeight / 2 + alvo.clientHeight / 2, behavior: saltar ? 'auto' : 'smooth' });
}
$('#ecra-letra').addEventListener('click', e => {
  const b = e.target.closest('.l');
  if (!b) return;
  audio.currentTime = Number(b.dataset.t);
  if (audio.paused) audio.play().catch(() => {});
  marcarLinha(Number(b.dataset.t), true);
});

// ---------- Momento: uma frase sobre o momento → a linha de uma música nossa que encaixa ----------
const MINI = {
  url: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1/dist/transformers.min.js',
  modelo: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
  estado: 'desligado', progresso: 0, extrator: null, linhas: [], vetores: [],
};
const momento = { q: '', resultados: null, aProcurar: false, modo: '', erro: '' };
const Ditado = window.SpeechRecognition || window.webkitSpeechRecognition;

function momentoHTML() {
  return `<div class="momento vidro">
    <span class="etiqueta">Momento</span>
    <h2>Como está o <em>momento</em>?</h2>
    <p class="momento-ajuda">Escreve ou dita uma frase e eu procuro, nas nossas músicas, a linha que encaixa — e toco a partir dela.</p>
    <form id="f-momento" autocomplete="off">
      <input id="momento-q" type="text" enterkeyhint="search" placeholder="estamos a descascar bananas…" value="${esc(momento.q)}" aria-label="Descreve o momento">
      ${Ditado ? '<button type="button" id="b-ditar" class="redondo vidro" aria-label="Ditar a frase" title="Ditar">🎙</button>' : ''}
      <button type="submit" class="play" aria-label="Procurar">→</button>
    </form>
    <div class="momento-sugestoes">${['dia de praia com os miúdos', 'mãos na terra', 'abrir a porta', 'cortar o cabelo', 'peixe fresco'].map(x => `<button type="button" class="texto-btn vidro" data-sugestao="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    <p class="etiqueta" id="mini-estado"></p>
  </div>
  <div id="momento-res"></div>`;
}
function ligarMomento() {
  $('#f-momento').onsubmit = e => { e.preventDefault(); procurarMomento($('#momento-q').value); };
  $('#momento-q').oninput = e => { momento.q = e.target.value; };
  $$('[data-sugestao]').forEach(b => b.onclick = () => { $('#momento-q').value = b.dataset.sugestao; procurarMomento(b.dataset.sugestao); });
  const bd = $('#b-ditar'); if (bd) bd.onclick = ditar;
  try { if (localStorage.getItem('som-mini') === '1' && MINI.estado === 'desligado') ligarMiniModelo(); } catch {}
  desenharMomento();
}
function desenharMiniEstado() {
  const el = $('#mini-estado');
  if (!el) return;
  const txt = {
    desligado: `<button type="button" class="ligar-mini" id="b-mini">Ligar o mini modelo neste aparelho</button> · procura por sentido sem sair daqui (descarrega ~120 MB uma vez)`,
    'a carregar': `Mini modelo a carregar… ${MINI.progresso ? Math.round(MINI.progresso) + ' %' : ''}`,
    'a preparar': `Mini modelo a ler as letras (${MINI.vetores.length}/${MINI.linhas.length})…`,
    pronto: `Mini modelo ligado neste aparelho · ${MINI.linhas.length} linhas`,
    falhou: `O mini modelo não arrancou neste aparelho (${esc(MINI.erro || '')}). A procura continua pelo servidor.`,
  }[MINI.estado];
  el.innerHTML = txt;
  const b = $('#b-mini'); if (b) b.onclick = () => { try { localStorage.setItem('som-mini', '1'); } catch {} ligarMiniModelo(); };
}
function desenharMomento() {
  desenharMiniEstado();
  const el = $('#momento-res');
  if (!el) return;
  if (momento.aProcurar) { el.innerHTML = '<p class="vazio">A procurar…</p>'; return; }
  if (momento.erro) { el.innerHTML = `<p class="vazio"><em>Não deu.</em>${esc(momento.erro)}</p>`; return; }
  if (!momento.resultados) { el.innerHTML = ''; return; }
  if (!momento.resultados.length) { el.innerHTML = '<p class="vazio"><em>Nada encaixa.</em>Experimenta dizer o momento por outras palavras.</p>'; return; }
  const max = Math.max(...momento.resultados.map(r => r.pontuacao), 0.01);
  el.innerHTML = `<p class="etiqueta seccao">${momento.resultados.length} linhas · ${esc(momento.modo)}</p>` + caixa(momento.resultados.map((r, i) => {
    const f = porId.get(r.id);
    return `<div class="linha momento-linha${r.id === estado.atual ? ' atual' : ''}" data-id="${r.id}">
      ${f ? capaFaixa(f) : capaHTML(r.musica)}
      <button class="txt" data-momento="${i}"><b>«${esc(r.linha)}»</b><span>${esc(r.musica)} · ${tempo(r.inicio)}</span></button>
      <span class="encaixe" title="Pontuação ${r.pontuacao}" aria-label="Encaixe ${Math.round(r.pontuacao * 100)} %"><i style="width:${Math.round(r.pontuacao / max * 100)}%"></i></span>
      <button class="acao" data-momento="${i}" aria-label="Tocar a partir desta linha">${ico('play')}</button>
    </div>`;
  }).join(''));
}
async function procurarMomento(q) {
  q = q.trim();
  if (!q) return;
  momento.q = q; momento.aProcurar = true; momento.erro = ''; desenharMomento();
  try {
    let r = await fetch('/api/momento?n=30&q=' + encodeURIComponent(q)).then(x => x.json());
    let modo = r[0]?.modo === 'palavras + mini modelo' ? 'palavras + mini modelo do servidor' : 'palavras';
    if (MINI.estado === 'pronto') { r = await reordenarComMini(q, r); modo = 'palavras + mini modelo deste aparelho'; }
    momento.resultados = r.slice(0, 8); momento.modo = modo;
  } catch (e) { momento.erro = 'Não consegui falar com o servidor.'; }
  momento.aProcurar = false;
  desenharMomento();
}
function tocarMomento(i) {
  const r = momento.resultados?.[i];
  if (!r || !porId.has(r.id)) return;
  const ids = [...new Set(momento.resultados.map(x => x.id))].filter(id => porId.has(id));
  tocarContexto(ids, { tipo: 'momento', nome: `o momento «${momento.q}»` }, r.id, false, Math.max(0, r.inicio - 0.3));
  aviso(`Desde «${r.linha.length > 34 ? r.linha.slice(0, 32) + '…' : r.linha}»`);
}
function ditar() {
  const rec = new Ditado();
  rec.lang = 'pt-PT'; rec.interimResults = true; rec.maxAlternatives = 1;
  const b = $('#b-ditar'); b.classList.add('on');
  rec.onresult = e => {
    const t = [...e.results].map(x => x[0].transcript).join(' ');
    $('#momento-q').value = t; momento.q = t;
    if (e.results[e.results.length - 1].isFinal) procurarMomento(t);
  };
  rec.onerror = () => aviso('Não consegui ouvir');
  rec.onend = () => b.classList.remove('on');
  rec.start();
}

// mini modelo no browser (transformers.js): calcula o vetor de cada linha uma vez e guarda-o no IndexedDB
const idb = (() => {
  let db;
  const abrir = () => db ||= new Promise((ok, falha) => {
    const r = indexedDB.open('som-momento', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('vetores');
    r.onsuccess = () => ok(r.result); r.onerror = () => falha(r.error);
  });
  return {
    async ler(k) { try { const d = await abrir(); return await new Promise(ok => { const q = d.transaction('vetores').objectStore('vetores').get(k); q.onsuccess = () => ok(q.result); q.onerror = () => ok(undefined); }); } catch { return undefined; } },
    async gravar(k, v) { try { const d = await abrir(); await new Promise(ok => { const t = d.transaction('vetores', 'readwrite'); t.objectStore('vetores').put(v, k); t.oncomplete = ok; t.onerror = ok; }); } catch {} },
  };
})();
async function vetorizar(textos) {
  const out = await MINI.extrator(textos, { pooling: 'mean', normalize: true });
  return out.tolist().map(v => Float32Array.from(v));
}
async function ligarMiniModelo() {
  if (MINI.estado === 'a carregar' || MINI.estado === 'a preparar' || MINI.estado === 'pronto') return;
  MINI.estado = 'a carregar'; MINI.progresso = 0; desenharMiniEstado();
  try {
    const { pipeline, env } = await import(MINI.url);
    env.allowLocalModels = false;
    const partes = {};
    MINI.extrator = await pipeline('feature-extraction', MINI.modelo, {
      dtype: 'q8',
      progress_callback: p => {
        if (p.status === 'progress' && p.total) { partes[p.file] = [p.loaded, p.total]; const v = Object.values(partes); MINI.progresso = 100 * v.reduce((s, x) => s + x[0], 0) / v.reduce((s, x) => s + x[1], 0); desenharMiniEstado(); }
      },
    });
    const { linhas } = await fetch('/api/letras').then(r => r.json());
    MINI.linhas = linhas; MINI.vetores = []; MINI.estado = 'a preparar'; desenharMiniEstado();
    const falta = [];
    for (const l of linhas) {
      const v = await idb.ler(MINI.modelo + '|' + l.texto);
      if (v) MINI.vetores.push(v); else { MINI.vetores.push(null); falta.push(MINI.vetores.length - 1); }
    }
    for (let k = 0; k < falta.length; k += 16) {
      const bloco = falta.slice(k, k + 16);
      const vs = await vetorizar(bloco.map(i => linhas[i].texto));
      bloco.forEach((i, j) => { MINI.vetores[i] = vs[j]; idb.gravar(MINI.modelo + '|' + linhas[i].texto, vs[j]); });
      desenharMiniEstado();
    }
    MINI.estado = 'pronto';
  } catch (e) {
    MINI.estado = 'falhou'; MINI.erro = String(e.message || e).slice(0, 80);
    try { localStorage.removeItem('som-mini'); } catch {}
  }
  desenharMiniEstado();
}
async function reordenarComMini(q, doServidor) {
  const [qv] = await vetorizar([q]);
  const palavras = new Map(doServidor.map(r => [r.id + '|' + r.inicio, r.palavras || 0]));
  const tudo = MINI.linhas.map((l, i) => {
    const v = MINI.vetores[i]; let cos = 0;
    if (v) for (let k = 0; k < v.length; k++) cos += v[k] * qv[k];
    const pal = palavras.get(l.id + '|' + l.inicio) || 0;
    const sem = Math.max(0, Math.min(1, (cos - 0.25) / 0.5));       // igual ao servidor
    return { l, cos: sem, pal, total: 0.55 * sem + 0.45 * pal };
  }).sort((a, b) => b.total - a.total);
  const porMusica = new Map(), out = [];
  for (const x of tudo) {
    const f = porId.get(x.l.id);
    if (!f || (porMusica.get(x.l.id) || 0) >= 2 || x.total < 0.08) continue;
    porMusica.set(x.l.id, (porMusica.get(x.l.id) || 0) + 1);
    out.push({ musica: f.titulo, linha: x.l.texto, inicio: x.l.inicio, fim: x.l.fim, id: x.l.id, pontuacao: Math.round(x.total * 1000) / 1000, palavras: x.pal, sentido: Math.round(x.cos * 1000) / 1000 });
    if (out.length >= 8) break;
  }
  return out;
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
carregar().catch(() => { $('#lista').innerHTML = '<p class="vazio"><em>Sem ligação.</em>Não consegui falar com o servidor.</p>'; });
