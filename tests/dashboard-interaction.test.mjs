import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const metricas = ['temperatura', 'umidade', 'pessoas', 'luminosidade'];

async function setup(t, quantidade = 8, instante = null) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://smartclass.test' });
  t.after(() => dom.window.close());
  const { window } = dom;
  const relogio = { agora: instante === null ? Date.now() : Number(instante) };
  if (instante !== null) {
    const DataNativa = window.Date;
    window.Date = class extends DataNativa {
      constructor(...args) { super(...(args.length ? args : [relogio.agora])); }
      static now() { return relogio.agora; }
    };
  }
  const quadros = new Map(), blobs = [];
  let proximoId = 0, inicio;
  window.requestAnimationFrame = (callback) => { const id = ++proximoId; quadros.set(id, callback); return id; };
  window.cancelAnimationFrame = (id) => quadros.delete(id);
  window.setInterval = () => ++proximoId;
  window.clearInterval = () => {};
  window.TextEncoder = TextEncoder;
  window.Blob = Blob;
  window.URL.createObjectURL = (blob) => { blobs.push(blob); return 'blob:historico'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = () => {};
  window.HTMLCanvasElement.prototype.getBoundingClientRect = function () {
    const visivel = !this.closest('[hidden]');
    return { width: visivel ? 560 : 0, height: visivel ? 260 : 0, left: 0, top: 0, right: visivel ? 560 : 0, bottom: visivel ? 260 : 0 };
  };
  window.HTMLCanvasElement.prototype.getContext = () => new Proxy({
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} })
  }, { get: (alvo, chave) => alvo[chave] ?? (() => {}) });
  window.senaiAuth = {
    canOperatePanel: () => true,
    start(init, estado, render) { inicio = { init, estado, render }; },
    loadHistoryForExport: async () => inicio.estado.historico,
    saveReading() {}, saveEvent() {}
  };
  const carregado = new Promise((resolve) => window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  window.eval(script);
  await carregado;
  inicio.init();
  function flush() {
    for (let i = 0; quadros.size && i < 20; i++) {
      const callbacks = [...quadros.values()];
      quadros.clear();
      callbacks.forEach((callback) => callback(0));
    }
    assert.equal(quadros.size, 0, 'os redesenhos não devem formar um ciclo contínuo');
  }
  const linha = (indice) => ({
    // Data antiga confirma que filtros usam o histórico carregado, não Date.now().
    hora: new window.Date(Date.UTC(2020, 0, 1, 12, 0, indice * 30)),
    temperatura: 20 + indice, umidade: 40 + indice, pessoas: indice,
    luminosidade: 60 + indice
  });
  inicio.estado.historico = Array.from({ length: quantidade }, (_, indice) => linha(indice));
  inicio.estado.sensores = { ...inicio.estado.historico.at(-1) };
  inicio.render();
  flush();
  const $ = (id) => window.document.getElementById(id);
  window.document.dispatchEvent(new window.CustomEvent('dashboard:open', { detail: { chave: 'temperatura' } }));
  flush();
  $('btn-ocultar-detalhes').click();
  flush();
  function alterar(id, valor, tipo = 'input') {
    assert.ok($(id), `${id} deve existir`);
    $(id).value = String(valor);
    $(id).dispatchEvent(new window.Event(tipo, { bubbles: true }));
    flush();
  }
  function ponteiro(canvas, tipo, indice, total = quantidade, pointerType = 'mouse', clientY = 100) {
    const x = total === 1 ? 299 : 54 + (490 * indice) / (total - 1);
    const event = new window.MouseEvent(tipo, { clientX: x, clientY, bubbles: true });
    Object.defineProperty(event, 'pointerType', { value: pointerType });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    canvas.dispatchEvent(event);
    flush();
  }
  function tecla(canvas, key) {
    canvas.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    flush();
  }
  async function baixar() {
    $('btn-baixar').click();
    await new Promise((resolve) => setImmediate(resolve));
    flush();
  }
  return { window, $, estado: inicio.estado, render: inicio.render, linha, alterar, ponteiro, tecla, flush, blobs, relogio, baixar };
}

