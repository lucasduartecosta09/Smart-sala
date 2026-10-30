import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const carouselSource = readFileSync(new URL('../src/dashboard-carousel.jsx', import.meta.url), 'utf8');
const circularSource = readFileSync(new URL('../src/components/CircularCarousel.jsx', import.meta.url), 'utf8');
const metricas = ['temperatura', 'umidade', 'pessoas', 'luminosidade'];

async function setup(t, autenticarAutomaticamente = true, options = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://smartclass.test' });
  t.after(() => dom.window.close());
  const { window } = dom;
  const quadros = new Map(), snapshots = [], blobs = [], leiturasSalvas = [], intervalos = new Map();
  const animacoes = [];
  let proximoId = 0, inicio;
  window.requestAnimationFrame = (callback) => { const id = ++proximoId; quadros.set(id, callback); return id; };
  window.cancelAnimationFrame = (id) => quadros.delete(id);
  window.setInterval = (callback, atraso) => { const id = ++proximoId; intervalos.set(id, { callback, atraso }); return id; };
  window.clearInterval = (id) => intervalos.delete(id);
  window.TextEncoder = TextEncoder;
  window.Blob = Blob;
  window.URL.createObjectURL = (blob) => { blobs.push(blob); return 'blob:historico'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = () => {};
  window.matchMedia = () => ({ matches: Boolean(options.reduzirMovimento) });
  if (options.animacao) window.HTMLElement.prototype.animate = function (quadros, configuracao) {
    const animacao = { elemento: this, quadros, configuracao, cancelada: false, cancel() { this.cancelada = true; } };
    animacoes.push(animacao);
    return animacao;
  };
  window.HTMLCanvasElement.prototype.getBoundingClientRect = function () {
    const width = this.closest('[hidden]') ? 0 : 560;
    return { width, height: width ? 300 : 0, left: 0, top: 0, right: width, bottom: width ? 300 : 0 };
  };
  window.HTMLCanvasElement.prototype.getContext = () => new Proxy({
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} })
  }, { get: (alvo, chave) => alvo[chave] ?? (() => {}) });
  window.senaiAuth = {
    canOperatePanel: () => true,
    start(init, estado, render) { inicio = { init, estado, render }; },
    loadHistoryForExport: async () => inicio.estado.historico,
    saveReading(leitura) { leiturasSalvas.push({ ...leitura }); }, saveEvent() {}
  };
  window.document.addEventListener('dashboard:state', (evento) => snapshots.push(evento.detail));
  const carregado = new Promise((resolve) => window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  window.eval(script);
  await carregado;
  function flush() {
    for (let i = 0; quadros.size && i < 20; i++) {
      const callbacks = [...quadros.values()]; quadros.clear(); callbacks.forEach((callback) => callback(0));
    }
    assert.equal(quadros.size, 0, 'os desenhos não devem formar um ciclo');
  }
  function autenticar() {
    // O callback só é liberado pelo contrato senaiAuth após o login.
    inicio.init();
    inicio.estado.historico = Array.from({ length: 12 }, (_, indice) => ({
      hora: new window.Date(Date.UTC(2020, 0, 1, 12, 0, indice * 30)),
      temperatura: 20 + indice, umidade: 40 + indice, pessoas: indice, luminosidade: 60 + indice
    }));
    inicio.estado.sensores = { ...inicio.estado.historico.at(-1) };
    inicio.render(); flush();
  }
  if (autenticarAutomaticamente) autenticar();
  const $ = (id) => window.document.getElementById(id);
  function selecionar(chave) {
    window.document.dispatchEvent(new window.CustomEvent('dashboard:select-metric', { detail: { chave } })); flush();
  }
  function abrir(chave) {
    window.document.dispatchEvent(new window.CustomEvent('dashboard:open', { detail: { chave } })); flush();
  }
  function fechar() {
    window.document.dispatchEvent(new window.Event('dashboard:close')); flush();
  }
  function hover(chave, indice, total = 12) {
    const evento = new window.MouseEvent('pointermove', { clientX: 54 + 490 * indice / Math.max(1, total - 1), clientY: 100 });
    Object.defineProperty(evento, 'pointerType', { value: 'mouse' });
    $(`grafico-${chave}`).dispatchEvent(evento); flush();
  }
  function definirPeriodo(inicio, fim = inicio) {
    for (const [id, valor] of [['historico-inicio', inicio], ['historico-fim', fim]]) {
      $(id).value = valor;
      $(id).dispatchEvent(new window.Event('input', { bubbles: true }));
    }
    flush();
  }
  return { window, $, estado: inicio.estado, snapshots, blobs, leiturasSalvas, intervalos, animacoes, flush, selecionar, abrir, fechar, hover, autenticar, definirPeriodo };
}

