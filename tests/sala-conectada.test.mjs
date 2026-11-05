import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
// Mesma ordem do index.html.
const scripts = ['assets/arduino.js', 'assets/remoto.js', 'app.js'].map((nome) => readFileSync(new URL(`../${nome}`, import.meta.url), 'utf8'));
const esperar = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

// A Vercel deste projeto publica a pasta assets/ inteira, mas da raiz só os arquivos de sempre.
// Um script ou estilo novo na raiz daria 404 no site (aconteceu em 05/11/2026).
test('scripts e estilos locais ficam na raiz de sempre ou em assets/', () => {
  const documento = new JSDOM(html).window.document;
  const raiz = new Set(['theme-init.js', 'visual.css', 'senai-auth.css', 'senai-auth.js', 'app.js']);
  for (const elemento of documento.querySelectorAll('script[src], link[rel="stylesheet"][href]')) {
    const caminho = elemento.getAttribute('src') || elemento.getAttribute('href');
    if (/^https:\/\//.test(caminho)) continue;
    assert.ok(raiz.has(caminho) || caminho.startsWith('assets/'), `${caminho} não seria publicado`);
  }
});

function linhaSensores({ pir = 'PRESENCA', luz = 100, dht = 'T=24.0C UR=55.0%', lampada = 'OFF', ventilador = 'OFF', modo = 'AUTO', porta = null } = {}) {
  return `[SENSORES] PIR=${pir} | LDR=1 | luz_relativa=${luz}% | ${dht} | LUZ=${lampada} | FAN=${ventilador} | SMART=${lampada} | ` +
    `LUMINARIA_PIR=ON | RETENCAO=0s | MODO=${modo}${porta ? ` | PORTA=${porta}` : ''}\r\n`;
}

function criarPorta() {
  let controlador;
  const porta = {
    escritos: [],
    readable: null,
    writable: null,
    getInfo: () => ({ usbVendorId: 0x2341, usbProductId: 0x1002 }),
    async open() {
      porta.readable = new ReadableStream({ start(c) { controlador = c; } });
      porta.writable = new WritableStream({ write(pedaco) { porta.escritos.push(new TextDecoder().decode(pedaco).trim()); } });
    },
    async close() {},
    falar(texto) { controlador.enqueue(new TextEncoder().encode(texto)); },
    perderCabo() {
      controlador.error(Object.assign(new Error('perdido'), { name: 'NetworkError' }));
      porta.readable = null;
    }
  };
  return porta;
}

function criarHub() {
  const salas = new Map();
  let fechado = false;
  return {
    // Depois do teste, nada mais é entregue às páginas já fechadas.
    fechar() { fechado = true; },
    canal(nome) {
      const ouvintes = [];
      const canal = {
        on(_tipo, filtro, funcao) { ouvintes.push({ evento: filtro.event, funcao }); return canal; },
        subscribe(aviso) {
          if (!salas.has(nome)) salas.set(nome, new Set());
          salas.get(nome).add(canal);
          setTimeout(() => aviso('SUBSCRIBED'));
          return canal;
        },
        async send({ event, payload }) {
          for (const outro of salas.get(nome) || []) {
            if (outro === canal) continue;
            for (const ouvinte of outro.ouvintes) {
              if (ouvinte.evento !== event) continue;
              setTimeout(() => {
                if (!fechado) ouvinte.funcao({ payload: JSON.parse(JSON.stringify(payload)) });
              });
            }
          }
          return 'ok';
        },
        async unsubscribe() { salas.get(nome)?.delete(canal); return 'ok'; },
        ouvintes
      };
      return canal;
    }
  };
}

async function abrirPainel(t, { porta = null, hub = criarHub(), podeOperar = true, voz = false } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://smartclass.test/' });
  t.after(() => dom.window.close());
  const { window } = dom;
  // Relógio da própria página: ao fechar a janela do teste, os redesenhos pendentes somem junto.
  window.requestAnimationFrame = (funcao) => window.setTimeout(() => funcao(0), 0);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  window.TextEncoder = TextEncoder;
  window.TextDecoder = TextDecoder;
  Object.defineProperty(window, 'crypto', { value: globalThis.crypto, configurable: true });
  window.HTMLCanvasElement.prototype.getBoundingClientRect = function () {
    const visivel = !this.closest('[hidden]');
    return { width: visivel ? 560 : 0, height: visivel ? 260 : 0, left: 0, top: 0, right: visivel ? 560 : 0, bottom: visivel ? 260 : 0 };
  };
  window.HTMLCanvasElement.prototype.getContext = () => new Proxy({
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} })
  }, { get: (alvo, chave) => alvo[chave] ?? (() => {}) });
  if (porta) {
    Object.defineProperty(window.navigator, 'serial', {
      configurable: true,
      value: { requestPort: async () => porta, getPorts: async () => [porta], addEventListener() {} }
    });
  }
  const reconhecimentos = [];
  if (voz) {
    window.webkitSpeechRecognition = class {
      constructor() { reconhecimentos.push(this); }
      start() { setTimeout(() => this.onstart?.()); }
      stop() { setTimeout(() => this.onend?.()); }
      abort() {}
      addEventListener() {}
    };
  }
  const leituras = [];
  let inicio;
  window.senaiAuth = {
    canOperatePanel: () => podeOperar,
    start(init, estado, render) { inicio = { init, estado, render }; },
    saveReading: async (leitura, origem) => { leituras.push({ ...leitura, origem }); return { ok: true }; },
    saveEvent() {},
    loadHistoryForExport: async () => [],
    realtimeChannel: (nome) => hub.canal(nome)
  };
  const carregado = new Promise((resolve) => window.document.addEventListener('DOMContentLoaded', resolve, { once: true }));
  for (const fonte of scripts) window.eval(fonte);
  await carregado;
  inicio.init();
  await esperar();
  const $ = (id) => window.document.getElementById(id);
  const clicar = async (id) => { $(id).click(); await esperar(); };
  return { window, $, clicar, estado: inicio.estado, leituras, reconhecimentos, hub };
}

