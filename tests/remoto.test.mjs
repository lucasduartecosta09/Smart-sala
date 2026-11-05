import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const fonte = readFileSync(new URL('../assets/remoto.js', import.meta.url), 'utf8');

function carregar(extras = {}) {
  const contexto = vm.createContext({ console, TextEncoder, TextDecoder, setTimeout, clearTimeout, crypto: globalThis.crypto, ...extras });
  contexto.window = contexto;
  vm.runInContext(fonte, contexto);
  return contexto.senaiRemoto;
}

// Canal Broadcast de mentira: entrega a todos os inscritos no mesmo nome, menos a quem enviou.
function criarHub() {
  const salas = new Map();
  return {
    salas,
    canal(nome) {
      const ouvintes = [];
      const canal = {
        on(tipo, filtro, funcao) { ouvintes.push({ evento: filtro.event, funcao }); return canal; },
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
              if (ouvinte.evento === event) setTimeout(() => ouvinte.funcao({ payload: JSON.parse(JSON.stringify(payload)) }));
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

const esperar = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

test('código da sala tem 16 caracteres sem letras ambíguas e aceita digitação solta', () => {
  const remoto = carregar();
  const codigos = new Set(Array.from({ length: 50 }, () => remoto.gerarCodigo()));
  assert.equal(codigos.size, 50, 'códigos não se repetem');
  for (const codigo of codigos) assert.match(codigo, /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
  assert.equal(remoto.formatarCodigo(' abcd efgh-jkmn pqrs '), 'ABCD-EFGH-JKMN-PQRS');
  for (const invalido of ['ABCD-EFGH-JKMN-PQR', 'ABCD-EFGH-JKMN-PQRS-T', 'ABCD-EFGH-JKMN-PQR0', 'ABCD-EFGH-IKMN-PQRS', '', null]) {
    assert.equal(remoto.formatarCodigo(invalido), null, String(invalido));
  }
});

test('o nome do canal e a chave saem do código, sem expor o código', async () => {
  const remoto = carregar();
  const a = await remoto.derivarSala('ABCD-EFGH-JKMN-PQRS');
  const b = await remoto.derivarSala('abcd efgh jkmn pqrs');
  const c = await remoto.derivarSala('ZZZZ-EFGH-JKMN-PQRS');
  assert.equal(a.canal, b.canal);
  assert.notEqual(a.canal, c.canal);
  assert.match(a.canal, /^smartclass-sala-[0-9a-f]{32}$/);
  assert.doesNotMatch(a.canal, /ABCD/i);
  await assert.rejects(() => remoto.derivarSala('curto'));
});

test('só aceita mensagem assinada com o mesmo código, recente, inteira e uma única vez', async () => {
  const remoto = carregar();
  const { chave } = await remoto.derivarSala('ABCD-EFGH-JKMN-PQRS');
  const { chave: outraChave } = await remoto.derivarSala('ZZZZ-EFGH-JKMN-PQRS');
  const agora = Date.now();
  const mensagem = await remoto.assinarMensagem(chave, 'comando', { acao: 'luz', valor: true }, agora);

  const corpo = await remoto.verificarMensagem(chave, 'comando', mensagem, new Map(), agora);
  assert.equal(JSON.stringify(corpo), JSON.stringify({ acao: 'luz', valor: true }));

  assert.equal(await remoto.verificarMensagem(outraChave, 'comando', mensagem, new Map(), agora), null, 'outro código');
  assert.equal(await remoto.verificarMensagem(chave, 'estado', mensagem, new Map(), agora), null, 'outro tipo de mensagem');
  const adulterada = { ...mensagem, dados: mensagem.dados.replace('true', 'false') };
  assert.equal(await remoto.verificarMensagem(chave, 'comando', adulterada, new Map(), agora), null, 'conteúdo alterado');
  assert.equal(await remoto.verificarMensagem(chave, 'comando', mensagem, new Map(), agora + 11 * 60 * 1000), null, 'velha demais');
  assert.equal(await remoto.verificarMensagem(chave, 'comando', { v: 1, dados: '{}' }, new Map(), agora), null, 'sem assinatura');

  const vistos = new Map();
  assert.ok(await remoto.verificarMensagem(chave, 'comando', mensagem, vistos, agora));
  assert.equal(await remoto.verificarMensagem(chave, 'comando', mensagem, vistos, agora), null, 'repetida');
});

test('ponte e celular conversam pelo canal e mensagem forjada é ignorada', async () => {
  const remoto = carregar();
  const hub = criarHub();
  const recebidosPonte = [];
  const recebidosCelular = [];
  const ponte = remoto.criarSala({ papel: 'ponte', codigo: 'ABCD-EFGH-JKMN-PQRS', criarCanal: (nome) => hub.canal(nome), aoMensagem: (evento, corpo) => recebidosPonte.push([evento, corpo]) });
  const celular = remoto.criarSala({ papel: 'controle', codigo: 'abcd-efgh-jkmn-pqrs', criarCanal: (nome) => hub.canal(nome), aoMensagem: (evento, corpo) => recebidosCelular.push([evento, corpo]) });
  assert.equal(await ponte.iniciar(), true);
  assert.equal(await celular.iniciar(), true);
  await esperar();
  assert.equal(ponte.estado, 'conectada');
  assert.equal(celular.estado, 'conectada');

  assert.equal(await celular.enviar('comando', { id: '1', acao: 'ventilador', valor: true }), true);
  await ponte.enviar('estado', { equipamentos: { ventiladorLigado: true } });
  await esperar();
  assert.deepEqual(recebidosPonte.map(([evento, corpo]) => [evento, corpo.acao, corpo.valor]), [['comando', 'ventilador', true]]);
  assert.deepEqual(recebidosCelular.map(([evento, corpo]) => [evento, corpo.equipamentos.ventiladorLigado]), [['estado', true]]);

  // Alguém que descobriu o nome do canal, mas não tem o código, não comanda a sala.
  const [nome] = hub.salas.keys();
  const intruso = hub.canal(nome);
  intruso.subscribe(() => {});
  await intruso.send({ type: 'broadcast', event: 'comando', payload: { v: 1, t: Date.now(), n: 'a'.repeat(24), dados: '{"acao":"luz","valor":true}', assinatura: 'b'.repeat(64) } });
  await esperar();
  assert.equal(recebidosPonte.length, 1);

  await celular.encerrar();
  assert.equal(celular.estado, 'desligada');
});

test('o link "#sala=" guarda o código só nesta aba e some da barra de endereço', () => {
  const sessao = new Map();
  const enderecos = [];
  const remoto = carregar({
    location: { hash: '#sala=abcd-efgh-jkmn-pqrs', pathname: '/', search: '' },
    sessionStorage: { getItem: (c) => sessao.get(c) ?? null, setItem: (c, v) => sessao.set(c, v), removeItem: (c) => sessao.delete(c) },
    history: { replaceState: (_estado, _titulo, endereco) => enderecos.push(endereco) }
  });
  assert.equal(remoto.lerCodigoDoLink(), 'ABCD-EFGH-JKMN-PQRS');
  assert.deepEqual(enderecos, ['/']);
  remoto.esquecerCodigoDoLink();
  assert.equal(remoto.lerCodigoDoLink(), null);
});