function conferirUltimaLeitura($, leitura) {
  assert.equal($('graficos-complementares').hidden, true);
  const principal = $('grafico-principal-slot').querySelector('canvas').id.replace('grafico-', '');
  for (const chave of metricas) {
    const tooltip = $(`grafico-${chave}-tooltip`);
    assert.equal(tooltip.hidden, chave !== principal, `${chave}: somente o dashboard principal mostra detalhe`);
    if (chave === principal) {
      assert.ok(tooltip.textContent.includes(leitura[chave].toFixed(chave === 'temperatura' ? 1 : 0)));
      assert.ok(tooltip.textContent.includes(leitura.hora.toLocaleTimeString('pt-BR')));
    }
  }
  assert.ok($('historico-selecao').textContent.includes(leitura[principal].toFixed(principal === 'temperatura' ? 1 : 0)));
}

test('roleta segue o cartão sob o cursor e abre apenas por duplo clique ou teclado', () => {
  assert.match(carouselSource, /focusOnHover/);
  assert.match(carouselSource, /onItemHover=.*trocar/);
  assert.match(carouselSource, /onItemDoubleClick=.*abrir/);
  assert.doesNotMatch(carouselSource, /carousel-(?:navegacao|paginacao|abrir)/);
  assert.match(circularSource, /if \(focusOnHover\) focusIndex\(index\)/);
  assert.match(circularSource, /onDoubleClick=\{handleDoubleClick\}/);
  assert.match(circularSource, /\(onItemDoubleClick \|\| onItemClick\)/);
});

test('a tela inicial mostra somente a roleta e navegar não abre o dashboard', async (t) => {
  const { $, window, estado, snapshots, selecionar, leiturasSalvas } = await setup(t);
  const completo = JSON.stringify(estado.historico);
  assert.equal($('aba-sensores').dataset.visualizacao, 'roleta');
  assert.equal($('dashboard-detalhes').hidden, true);
  assert.equal(window.document.querySelector('.carousel-shell').hidden, false);
  assert.equal(snapshots.at(-1).visualizacao, 'roleta');
  assert.ok($('aba-controles').contains(window.document.querySelector('.metricas')), 'indicadores atuais continuam nos controles sem duplicar a tela de roleta');
  for (const chave of metricas) {
    selecionar(chave);
    assert.equal($('dashboard-detalhes').hidden, true);
    assert.equal($('aba-sensores').dataset.visualizacao, 'roleta');
    assert.equal($(`grafico-${chave}`).getBoundingClientRect().width, 0);
  }
  assert.equal(JSON.stringify(estado.historico), completo);
  assert.equal(leiturasSalvas.length, 0);
});

test('selecionar a métrica já focada abre somente o dashboard escolhido', async (t) => {
  const { $, window, estado, snapshots, abrir } = await setup(t);
  const canvases = metricas.map(chave => $(`grafico-${chave}`));
  abrir('temperatura');
  assert.equal($('aba-sensores').dataset.visualizacao, 'detalhes');
  assert.equal($('dashboard-detalhes').hidden, false);
  assert.equal(window.document.querySelector('.carousel-shell').hidden, true);
  assert.equal(snapshots.at(-1).visualizacao, 'detalhes');
  assert.equal(window.document.activeElement, $('grafico-temperatura'));
  conferirUltimaLeitura($, estado.historico.at(-1));
  assert.deepEqual(metricas.map(chave => $(`grafico-${chave}`)), canvases, 'a abertura reutiliza os canvases existentes');
  assert.match($('grafico-temperatura').getAttribute('aria-label'), /12 leituras no período/);
  assert.match($('grafico-umidade').getAttribute('aria-label'), /Sem leituras/);
});