async function conectarArduino(painel, porta, linha = linhaSensores()) {
  await painel.clicar('btn-arduino-config');
  porta.falar('SENAI SMART CLASS - Equipe 01 - Firmware v3.6\r\n');
  porta.falar(linha);
  await esperar();
}

test('Arduino na USB troca a simulação pelas leituras reais e recebe as regras do painel', async (t) => {
  const porta = criarPorta();
  const painel = await abrirPainel(t, { porta });
  const { $, estado } = painel;
  assert.equal($('fonte-dados-texto').textContent, 'Dados simulados');
  assert.equal($('btn-arduino').hidden, false, 'o botão aparece quando o navegador tem USB');

  await conectarArduino(painel, porta);
  assert.equal(estado.fonte, 'arduino');
  assert.equal($('fonte-dados-texto').textContent, 'Ao vivo · Arduino');
  assert.equal($('m-temp').textContent, '24.0 °C');
  assert.equal($('m-umid').textContent, '55 %');
  assert.equal($('m-lux').textContent, 'Claro');
  assert.equal($('m-pessoas').textContent, 'Detectada');
  assert.equal($('m-presenca').textContent, 'Ocupada');
  assert.equal($('m-pessoas-rotulo').textContent, 'Presença na sala (PIR)');
  assert.equal(estado.historico.length, 1, 'o gráfico recomeça só com leituras reais');
  assert.equal(estado.modoAuto, true, 'o painel espelha o modo AUTO do Arduino');
  assert.ok(porta.escritos.includes('LIMIAR_TEMP 28'));
  assert.ok(porta.escritos.includes('LIMIAR_LUZ 40'));
  assert.equal(painel.leituras.at(-1).origem, 'ARDUINO');
  assert.equal(painel.leituras.at(-1).pessoas, 1);
  assert.match($('arduino-situacao').textContent, /Conectado pela USB · firmware v3\.6/);
});

test('cada controle das telas vira um comando que o firmware entende', async (t) => {
  const porta = criarPorta();
  const painel = await abrirPainel(t, { porta });
  const { $, window, estado, clicar } = painel;
  await conectarArduino(painel, porta);
  porta.escritos.length = 0;

  $('modo-auto').checked = false;
  $('modo-auto').dispatchEvent(new window.Event('change'));
  await esperar();
  assert.deepEqual(porta.escritos, ['MANUAL']);

  await clicar('btn-ventilador');
  await clicar('btn-leds');
  assert.deepEqual(porta.escritos.slice(1), ['VENTILADOR 1', 'LUZ 1']);

  // Uma linha antiga (FAN=OFF) chegando logo depois não desfaz o comando recém-enviado.
  porta.falar(linhaSensores({ modo: 'MANUAL' }));
  await esperar();
  assert.equal(estado.ventiladorLigado, true);
  assert.equal($('pill-ventilador').textContent, 'LIGADO');

  $('temp-alta').value = '30';
  $('temp-alta').dispatchEvent(new window.Event('input'));
  $('temp-alta').dispatchEvent(new window.Event('change'));
  await esperar();
  assert.equal(porta.escritos.at(-1), 'LIMIAR_TEMP 30');

  porta.escritos.length = 0;
  await clicar('btn-desligar-tudo');
  assert.ok(porta.escritos.includes('VENTILADOR 0'));
  assert.ok(porta.escritos.includes('LUZ 0'));
  assert.ok(porta.escritos.includes('MANUAL'));
});

test('a porta só funciona com o firmware v3.7, que traz o servo', async (t) => {
  const porta = criarPorta();
  const painel = await abrirPainel(t, { porta });
  const { $, clicar } = painel;
  await conectarArduino(painel, porta, linhaSensores({ modo: 'MANUAL' }));
  assert.equal($('btn-servo').disabled, true);
  assert.equal($('pill-servo').textContent, 'SEM SERVO');

  porta.falar(linhaSensores({ modo: 'MANUAL', porta: 'FECHADA' }));
  await esperar();
  assert.equal($('btn-servo').disabled, false);
  assert.equal($('pill-servo').textContent, 'FECHADO');
  porta.escritos.length = 0;
  await clicar('btn-servo');
  assert.deepEqual(porta.escritos, ['PORTA 1']);
});

