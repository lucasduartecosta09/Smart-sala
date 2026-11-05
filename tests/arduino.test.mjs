import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const fonte = readFileSync(new URL('../assets/arduino.js', import.meta.url), 'utf8');

function carregar(extras = {}) {
  const contexto = vm.createContext({ console, TextEncoder, TextDecoder, setTimeout, clearTimeout, ...extras });
  contexto.window = contexto;
  vm.runInContext(fonte, contexto);
  return contexto.senaiArduino;
}

// Linhas copiadas do formato de printSensorLine() e printStatus() do firmware v3.6.
const LINHA_V36 = '[SENSORES] PIR=PRESENCA | LDR=1 | luz_relativa=100% | T=24.0C UR=55.0% | LUZ=OFF | FAN=ON | SMART=OFF | LUMINARIA_PIR=ON | RETENCAO=0s | MODO=AUTO';
const LINHA_DHT_ERRO = '[SENSORES] PIR=SEM_PRESENCA | LDR=0 | luz_relativa=0% | DHT=ERRO/AGUARDANDO | LUZ=ON | FAN=OFF | SMART=ON | LUMINARIA_PIR=OFF | RETENCAO=23s | MODO=MANUAL';

function memoria() {
  const dados = new Map();
  return {
    getItem: (chave) => (dados.has(chave) ? dados.get(chave) : null),
    setItem: (chave, valor) => dados.set(chave, String(valor)),
    removeItem: (chave) => dados.delete(chave),
    dados
  };
}

function criarPorta(info = { usbVendorId: 0x2341, usbProductId: 0x1002 }) {
  let controlador;
  const escritos = [];
  const porta = {
    opcoes: null,
    fechada: false,
    readable: null,
    writable: null,
    getInfo: () => info,
    async open(opcoes) {
      if (porta.recusar) throw Object.assign(new Error('ocupada'), { name: 'NetworkError' });
      porta.opcoes = opcoes;
      porta.readable = new ReadableStream({ start(c) { controlador = c; } });
      porta.writable = new WritableStream({ write(pedaco) { escritos.push(new TextDecoder().decode(pedaco)); } });
    },
    async close() { porta.fechada = true; },
    sinais: [],
    async setSignals(sinais) { porta.sinais.push({ ...sinais }); },
    falar(texto) { controlador.enqueue(new TextEncoder().encode(texto)); },
    perderCabo() {
      controlador.error(Object.assign(new Error('perdido'), { name: 'NetworkError' }));
      porta.readable = null;
    },
    escritos
  };
  return porta;
}

function criarSerial(portas) {
  const ouvintes = {};
  return {
    pedidos: 0,
    filtros: null,
    async requestPort(opcoes) {
      this.pedidos++;
      this.filtros = opcoes?.filters ?? null;
      if (!portas.length) throw Object.assign(new Error('cancelado'), { name: 'NotFoundError' });
      return portas[0];
    },
    async getPorts() { return portas; },
    addEventListener(tipo, funcao) { ouvintes[tipo] = funcao; },
    disparar(tipo, alvo) { ouvintes[tipo]?.({ target: alvo }); }
  };
}

const esperar = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

test('lê a linha [SENSORES] do firmware v3.6 com DHT11, PIR, LDR digital e saídas', () => {
  const { interpretarLinha } = carregar();
  const { tipo, dados } = interpretarLinha(LINHA_V36);
  assert.equal(tipo, 'sensores');
  assert.equal(dados.presenca, true);
  assert.equal(dados.luminosidade, 100);
  assert.equal(dados.temperatura, 24);
  assert.equal(dados.umidade, 55);
  assert.equal(dados.dhtValido, true);
  assert.equal(dados.luz, false);
  assert.equal(dados.ventilador, true);
  assert.equal(dados.luminaria, true);
  assert.equal(dados.modo, 'AUTO');
  assert.equal(dados.porta, null, 'o v3.6 não tem servo');

  const erro = interpretarLinha(LINHA_DHT_ERRO).dados;
  assert.equal(erro.dhtValido, false);
  assert.equal(erro.temperatura, null);
  assert.equal(erro.umidade, null);
  assert.equal(erro.presenca, false);
  assert.equal(erro.luminosidade, 0);
  assert.equal(erro.retencao, 23);
  assert.equal(erro.modo, 'MANUAL');

  const v37 = interpretarLinha(`${LINHA_V36} | PORTA=ABERTA`).dados;
  assert.equal(v37.porta, true);
});