function conferirFoco($, leitura, visivel = true) {
  const principal = $('grafico-principal-slot').querySelector('canvas').id.replace('grafico-', '');
  for (const metrica of metricas) {
    const tooltip = $(`grafico-${metrica}-tooltip`);
    const mostrar = visivel && metrica === principal;
    assert.equal(tooltip.hidden, !mostrar, `${metrica}: visibilidade do tooltip`);
    const wrapper = $(`grafico-${metrica}-wrapper`);
    assert.equal(wrapper.querySelector('.grafico-cursor').hidden, !mostrar, `${metrica}: cursor`);
    assert.equal(wrapper.querySelector('.grafico-marcador').hidden, !mostrar, `${metrica}: marcador`);
    if (mostrar) {
      const casas = metrica === 'temperatura' ? 1 : 0;
      assert.ok(tooltip.textContent.includes(leitura[metrica].toFixed(casas)), `${metrica}: valor da mesma amostra`);
      assert.ok(tooltip.textContent.includes(leitura.hora.toLocaleTimeString('pt-BR', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      })), `${metrica}: mesmo horário em foco`);
    }
  }
}

test('somente hover no principal mostra seus dados e mantém os outros dashboards ocultos', async (t) => {
  const { $, estado, ponteiro } = await setup(t);
  assert.equal($('graficos-complementares').hidden, true);
  ponteiro($('grafico-umidade'), 'pointermove', 3);
  assert.equal($('graficos-complementares').hidden, true, 'eventos no complementar oculto não revelam a área');
  const canvas = $('grafico-temperatura');
  ponteiro(canvas, 'pointermove', 3);
  assert.equal($('graficos-complementares').hidden, true);
  conferirFoco($, estado.historico[3]);
  assert.ok($('historico-selecao').textContent.includes('23.0'));
  assert.doesNotMatch($('historico-selecao').textContent, /umidade:|ocupação da sala:|luminosidade:/);
  assert.equal($('complementares-contexto').textContent, '');
  ponteiro(canvas, 'pointerleave', 3);
  assert.equal($('graficos-complementares').hidden, true);
  conferirFoco($, estado.historico[3]);
  ponteiro($('grafico-umidade'), 'pointermove', 6);
  conferirFoco($, estado.historico[3]);
});

test('o hover atualiza somente o ponto do principal sem recortar seus dados gerais', async (t) => {
  const { $, estado, ponteiro } = await setup(t, 21);
  const completo = JSON.stringify(estado.historico);
  const principal = $('grafico-temperatura');
  ponteiro(principal, 'pointermove', 10, 21);
  conferirFoco($, estado.historico[10]);
  assert.equal($('graf-temperatura-min').textContent, '20.0 °C');
  assert.equal($('graf-temperatura-max').textContent, '40.0 °C');
  assert.equal($('graf-temperatura-atual').textContent, '40.0 °C');
  for (const metrica of metricas.slice(1)) {
    for (const campo of ['atual', 'min', 'med', 'max']) {
      assert.equal($(`graf-${metrica}-${campo}`).textContent, '--', `${metrica}: dados ocultos`);
    }
    assert.match($(`grafico-${metrica}`).getAttribute('aria-label'), /Sem leituras/);
  }
  ponteiro(principal, 'pointermove', 18, 21);
  conferirFoco($, estado.historico[18]);
  assert.equal($('graf-umidade-atual').textContent, '--');
  assert.equal($('graficos-complementares').hidden, true);
  assert.equal(JSON.stringify(estado.historico), completo, 'hover não altera as amostras originais');
});

