// Som — servidor de música caseiro. Sem dependências: só Node 18+.
// - Lê a pasta MUSICA (etiquetas ID3, capa embutida, duração) e serve a app web em /.
// - Fala a API Subsonic em /rest/*, para apps Android/iOS (Symfonium, Substreamer, Tempo, Ultrasonic…)
//   usarem a mesma biblioteca, playlists e favoritas.
// - Guarda playlists, favoritas e fila em dados/estado.json (partilhado entre a web e as apps).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 4560);
const HOST = process.env.HOST || '127.0.0.1'; // só a própria máquina: o Tailscale serve faz a ponte
const MUSICA = path.resolve(process.env.MUSICA || path.join(__dirname, 'musica'));
const DADOS = path.join(__dirname, 'dados');
const PUBLIC = path.join(__dirname, 'public');
const LETRAS = path.join(DADOS, 'letras');
const PYTHON = process.env.SOM_PYTHON || 'python';
// Senha da API Subsonic. Sem SOM_SENHA aceita qualquer senha: a proteção é o Tailscale (só os teus aparelhos chegam cá).
const SENHA = process.env.SOM_SENHA || '';
const EXT = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.webm': 'audio/webm' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.apk': 'application/vnd.android.package-archive' };

fs.mkdirSync(DADOS, { recursive: true });
fs.mkdirSync(LETRAS, { recursive: true });
fs.mkdirSync(MUSICA, { recursive: true });

// =====================================================================
// Leitura dos ficheiros: etiquetas ID3v2, capa (APIC) e duração do mp3
// =====================================================================
function lerID3(ficheiro) {
  const out = { tamanhoTag: 0 };
  try {
    const fd = fs.openSync(ficheiro, 'r');
    const cab = Buffer.alloc(10);
    fs.readSync(fd, cab, 0, 10, 0);
    if (cab.toString('latin1', 0, 3) !== 'ID3') { fs.closeSync(fd); return out; }
    const ver = cab[3];
    const tam = (cab[6] << 21) | (cab[7] << 14) | (cab[8] << 7) | cab[9];
    out.tamanhoTag = tam + 10;
    const buf = Buffer.alloc(Math.min(tam, 8 * 1024 * 1024));
    fs.readSync(fd, buf, 0, buf.length, 10);
    fs.closeSync(fd);
    let i = 0;
    while (i + 10 < buf.length) {
      const id = buf.toString('latin1', i, i + 4);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const t = ver === 4 ? (buf[i + 4] << 21) | (buf[i + 5] << 14) | (buf[i + 6] << 7) | buf[i + 7] : buf.readUInt32BE(i + 4);
      if (t <= 0 || i + 10 + t > buf.length) break;
      const d = buf.subarray(i + 10, i + 10 + t);
      const texto = () => {
        const enc = d[0];
        let s;
        if (enc === 1 || enc === 2) {
          let b = Buffer.from(d.subarray(1));
          if (enc === 1 && b[0] === 0xfe) b.swap16();
          s = b.toString('utf16le');
        } else s = d.subarray(1).toString(enc === 3 ? 'utf8' : 'latin1');
        return s.replace(/﻿|\u0000/g, '').trim();
      };
      const campo = { TIT2: 'titulo', TPE1: 'artista', TALB: 'album', TRCK: 'faixa', TYER: 'ano', TDRC: 'ano', TCON: 'genero' }[id];
      if (campo) { const s = texto(); if (s) out[campo] = s; }
      if (id === 'APIC' && !out.capa) {
        // enc(1) mime\0 tipo(1) descrição\0 dados
        const enc = d[0];
        let p = d.indexOf(0, 1);
        const mime = d.toString('latin1', 1, p) || 'image/jpeg';
        p += 2;
        if (enc === 1 || enc === 2) { while (p + 1 < d.length && !(d[p] === 0 && d[p + 1] === 0)) p += 2; p += 2; }
        else { while (p < d.length && d[p] !== 0) p++; p++; }
        out.capa = { posicao: 10 + i + 10 + p, tamanho: d.length - p, mime: mime.includes('/') ? mime : 'image/' + mime.toLowerCase() };
      }
      i += 10 + t;
    }
  } catch {}
  return out;
}

const BITRATES = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
const AMOSTRAS = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
function duracaoMp3(ficheiro, inicio, tamanhoFicheiro) {
  try {
    const fd = fs.openSync(ficheiro, 'r');
    const buf = Buffer.alloc(16 * 1024);
    const lidos = fs.readSync(fd, buf, 0, buf.length, inicio);
    fs.closeSync(fd);
    for (let i = 0; i + 4 < lidos; i++) {
      if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;
      const versao = (buf[i + 1] >> 3) & 3;           // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
      const camada = (buf[i + 1] >> 1) & 3;           // 1 = Layer III
      if (versao === 1 || camada !== 1) continue;
      const kbps = BITRATES[versao === 3 ? 1 : 2][buf[i + 2] >> 4];
      const hz = AMOSTRAS[versao]?.[(buf[i + 2] >> 2) & 3];
      if (!kbps || !hz) continue;
      const mono = (buf[i + 3] >> 6) === 3;
      const porFrame = versao === 3 ? 1152 : 576;
      // cabeçalho Xing/Info (VBR) dá o número exato de frames
      const off = i + 4 + (versao === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17));
      const marca = buf.toString('latin1', off, off + 4);
      if ((marca === 'Xing' || marca === 'Info') && (buf.readUInt32BE(off + 4) & 1)) {
        return Math.round(buf.readUInt32BE(off + 8) * porFrame / hz);
      }
      return Math.round((tamanhoFicheiro - inicio - i) * 8 / (kbps * 1000));
    }
  } catch {}
  return 0;
}

// =====================================================================
// Biblioteca
// =====================================================================
let biblioteca = [];
const porId = new Map();
let artistas = new Map(); // id -> { id, nome, albuns: Set }
let albuns = new Map();   // id -> { id, nome, artista, artistaId, faixas: [] }
let ultimaVarredura = 0;
const hash = (s, n = 12) => crypto.createHash('sha1').update(s).digest('hex').slice(0, n);