test('reconhece status, versão, palmas e respostas e ignora o resto do Monitor Serial', () => {
  const { interpretarLinha } = carregar();
  assert.equal(JSON.stringify(interpretarLinha('Modo: MANUAL')), JSON.stringify({ tipo: 'status', dados: { modo: 'MANUAL' } }));
  assert.equal(interpretarLinha('Lampada Smart: LIGADO').dados.luz, true);
  assert.equal(interpretarLinha('Ventilador: DESLIGADO').dados.ventilador, false);
  assert.equal(interpretarLinha('Luminaria simples (PIR): LIGADA').dados.luminaria, true);
  assert.equal(interpretarLinha('Porta (servo): FECHADA').dados.porta, false);
  assert.equal(interpretarLinha('SENAI SMART CLASS - Equipe 01 - Firmware v3.6').versao, '3.6');
  assert.equal(interpretarLinha('[SOM] 2 palmas: alternando LAMPADA SMART.').quantidade, 2);
  assert.equal(interpretarLinha('Uso: LIMIAR_TEMP 15 a 45').tipo, 'recusado');
  for (const linha of [
    '', '   ', 'ORES] PIR=PRESENCA | LDR=1', '[SENSORES] PIR=PRESENCA | LDR=1',
    '[SOM] Diagnostico D12=1 | estado=REPOUSO', 'LUZ 0/1 | VENTILADOR 0/1', 'Wi-Fi: desconectado',
    'MQTT: desconectado', 'Comandos Serial (115200 baud; Nova linha):'
  ]) {
    assert.equal(interpretarLinha(linha), null, linha);
  }
});

test('monta só comandos que o firmware aceita e recusa valores fora da faixa', () => {
  const { criarComando } = carregar();
  assert.equal(criarComando('luz', true), 'LUZ 1');
  assert.equal(criarComando('luz', false), 'LUZ 0');
  assert.equal(criarComando('ventilador', true), 'VENTILADOR 1');
  assert.equal(criarComando('modo', true), 'AUTO');
  assert.equal(criarComando('modo', false), 'MANUAL');
  assert.equal(criarComando('porta', true), 'PORTA 1');
  assert.equal(criarComando('limiar-temperatura', 28), 'LIMIAR_TEMP 28');
  assert.equal(criarComando('limiar-luz', 40), 'LIMIAR_LUZ 40');
  for (const [acao, valor] of [['limiar-temperatura', 14], ['limiar-temperatura', 46], ['limiar-temperatura', 'x'],
    ['limiar-luz', -1], ['limiar-luz', 101], ['limiar-luz', 4.5], ['desconhecido', 1]]) {
    assert.equal(criarComando(acao, valor), null, `${acao} ${valor}`);
  }
});

test('separa as linhas mesmo quando a USB entrega pedaços quebrados', () => {
  const { criarSeparadorDeLinhas } = carregar();
  const linhas = [];
  const separador = criarSeparadorDeLinhas((linha) => linhas.push(linha));
  separador.receber('Modo: AU');
  separador.receber('TO\r');
  separador.receber('\nVentilador: LIGADO\r\n[SENS');
  assert.deepEqual(linhas, ['Modo: AUTO', 'Ventilador: LIGADO']);
  separador.receber('x'.repeat(600));
  separador.receber('\nModo: MANUAL\n');
  assert.deepEqual(linhas.slice(2), ['Modo: MANUAL'], 'lixo longo sem quebra de linha é descartado');
});

test('conecta a 115200, entrega linhas, envia comandos e desconecta pela USB', async () => {
  const { criarConexao } = carregar();
  const porta = criarPorta();
  const serial = criarSerial([porta]);
  const linhas = [];
  const estados = [];
  const armazenamento = memoria();
  const conexao = criarConexao({ serial, armazenamento, aoLinha: (linha) => linhas.push(linha), aoEstado: (estado) => estados.push(estado) });

  assert.equal(conexao.estado, 'desconectado');
  assert.equal(await conexao.conectar(), true);
  assert.equal(porta.opcoes.baudRate, 115200);
  // A ponte USB da UNO R4 WiFi só envia dados com o DTR ligado, como no Monitor Serial.
  assert.deepEqual(porta.sinais, [{ dataTerminalReady: true, requestToSend: true }]);
  assert.deepEqual(estados, ['conectando', 'conectado']);
  assert.match(armazenamento.getItem('smartclass:arduino'), /"automatico":true/);

  porta.falar(`${LINHA_V36}\r\nModo: AUTO\r\n`);
  await esperar();
  assert.deepEqual(linhas, [LINHA_V36, 'Modo: AUTO']);

  assert.equal(await conexao.enviar('LUZ 1'), true);
  assert.equal(await conexao.enviar('VENTILADOR 0'), true);
  assert.deepEqual(porta.escritos, ['LUZ 1\n', 'VENTILADOR 0\n']);

  await conexao.desconectar();
  assert.equal(conexao.estado, 'desconectado');
  assert.equal(porta.fechada, true);
  assert.equal(armazenamento.getItem('smartclass:arduino'), null, 'desconectar à mão não reconecta sozinho');
  assert.equal(await conexao.enviar('LUZ 0'), false);
});