test('pontos nas extremidades continuam interativos sem revelar outros dashboards', async (t) => {
  const { $, estado, ponteiro, flush } = await setup(t, 21);
  const canvas = $('grafico-temperatura');
  ponteiro(canvas, 'pointermove', 0, 21);
  conferirFoco($, estado.historico[0]);
  assert.equal($('graf-umidade-min').textContent, '--');
  assert.equal($('graficos-complementares').hidden, true);
  ponteiro(canvas, 'pointermove', 20, 21);
  conferirFoco($, estado.historico[20]);
  assert.equal($('graf-umidade-min').textContent, '--');
  $('btn-ocultar-detalhes').click();
  flush();
  assert.equal($('graficos-complementares').hidden, true);
  conferirFoco($, null, false);
  ponteiro(canvas, 'pointermove', 10, 21);
  assert.equal($('graficos-complementares').hidden, true, 'novo hover mantém os outros dashboards ocultos');
  conferirFoco($, estado.historico[10]);
});

test('clique fixa a leitura entre gráficos e novo clique na mesma amostra libera', async (t) => {
  const { $, estado, ponteiro } = await setup(t);
  const canvas = $('grafico-temperatura');
  ponteiro(canvas, 'click', 2);
  ponteiro(canvas, 'pointerleave', 2);
  conferirFoco($, estado.historico[2]);
  ponteiro($('grafico-pessoas'), 'pointermove', 6);
  conferirFoco($, estado.historico[2]);
  ponteiro(canvas, 'click', 2);
  ponteiro(canvas, 'pointerleave', 2);
  conferirFoco($, null, false);
});

test('toque curto fixa um ponto sem depender de hover', async (t) => {
  const { $, estado, ponteiro } = await setup(t);
  const canvas = $('grafico-temperatura');
  ponteiro(canvas, 'pointerdown', 4, 8, 'touch');
  ponteiro(canvas, 'pointerup', 4, 8, 'touch');
  // Navegadores também disparam click depois do toque; não deve desfazer a fixação.
  ponteiro(canvas, 'click', 4, 8, 'touch');
  ponteiro(canvas, 'pointerleave', 4, 8, 'touch');
  conferirFoco($, estado.historico[4]);
});

test('gesto vertical de rolagem no toque não fixa uma leitura acidentalmente', async (t) => {
  const { $, ponteiro } = await setup(t);
  const canvas = $('grafico-temperatura');
  ponteiro(canvas, 'pointerdown', 3, 8, 'touch', 100);
  ponteiro(canvas, 'pointermove', 3, 8, 'touch', 150);
  ponteiro(canvas, 'pointerup', 3, 8, 'touch', 150);
  ponteiro(canvas, 'pointerleave', 3, 8, 'touch', 150);
  conferirFoco($, null, false);
});

