// Ícones desenhados (SVG), sempre centrados. Uso: ico('play') ou <button data-ico="play">.
(function () {
  const t = (d, extra = '') => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra}>${d}</svg>`;
  const ICO = {
    play: t('<path d="M8.5 5.8v12.4a.8.8 0 0 0 1.2.7l10-6.2a.8.8 0 0 0 0-1.4l-10-6.2a.8.8 0 0 0-1.2.7z" fill="currentColor" stroke="none"/>'),
    pausa: t('<rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/>'),
    seguinte: t('<path d="M6 6.2v11.6a.7.7 0 0 0 1.1.6l8.4-5.8a.7.7 0 0 0 0-1.2L7.1 5.6a.7.7 0 0 0-1.1.6z" fill="currentColor" stroke="none"/><rect x="16.5" y="5.5" width="2.6" height="13" rx="1" fill="currentColor" stroke="none"/>'),
    anterior: t('<path d="M18 6.2v11.6a.7.7 0 0 1-1.1.6l-8.4-5.8a.7.7 0 0 1 0-1.2l8.4-5.8a.7.7 0 0 1 1.1.6z" fill="currentColor" stroke="none"/><rect x="4.9" y="5.5" width="2.6" height="13" rx="1" fill="currentColor" stroke="none"/>'),
    aleatorio: t('<path d="M3 7h3.5c2 0 3.2 1 4.3 2.7l2.4 3.6c1.1 1.7 2.3 2.7 4.3 2.7H21"/><path d="M3 17h3.5c1.4 0 2.4-.5 3.2-1.4"/><path d="M13.8 8.4c.8-.9 1.8-1.4 3.2-1.4H21"/><path d="m18 4 3 3-3 3"/><path d="m18 14 3 3-3 3"/>'),
    repetir: t('<path d="M4 11V9a3 3 0 0 1 3-3h13"/><path d="m17 3 3 3-3 3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/><path d="m7 21-3-3 3-3"/>'),
    repetir1: t('<path d="M4 11V9a3 3 0 0 1 3-3h13"/><path d="m17 3 3 3-3 3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/><path d="m7 21-3-3 3-3"/><path d="M11.5 10.5 13 9.5v5" stroke-width="1.8"/>'),
    coracao: t('<path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.2 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z"/>'),
    coracaoCheio: t('<path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.2 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z" fill="currentColor"/>'),
    mais: t('<circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none"/>'),
    juntar: t('<path d="M12 5v14M5 12h14"/>'),
    fila: t('<path d="M4 6h12M4 12h12M4 18h7"/><path d="M18 15v6M15 18h6"/>'),
    aSeguir: t('<path d="M4 6h16M4 12h10"/><path d="M4 18h6"/><path d="m15 15 3 3-3 3"/><path d="M13 18h5"/>'),
    baixo: t('<path d="m6 9 6 6 6-6"/>'),
    voltar: t('<path d="m15 18-6-6 6-6"/>'),
    definicoes: t('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/>'),
    atualizar: t('<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>'),
    album: t('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.5"/>'),
    fechar: t('<path d="M6 6l12 12M18 6 6 18"/>'),
    lixo: t('<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7"/><path d="M9 7V4.5h6V7"/>'),
    editar: t('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
    copiar: t('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>'),
    letra: t('<path d="M4 6h16M4 10h12M4 14h16M4 18h9"/>'),
    lua: t('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
    sol: t('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'),
    telemovel: t('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>'),
    loja: t('<path d="M4 9h16l-1.2 10.2a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8z"/><path d="M8.5 9V7a3.5 3.5 0 0 1 7 0v2"/>'),
    relogio: t('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    descarregar: t('<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>'),
  };
  window.ICO = ICO;
  window.ico = n => ICO[n] || '';
  // preencher os botões fixos do HTML
  for (const el of document.querySelectorAll('[data-ico]')) el.innerHTML = ICO[el.dataset.ico] || el.innerHTML;
})();