function varrer() {
  const lista = [];
  (function andar(dir) {
    let entradas = [];
    try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entradas) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { andar(p); continue; }
      const ext = path.extname(e.name).toLowerCase();
      if (!EXT[ext]) continue;
      const rel = path.relative(MUSICA, p).split(path.sep).join('/');
      const nome = path.basename(e.name, ext);
      const st = fs.statSync(p);
      const letraTxt = p.slice(0, -ext.length) + '.letra.txt';     // letra escrita por nós, ao lado do áudio
      const tags = ext === '.mp3' ? lerID3(p) : {};
      const [a, ...r] = nome.split(' - ');           // «Artista - Título.mp3» quando não há etiquetas
      const pasta = path.dirname(rel) === '.' ? '' : path.dirname(rel);
      const artista = tags.artista || (r.length ? a.trim() : '') || 'Desconhecido';
      const album = tags.album || pasta || 'Soltas';
      lista.push({
        id: hash(rel), ficheiro: rel, pasta, sufixo: ext.slice(1), tipo: EXT[ext], tamanho: st.size,
        titulo: tags.titulo || (r.length ? r.join(' - ').trim() : nome),
        artista, album, ano: parseInt(tags.ano) || undefined, faixa: parseInt(tags.faixa) || undefined, genero: tags.genero,
        duracao: ext === '.mp3' ? duracaoMp3(p, tags.tamanhoTag || 0, st.size) : 0,
        capa: tags.capa || null,
        artistaId: 'ar-' + hash(artista.toLowerCase(), 10),
        albumId: 'al-' + hash((album + '|' + (tags.album ? artista : pasta)).toLowerCase(), 10),
        adicionada: st.mtimeMs,
        letraTxt: fs.existsSync(letraTxt) ? letraTxt : null,
      });
    }
  })(MUSICA);
  lista.sort((x, y) => (x.artista + x.titulo).localeCompare(y.artista + y.titulo, 'pt'));
  biblioteca = lista;
  porId.clear(); artistas = new Map(); albuns = new Map();
  for (const m of lista) {
    porId.set(m.id, m);
    if (!artistas.has(m.artistaId)) artistas.set(m.artistaId, { id: m.artistaId, nome: m.artista, albuns: new Set() });
    artistas.get(m.artistaId).albuns.add(m.albumId);
    if (!albuns.has(m.albumId)) albuns.set(m.albumId, { id: m.albumId, nome: m.album, artista: m.artista, artistaId: m.artistaId, faixas: [], criado: m.adicionada });
    const al = albuns.get(m.albumId);
    al.faixas.push(m);
    if (al.artista !== m.artista) al.artista = 'Vários';
    al.criado = Math.max(al.criado, m.adicionada);
  }
  for (const al of albuns.values()) al.faixas.sort((x, y) => (x.faixa || 999) - (y.faixa || 999) || x.titulo.localeCompare(y.titulo, 'pt'));
  ultimaVarredura = Date.now();
  console.log(`[som] ${lista.length} faixas, ${albuns.size} álbuns em ${MUSICA}`);
  carregarLetras();
  enfileirarLetras();
}

