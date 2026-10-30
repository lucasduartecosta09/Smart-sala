import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const metricas = ['temperatura', 'umidade', 'pessoas', 'luminosidade'];

async function setup(t) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://smartclass.test' });
  t.after(() => dom.window.close());
  const { window } = dom;
  const intervalos = new Map(), quadros = new Map(), desenhos = new Map();
  const leiturasSalvas = [], downloads = [], blobs = [];
  let proximoId = 0, inicio;

  window.requestAnimationFrame = (callback) => {
    const id = ++proximoId;
    quadros.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id) => quadros.delete(id);
  window.setInterval = (callback, atraso) => {
    const id = ++proximoId;
    intervalos.set(id, { callback, atraso });
    return id;
  };
  window.clearInterval = (id) => intervalos.delete(id);
  window.TextEncoder = TextEncoder;
  window.Blob = Blob;
  window.URL.createObjectURL = (blob) => {
    blobs.push(blob);
    return `blob:teste-${blobs.length}`;
  };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () {
    downloads.push({ href: this.href, nome: this.download });
  };
  window.HTMLCanvasElement.prototype.getBoundingClientRect = function () {
    const visivel = !this.closest('[hidden]');
    return { width: visivel ? 560 : 0, height: visivel ? 260 : 0, left: 0, top: 0, right: visivel ? 560 : 0, bottom: visivel ? 260 : 0 };
  };
  window.HTMLCanvasElement.prototype.getContext = function () {
    const id = this.id;
    const gradiente = () => ({ addColorStop() {} });
    return new Proxy({
      clearRect() { desenhos.set(id, (desenhos.get(id) || 0) + 1); },
      createLinearGradient: gradiente,
      createRadialGradient: gradiente,
      measureText: (texto) => ({ width: String(texto).length * 6 })
    }, { get: (alvo, chave) => alvo[chave] ?? (() => {}) });
  };
  window.senaiAuth = {
    start(init, estado, render) { inicio = { init, estado, render }; },
    canOperatePanel: () => true,
    loadHistoryForExport: async () => inicio.estado.historico,
    saveReading: (leitura) => leiturasSalvas.push({ ...leitura }),
    saveEvent() {}
  };

  const carregado = new Promise((resolve) => window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  window.eval(script);
  await carregado;
  assert.ok(inicio, 'o aplicativo deve iniciar pelo contrato de autenticação');
  inicio.init();

  function flush() {
    for (let i = 0; quadros.size && i < 20; i++) {
      const callbacks = [...quadros.values()];
      quadros.clear();
      callbacks.forEach((callback) => callback(0));
    }
    assert.equal(quadros.size, 0, 'os redesenhos devem terminar');
  }
  flush();
  window.document.dispatchEvent(new window.CustomEvent('dashboard:open', { detail: { chave: 'temperatura' } }));
  flush();
  window.document.getElementById('btn-ocultar-detalhes').click();
  flush();

  function usarLeituras(linhas) {
    inicio.estado.historico = linhas.map((linha, indice) => ({
      hora: new window.Date(Date.UTC(2026, 9, 29, 12, 0, indice * 5)),
      ...linha
    }));
    inicio.estado.sensores = { ...inicio.estado.historico.at(-1) };
    inicio.render();
    flush();
  }

  function mostrarComplementares(indice = 0) {
    const total = inicio.estado.historico.length;
    const x = total === 1 ? 299 : 54 + (490 * indice) / (total - 1);
    window.document.getElementById('grafico-temperatura').dispatchEvent(
      new window.MouseEvent('pointermove', { clientX: x, clientY: 100, bubbles: true })
    );
    flush();
  }

  function definirPeriodo(inicio, fim = inicio) {
    for (const [id, valor] of [['historico-inicio', inicio], ['historico-fim', fim]]) {
      const controle = window.document.getElementById(id);
      controle.value = valor;
      controle.dispatchEvent(new window.Event('input', { bubbles: true }));
    }
    flush();
  }

  return {
    window, $: (id) => window.document.getElementById(id),
    estado: inicio.estado, render: inicio.render, usarLeituras, mostrarComplementares, definirPeriodo, flush,
    intervalos, desenhos, leiturasSalvas, downloads, blobs
  };
}

const amostras = [
  { temperatura: 20, umidade: 40, pessoas: 0, luminosidade: 30 },
  { temperatura: 22, umidade: 60, pessoas: 4, luminosidade: 50 },
  { temperatura: 24, umidade: 50, pessoas: 2, luminosidade: 70 }
];