test('voltar à roleta preserva datas do download, histórico e o temporizador único, e permite reabrir', async (t) => {
  const { $, window, estado, snapshots, abrir, intervalos, leiturasSalvas, flush, definirPeriodo } = await setup(t);
  abrir('umidade');
  definirPeriodo('2020-01-01');
  $('auto-refresh').checked = true;
  $('auto-refresh').dispatchEvent(new window.Event('change')); flush();
  const completo = JSON.stringify(estado.historico);
  const temporizadores = [...intervalos.entries()].filter(([, timer]) => timer.atraso === 5000);
  assert.equal(temporizadores.length, 1);
  $('btn-voltar-roleta').click(); flush();
  assert.equal($('dashboard-detalhes').hidden, true);
  assert.equal(window.document.querySelector('.carousel-shell').hidden, false);
  assert.equal($('graficos-complementares').hidden, true);
  assert.equal($('aba-sensores').dataset.visualizacao, 'roleta');
  assert.equal(snapshots.at(-1).visualizacao, 'roleta');
  assert.equal(window.document.activeElement, $('carousel-fallback').querySelector('[data-dashboard-metric="umidade"]'));
  assert.equal($('historico-inicio').value, '2020-01-01');
  assert.equal($('historico-fim').value, '2020-01-01');
  assert.equal(JSON.stringify(estado.historico), completo);
  assert.deepEqual([...intervalos.entries()].filter(([, timer]) => timer.atraso === 5000), temporizadores);
  assert.equal(leiturasSalvas.length, 0);
  abrir('umidade');
  assert.equal($('historico-inicio').value, '2020-01-01');
  assert.equal($('historico-fim').value, '2020-01-01');
  assert.match($('grafico-umidade').getAttribute('aria-label'), /12 leituras no período/);
  conferirUltimaLeitura($, estado.historico.at(-1));
});

test('fechar por evento devolve o foco ao carrossel React quando ele está disponível', async (t) => {
  const { $, window, abrir, fechar } = await setup(t);
  const carrossel = window.document.createElement('div');
  carrossel.className = 'circular-carousel'; carrossel.tabIndex = 0;
  $('dashboard-carousel-root').appendChild(carrossel);
  abrir('pessoas');
  fechar();
  assert.equal(window.document.activeElement, carrossel);
  assert.equal($('dashboard-detalhes').hidden, true);
});

test('abertura inválida não altera a seleção, a visualização nem as leituras', async (t) => {
  const { $, estado, snapshots, abrir, leiturasSalvas } = await setup(t);
  const completo = JSON.stringify(estado.historico), quantidade = snapshots.length;
  for (const chave of ['__proto__', 'constructor', 'inexistente', null, undefined, ['pessoas'], { chave: 'pessoas' }]) abrir(chave);
  assert.equal($('aba-sensores').dataset.visualizacao, 'roleta');
  assert.equal($('dashboard-detalhes').hidden, true);
  assert.equal($('grafico-principal-slot').querySelector('canvas').id, 'grafico-temperatura');
  assert.equal(snapshots.length, quantidade);
  assert.equal(JSON.stringify(estado.historico), completo);
  assert.equal(leiturasSalvas.length, 0);
});

test('o zoom de abertura é cancelado ao voltar e respeita movimento reduzido', async (t) => {
  const normal = await setup(t, true, { animacao: true });
  normal.abrir('temperatura');
  assert.equal(normal.animacoes.length, 1);
  assert.equal(normal.animacoes[0].elemento, normal.$('dashboard-detalhes'));
  assert.ok(normal.animacoes[0].quadros[0].transform.includes('scale(0.9)'));
  assert.ok(normal.animacoes[0].configuracao.duration > 0);
  normal.fechar();
  assert.equal(normal.animacoes[0].cancelada, true);
  const reduzido = await setup(t, true, { animacao: true, reduzirMovimento: true });
  reduzido.abrir('pessoas');
  assert.equal(reduzido.animacoes.length, 0);
  assert.equal(reduzido.$('dashboard-detalhes').hidden, false);
  conferirUltimaLeitura(reduzido.$, reduzido.estado.historico.at(-1));
});