test('DHT11 sem leitura mantém o último valor por alguns segundos e avisa', async (t) => {
  const porta = criarPorta();
  const painel = await abrirPainel(t, { porta });
  const { $ } = painel;
  await conectarArduino(painel, porta);
  porta.falar(linhaSensores({ dht: 'DHT=ERRO/AGUARDANDO' }));
  await esperar();
  assert.equal($('m-temp').textContent, '24.0 °C', 'falha isolada não apaga a temperatura');
  assert.equal($('fonte-dados-texto').textContent, 'Ao vivo · DHT11 sem leitura');
  assert.equal(painel.estado.historico.length, 1, 'leitura sem DHT11 não entra no gráfico');
});

test('aluno acompanha o Arduino, mas não comanda os equipamentos', async (t) => {
  const porta = criarPorta();
  const painel = await abrirPainel(t, { porta, podeOperar: false });
  await conectarArduino(painel, porta, linhaSensores({ modo: 'MANUAL' }));
  assert.equal(painel.$('m-temp').textContent, '24.0 °C');
  assert.equal(painel.$('btn-ventilador').disabled, true);
  assert.equal(painel.$('btn-leds').disabled, true);
  assert.deepEqual(porta.escritos, [], 'nem as regras são enviadas');
});

test('cabo solto deixa o aviso e os dados congelados, sem voltar à simulação', async (t) => {
  const porta = criarPorta();
  const painel = await abrirPainel(t, { porta });
  await conectarArduino(painel, porta);
  porta.perderCabo();
  await esperar();
  assert.equal(painel.estado.fonte, 'arduino');
  assert.equal(painel.$('fonte-dados-texto').textContent, 'Arduino desconectado · confira o cabo USB');
  assert.equal(painel.$('btn-arduino').textContent.trim(), 'Reconectar Arduino');
});

test('voz no celular liga o ventilador do Arduino ligado no notebook da TV', async (t) => {
  const hub = criarHub();
  t.after(() => hub.fechar());
  const porta = criarPorta();
  const notebook = await abrirPainel(t, { porta, hub });
  await conectarArduino(notebook, porta);

  // Notebook: libera o controle pelo celular. O código fica oculto (a tela está na TV).
  await notebook.clicar('btn-ponte');
  assert.equal(notebook.$('ponte-codigo').textContent, '••••-••••-••••-••••');
  await notebook.clicar('btn-ponte-mostrar');
  const codigo = notebook.$('ponte-codigo').textContent;
  assert.match(codigo, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);

  // Celular: entra na sala com o código.
  const celular = await abrirPainel(t, { hub, voz: true });
  celular.$('controle-codigo').value = codigo.toLowerCase();
  celular.$('controle-form').dispatchEvent(new celular.window.Event('submit', { cancelable: true }));
  await esperar(80);
  assert.equal(celular.estado.fonte, 'remoto');
  assert.equal(celular.$('fonte-dados-texto').textContent, 'Ao vivo · Arduino da sala');
  assert.equal(celular.$('m-temp').textContent, '24.0 °C');
  assert.equal(celular.$('m-pessoas').textContent, 'Detectada');
  assert.equal(celular.estado.historico.length, 1, 'o celular recebe o histórico da sala');
  assert.match(notebook.$('ponte-situacao').textContent, /Celular conectado/);

  // Celular: "ligar o ventilador" pela assistente de voz.
  porta.escritos.length = 0;
  await celular.clicar('btn-voz');
  const reconhecimento = celular.reconhecimentos[0];
  const resultado = Object.assign([{ transcript: 'ligar o ventilador' }], { isFinal: true });
  reconhecimento.onresult({ resultIndex: 0, results: [resultado] });
  await esperar(80);
  assert.deepEqual(porta.escritos, ['MANUAL', 'VENTILADOR 1'], 'o Arduino recebe os comandos pela USB do notebook');
  assert.equal(notebook.$('sala-aviso').textContent, 'Celular: ventilador ligado', 'a TV mostra o pedido que veio do celular');
  assert.equal(celular.estado.ventiladorLigado, true);

  // O Arduino confirma e o celular continua de acordo.
  porta.falar(linhaSensores({ ventilador: 'ON', modo: 'MANUAL' }));
  await esperar(80);
  assert.equal(celular.$('pill-ventilador').textContent, 'LIGADO');
  assert.equal(celular.estado.modoAuto, false);

  // "Desligar tudo" no celular chega como um único pedido.
  porta.escritos.length = 0;
  await celular.clicar('btn-desligar-tudo');
  await esperar(80);
  assert.ok(porta.escritos.includes('VENTILADOR 0'));
  assert.ok(porta.escritos.includes('LUZ 0'));
  assert.equal(notebook.$('sala-aviso').textContent, 'Celular: desligar tudo (sem aula)');
});