test('gráficos oferecem instruções e navegação pelo teclado com liberação por Escape', async (t) => {
  const { $, estado, window, tecla } = await setup(t);
  for (const metrica of metricas) {
    const canvas = $(`grafico-${metrica}`);
    assert.equal(canvas.tabIndex, 0);
    const ids = (canvas.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    assert.ok(ids.length > 0);
    assert.ok(ids.every((id) => window.document.getElementById(id)));
  }
  const canvas = $('grafico-temperatura');
  tecla(canvas, 'Home');
  conferirFoco($, estado.historico[0]);
  tecla(canvas, 'ArrowRight');
  conferirFoco($, estado.historico[1]);
  tecla(canvas, 'End');
  conferirFoco($, estado.historico.at(-1));
  tecla(canvas, 'ArrowLeft');
  conferirFoco($, estado.historico.at(-2));
  tecla(canvas, 'Escape');
  conferirFoco($, null, false);
  assert.equal($('graficos-complementares').hidden, true);
  assert.equal($('dashboard-detalhes').hidden, false, 'Escape libera a inspeção sem sair do dashboard ampliado');
  assert.equal($('aba-sensores').dataset.visualizacao, 'detalhes');
});

test('datas padrão seguem o dia local nas mudanças de mês e de ano', async (t) => {
  const { $, window, relogio, flush } = await setup(t, 8, new Date(2026, 0, 31, 23, 59, 30));
  assert.equal($('historico-inicio').type, 'date');
  assert.equal($('historico-fim').type, 'date');
  assert.equal($('historico-inicio').value, '2026-01-31');
  assert.equal($('historico-fim').value, '2026-01-31');
  assert.equal($('historico-download-periodo').textContent, '31/01/2026 a 31/01/2026');
  for (const [instante, esperado] of [
    [new Date(2026, 1, 1, 0, 1), '2026-02-01'],
    [new Date(2026, 11, 31, 23, 59), '2026-12-31'],
    [new Date(2027, 0, 1, 0, 1), '2027-01-01']
  ]) {
    relogio.agora = Number(instante);
    window.dispatchEvent(new window.Event('focus'));
    flush();
    assert.equal($('historico-inicio').value, esperado);
    assert.equal($('historico-fim').value, esperado);
  }
});

test('datas escolhidas permanecem ao retomar e renderizar, e Hoje restaura o padrão atual', async (t) => {
  const { $, window, alterar, relogio, render, flush } = await setup(t, 8, new Date(2026, 9, 29, 12));
  alterar('historico-inicio', '2025-12-20');
  alterar('historico-fim', '2026-01-05', 'change');
  relogio.agora = Number(new Date(2027, 0, 1, 9));
  window.dispatchEvent(new window.Event('focus'));
  render(); flush();
  assert.equal($('historico-inicio').value, '2025-12-20');
  assert.equal($('historico-fim').value, '2026-01-05');
  assert.equal($('historico-download-periodo').textContent, '20/12/2025 a 05/01/2026');
  $('btn-periodo-hoje').click(); flush();
  assert.equal($('historico-inicio').value, '2027-01-01');
  assert.equal($('historico-fim').value, '2027-01-01');
  assert.equal($('historico-download-status').textContent, '');
  relogio.agora = Number(new Date(2027, 1, 1, 9));
  window.dispatchEvent(new window.Event('focus')); flush();
  assert.equal($('historico-inicio').value, '2027-02-01');
  assert.equal($('historico-fim').value, '2027-02-01');
});

test('download inclui os dias inicial e final completos sem recortar gráficos nem alterar o buffer', async (t) => {
  const { $, window, estado, linha, alterar, render, flush, baixar, blobs } = await setup(t, 6, new Date(2026, 9, 31, 12));
  const horarios = [
    new window.Date(2026, 9, 28, 23, 59, 59, 999),
    new window.Date(2026, 9, 29, 0, 0, 0, 0),
    new window.Date(2026, 9, 29, 23, 59, 59, 999),
    new window.Date(2026, 9, 30, 0, 0, 0, 0),
    new window.Date(2026, 9, 30, 23, 59, 59, 999),
    new window.Date(2026, 9, 31, 0, 0, 0, 0)
  ];
  estado.historico = horarios.map((hora, indice) => ({ ...linha(indice), hora, temperatura: (indice + 1) * 10 }));
  estado.sensores = { ...estado.historico.at(-1) };
  render(); flush();
  const buffer = estado.historico;
  const completo = JSON.stringify(buffer);
  alterar('historico-inicio', '2026-10-29');
  alterar('historico-fim', '2026-10-30');
  const conferirGraficoCompleto = () => {
    assert.match($('grafico-temperatura').getAttribute('aria-label'), /6 leituras no período/);
    assert.equal($('graf-temperatura-min').textContent, '10.0 °C');
    assert.equal($('graf-temperatura-med').textContent, '35.0 °C');
    assert.equal($('graf-temperatura-max').textContent, '60.0 °C');
    assert.equal($('graf-temperatura-atual').textContent, '60.0 °C');
  };
  conferirGraficoCompleto();
  await baixar();
  assert.equal(blobs.length, 1);
  const pdf = new TextDecoder().decode(await blobs[0].arrayBuffer());
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.ok(pdf.includes('(Total: 4 leituras)'));
  assert.equal((pdf.match(/\(29\/10\/2026\)/g) || []).length, 2);
  assert.equal((pdf.match(/\(30\/10\/2026\)/g) || []).length, 2);
  for (const valor of ['20,0 C', '30,0 C', '40,0 C', '50,0 C']) assert.ok(pdf.includes(`(${valor})`));
  for (const valor of ['10,0 C', '60,0 C']) assert.equal(pdf.includes(`(${valor})`), false);
  conferirGraficoCompleto();
  assert.equal(estado.historico, buffer);
  assert.equal(JSON.stringify(estado.historico), completo);
  assert.match($('historico-download-status').textContent, /4 leituras/);
});

test('dia com transição de horário de verão exclui as primeiras leituras do dia seguinte', async (t) => {
  const { $, window, estado, linha, alterar, render, flush, baixar, blobs } = await setup(t, 3, new Date(2018, 10, 4, 12));
  estado.historico = [
    { ...linha(0), hora: new window.Date(2018, 10, 4, 12), temperatura: 21 },
    { ...linha(1), hora: new window.Date(2018, 10, 4, 23, 59, 59, 999), temperatura: 22 },
    { ...linha(2), hora: new window.Date(2018, 10, 5, 0, 30), temperatura: 99 }
  ];
  estado.sensores = { ...estado.historico.at(-1) };
  render(); flush();
  alterar('historico-inicio', '2018-11-04');
  alterar('historico-fim', '2018-11-04');
  await baixar();
  assert.equal(blobs.length, 1);
  const pdf = new TextDecoder().decode(await blobs[0].arrayBuffer());
  assert.ok(pdf.includes('(Total: 2 leituras)'));
  assert.ok(pdf.includes('(21,0 C)'));
  assert.ok(pdf.includes('(22,0 C)'));
  assert.equal(pdf.includes('(99,0 C)'), false);
  assert.equal((pdf.match(/\(04\/11\/2018\)/g) || []).length, 2);
  assert.equal($('historico-inicio').value, '2018-11-04');
  assert.equal($('historico-fim').value, '2018-11-04');
});

test('datas vazias ou invertidas informam o erro no campo sem consultar nem baixar', async (t) => {
  const { $, window, alterar, baixar, blobs } = await setup(t);
  let consultas = 0;
  window.senaiAuth.loadHistoryForExport = async () => { consultas++; return []; };
  for (const invalido of ['historico-inicio', 'historico-fim']) {
    alterar('historico-inicio', '2020-01-01');
    alterar('historico-fim', '2020-01-01');
    alterar(invalido, '');
    await baixar();
    assert.equal($(invalido).getAttribute('aria-invalid'), 'true');
    assert.equal(window.document.activeElement, $(invalido));
    assert.match($('historico-download-status').textContent, /Preencha.*data inicial.*data final/);
    assert.equal($('historico-download-status').dataset.erro, 'true');
  }
  alterar('historico-inicio', '2020-01-02');
  alterar('historico-fim', '2020-01-01');
  await baixar();
  assert.equal($('historico-fim').getAttribute('aria-invalid'), 'true');
  assert.match($('historico-download-status').textContent, /data final.*igual ou posterior.*data inicial/);
  assert.equal(consultas, 0);
  assert.equal(blobs.length, 0);
  alterar('historico-fim', '2020-01-02');
  assert.equal($('historico-inicio').hasAttribute('aria-invalid'), false);
  assert.equal($('historico-fim').hasAttribute('aria-invalid'), false);
  assert.equal($('historico-download-status').textContent, '');
});

test('buffer vazio mantém calendários disponíveis e um período sem leituras não gera PDF', async (t) => {
  const { $, estado, alterar, render, flush, baixar, blobs } = await setup(t);
  estado.historico = [];
  estado.sensores = null;
  render(); flush();
  for (const id of ['historico-inicio', 'historico-fim', 'btn-periodo-hoje', 'btn-baixar']) {
    assert.equal($(id).disabled, false, `${id} continua disponível para consultar outras datas`);
  }
  alterar('historico-inicio', '2020-01-01');
  alterar('historico-fim', '2020-01-02');
  await baixar();
  assert.equal(blobs.length, 0);
  assert.match($('historico-download-status').textContent, /Nenhuma leitura.*Escolha outro período/);
  assert.equal($('historico-download-status').dataset.erro, 'true');
  assert.equal($('historico-download-form').hasAttribute('aria-busy'), false);
  for (const id of ['historico-inicio', 'historico-fim', 'btn-periodo-hoje', 'btn-baixar']) assert.equal($(id).disabled, false);
});

test('exportação remota usa limites locais, bloqueia duplicatas e exporta somente a consulta concluída', async (t) => {
  const { $, window, estado, linha, alterar, blobs, flush } = await setup(t);
  alterar('historico-inicio', '2026-12-31');
  alterar('historico-fim', '2027-01-01');
  const buffer = JSON.stringify(estado.historico);
  const consultas = [];
  let concluir;
  const consulta = new Promise((resolve) => { concluir = resolve; });
  window.senaiAuth.loadHistoryForExport = async (inicio, fim) => {
    consultas.push({ inicio, fim });
    return consulta;
  };
  const textoOriginal = $('btn-baixar').textContent;
  $('btn-baixar').click();
  assert.equal(consultas.length, 1);
  assert.ok(consultas[0].inicio instanceof window.Date);
  assert.ok(consultas[0].fim instanceof window.Date);
  assert.equal(Number(consultas[0].inicio), Number(new window.Date(2026, 11, 31, 0, 0, 0, 0)));
  assert.equal(Number(consultas[0].fim), Number(new window.Date(2027, 0, 2, 0, 0, 0, 0)));
  assert.equal($('historico-download-form').getAttribute('aria-busy'), 'true');
  assert.match($('historico-download-status').textContent, /Buscando.*leituras/);
  for (const id of ['historico-inicio', 'historico-fim', 'btn-periodo-hoje', 'btn-baixar']) assert.equal($(id).disabled, true);
  assert.match($('btn-baixar').textContent, /Preparando PDF/);
  $('btn-baixar').click();
  $('historico-download-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(consultas.length, 1);
  assert.equal(blobs.length, 0, 'o PDF aguarda a consulta completa');
  concluir([
    { ...linha(0), hora: new window.Date(2026, 11, 30, 23, 59, 59, 999), temperatura: 88 },
    { ...linha(0), hora: new window.Date(2027, 0, 1, 23, 59, 59, 999), temperatura: 100 },
    { ...linha(0), hora: new window.Date(2026, 11, 31, 0, 0, 0, 0), temperatura: 99 },
    { ...linha(0), hora: new window.Date(2027, 0, 2, 0, 0, 0, 0), temperatura: 77 }
  ]);
  await new Promise(setImmediate); flush();
  assert.equal(blobs.length, 1);
  const pdf = new TextDecoder().decode(await blobs[0].arrayBuffer());
  assert.ok(pdf.includes('(Total: 2 leituras)'));
  assert.ok(pdf.includes('(99,0 C)'));
  assert.ok(pdf.includes('(100,0 C)'));
  for (const valor of ['20,0 C', '27,0 C', '88,0 C', '77,0 C']) assert.equal(pdf.includes(`(${valor})`), false);
  assert.ok(pdf.indexOf('(99,0 C)') < pdf.indexOf('(100,0 C)'), 'leituras remotas são ordenadas por data');
  assert.equal(JSON.stringify(estado.historico), buffer);
  assert.equal($('historico-download-form').hasAttribute('aria-busy'), false);
  for (const id of ['historico-inicio', 'historico-fim', 'btn-periodo-hoje', 'btn-baixar']) assert.equal($(id).disabled, false);
  assert.equal($('btn-baixar').textContent, textoOriginal);
  assert.match($('historico-download-status').textContent, /Download iniciado: 2 leituras/);
});

test('virada do dia mantém o período durante a consulta e atualiza os padrões depois do download', async (t) => {
  const { $, window, relogio, blobs, flush } = await setup(t, 8, new Date(2026, 11, 31, 23, 59, 30));
  let concluir;
  const consulta = new Promise((resolve) => { concluir = resolve; });
  let limites;
  window.senaiAuth.loadHistoryForExport = async (inicio, fim) => {
    limites = { inicio: Number(inicio), fim: Number(fim) };
    return consulta;
  };
  $('btn-baixar').click();
  relogio.agora = Number(new Date(2027, 0, 1, 0, 1));
  window.dispatchEvent(new window.Event('focus')); flush();
  assert.equal($('historico-inicio').value, '2026-12-31');
  assert.equal($('historico-fim').value, '2026-12-31');
  assert.equal(limites.inicio, Number(new window.Date(2026, 11, 31, 0)));
  assert.equal(limites.fim, Number(new window.Date(2027, 0, 1, 0)));
  concluir([{ hora: new window.Date(2026, 11, 31, 12), temperatura: 25, umidade: 50, pessoas: 3, luminosidade: 60 }]);
  await new Promise(setImmediate); flush();
  assert.equal(blobs.length, 1);
  assert.match($('historico-download-status').textContent, /31\/12\/2026 a 31\/12\/2026/);
  assert.equal($('historico-inicio').value, '2027-01-01');
  assert.equal($('historico-fim').value, '2027-01-01');
  assert.equal($('historico-download-periodo').textContent, '01/01/2027 a 01/01/2027');
});

test('serviço de exportação ausente informa falha sem substituir a consulta pelo buffer', async (t) => {
  const { $, window, alterar, baixar, blobs } = await setup(t);
  alterar('historico-inicio', '2020-01-01');
  alterar('historico-fim', '2020-01-01');
  window.console.warn = () => {};
  delete window.senaiAuth.loadHistoryForExport;
  await baixar();
  assert.equal(blobs.length, 0);
  assert.match($('historico-download-status').textContent, /Não foi possível consultar/);
  assert.equal($('historico-download-status').dataset.erro, 'true');
  assert.equal($('historico-download-form').hasAttribute('aria-busy'), false);
  assert.equal($('btn-baixar').disabled, false);
});

test('falha na consulta remota não usa o buffer como exportação parcial e restaura os controles', async (t) => {
  const { $, window, estado, alterar, baixar, blobs } = await setup(t);
  alterar('historico-inicio', '2020-01-01');
  alterar('historico-fim', '2020-01-01');
  const buffer = JSON.stringify(estado.historico);
  window.console.warn = () => {};
  window.senaiAuth.loadHistoryForExport = async () => { throw new Error('Falha de conexão'); };
  await baixar();
  assert.equal(blobs.length, 0);
  assert.equal(JSON.stringify(estado.historico), buffer);
  assert.match($('historico-download-status').textContent, /Não foi possível consultar.*conexão.*tente novamente/);
  assert.equal($('historico-download-status').dataset.erro, 'true');
  assert.equal($('historico-download-form').hasAttribute('aria-busy'), false);
  for (const id of ['historico-inicio', 'historico-fim', 'btn-periodo-hoje', 'btn-baixar']) assert.equal($(id).disabled, false);
  assert.equal($('btn-baixar').textContent.trim(), 'Baixar histórico');
});

test('perfil sem permissão não consulta nem exporta o buffer disponível', async (t) => {
  const { $, window, alterar, baixar, blobs } = await setup(t);
  alterar('historico-inicio', '2020-01-01');
  alterar('historico-fim', '2020-01-01');
  let consultas = 0;
  window.senaiAuth.canOperatePanel = () => false;
  window.senaiAuth.loadHistoryForExport = async () => { consultas++; return []; };
  await baixar();
  assert.equal(consultas, 0);
  assert.equal(blobs.length, 0);
  assert.match($('historico-download-status').textContent, /não tem permissão.*baixar o histórico/);
  assert.equal($('historico-download-status').dataset.erro, 'true');
  assert.equal($('historico-download-form').hasAttribute('aria-busy'), false);
});