test('o dashboard principal permanece único e os demais continuam ocultos sem duplicação', async (t) => {
  const { $, window, desenhos, mostrarComplementares } = await setup(t);
  assert.equal($('aba-sensores').hidden, false);
  assert.equal($('sensor-grafico'), null);
  assert.equal($('aba-verificacao'), null);
  assert.equal($('aba-btn-verificacao'), null);
  assert.equal(window.document.querySelectorAll('#aba-sensores canvas.grafico').length, 4);
  assert.equal($('graficos-complementares').hidden, true);
  assert.equal($('grafico-temperatura').closest('[hidden]'), null);
  for (const metrica of metricas.slice(1)) {
    assert.ok($('graficos-complementares').contains($(`grafico-${metrica}`)));
  }
  mostrarComplementares(8);
  assert.equal($('graficos-complementares').hidden, true);
  for (const metrica of metricas) {
    const canvas = $(`grafico-${metrica}`);
    assert.ok(canvas, `histórico de ${metrica} preservado`);
    assert.ok($('aba-sensores').contains(canvas));
    assert.equal(Boolean(canvas.closest('[hidden]')), metrica !== 'temperatura');
    assert.ok(desenhos.get(canvas.id) > 0, `${metrica} deve ter sido desenhada`);
    assert.ok(window.document.querySelector(`[data-metrica="${metrica}"]`));
  }
  const ids = [...window.document.querySelectorAll('[id]')].map((elemento) => elemento.id);
  assert.equal(new Set(ids).size, ids.length, 'não deve haver IDs duplicados após a junção');
});

