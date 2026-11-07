window.SOM_TEMAS = {
  areia:    { nome: 'Areia',    grupo: 'Suaves',       base: 'dia',   fundo: '#F2ECE1', acao: '#FFC53D', m1: '#FFC53D', m2: '#1F9D6C' },
  nevoa:    { nome: 'Névoa',    grupo: 'Suaves',       base: 'dia',   fundo: '#EDF0F4', acao: '#3E6FE0', m1: '#78A0FF', m2: '#BEAAFF' },
  pessego:  { nome: 'Pêssego',  grupo: 'Suaves',       base: 'dia',   fundo: '#FBEFE8', acao: '#E46B4F', m1: '#FFAA82', m2: '#FF8CAA' },
  menta:    { nome: 'Menta',    grupo: 'Suaves',       base: 'dia',   fundo: '#E9F4EE', acao: '#179468', m1: '#78DCAA', m2: '#FFD26E' },
  lavanda:  { nome: 'Lavanda',  grupo: 'Suaves',       base: 'dia',   fundo: '#F1EDF9', acao: '#7558E0', m1: '#B496FF', m2: '#8CC8FF' },
  noite:    { nome: 'Noite',    grupo: 'Profundos',    base: 'noite', fundo: '#0E0C0A', acao: '#FFC53D', m1: '#7A5A10', m2: '#0F5A3A' },
  floresta: { nome: 'Floresta', grupo: 'Profundos',    base: 'noite', fundo: '#07120D', acao: '#5BD6A0', m1: '#11704D', m2: '#123A2C' },
  oceano:   { nome: 'Oceano',   grupo: 'Profundos',    base: 'noite', fundo: '#050E1A', acao: '#4CC2FF', m1: '#1A4E96', m2: '#0D6A6A' },
  aurora:   { nome: 'Aurora',   grupo: 'Profundos',    base: 'noite', fundo: '#0C0918', acao: '#B79CFF', m1: '#4B3696', m2: '#0F6E52' },
  brasa:    { nome: 'Brasa',    grupo: 'Profundos',    base: 'noite', fundo: '#130806', acao: '#FF7A45', m1: '#8A2E12', m2: '#6E1022' },
  papel:    { nome: 'Papel',    grupo: 'Minimalistas', base: 'dia',   fundo: '#FFFFFF', acao: '#0A0A0A', minimal: true },
  tinta:    { nome: 'Tinta',    grupo: 'Minimalistas', base: 'noite', fundo: '#000000', acao: '#FFFFFF', minimal: true },
};
window.aplicarPaleta = function (id) {
  var t = window.SOM_TEMAS[id] || window.SOM_TEMAS.noite, r = document.documentElement;
  r.dataset.paleta = window.SOM_TEMAS[id] ? id : 'noite';
  r.dataset.tema = t.base;
  if (t.minimal) r.dataset.estilo = 'minimal'; else delete r.dataset.estilo;
  var m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t.fundo;
};
(function () {
  var id = null;
  try { id = localStorage.getItem('som-paleta'); if (!id) { var v = localStorage.getItem('som-tema'); id = v === 'dia' ? 'areia' : 'noite'; } } catch (e) { id = 'noite'; }
  window.aplicarPaleta(id);
})();