test('bridge só responde após o callback autenticado e não persiste leituras ao navegar', async (t) => {
  const { window, $, snapshots, leiturasSalvas, selecionar, abrir, autenticar } = await setup(t, false);
  window.document.dispatchEvent(new window.Event('dashboard:request-state'));
  selecionar('pessoas');
  abrir('pessoas');
  assert.equal(snapshots.length, 0, 'o carrossel não deve receber estado antes do login');
  assert.equal($('grafico-principal-slot').querySelector('canvas').id, 'grafico-temperatura');
  autenticar();
  assert.ok(snapshots.length > 0);
  window.document.dispatchEvent(new window.Event('dashboard:request-state'));
  assert.equal(snapshots.at(-1).principal, 'temperatura', 'pedido pré-login não deve ficar pendente');
  assert.equal(snapshots.at(-1).visualizacao, 'roleta', 'abertura pré-login não deve ficar pendente');
  selecionar('umidade');
  assert.equal(snapshots.at(-1).principal, 'umidade');
  assert.equal(leiturasSalvas.length, 0, 'trocar o principal só apresenta as leituras já carregadas');
});

test('carrossel muda a métrica principal reutilizando os quatro canvases e seus controles', async (t) => {
  const { $, window, estado, snapshots, selecionar } = await setup(t);
  assert.ok($('grafico-principal-slot'), 'o HTML deve fornecer o slot principal');
  const canvases = Object.fromEntries(metricas.map((chave) => [chave, $(`grafico-${chave}`)]));
  const completo = JSON.stringify(estado.historico);
  for (const principal of ['umidade', 'pessoas', 'luminosidade', 'temperatura']) {
    selecionar(principal);
    assert.equal(snapshots.at(-1).principal, principal);
    assert.equal($('grafico-principal-slot').querySelector('canvas'), canvases[principal]);
    assert.equal($('graficos-complementares').hidden, true);
    assert.equal(window.document.querySelectorAll('.grafico-principal').length, 1);
    assert.equal(window.document.querySelectorAll('canvas.grafico').length, 4);
    for (const chave of metricas) {
      const canvas = $(`grafico-${chave}`), card = canvas.closest('article');
      assert.equal(canvas, canvases[chave]);
      assert.equal(card.classList.contains('grafico-principal'), chave === principal);
      assert.equal(card.querySelector('.kpi-legenda').textContent, chave === principal ? 'Atual' : 'No ponto');
      assert.equal(canvas.getAttribute('aria-controls'), null);
      assert.equal(canvas.parentElement.querySelectorAll('.grafico-cursor').length, 1, 'não reinstala listeners/cursores');
      if (chave !== principal) assert.ok($('graficos-complementares').contains(canvas));
    }
    assert.equal(JSON.stringify(estado.historico), completo);
  }
});

test('hover consulta somente o dashboard principal atual', async (t) => {
  const { $, estado, selecionar, abrir, hover } = await setup(t);
  abrir('temperatura');
  $('btn-ocultar-detalhes').click();
  hover('temperatura', 5);
  assert.equal($('graficos-complementares').hidden, true);
  assert.equal($('grafico-temperatura-tooltip').hidden, false);
  assert.equal($('grafico-umidade-tooltip').hidden, true);
  assert.match($('historico-selecao').textContent, /temperatura: 25\.0 °C/);
  assert.doesNotMatch($('historico-selecao').textContent, /umidade:/);
  selecionar('umidade');
  hover('temperatura', 5);
  assert.equal($('graficos-complementares').hidden, true, 'o antigo principal não deve continuar disparando hover');
  hover('umidade', 5);
  assert.equal($('graficos-complementares').hidden, true);
  assert.match($('grafico-umidade').getAttribute('aria-label'), /12 leituras no período/);
  assert.match($('grafico-temperatura').getAttribute('aria-label'), /Sem leituras/);
  assert.equal($('graf-umidade-atual').textContent, `${estado.historico.at(-1).umidade.toFixed(0)} %`);
  assert.match($('historico-selecao').textContent, /umidade: 45 %/);
  assert.doesNotMatch($('historico-selecao').textContent, /temperatura:/);
  $('btn-ocultar-detalhes').click();
  assert.equal($('graficos-complementares').hidden, true);
  assert.equal($('grafico-umidade'), $('grafico-principal-slot').querySelector('canvas'));
  assert.equal($('grafico-umidade'), $('grafico-umidade').ownerDocument.activeElement);
});