test('cabo solto vira "perdido" e a placa autorizada volta sozinha', async () => {
  const { criarConexao } = carregar();
  const porta = criarPorta();
  const serial = criarSerial([porta]);
  const armazenamento = memoria();
  const conexao = criarConexao({ serial, armazenamento });
  await conexao.conectar();
  porta.perderCabo();
  await esperar();
  assert.equal(conexao.estado, 'perdido');

  // Religar o cabo: o navegador avisa e a mesma placa é reaberta sem a janela de escolha.
  serial.disparar('connect', porta);
  await esperar();
  assert.equal(conexao.estado, 'conectado');
  assert.equal(serial.pedidos, 1);

  // Depois de recarregar a página: reconexão automática pela lista de portas autorizadas.
  await conexao.desconectar();
  armazenamento.setItem('smartclass:arduino', JSON.stringify({ automatico: true, usbVendorId: 0x2341, usbProductId: 0x1002 }));
  const outra = criarConexao({ serial, armazenamento });
  assert.equal(await outra.reconectarAutomatico(), true);
  assert.equal(outra.estado, 'conectado');

  const estranha = criarConexao({ serial: criarSerial([criarPorta({ usbVendorId: 0x1a86, usbProductId: 0x7523 })]), armazenamento });
  assert.equal(await estranha.reconectarAutomatico(), false, 'não abre sozinho uma placa diferente');
});

test('a janela mostra só placas USB e uma placa que não responde não prende o botão', async () => {
  const { criarConexao } = carregar();
  const porta = criarPorta();
  const serial = criarSerial([porta]);
  const conexao = criarConexao({ serial, armazenamento: memoria() });
  await conexao.conectar();
  assert.ok(serial.filtros.some((filtro) => filtro.usbVendorId === 0x2341), 'Arduino (0x2341) aparece na janela');
  assert.ok(serial.filtros.every((filtro) => typeof filtro.usbVendorId === 'number'), 'só filtros USB: portas Bluetooth ficam de fora');

  // Placa travada: a abertura nunca termina.
  let fechouDepois = false;
  const travada = { getInfo: () => ({}), open: () => new Promise(() => {}), close: async () => { fechouDepois = true; } };
  const detalhes = [];
  const lenta = criarConexao({ serial: criarSerial([travada]), armazenamento: memoria(), esperaAbrir: 40, aoEstado: (estado, detalhe) => detalhes.push([estado, detalhe]) });
  assert.equal(await lenta.conectar(), false);
  assert.equal(lenta.estado, 'erro');
  assert.match(detalhes.at(-1)[1], /não respondeu/);
  assert.equal(fechouDepois, false);

  // Depois do erro, dá para tentar de novo (o botão não fica preso em "Conectando…").
  const boa = criarPorta();
  const outra = criarConexao({ serial: criarSerial([boa]), armazenamento: memoria(), esperaAbrir: 40 });
  assert.equal(await outra.conectar(), true);

  // Sinal DTR que não responde não impede a conexão.
  const semSinal = criarPorta();
  semSinal.setSignals = () => new Promise(() => {});
  const teimosa = criarConexao({ serial: criarSerial([semSinal]), armazenamento: memoria(), esperaSinais: 30 });
  assert.equal(await teimosa.conectar(), true);
  assert.equal(teimosa.estado, 'conectado');
});

test('porta ocupada explica o motivo e fechar a janela de escolha não muda nada', async () => {
  const { criarConexao } = carregar();
  const ocupada = criarPorta();
  ocupada.recusar = true;
  const detalhes = [];
  const conexao = criarConexao({ serial: criarSerial([ocupada]), armazenamento: memoria(), aoEstado: (estado, detalhe) => detalhes.push([estado, detalhe]) });
  assert.equal(await conexao.conectar(), false);
  assert.equal(conexao.estado, 'erro');
  assert.match(detalhes.at(-1)[1], /Monitor Serial/);

  const cancelada = criarConexao({ serial: criarSerial([]), armazenamento: memoria() });
  assert.equal(await cancelada.conectar(), false);
  assert.equal(cancelada.estado, 'desconectado');

  const semUsb = criarConexao({ serial: undefined, armazenamento: memoria() });
  assert.equal(semUsb.estado, 'sem-suporte');
  assert.equal(semUsb.suportado, false);
});