// =====================================================================
// Capas geradas (PNG sem dependências): um sol sobre fundo da cor da marca
// =====================================================================
const CORES = [['#FFC53D', '#FFF1C9'], ['#E7DECD', '#147A53'], ['#147A53', '#FFC53D'], ['#F2ECE1', '#FFC53D'], ['#27231D', '#FFC53D'], ['#174C3B', '#F2ECE1']];
const corDe = txt => { let h = 0; for (const c of String(txt)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return CORES[h % CORES.length]; };
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(b) { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function bloco(tipo, dados) {
  const t = Buffer.from(tipo, 'latin1'), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(dados.length); crc.writeUInt32BE(crc32(Buffer.concat([t, dados])));
  return Buffer.concat([len, t, dados, crc]);
}
const cacheCapas = new Map();
function capaGerada(chave, lado = 300) {
  const k = chave + '|' + lado;
  if (cacheCapas.has(k)) return cacheCapas.get(k);
  const [fundo, sol] = corDe(chave).map(rgb);
  const h = parseInt(hash(chave, 4), 16);
  const cx = lado * (0.35 + (h % 30) / 100), cy = lado * (0.38 + ((h >> 5) % 25) / 100), r = lado * (0.22 + ((h >> 9) % 10) / 100);
  const raw = Buffer.alloc((lado * 3 + 1) * lado);
  for (let y = 0; y < lado; y++) {
    const o = y * (lado * 3 + 1);
    raw[o] = 0;
    for (let x = 0; x < lado; x++) {
      const dist = Math.hypot(x - cx, y - cy);
      const a = Math.max(0, Math.min(1, r - dist + 0.5));           // borda suave
      const halo = Math.max(0, 1 - (dist - r) / (r * 1.6)) * 0.18;  // brilho à volta
      const m = Math.min(1, a + (a < 1 ? halo : 0));
      for (let c = 0; c < 3; c++) raw[o + 1 + x * 3 + c] = Math.round(fundo[c] * (1 - m) + sol[c] * m);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0); ihdr.writeUInt32BE(lado, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco('IHDR', ihdr), bloco('IDAT', zlib.deflateSync(raw)), bloco('IEND', Buffer.alloc(0))]);
  if (cacheCapas.size > 300) cacheCapas.clear();
  cacheCapas.set(k, png);
  return png;
}
function servirCapa(res, id, lado) {
  lado = Math.max(32, Math.min(600, Number(lado) || 300));
  const f = porId.get(id) || albuns.get(id)?.faixas[0];
  const cab = { 'Cache-Control': 'public, max-age=86400' };
  if (f?.capa) {
    try {
      const fd = fs.openSync(path.join(MUSICA, f.ficheiro), 'r');
      const b = Buffer.alloc(f.capa.tamanho);
      fs.readSync(fd, b, 0, b.length, f.capa.posicao);
      fs.closeSync(fd);
      res.writeHead(200, { ...cab, 'Content-Type': f.capa.mime });
      return res.end(b);
    } catch {}
  }
  const chave = f ? f.album : (id.startsWith('pl-') ? id : (artistas.get(id)?.nome || id));
  res.writeHead(200, { ...cab, 'Content-Type': 'image/png' });
  res.end(capaGerada(chave, lado));
}

// =====================================================================
// Estado partilhado (playlists, favoritas, fila, onde ia)
// =====================================================================
const FICH_ESTADO = path.join(DADOS, 'estado.json');
function lerEstado() {
  try { return JSON.parse(fs.readFileSync(FICH_ESTADO, 'utf8')); }
  catch { return { playlists: [], favoritas: [], ordem: [], proximas: [], atual: null, posicao: 0, atualizado: 0 }; }
}
function gravarEstado(e) {
  const tmp = FICH_ESTADO + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(e, null, 1));
  fs.renameSync(tmp, FICH_ESTADO);
}
function mudarEstado(fn) { const e = lerEstado(); fn(e); e.atualizado = Date.now(); gravarEstado(e); return e; }

// =====================================================================
// API Subsonic (subconjunto que as apps usam)
// =====================================================================
const VERSAO_API = '1.16.1';
function xml(nome, v) {
  const at = [], filhos = [];
  const escx = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  for (const [k, x] of Object.entries(v || {})) {
    if (x === undefined || x === null) continue;
    if (Array.isArray(x)) for (const item of x) filhos.push(typeof item === 'object' ? xml(k, item) : `<${k}>${escx(item)}</${k}>`);
    else if (typeof x === 'object') filhos.push(xml(k, x));
    else if (k === 'value') filhos.push(escx(x));
    else at.push(`${k}="${escx(x)}"`);
  }
  return `<${nome}${at.length ? ' ' + at.join(' ') : ''}${filhos.length ? `>${filhos.join('')}</${nome}>` : '/>'}`;
}
function responder(res, q, corpo = {}, erro = null) {
  const base = { status: erro ? 'failed' : 'ok', version: VERSAO_API, type: 'som', serverVersion: '1.0', openSubsonic: true, ...(erro ? { error: erro } : corpo) };
  const f = q.get('f');
  if (f === 'json' || f === 'jsonp') {
    const txt = JSON.stringify({ 'subsonic-response': base });
    const cb = q.get('callback');
    res.writeHead(200, { 'Content-Type': f === 'jsonp' ? 'text/javascript' : 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    return res.end(f === 'jsonp' && cb ? `${cb}(${txt})` : txt);
  }
  res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end('<?xml version="1.0" encoding="UTF-8"?>' + xml('subsonic-response', { xmlns: 'http://subsonic.org/restapi', ...base }));
}
const iso = ms => new Date(ms || Date.now()).toISOString();
function songJ(f, est) {
  const fav = est.favoritas.includes(f.id);
  return {
    id: f.id, parent: f.albumId, isDir: false, title: f.titulo, album: f.album, artist: f.artista, track: f.faixa, year: f.ano, genre: f.genero,
    coverArt: f.capa ? f.id : f.albumId, size: f.tamanho, contentType: f.tipo, suffix: f.sufixo, duration: f.duracao,
    bitRate: f.duracao ? Math.round(f.tamanho * 8 / f.duracao / 1000) : undefined, path: f.ficheiro, albumId: f.albumId, artistId: f.artistaId,
    type: 'music', mediaType: 'song', created: iso(f.adicionada), starred: fav ? iso(est.atualizado) : undefined,
  };
}
function albumJ(al, est, comFaixas = false) {
  const j = {
    id: al.id, name: al.nome, title: al.nome, album: al.nome, artist: al.artista, artistId: al.artistaId, coverArt: al.id, isDir: true, parent: al.artistaId,
    songCount: al.faixas.length, duration: al.faixas.reduce((s, f) => s + (f.duracao || 0), 0), created: iso(al.criado),
    year: al.faixas.find(f => f.ano)?.ano, genre: al.faixas.find(f => f.genero)?.genero,
  };
  if (comFaixas) j.song = al.faixas.map(f => songJ(f, est));
  return j;
}
function artistaJ(ar) { return { id: ar.id, name: ar.nome, albumCount: ar.albuns.size, coverArt: ar.id }; }
function playlistJ(p, est, comFaixas = false) {
  const fs_ = p.faixas.map(id => porId.get(id)).filter(Boolean);
  const j = { id: 'pl-' + p.id, name: p.nome, owner: 'jaime', public: false, songCount: fs_.length, duration: fs_.reduce((s, f) => s + (f.duracao || 0), 0),
    created: iso(parseInt(p.id, 36) || 0), changed: iso(est.atualizado), coverArt: fs_[0] ? fs_[0].albumId : 'pl-' + p.id };
  if (comFaixas) j.entry = fs_.map(f => songJ(f, est));
  return j;
}
function indice(lista, nomeDe) {
  const grupos = {};
  for (const x of lista) {
    let l = (nomeDe(x)[0] || '#').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!/[A-Z]/.test(l)) l = '#';
    (grupos[l] ||= []).push(x);
  }
  return Object.keys(grupos).sort().map(l => ({ name: l, artist: grupos[l].map(artistaJ) }));
}
const baralhar = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sem = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function autenticado(q) {
  if (!SENHA) return true;
  const p = q.get('p'), t = q.get('t'), s = q.get('s');
  if (p) return (p.startsWith('enc:') ? Buffer.from(p.slice(4), 'hex').toString() : p) === SENHA;
  if (t && s) return crypto.createHash('md5').update(SENHA + s).digest('hex') === t.toLowerCase();
  return false;
}

function subsonic(req, res, metodo, q) {
  if (!autenticado(q)) return responder(res, q, {}, { code: 40, message: 'Senha errada' });
  const est = lerEstado();
  const id = q.get('id');
  const n = (k, def) => { const v = parseInt(q.get(k)); return isNaN(v) ? def : v; };
  switch (metodo) {
    case 'ping': return responder(res, q);
    case 'getLicense': return responder(res, q, { license: { valid: true, email: 'som@casa', licenseExpires: '2099-12-31T00:00:00.000Z' } });
    case 'getOpenSubsonicExtensions': return responder(res, q, { openSubsonicExtensions: [] });
    case 'getUser': return responder(res, q, { user: { username: q.get('username') || 'jaime', scrobblingEnabled: false, adminRole: true, settingsRole: true, downloadRole: true, uploadRole: false,
      playlistRole: true, coverArtRole: true, commentRole: false, podcastRole: false, streamRole: true, jukeboxRole: false, shareRole: false, folder: [1] } });
    case 'getMusicFolders': return responder(res, q, { musicFolders: { musicFolder: [{ id: 1, name: 'Música' }] } });
    case 'getScanStatus': return responder(res, q, { scanStatus: { scanning: false, count: biblioteca.length } });
    case 'startScan': varrer(); return responder(res, q, { scanStatus: { scanning: false, count: biblioteca.length } });
    case 'getGenres': {
      const g = {};
      for (const f of biblioteca) if (f.genero) (g[f.genero] ||= { value: f.genero, songCount: 0, albumCount: new Set() }), g[f.genero].songCount++, g[f.genero].albumCount.add(f.albumId);
      return responder(res, q, { genres: { genre: Object.values(g).map(x => ({ ...x, albumCount: x.albumCount.size })) } });
    }
    case 'getIndexes':
    case 'getArtists': {
      const lista = [...artistas.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
      const chave = metodo === 'getArtists' ? 'artists' : 'indexes';
      return responder(res, q, { [chave]: { ignoredArticles: '', lastModified: ultimaVarredura, index: indice(lista, a => a.nome) } });
    }
    case 'getArtist': {
      const ar = artistas.get(id);
      if (!ar) return responder(res, q, {}, { code: 70, message: 'Artista não encontrado' });
      return responder(res, q, { artist: { ...artistaJ(ar), album: [...ar.albuns].map(a => albumJ(albuns.get(a), est)) } });
    }
    case 'getArtistInfo': case 'getArtistInfo2': return responder(res, q, { [metodo === 'getArtistInfo' ? 'artistInfo' : 'artistInfo2']: { similarArtist: [] } });
    case 'getAlbumInfo': case 'getAlbumInfo2': return responder(res, q, { albumInfo: {} });
    case 'getAlbum': {
      const al = albuns.get(id);
      if (!al) return responder(res, q, {}, { code: 70, message: 'Álbum não encontrado' });
      return responder(res, q, { album: albumJ(al, est, true) });
    }
    case 'getSong': {
      const f = porId.get(id);
      if (!f) return responder(res, q, {}, { code: 70, message: 'Música não encontrada' });
      return responder(res, q, { song: songJ(f, est) });
    }
    case 'getMusicDirectory': {
      if (artistas.has(id)) { const ar = artistas.get(id); return responder(res, q, { directory: { id, name: ar.nome, child: [...ar.albuns].map(a => albumJ(albuns.get(a), est)) } }); }
      if (albuns.has(id)) { const al = albuns.get(id); return responder(res, q, { directory: { id, name: al.nome, parent: al.artistaId, child: al.faixas.map(f => songJ(f, est)) } }); }
      return responder(res, q, {}, { code: 70, message: 'Pasta não encontrada' });
    }
    case 'getAlbumList':
    case 'getAlbumList2': {
      let l = [...albuns.values()];
      const tipo = q.get('type') || 'alphabeticalByName';
      if (tipo === 'random') l = baralhar(l);
      else if (tipo === 'newest' || tipo === 'recent') l.sort((a, b) => b.criado - a.criado);
      else if (tipo === 'alphabeticalByArtist') l.sort((a, b) => a.artista.localeCompare(b.artista, 'pt'));
      else if (tipo === 'starred') l = l.filter(a => a.faixas.some(f => est.favoritas.includes(f.id)));
      else if (tipo === 'byGenre') l = l.filter(a => a.faixas.some(f => f.genero === q.get('genre')));
      else l.sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
      l = l.slice(n('offset', 0), n('offset', 0) + Math.min(n('size', 10), 500));
      return responder(res, q, { [metodo === 'getAlbumList' ? 'albumList' : 'albumList2']: { album: l.map(a => albumJ(a, est)) } });
    }
    case 'getRandomSongs': return responder(res, q, { randomSongs: { song: baralhar(biblioteca).slice(0, Math.min(n('size', 10), 500)).map(f => songJ(f, est)) } });
    case 'getSongsByGenre': return responder(res, q, { songsByGenre: { song: biblioteca.filter(f => f.genero === q.get('genre')).map(f => songJ(f, est)) } });
    case 'getStarred':
    case 'getStarred2': {
      const song = est.favoritas.map(i => porId.get(i)).filter(Boolean).map(f => songJ(f, est));
      return responder(res, q, { [metodo === 'getStarred' ? 'starred' : 'starred2']: { artist: [], album: [], song } });
    }
    case 'star':
    case 'unstar': {
      const ids = [...q.getAll('id')].filter(i => porId.has(i));
      for (const a of q.getAll('albumId')) albuns.get(a)?.faixas.forEach(f => ids.push(f.id));
      mudarEstado(e => {
        for (const i of ids) {
          const k = e.favoritas.indexOf(i);
          if (metodo === 'star' && k < 0) e.favoritas.unshift(i);
          if (metodo === 'unstar' && k >= 0) e.favoritas.splice(k, 1);
        }
      });
      return responder(res, q);
    }
    case 'search':
    case 'search2':
    case 'search3': {
      const termo = sem((q.get('query') || '').replace(/"/g, '').replace(/\*$/, ''));
      const bate = s => !termo || sem(s).includes(termo);
      const corta = (l, k) => l.slice(n(k + 'Offset', 0), n(k + 'Offset', 0) + n(k + 'Count', 20));
      const artist = corta([...artistas.values()].filter(a => bate(a.nome)), 'artist').map(artistaJ);
      const album = corta([...albuns.values()].filter(a => bate(a.nome + ' ' + a.artista)), 'album').map(a => albumJ(a, est));
      const song = corta(biblioteca.filter(f => bate(`${f.titulo} ${f.artista} ${f.album}`)), 'song').map(f => songJ(f, est));
      return responder(res, q, { [metodo === 'search3' ? 'searchResult3' : 'searchResult2']: { artist, album, song } });
    }
    case 'getPlaylists': return responder(res, q, { playlists: { playlist: est.playlists.map(p => playlistJ(p, est)) } });
    case 'getPlaylist': {
      const p = est.playlists.find(x => 'pl-' + x.id === id);
      if (!p) return responder(res, q, {}, { code: 70, message: 'Playlist não encontrada' });
      return responder(res, q, { playlist: playlistJ(p, est, true) });
    }
    case 'createPlaylist': {
      const ids = q.getAll('songId').filter(i => porId.has(i));
      let alvo;
      const e = mudarEstado(e => {
        const existente = q.get('playlistId') && e.playlists.find(x => 'pl-' + x.id === q.get('playlistId'));
        if (existente) { existente.faixas = ids; if (q.get('name')) existente.nome = q.get('name'); alvo = existente; }
        else { alvo = { id: Date.now().toString(36), nome: q.get('name') || 'Nova playlist', faixas: ids }; e.playlists.unshift(alvo); }
      });
      return responder(res, q, { playlist: playlistJ(alvo, e, true) });
    }
    case 'updatePlaylist': {
      let ok = false;
      mudarEstado(e => {
        const p = e.playlists.find(x => 'pl-' + x.id === q.get('playlistId'));
        if (!p) return;
        ok = true;
        if (q.get('name')) p.nome = q.get('name');
        const tirar = new Set(q.getAll('songIndexToRemove').map(Number));
        p.faixas = p.faixas.filter((_, i) => !tirar.has(i));
        for (const s of q.getAll('songIdToAdd')) if (porId.has(s)) p.faixas.push(s);
      });
      return ok ? responder(res, q) : responder(res, q, {}, { code: 70, message: 'Playlist não encontrada' });
    }
    case 'deletePlaylist': mudarEstado(e => { e.playlists = e.playlists.filter(x => 'pl-' + x.id !== id); }); return responder(res, q);
    case 'getPlayQueue': {
      const ids = est.ordem?.length ? est.ordem : [];
      return responder(res, q, { playQueue: { current: est.atual || undefined, position: Math.round((est.posicao || 0) * 1000), username: 'jaime', changed: iso(est.atualizado), changedBy: 'som',
        entry: ids.map(i => porId.get(i)).filter(Boolean).map(f => songJ(f, est)) } });
    }
    case 'savePlayQueue': {
      const ids = q.getAll('id').filter(i => porId.has(i));
      mudarEstado(e => {
        e.ordem = ids; e.proximas = []; e.atual = q.get('current') || ids[0] || null;
        e.idx = Math.max(0, ids.indexOf(e.atual)); e.posicao = n('position', 0) / 1000;
        e.contexto = { tipo: 'app', nome: 'a app do telemóvel', base: ids };
      });
      return responder(res, q);
    }
    case 'scrobble': case 'setRating': return responder(res, q);
    case 'getNowPlaying': return responder(res, q, { nowPlaying: { entry: [] } });
    case 'getLyrics': {
      const f = biblioteca.find(x => sem(x.titulo) === sem(q.get('title')) && (!q.get('artist') || sem(x.artista) === sem(q.get('artist'))));
      const j = f && letras.get(f.id);
      if (!j || !j.linhas?.length) return responder(res, q, { lyrics: {} });
      return responder(res, q, { lyrics: { artist: f.artista, title: f.titulo, value: j.linhas.map(l => l.texto).join('\n') } });
    }
    case 'getLyricsBySongId': {
      const f = porId.get(id), j = letras.get(id);
      if (!f || !j || !j.linhas?.length) return responder(res, q, { lyricsList: { structuredLyrics: [] } });
      return responder(res, q, { lyricsList: { structuredLyrics: [{ lang: j.idioma || 'xxx', synced: true, displayArtist: f.artista, displayTitle: f.titulo,
        line: j.linhas.map(l => ({ start: Math.round(l.inicio * 1000), value: l.texto })) }] } });
    }
    case 'getSimilarSongs': case 'getSimilarSongs2': {
      const f = porId.get(id) || [...albuns.values()].find(a => a.artistaId === id)?.faixas[0];
      const l = baralhar(biblioteca.filter(x => !f || x.albumId === f.albumId || x.artistaId === f.artistaId)).slice(0, n('count', 50));
      return responder(res, q, { [metodo === 'getSimilarSongs' ? 'similarSongs' : 'similarSongs2']: { song: l.map(x => songJ(x, est)) } });
    }
    case 'getTopSongs': return responder(res, q, { topSongs: { song: biblioteca.filter(f => sem(f.artista) === sem(q.get('artist'))).map(f => songJ(f, est)) } });
    case 'getBookmarks': return responder(res, q, { bookmarks: { bookmark: [] } });
    case 'getInternetRadioStations': return responder(res, q, { internetRadioStations: { internetRadioStation: [] } });
    case 'getPodcasts': return responder(res, q, { podcasts: { channel: [] } });
    case 'getNewestPodcasts': return responder(res, q, { newestPodcasts: { episode: [] } });
    case 'getShares': return responder(res, q, { shares: { share: [] } });
    case 'stream':
    case 'download': {
      const f = porId.get(id);
      return f ? servirAudio(req, res, f) : responder(res, q, {}, { code: 70, message: 'Música não encontrada' });
    }
    case 'getCoverArt': return servirCapa(res, id || '', q.get('size'));
    case 'getAvatar': res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(capaGerada('jaime', 120));
    default: return responder(res, q, {}, { code: 0, message: `Ainda não sei fazer «${metodo}»` });
  }
}

// =====================================================================
// Letras: o letras.py (Whisper, neste PC) escreve-as em dados/letras/<id>.json,
// uma música de cada vez, em segundo plano. Se já existe, não volta a gerar.
// =====================================================================
const letras = new Map();          // id -> { instrumental, fonte, idioma, linhas: [{ inicio, fim, texto }] }
const filaLetras = [];
let aEscrever = null, semPython = false;
const tentativas = new Map();
const ficheiroLetra = id => path.join(LETRAS, id + '.json');
function carregarLetras() {
  for (const f of biblioteca) {
    if (letras.has(f.id)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(ficheiroLetra(f.id), 'utf8'));
      if (f.letraTxt && !j.letraNossa) continue;   // apareceu a letra escrita por nós: refaz com ela
      letras.set(f.id, j);
    } catch {}
  }
  momentoSujo = true;
}
function enfileirarLetras() {
  const falta = biblioteca.filter(f => !letras.has(f.id) && f.id !== aEscrever && !filaLetras.includes(f.id) && (tentativas.get(f.id) || 0) < 2);
  falta.sort((a, b) => (b.letraTxt ? 1 : 0) - (a.letraTxt ? 1 : 0));   // primeiro as nossas (com letra escrita)
  filaLetras.push(...falta.map(f => f.id));
  proximaLetra();
}
function proximaLetra() {
  if (aEscrever || semPython || !filaLetras.length || process.env.SOM_SEM_LETRAS === '1') return;
  const id = filaLetras.shift();
  const f = porId.get(id);
  if (!f || letras.has(id)) return proximaLetra();
  aEscrever = id;
  const saida = ficheiroLetra(id);
  const args = [path.join(__dirname, 'letras.py'), path.join(MUSICA, f.ficheiro), saida, '--titulo', f.titulo];
  if (f.letraTxt) args.push('--letra', f.letraTxt);
  const t0 = Date.now();
  let erro = '', acabou = false;
  const p = spawn(PYTHON, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', HF_HUB_DISABLE_SYMLINKS_WARNING: '1' } });
  p.stdout.on('data', () => {});
  p.stderr.on('data', d => { erro = (erro + d).slice(-3000); });
  const relogio = setTimeout(() => p.kill(), 15 * 60 * 1000);
  const fim = () => {
    if (acabou) return;
    acabou = true; clearTimeout(relogio); aEscrever = null;
    // o que conta é o ficheiro: o Python com CUDA às vezes sai com erro já depois de o gravar
    try {
      const j = JSON.parse(fs.readFileSync(saida, 'utf8'));
      letras.set(id, j); momentoSujo = true;
      console.log(`[som] letra de «${f.titulo}»: ${j.instrumental ? 'instrumental' : j.linhas.length + ' linhas'} · ${Math.round((Date.now() - t0) / 1000)} s`);
    } catch {
      tentativas.set(id, (tentativas.get(id) || 0) + 1);
      const ultima = erro.trim().split('\n').filter(l => !/warn/i.test(l)).slice(-1)[0];
      console.log(`[som] não consegui a letra de «${f.titulo}»: ${ultima || 'sem detalhe'}`);
    }
    setTimeout(proximaLetra, 300);
  };
  p.on('error', e => {
    if (e.code === 'ENOENT') { semPython = true; console.log(`[som] não encontrei o Python («${PYTHON}»): sem letras automáticas. Define SOM_PYTHON.`); }
    fim();
  });
  p.on('close', fim);
}
const estadoLetra = id => letras.has(id) ? (letras.get(id).instrumental ? 'instrumental' : 'pronta')
  : aEscrever === id ? 'a escrever' : filaLetras.includes(id) ? 'na fila' : 'sem letra';

// =====================================================================
// Momento: descreves o momento numa frase e o Som encontra a linha de uma música nossa que encaixa.
// Duas formas de pontuar: palavras (BM25 leve, sem acentos, radicais PT e sinónimos simples) e,
// se o mini modelo do sentidos.py arrancar, sentido (embeddings multilingues a correr neste PC).
// =====================================================================
const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const VAZIAS = new Set(('a o e os as um uma uns umas de da do das dos em na no nas nos ao aos por para pra com sem que se me te lhe ' +
  'eu tu ele ela nos vos eles elas meu minha meus minhas teu tua seu sua isto isso aquilo este esta esse essa estamos estou esta estao ' +
  'ser estar ter tem tenho ha mais muito muita mas ou como quando onde ja nao sim vamos vou vai dia hoje agora so the and of to in is it on ' +
  'my me i you an at for with our we are this that').split(' '));
const SUFIXOS = ['amentos', 'imentos', 'amento', 'imento', 'adoras', 'adores', 'adora', 'ador', 'acoes', 'icoes', 'ancias', 'encias', 'idades',
  'mente', 'idade', 'ismos', 'istas', 'acao', 'icao', 'ancia', 'encia', 'ismo', 'ista', 'avel', 'ivel', 'inhos', 'inhas', 'inho', 'inha',
  'eiros', 'eiras', 'eiro', 'eira', 'ando', 'endo', 'indo', 'ados', 'adas', 'idos', 'idas', 'ado', 'ada', 'ido', 'ida', 'oes', 'aes',
  'ais', 'eis', 'ar', 'er', 'ir', 'as', 'es', 'os', 'am', 'em', 'a', 'e', 'o', 's'];
function radical(p) {
  for (const s of SUFIXOS) if (p.endsWith(s) && p.length - s.length >= 3) return p.slice(0, -s.length);
  return p;
}
const termos = txt => semAcento(txt).replace(/-/g, '').split(/[^a-z0-9]+/).filter(w => w && !VAZIAS.has(w)).map(radical);
// grupos de palavras que andam juntas: qualquer uma puxa as outras (com metade do peso)
const GRUPOS = [
  'banana bananas fruta descascar casca maca laranja lanche mercado banca horta fresquinho comer',
  'comer comida almoco jantar pao tacho ferver mesa restaurante cozinha cozinhar fome alecrim peixe sardinha polvo cheira',
  'praia mar areia onda ondas verao ferias ria barco traineira barra gaivota sol nadar banho algarve beach sea sun',
  'porta abrir aberta aberto abre abriu entrar entrada janela casa lugar door open',
  'terra horta semear semeia plantar regador sementes jardim campo cultivar cresce crescer flores maos mao',
  'cabelo cortar corte barbearia barba barbeiro mestre maquina tesoura pentear hair',
  'familia filhos miudos criancas netos neto avo avos pais geracoes brincar kids',
  'manha amanhecer acordar acorda cedo cedinho cafe despertar aurora luz morning',
  'noite dormir dormes sono cansado descansado estrelas deitar night sleep',
  'trabalho trabalhar agenda cliente clientes marcar reserva reservas telemovel whatsapp negocio loja work',
  'comecar ideia sonho projeto arrancar inspiracao mangas bora start',
  'festa dancar baile arraial palmas alegria cantar musica party dance',
  'tecer tecendo tecemos novelo fio trico tricotar la manta costura',
  'medico medica doutora doutor consulta clinica dentista lembrete saude',
  'peixe lota sardinha sardinhas polvo pescador pescar mercado banca fresquinho fish',
  'voar livre liberdade asas caixa fly free box',
  'jogo jogar joga game play brincar',
  'estrada viagem carro conduzir correr corro road',
  'calma devagar devagarinho relaxar descansar tranquilo paz calm',
  'pressa rapido correr stress aguento apitar',
].map(g => g.split(' ').map(w => radical(semAcento(w))));
const SINONIMOS = new Map();
for (const g of GRUPOS) for (const w of g) { if (!SINONIMOS.has(w)) SINONIMOS.set(w, new Set()); for (const o of g) if (o !== w) SINONIMOS.get(w).add(o); }

let momentoSujo = true, docs = [], df = new Map(), compMedio = 1;
function construirIndice() {
  docs = []; df = new Map();
  for (const f of biblioteca) {
    const j = letras.get(f.id);
    if (!j || j.instrumental || !j.linhas?.length) continue;
    const vistas = new Set();
    j.linhas.forEach((l, i) => {
      const chave = semAcento(l.texto).replace(/[^a-z0-9]/g, '');
      if (!chave || vistas.has(chave)) return;     // o refrão repetido conta uma vez (a 1.ª)
      if (l.texto.trim().split(/\s+/).length < 2) return;   // «Oh», «Descomplicai!»: sozinhas não dizem nada do momento
      vistas.add(chave);
      const t = [...termos(l.texto), ...termos(f.titulo)];
      const tf = new Map();
      for (const w of t) tf.set(w, (tf.get(w) || 0) + 1);
      for (const w of tf.keys()) df.set(w, (df.get(w) || 0) + 1);
      docs.push({ id: f.id, f, i, linha: l.texto, inicio: l.inicio, fim: l.fim, tf, n: t.length });
    });
  }
  compMedio = docs.reduce((s, d) => s + d.n, 0) / (docs.length || 1);
  momentoSujo = false;
  calcularVetores();
}
function bm25(d, pesos) {
  let s = 0;
  for (const [w, peso] of pesos) {
    const tf = d.tf.get(w);
    if (!tf) continue;
    const idf = Math.log(1 + (docs.length - df.get(w) + 0.5) / (df.get(w) + 0.5));
    s += peso * idf * (tf * 2.2) / (tf + 1.2 * (1 - 0.75 + 0.75 * d.n / compMedio));
  }
  return s;
}

// --- mini modelo de sentido (processo Python à parte; se falhar, fica só o BM25) ---
const FICH_VETORES = path.join(DADOS, 'vetores.json');
const sentidos = { proc: null, pronto: false, seq: 0, pedidos: new Map(), resto: '', modelo: '' };
let vetores = new Map();
try {
  const v = JSON.parse(fs.readFileSync(FICH_VETORES, 'utf8'));
  sentidos.modelo = v.modelo;
  vetores = new Map(Object.entries(v.vetores).map(([k, a]) => [k, Float32Array.from(a)]));
} catch {}
function ligarSentidos() {
  if (process.env.SOM_SEM_MODELO === '1' || semPython) return;
  const p = spawn(PYTHON, [path.join(__dirname, 'sentidos.py')], { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', HF_HUB_DISABLE_SYMLINKS_WARNING: '1' } });
  sentidos.proc = p;
  p.stderr.on('data', () => {});
  p.stdout.on('data', d => {
    sentidos.resto += d;
    let k;
    while ((k = sentidos.resto.indexOf('\n')) >= 0) {
      const linha = sentidos.resto.slice(0, k); sentidos.resto = sentidos.resto.slice(k + 1);
      let m; try { m = JSON.parse(linha); } catch { continue; }
      if (m.pronto) {
        if (sentidos.modelo && sentidos.modelo !== m.modelo) vetores.clear();
        sentidos.pronto = true; sentidos.modelo = m.modelo;
        console.log(`[som] mini modelo pronto (${m.modelo})`);
        calcularVetores();
      } else if (m.erro && m.id == null) console.log('[som] mini modelo:', m.erro);
      const pd = sentidos.pedidos.get(m.id);
      if (pd) { sentidos.pedidos.delete(m.id); m.erro ? pd.falha(new Error(m.erro)) : pd.ok(m.vetores); }
    }
  });
  p.on('error', () => {});
  p.on('close', () => {
    sentidos.pronto = false; sentidos.proc = null;
    for (const pd of sentidos.pedidos.values()) pd.falha(new Error('modelo fechou'));
    sentidos.pedidos.clear();
  });
}
function pedirVetores(textos, ms = 15000) {
  if (!sentidos.pronto) return Promise.reject(new Error('modelo desligado'));
  return new Promise((ok, falha) => {
    const id = ++sentidos.seq;
    const t = setTimeout(() => { sentidos.pedidos.delete(id); falha(new Error('modelo demorou')); }, ms);
    sentidos.pedidos.set(id, { ok: v => { clearTimeout(t); ok(v); }, falha: e => { clearTimeout(t); falha(e); } });
    sentidos.proc.stdin.write(JSON.stringify({ id, textos }) + '\n');
  });
}
let aVetorizar = false;
async function calcularVetores() {
  if (!sentidos.pronto || aVetorizar) return;
  const falta = [...new Set(docs.map(d => d.linha))].filter(t => !vetores.has(t));
  if (!falta.length) return;
  aVetorizar = true;
  try {
    const vs = await pedirVetores(falta, 180000);
    falta.forEach((t, i) => vetores.set(t, Float32Array.from(vs[i])));
    const obj = {};
    for (const [k, v] of vetores) obj[k] = Array.from(v, x => Math.round(x * 1e5) / 1e5);
    fs.writeFileSync(FICH_VETORES, JSON.stringify({ modelo: sentidos.modelo, vetores: obj }));
  } catch (e) { console.log('[som] vetores:', e.message); }
  aVetorizar = false;
  if (docs.some(d => !vetores.has(d.linha))) setTimeout(calcularVetores, 1000);
}
const cosseno = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

async function procurarMomento(texto, n = 8) {
  if (momentoSujo) construirIndice();
  const pesos = new Map();
  for (const w of termos(texto)) {
    pesos.set(w, 1);
    for (const o of SINONIMOS.get(w) || []) if (!pesos.has(o)) pesos.set(o, 0.5);
  }
  let qv = null;
  try { qv = Float32Array.from((await pedirVetores([texto], 8000))[0]); } catch {}
  const modo = qv ? 'palavras + mini modelo' : 'palavras';
  const cont = docs.map(d => {
    const b = bm25(d, pesos), bn = b / (b + 3);                       // 0..1, sem depender das outras linhas
    const v = qv && vetores.get(d.linha);
    // o cosseno deste modelo anda por 0,2–0,4 entre frases sem nada a ver: só conta o que passa disso
    const sem = v ? Math.max(0, Math.min(1, (cosseno(qv, v) - 0.25) / 0.5)) : null;
    const total = sem == null ? bn : 0.55 * sem + 0.45 * bn;
    return { d, b: bn, sem, total };
  }).filter(x => x.total > (qv ? 0.08 : 0.02)).sort((a, b) => b.total - a.total);
  const porMusica = new Map(), out = [];
  for (const x of cont) {
    const k = porMusica.get(x.d.id) || 0;
    if (k >= 2) continue;                                              // no máximo 2 linhas da mesma música
    porMusica.set(x.d.id, k + 1);
    out.push({ musica: x.d.f.titulo, linha: x.d.linha, inicio: x.d.inicio, fim: x.d.fim, pontuacao: Math.round(x.total * 1000) / 1000,
      id: x.d.id, artista: x.d.f.artista, album: x.d.f.album, audio: `/audio/${x.d.id}`,
      palavras: Math.round(x.b * 1000) / 1000, sentido: x.sem == null ? null : Math.round(x.sem * 1000) / 1000, modo });
    if (out.length >= n) break;
  }
  return out;
}

// =====================================================================
// HTTP
// =====================================================================
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function corpoTexto(req) {
  return new Promise((ok, falha) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 2e6) req.destroy(); });
    req.on('end', () => ok(d));
    req.on('error', falha);
  });
}
function servirAudio(req, res, faixa) {
  const p = path.join(MUSICA, faixa.ficheiro);
  let st;
  try { st = fs.statSync(p); } catch { return json(res, 404, { erro: 'ficheiro não encontrado' }); }
  const tipo = faixa.tipo || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let ini = m && m[1] ? Number(m[1]) : 0;
    let fim = m && m[2] ? Number(m[2]) : st.size - 1;
    if (m && !m[1] && m[2]) { ini = st.size - Number(m[2]); fim = st.size - 1; }
    if (ini >= st.size || ini > fim) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    fim = Math.min(fim, st.size - 1);
    res.writeHead(206, { 'Content-Type': tipo, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${ini}-${fim}/${st.size}`, 'Content-Length': fim - ini + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(p, { start: ini, end: fim }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': tipo, 'Accept-Ranges': 'bytes', 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(p).pipe(res);
}
function servirEstatico(res, url) {
  let rel = decodeURIComponent(url.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  const p = path.normalize(path.join(PUBLIC, rel));
  if (!p.startsWith(PUBLIC)) return json(res, 403, { erro: 'proibido' });
  fs.readFile(p, (err, data) => {
    if (err) return json(res, 404, { erro: 'não existe' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}
// a web recebe a biblioteca sem os detalhes internos
const paraWeb = f => ({ id: f.id, ficheiro: f.ficheiro, pasta: f.pasta, titulo: f.titulo, artista: f.artista, album: f.album, duracao: f.duracao, albumId: f.albumId, artistaId: f.artistaId, temCapa: !!f.capa, adicionada: f.adicionada, letra: estadoLetra(f.id) });

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://som');
  try {
    // Subsonic: /rest/metodo ou /rest/metodo.view, parâmetros na URL ou no corpo (POST)
    const sub = /^\/rest\/([A-Za-z0-9]+)(\.view)?$/.exec(u.pathname);
    if (sub) {
      const q = new URLSearchParams(u.search);
      if (req.method === 'POST') for (const [k, v] of new URLSearchParams(await corpoTexto(req))) q.append(k, v);
      return subsonic(req, res, sub[1], q);
    }
    if (u.pathname === '/api/biblioteca') return json(res, 200, biblioteca.map(paraWeb));
    if (u.pathname === '/api/varrer' && req.method === 'POST') { varrer(); return json(res, 200, { faixas: biblioteca.length }); }
    if (u.pathname === '/api/estado' && req.method === 'GET') return json(res, 200, lerEstado());
    if (u.pathname === '/api/estado' && req.method === 'PUT') {
      const novo = JSON.parse(await corpoTexto(req) || '{}');
      const atual = lerEstado();
      if ((novo.atualizado || 0) < (atual.atualizado || 0)) return json(res, 409, atual); // a escrita mais recente ganha
      gravarEstado(novo);
      return json(res, 200, novo);
    }
    if (u.pathname === '/api/momento') {
      const texto = (u.searchParams.get('q') || '').trim().slice(0, 300);
      const cab = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
      if (!texto) { res.writeHead(400, cab); return res.end(JSON.stringify({ erro: 'Falta a frase: /api/momento?q=estamos a descascar bananas' })); }
      const n = Math.max(1, Math.min(30, parseInt(u.searchParams.get('n')) || 8));
      res.writeHead(200, cab);
      return res.end(JSON.stringify(await procurarMomento(texto, n)));
    }
    if (u.pathname === '/api/letras') {
      if (momentoSujo) construirIndice();
      const feitas = biblioteca.filter(f => letras.has(f.id)).length;
      return json(res, 200, { total: biblioteca.length, feitas, naFila: filaLetras.length, aEscrever: porId.get(aEscrever)?.titulo || null,
        miniModelo: sentidos.pronto ? sentidos.modelo : null,
        linhas: docs.map(d => ({ id: d.id, i: d.i, texto: d.linha, inicio: d.inicio, fim: d.fim })) });
    }
    let m = /^\/api\/letra\/([0-9a-f]{12})$/.exec(u.pathname);
    if (m) {
      if (!porId.has(m[1])) return json(res, 404, { erro: 'faixa desconhecida' });
      return json(res, 200, { ...(letras.get(m[1]) || { linhas: [] }), estado: estadoLetra(m[1]) });
    }
    m = /^\/audio\/([0-9a-f]{12})$/.exec(u.pathname);
    if (m) { const f = porId.get(m[1]); return f ? servirAudio(req, res, f) : json(res, 404, { erro: 'faixa desconhecida' }); }
    m = /^\/capa\/([\w-]+)$/.exec(u.pathname);
    if (m) return servirCapa(res, m[1], u.searchParams.get('t'));
    if (u.pathname === '/creditos.txt') return servirEstaticoFicheiro(res, path.join(MUSICA, 'CREDITOS.txt'));
    return servirEstatico(res, u.pathname);
  } catch (e) {
    console.error(e);
    json(res, 500, { erro: 'erro no servidor' });
  }
}).listen(PORT, HOST, () => {
  varrer();
  console.log(`[som] http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  ·  Subsonic em /rest`);
});
function servirEstaticoFicheiro(res, p) {
  fs.readFile(p, (err, data) => {
    if (err) return json(res, 404, { erro: 'não existe' });
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(data);
  });
}

// volta a ler a pasta de 10 em 10 minutos (músicas novas) e, entretanto, fica atento à pasta:
// um ficheiro novo entra na biblioteca uns segundos depois e a letra dele vai para a fila.
setInterval(varrer, 10 * 60 * 1000);
let vigiaTimer;
try {
  fs.watch(MUSICA, { recursive: true }, (ev, nome) => {
    if (!nome || !/\.(mp3|m4a|aac|flac|ogg|opus|wav|webm|txt)$/i.test(nome)) return;
    clearTimeout(vigiaTimer); vigiaTimer = setTimeout(varrer, 4000);
  });
} catch (e) { console.log('[som] sem vigia da pasta (fica o varrimento de 10 em 10 min):', e.message); }
ligarSentidos();
