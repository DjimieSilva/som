// Som — extras: controlos de media (web + app Android), definições, fundos, transição suave,
// temporizador para dormir, instalar como app e um easter egg escondido no logótipo.
(function () {
  const $ = s => document.querySelector(s);
  const guardar = (k, v) => { try { localStorage.setItem('som-' + k, JSON.stringify(v)); } catch {} };
  const ler = (k, def) => { try { const v = localStorage.getItem('som-' + k); return v == null ? def : JSON.parse(v); } catch { return def; } };

  // =========================================================
  // 1. Controlos de media: notificação, ecrã de bloqueio, auriculares
  //    Web: navigator.mediaSession. App Android (Capacitor): plugin MediaSession com serviço em primeiro plano.
  // =========================================================
  const nativo = () => window.Capacitor?.Plugins?.MediaSession;
  const web = 'mediaSession' in navigator ? navigator.mediaSession : null;
  const acoes = {
    play: () => audio.play(),
    pause: () => audio.pause(),
    nexttrack: () => seguinte(false),
    previoustrack: () => anterior(),
    seekto: d => { if (d && d.seekTime != null) audio.currentTime = d.seekTime; },
    stop: () => audio.pause(),
    seekforward: () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10); },
    seekbackward: () => { audio.currentTime = Math.max(0, audio.currentTime - 10); },
  };
  for (const [acao, fn] of Object.entries(acoes)) {
    if (web) try { web.setActionHandler(acao, fn); } catch {}
    const n = nativo();
    if (n) try { n.setActionHandler({ action: acao }, fn); } catch {}
  }
  window.sessaoMedia = {
    meta(f) {
      const arte = [96, 256, 512].map(t => ({ src: location.origin + urlCapa(idCapa(f), t), sizes: `${t}x${t}`, type: 'image/png' }));
      const dados = { title: f.titulo, artist: f.artista, album: f.album, artwork: arte };
      if (web) try { web.metadata = new MediaMetadata(dados); } catch {}
      const n = nativo(); if (n) n.setMetadata(dados).catch?.(() => {});
    },
    estado(s) {
      if (web) try { web.playbackState = s; } catch {}
      const n = nativo(); if (n) n.setPlaybackState({ playbackState: s }).catch?.(() => {});
    },
    posicao(d, t) {
      const p = { duration: d, position: Math.min(t, d), playbackRate: audio.playbackRate || 1 };
      if (web) try { web.setPositionState(p); } catch {}
      const n = nativo(); if (n && (!this._ult || Date.now() - this._ult > 4000)) { this._ult = Date.now(); n.setPositionState(p).catch?.(() => {}); }
    },
  };
  if (estado.atual && porId.get(estado.atual)) window.sessaoMedia.meta(porId.get(estado.atual));

  // =========================================================
  // 2. Definições guardadas neste aparelho
  // =========================================================
  const DEF = Object.assign({
    vidro: 'medio', movimento: true, duracoes: true,
    transicao: 0, volume: 1, retomar: true,
  }, ler('definicoes', {}));
  function aplicarDef() {
    const r = document.documentElement;
    r.dataset.vidro = DEF.vidro;
    r.dataset.movimento = DEF.movimento ? 'sim' : 'nao';
    r.dataset.duracoes = DEF.duracoes ? 'sim' : 'nao';
    audio.volume = DEF.volume;
  }
  function mudarDef(k, v) { DEF[k] = v; guardar('definicoes', DEF); aplicarDef(); desenharDef(); }
  function escolherTema(id) {
    try { localStorage.setItem('som-paleta', id); } catch {}
    window.aplicarPaleta(id);
    desenharDef();
  }
  aplicarDef();

  // temporizador para dormir
  let dormir = { ate: 0, fimDaMusica: false, timer: null };
  function marcarDormir(min) {
    clearTimeout(dormir.timer);
    dormir = { ate: 0, fimDaMusica: false, timer: null };
    if (min === 'fim') { dormir.fimDaMusica = true; aviso('Pára no fim desta música'); }
    else if (min) {
      dormir.ate = Date.now() + min * 60000;
      dormir.timer = setTimeout(() => desvanecer(4, () => { audio.pause(); audio.volume = DEF.volume; aviso('Boa noite'); dormir.ate = 0; desenharDef(); }), min * 60000);
      aviso(`Pára daqui a ${min} min`);
    } else aviso('Temporizador desligado');
    desenharDef();
  }
  audio.addEventListener('ended', () => {
    if (dormir.fimDaMusica) { dormir.fimDaMusica = false; setTimeout(() => { audio.pause(); aviso('Boa noite'); }, 0); desenharDef(); }
  }, true);

  // transição suave: baixa o volume no fim e sobe no início de cada música
  let rampa = null;
  function desvanecer(seg, fim) {
    cancelAnimationFrame(rampa);
    const ini = audio.volume, t0 = performance.now();
    const passo = now => {
      const k = Math.min(1, (now - t0) / (seg * 1000));
      audio.volume = Math.max(0, ini * (1 - k));
      if (k < 1) rampa = requestAnimationFrame(passo); else fim && fim();
    };
    rampa = requestAnimationFrame(passo);
  }
  audio.addEventListener('timeupdate', () => {
    const s = DEF.transicao;
    if (!s || !audio.duration || audio.paused) return;
    const falta = audio.duration - audio.currentTime;
    if (audio.currentTime < s) audio.volume = DEF.volume * Math.max(0.05, audio.currentTime / s);
    else if (falta < s) audio.volume = DEF.volume * Math.max(0, falta / s);
    else if (audio.volume !== DEF.volume) audio.volume = DEF.volume;
  });

  // instalar como app (PC e Android, pelo Chrome/Edge)
  let pedidoInstalar = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); pedidoInstalar = e; desenharDef(); });
  window.addEventListener('appinstalled', () => { pedidoInstalar = null; aviso('Som instalada'); desenharDef(); });
  const instalada = () => matchMedia('(display-mode: standalone)').matches || !!window.Capacitor;

  // =========================================================
  // 3. Painel de definições
  // =========================================================
  const seg = (k, opcoes, atual) => `<div class="seg-def" role="radiogroup">${opcoes.map(([v, r]) =>
    `<button type="button" role="radio" aria-checked="${String(v) === String(atual)}" class="${String(v) === String(atual) ? 'on' : ''}" data-def="${k}" data-valor='${JSON.stringify(v)}'>${r}</button>`).join('')}</div>`;
  const interruptor = (k, ligado, rotulo) => `<button type="button" class="linha-def interruptor-def" role="switch" aria-checked="${ligado}" data-def="${k}" data-valor='${JSON.stringify(!ligado)}'><span>${rotulo}</span><span class="mini-int ${ligado ? 'on' : ''}"><i></i></span></button>`;
  function desenharDef() {
    const corpo = $('#def-corpo');
    if (!corpo || !$('#definicoes').open) return;
    const temaAtual = document.documentElement.dataset.paleta;
    const minimal = !!(window.SOM_TEMAS[temaAtual] || {}).minimal;
    const grupos = {};
    for (const [id, t] of Object.entries(window.SOM_TEMAS)) (grupos[t.grupo] ||= []).push([id, t]);
    const amostra = t => t.minimal
      ? `<span class="tema-amostra" style="background:${t.fundo}"><s style="background:${t.acao}"></s><s style="background:${t.acao}"></s><b style="background:${t.acao};box-shadow:none"></b></span>`
      : `<span class="tema-amostra" style="background:${t.fundo}"><i style="width:70%;height:80%;left:-12%;top:-20%;background:${t.m1}"></i><i style="width:60%;height:70%;right:-14%;bottom:-20%;background:${t.m2}"></i><b style="background:${t.acao}"></b></span>`;
    const restaDormir = dormir.ate ? Math.ceil((dormir.ate - Date.now()) / 60000) + ' min' : dormir.fimDaMusica ? 'no fim desta música' : '';
    corpo.innerHTML = `
      <section><h3>Aspeto</h3>
        ${Object.entries(grupos).map(([g, lista]) => `<div class="temas-grupo"><p class="rot">${g}</p><div class="temas">${lista.map(([id, t]) =>
          `<button type="button" class="tema-op ${id === temaAtual ? 'on' : ''}" data-paleta="${id}" aria-pressed="${id === temaAtual}">${amostra(t)}<span>${t.nome}</span></button>`).join('')}</div></div>`).join('')}
        ${minimal ? '' : `<p class="rot">Vidro</p>${seg('vidro', [['leve', 'Leve'], ['medio', 'Médio'], ['forte', 'Forte']], DEF.vidro)}
        ${interruptor('movimento', DEF.movimento, 'Fundo a mexer')}`}
        ${interruptor('duracoes', DEF.duracoes, 'Mostrar a duração das músicas')}
      </section>
      <section><h3>Reprodução</h3>
        <p class="rot">Volume</p>
        <input type="range" id="def-volume" min="0" max="100" step="1" value="${Math.round(DEF.volume * 100)}" style="--p:${Math.round(DEF.volume * 100)}%" aria-label="Volume">
        <p class="rot">Transição suave entre músicas</p>${seg('transicao', [[0, 'Não'], [3, '3 s'], [6, '6 s'], [10, '10 s']], DEF.transicao)}
        <p class="rot">Temporizador para dormir ${restaDormir ? `<span class="etiqueta">· para ${restaDormir}</span>` : ''}</p>
        <div class="seg-def">${[[0, 'Não'], [15, '15 min'], [30, '30 min'], [60, '1 h'], ['fim', 'Fim da música']].map(([v, r]) =>
          `<button type="button" data-dormir='${JSON.stringify(v)}' class="${(v === 'fim' && dormir.fimDaMusica) || (v === 0 && !dormir.ate && !dormir.fimDaMusica) ? 'on' : ''}">${r}</button>`).join('')}</div>
      </section>
      <section><h3>Biblioteca</h3>
        <button type="button" class="linha-def" id="def-atualizar"><span>Procurar músicas novas</span>${ico('atualizar')}</button>
        <button type="button" class="linha-def" id="def-juntar"><span>Juntar músicas do aparelho ou por link</span>${ico('juntar')}</button>
        <p class="nota">${faixas.length} músicas · ${estado.playlists.length} playlists · ${estado.favoritas.length} favoritas. No PC também podes arrastar ficheiros para a janela.</p>
      </section>
      <section><h3>Apps</h3>
        ${instalada() ? '<p class="nota">Estás a usar a Som como app.</p>' : pedidoInstalar
          ? `<button type="button" class="linha-def" id="def-instalar"><span>Instalar a Som neste aparelho</span>${ico('descarregar')}</button>`
          : '<p class="nota">Para instalar no PC: no Chrome ou no Edge, ícone de instalar na barra do endereço. No Android: menu ⋮ → «Adicionar ao ecrã principal», ou a app na loja.</p>'}
        <a class="linha-def" href="/loja/"><span>Loja Descomplicai (apps para o telemóvel)</span>${ico('loja')}</a>
        <p class="nota">Apps de música (Symfonium, Substreamer, Ultrasonic): servidor <code>${location.origin}</code>, utilizador <code>jaime</code>, qualquer senha.</p>
      </section>
      <section><h3>Sobre</h3>
        <p class="nota">Som 1.2 · feita em casa, a correr no fixo. Música de exemplo de Kevin MacLeod (CC BY 4.0) · <a href="/creditos.txt">créditos</a>.</p>
      </section>`;
    const vol = $('#def-volume');
    vol.oninput = () => { DEF.volume = vol.value / 100; vol.style.setProperty('--p', vol.value + '%'); audio.volume = DEF.volume; };
    vol.onchange = () => guardar('definicoes', DEF);
  }
  $('#def-corpo').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.paleta) return escolherTema(b.dataset.paleta);
    if (b.dataset.def) return mudarDef(b.dataset.def, JSON.parse(b.dataset.valor));
    if (b.dataset.dormir) return marcarDormir(JSON.parse(b.dataset.dormir));
    if (b.id === 'def-atualizar') return varrer();
    if (b.id === 'def-juntar') { $('#definicoes').close(); return $('#b-juntar').click(); }
    if (b.id === 'def-instalar' && pedidoInstalar) { pedidoInstalar.prompt(); pedidoInstalar.userChoice.finally(() => { pedidoInstalar = null; desenharDef(); }); }
  });
  $('#b-definicoes').onclick = () => { $('#definicoes').showModal(); desenharDef(); };
  $('#b-atualizar').onclick = async () => {
    const b = $('#b-atualizar'); b.classList.add('a-rodar');
    try { await varrer(); } finally { b.classList.remove('a-rodar'); }
  };
  setInterval(() => { if ($('#definicoes').open && dormir.ate) desenharDef(); }, 30000);


  // =========================================================
  // Juntar músicas: ficheiros do aparelho ou link direto
  // =========================================================
  async function enviarFicheiros(lista) {
    const fs_ = [...lista];
    if (!fs_.length) return;
    let ok = 0, ultima = null;
    for (const [i, f] of fs_.entries()) {
      aviso(`A enviar ${i + 1} de ${fs_.length}…`);
      try {
        const r = await fetch('/api/enviar?nome=' + encodeURIComponent(f.name), { method: 'POST', headers: { 'Content-Type': f.type || 'application/octet-stream' }, body: f });
        const d = await r.json();
        if (!r.ok) throw new Error(d.erro);
        ok++; ultima = d.faixa;
      } catch (err) { aviso(`«${f.name}»: ${err.message}`); await new Promise(r => setTimeout(r, 2200)); }
    }
    await carregar();
    if (ok) { aviso(ok === 1 ? `«${ultima?.titulo || 'Música'}» juntada` : `${ok} músicas juntadas`); mostrarRecebidas(); }
  }
  async function juntarLink() {
    const url = prompt('Cola o link direto do ficheiro de áudio (Google Drive, Dropbox, archive.org, um .mp3…)');
    if (!url || !url.trim()) return;
    aviso('A descarregar…');
    try {
      const r = await fetch('/api/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim() }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      await carregar();
      aviso(`«${d.faixa?.titulo || 'Música'}» juntada`);
      mostrarRecebidas();
    } catch (err) { alert(err.message); }
  }
  function mostrarRecebidas() {
    const f = faixas.find(x => x.pasta === 'Recebidas');
    if (!f) return;
    vista = { aba: 'pastas', pasta: f.albumId, playlist: null }; marcarAba(); desenhar();
  }
  $('#f-juntar').addEventListener('change', e => { enviarFicheiros(e.target.files); e.target.value = ''; });
  $('#b-juntar').onclick = () => abrirMenu({
    titulo: 'Juntar músicas', sub: 'Ficam na pasta «Recebidas» do fixo', capaTxt: 'Juntar',
    acoes: [
      ['telemovel', 'Do aparelho (escolher ficheiros)', () => $('#f-juntar').click()],
      ['descarregar', 'Por link direto', juntarLink],
    ],
  });
  // arrastar ficheiros para a janela (PC)
  document.addEventListener('dragover', e => { if ([...(e.dataTransfer?.items || [])].some(i => i.kind === 'file')) e.preventDefault(); });
  document.addEventListener('drop', e => { const fl = e.dataTransfer?.files; if (fl && fl.length) { e.preventDefault(); enviarFicheiros(fl); } });

  // =========================================================
  // 4. Easter egg: 5 toques no logótipo
  // =========================================================
  let toques = [];
  $('#marca').addEventListener('click', () => {
    const agora = Date.now();
    toques = toques.filter(t => agora - t < 2500).concat(agora);
    if (toques.length >= 5) { toques = []; festa(); }
  });

  let festaViva = null;
  function festa() {
    if (festaViva) return;
    const estavaATocar = !audio.paused;
    audio.pause();
    const palco = $('#festa');
    palco.hidden = false;
    requestAnimationFrame(() => palco.classList.add('on'));
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const saida = ctx.createGain(); saida.gain.value = 0.9;
    const analisador = ctx.createAnalyser(); analisador.fftSize = 256;
    saida.connect(analisador); analisador.connect(ctx.destination);

    // batida house original, 124 bpm, 8 compassos
    const bpm = 124, b = 60 / bpm, t0 = ctx.currentTime + 0.15, compassos = 8, total = compassos * 4 * b;
    const ruido = (() => { const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return buf; })();
    const bombo = t => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g).connect(saida); o.start(t); o.stop(t + 0.4);
    };
    const chiado = (t, dur, freq, vol, tipo = 'highpass') => {
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = ruido; f.type = tipo; f.frequency.value = freq;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f).connect(g).connect(saida); s.start(t); s.stop(t + dur + 0.02);
    };
    const nota = (t, hz, dur, vol, tipo, corte) => {
      const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = tipo; o.frequency.value = hz; f.type = 'lowpass'; f.frequency.setValueAtTime(corte, t); f.frequency.exponentialRampToValueAtTime(corte / 4, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(f).connect(g).connect(saida); o.start(t); o.stop(t + dur + 0.05);
    };
    const hz = m => 440 * Math.pow(2, (m - 69) / 12);
    const baixo = [45, 45, 57, 45, 48, 45, 55, 43];          // Lá menor a saltar
    const acordes = [[57, 60, 64, 67], [55, 59, 62, 65], [53, 57, 60, 64], [55, 59, 62, 67]];
    for (let c = 0; c < compassos; c++) for (let p = 0; p < 4; p++) {
      const t = t0 + (c * 4 + p) * b;
      if (c > 0 || p > 1) bombo(t);
      if (p % 2 === 1 && c > 0) chiado(t, 0.18, 1400, 0.5, 'bandpass');
      chiado(t + b / 2, 0.05, 7000, 0.28);
      if (c > 1) chiado(t + b / 4 * 3, 0.03, 9000, 0.12);
      if (c > 0) { nota(t + b / 2, hz(baixo[(c * 4 + p) % 8]), b / 2.2, 0.5, 'sawtooth', 900); nota(t, hz(baixo[(c * 4 + p) % 8]), b / 3, 0.35, 'square', 500); }
      if (c > 1 && (p === 1 || p === 3)) for (const m of acordes[c % 4]) nota(t + b / 2, hz(m), 0.16, 0.08, 'sawtooth', 3200);
    }

    // palavras a saltar na batida
    const palavras = [...palco.querySelectorAll('.festa-texto span')];
    const tela = $('#festa-tela'), g2 = tela.getContext('2d');
    const dados = new Uint8Array(analisador.frequencyBinCount);
    let ultimaBatida = -1;
    const desenhar = () => {
      if (!festaViva) return;
      const w = tela.width = tela.clientWidth * devicePixelRatio, h = tela.height = tela.clientHeight * devicePixelRatio;
      analisador.getByteFrequencyData(dados);
      const tempo = ctx.currentTime - t0;
      const batida = Math.floor(tempo / b);
      if (batida !== ultimaBatida && tempo >= 0) {
        ultimaBatida = batida;
        palavras.forEach((s, i) => s.classList.toggle('on', i === batida % 4));
        palco.classList.toggle('pulso', batida % 2 === 0);
      }
      const graves = dados.slice(0, 8).reduce((a, x) => a + x, 0) / 8 / 255;
      g2.clearRect(0, 0, w, h);
      // sol a pulsar
      const r = Math.min(w, h) * (0.16 + graves * 0.12);
      const grad = g2.createRadialGradient(w / 2, h * 0.42, r * 0.2, w / 2, h * 0.42, r * 2.4);
      grad.addColorStop(0, 'rgba(255,197,61,0.95)'); grad.addColorStop(0.45, 'rgba(255,197,61,0.35)'); grad.addColorStop(1, 'rgba(255,197,61,0)');
      g2.fillStyle = grad; g2.beginPath(); g2.arc(w / 2, h * 0.42, r * 2.4, 0, Math.PI * 2); g2.fill();
      // raios do sol = espectro
      const n = 48;
      for (let i = 0; i < n; i++) {
        const v = dados[Math.floor(i / n * dados.length * 0.7)] / 255;
        const ang = (i / n) * Math.PI * 2 + tempo * 0.4;
        const r1 = r * 1.15, r2 = r1 + v * Math.min(w, h) * 0.22;
        g2.strokeStyle = i % 2 ? 'rgba(31,157,108,0.9)' : 'rgba(255,253,248,0.9)';
        g2.lineWidth = Math.max(2, devicePixelRatio * 3); g2.lineCap = 'round';
        g2.beginPath(); g2.moveTo(w / 2 + Math.cos(ang) * r1, h * 0.42 + Math.sin(ang) * r1); g2.lineTo(w / 2 + Math.cos(ang) * r2, h * 0.42 + Math.sin(ang) * r2); g2.stroke();
      }
      // chão de barras
      const barras = 32, lb = w / barras;
      for (let i = 0; i < barras; i++) {
        const v = dados[i * 2] / 255;
        g2.fillStyle = `rgba(255,197,61,${0.25 + v * 0.6})`;
        g2.fillRect(i * lb + lb * 0.15, h - v * h * 0.28, lb * 0.7, v * h * 0.28);
      }
      requestAnimationFrame(desenhar);
    };
    const acabar = () => {
      if (!festaViva) return;
      festaViva = null;
      palco.classList.remove('on', 'pulso');
      setTimeout(() => { palco.hidden = true; }, 400);
      saida.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      setTimeout(() => ctx.close(), 500);
      if (estavaATocar) audio.play().catch(() => {});
    };
    festaViva = { acabar };
    palco.onclick = acabar;
    setTimeout(acabar, (total + 0.6) * 1000);
    requestAnimationFrame(desenhar);
  }
  window.festa = festa; // para testar
})();