test('cada série conserva unidade, valores e estatísticas independentes', async (t) => {
  const { $, window, usarLeituras, flush } = await setup(t);
  usarLeituras(amostras);
  const esperados = {
    temperatura: { atual: '24.0 °C', min: '20.0 °C', med: '22.0 °C', max: '24.0 °C', tend: 'Subindo' },
    umidade: { atual: '50 %', min: '40 %', med: '50 %', max: '60 %', tend: 'Caindo' },
    pessoas: { atual: '2 pessoas', min: '0 pessoas', med: '2 pessoas', max: '4 pessoas', tend: 'Caindo' },
    luminosidade: { atual: '70 %', min: '30 %', med: '50 %', max: '70 %', tend: 'Subindo' }
  };
  for (const [metrica, valores] of Object.entries(esperados)) {
    window.document.dispatchEvent(new window.CustomEvent('dashboard:select-metric', { detail: { chave: metrica } }));
    flush();
    assert.equal($('grafico-principal-slot').querySelector('canvas'), $(`grafico-${metrica}`));
    assert.equal($('graficos-complementares').hidden, true);
    for (const campo of ['atual', 'min', 'med', 'max']) {
      assert.equal($(`graf-${metrica}-${campo}`).textContent.trim(), valores[campo], `${metrica}: ${campo}`);
    }
    assert.equal($(`graf-${metrica}-tend-texto`).textContent, valores.tend);
    assert.match($(`grafico-${metrica}`).getAttribute('aria-label'), new RegExp(valores.atual.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('uma atualização compartilha a mesma leitura entre todos os gráficos', async (t) => {
  const { $, estado, usarLeituras, mostrarComplementares, flush, desenhos, leiturasSalvas } = await setup(t);
  usarLeituras(amostras);
  mostrarComplementares(1);
  const antes = new Map(desenhos);
  $('btn-atualizar').click();
  flush();
  assert.equal(estado.historico.length, 4);
  assert.equal(leiturasSalvas.length, 1, 'atualizar quatro gráficos deve salvar apenas uma leitura');
  for (const metrica of metricas) {
    assert.equal(estado.historico.at(-1)[metrica], estado.sensores[metrica]);
    assert.ok(desenhos.get(`grafico-${metrica}`) > antes.get(`grafico-${metrica}`), `${metrica} deve refletir a atualização`);
  }
});

test('o intervalo original usa um único temporizador de aquisição e pode ser alterado ou pausado', async (t) => {
  const { $, window, estado, intervalos, leiturasSalvas, flush } = await setup(t);
  assert.equal(estado.autoRefresh, false);
  assert.equal(estado.intervalo, 5);
  const definirAuto = (ligado) => {
    $('auto-refresh').checked = ligado;
    $('auto-refresh').dispatchEvent(new window.Event('change'));
    flush();
  };
  definirAuto(true);
  assert.equal([...intervalos.values()].filter(({ atraso }) => atraso === 5000).length, 1);
  const total = estado.historico.length;
  [...intervalos.values()].find(({ atraso }) => atraso === 5000).callback();
  flush();
  assert.equal(estado.historico.length, total + 1);
  assert.equal(leiturasSalvas.length, 1);

  $('intervalo').value = '10';
  $('intervalo').dispatchEvent(new window.Event('input'));
  assert.equal([...intervalos.values()].filter(({ atraso }) => atraso === 5000).length, 0);
  assert.equal([...intervalos.values()].filter(({ atraso }) => atraso === 10000).length, 1);
  definirAuto(false);
  assert.equal([...intervalos.values()].filter(({ atraso }) => atraso >= 2000).length, 0);
  assert.equal($('intervalo').disabled, true);
});

test('presença reúne status, contagem zero/uma/várias pessoas e variação no mesmo cartão', async (t) => {
  const { $, window, usarLeituras } = await setup(t);
  for (const pessoas of [0, 1, 3]) {
    usarLeituras([{ ...amostras[0], pessoas: 0 }, { ...amostras[1], pessoas }]);
    assert.equal($('m-pessoas').textContent.trim(), String(pessoas));
    assert.equal($('m-presenca').textContent.trim(), pessoas === 0 ? 'Vazia' : 'Ocupada');
    assert.match($('m-pessoas-delta').textContent, new RegExp(`${pessoas} pessoa${pessoas === 1 ? '(?!s)' : 's'}`));
    assert.ok($('m-pessoas').closest('.metrica').contains($('m-presenca')));
    assert.equal(window.document.querySelectorAll('#m-pessoas').length, 1);
  }
});

test('limpar histórico conserva a última leitura e atualiza todas as séries', async (t) => {
  const { $, window, estado, usarLeituras, flush } = await setup(t);
  usarLeituras(amostras);
  const ultima = estado.historico.at(-1);
  $('btn-limpar').click();
  flush();
  assert.equal(estado.historico.length, 1);
  assert.equal(estado.historico[0], ultima);
  for (const metrica of metricas) {
    window.document.dispatchEvent(new window.CustomEvent('dashboard:select-metric', { detail: { chave: metrica } }));
    flush();
    assert.equal($(`graf-${metrica}-min`).textContent, $(`graf-${metrica}-atual`).textContent);
    assert.equal($(`graf-${metrica}-max`).textContent, $(`graf-${metrica}-atual`).textContent);
    assert.equal($(`graf-${metrica}-tend-texto`).textContent, 'Estável');
  }
});

test('exportação PDF organiza as quatro métricas e as leituras das datas escolhidas', async (t) => {
  const { $, usarLeituras, definirPeriodo, downloads, blobs } = await setup(t);
  usarLeituras(amostras);
  definirPeriodo('2026-10-29');
  assert.equal($('btn-baixar').textContent.trim(), 'Baixar histórico');
  assert.equal($('historico-inicio').type, 'date');
  assert.equal($('historico-fim').type, 'date');
  assert.equal($('btn-baixar').form, $('historico-download-form'));
  $('btn-baixar').click();
  await new Promise(setImmediate);
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].nome, 'historico-sensores_2026-10-29_a_2026-10-29.pdf');
  assert.equal(blobs[0].type, 'application/pdf');
  const pdf = new TextDecoder().decode(await blobs[0].arrayBuffer());
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.ok(pdf.endsWith('%%EOF'));
  for (const cabecalho of ['Temperatura \\(C\\)', 'Umidade \\(%\\)', 'Luminosidade \\(%\\)', 'Pessoas']) {
    assert.ok(pdf.includes(`(${cabecalho})`), cabecalho);
  }
  assert.ok(pdf.includes('(Total: 3 leituras)'));
  assert.equal((pdf.match(/\(29\/10\/2026\)/g) || []).length, amostras.length);
  for (const valor of ['20,0 C', '22,0 C', '24,0 C', '40 %', '60 %', '70 %']) assert.ok(pdf.includes(`(${valor})`));
});

test('exportação PDF pagina históricos extensos sem remover leituras', async (t) => {
  const { $, usarLeituras, definirPeriodo, blobs } = await setup(t);
  usarLeituras(Array.from({ length: 45 }, (_, indice) => ({
    ...amostras[indice % amostras.length],
    pessoas: indice
  })));
  definirPeriodo('2026-10-29');
  $('btn-baixar').click();
  await new Promise(setImmediate);
  assert.equal(blobs.length, 1);
  const pdf = new TextDecoder().decode(await blobs[0].arrayBuffer());
  assert.ok(pdf.includes('/Type /Pages /Count 3'));
  assert.ok(pdf.includes('(Pagina 3 de 3)'));
  assert.ok(pdf.includes('(Total: 45 leituras)'));
  assert.equal((pdf.match(/\(29\/10\/2026\)/g) || []).length, 45);
  assert.ok(pdf.endsWith('%%EOF'));
});