test('trocar o principal preserva datas do download, gráfico completo e aquisição única', async (t) => {
  const { $, estado, selecionar, abrir, hover, blobs, leiturasSalvas, flush, definirPeriodo } = await setup(t);
  abrir('temperatura');
  const completo = JSON.stringify(estado.historico);
  definirPeriodo('2020-01-01');
  selecionar('pessoas');
  assert.equal($('historico-inicio').value, '2020-01-01');
  assert.equal($('historico-fim').value, '2020-01-01');
  assert.match($('grafico-pessoas').getAttribute('aria-label'), /12 leituras no período/);
  hover('pessoas', 10);
  assert.equal($('graf-umidade-atual').textContent, '--');
  assert.equal(JSON.stringify(estado.historico), completo);
  $('btn-baixar').click(); flush();
  await new Promise(setImmediate);
  assert.equal(blobs.length, 1);
  const texto = new TextDecoder().decode(await blobs[0].arrayBuffer());
  assert.ok(texto.startsWith('%PDF-1.4'));
  assert.ok(texto.includes('(Total: 12 leituras)'));
  assert.equal((texto.match(/\(01\/01\/2020\)/g) || []).length, 12);
  for (const coluna of ['Temperatura \\(C\\)', 'Umidade \\(%\\)', 'Luminosidade \\(%\\)', 'Pessoas']) assert.ok(texto.includes(`(${coluna})`));
  $('btn-atualizar').click(); flush();
  assert.equal(estado.historico.length, 13);
  assert.equal(leiturasSalvas.length, 1);
});

test('bridge emite snapshots isolados por leitura e pedido, sem ciclos em hover ou seleção repetida', async (t) => {
  const { $, window, estado, snapshots, selecionar, abrir, hover, flush } = await setup(t);
  abrir('temperatura');
  const antes = snapshots.length;
  hover('temperatura', 4);
  hover('temperatura', 5);
  window.dispatchEvent(new window.Event('resize')); flush();
  assert.equal(snapshots.length, antes, 'hover e resize não devem forçar novo estado React');
  selecionar('umidade');
  assert.equal(snapshots.length, antes + 1);
  selecionar('umidade');
  assert.equal(snapshots.length, antes + 1, 'callback de mesma métrica não deve produzir loop');
  for (const chave of ['__proto__', 'constructor', 'inexistente', null, undefined, ['pessoas'], { chave: 'pessoas' }]) selecionar(chave);
  assert.equal(snapshots.length, antes + 1);
  assert.equal($('grafico-principal-slot').querySelector('canvas').id, 'grafico-umidade');
  window.document.dispatchEvent(new window.Event('dashboard:request-state'));
  assert.equal(snapshots.length, antes + 2);
  const snapshot = snapshots.at(-1);
  assert.equal(typeof snapshot.historico[0].hora, 'number');
  snapshot.historico[0].temperatura = 999;
  snapshot.sensores.temperatura = 999;
  assert.equal(estado.historico[0].temperatura, 20);
  assert.equal(estado.sensores.temperatura, 31);
});

test('navegação alternativa abre o dashboard e seus detalhes sem o bundle React', async (t) => {
  const { $, window, snapshots } = await setup(t);
  const buttons = $('carousel-fallback').querySelectorAll('[data-dashboard-metric]');
  assert.equal(buttons.length, 4);
  const presenca = $('carousel-fallback').querySelector('[data-dashboard-metric="pessoas"]');
  presenca.click();
  assert.equal(snapshots.at(-1).principal, 'pessoas');
  assert.equal(snapshots.at(-1).visualizacao, 'detalhes');
  assert.equal($('dashboard-detalhes').hidden, false);
  assert.equal($('graficos-complementares').hidden, true);
  assert.equal(presenca.getAttribute('aria-pressed'), 'true');
  assert.equal(window.document.querySelectorAll('#carousel-fallback [aria-pressed="true"]').length, 1);
});
