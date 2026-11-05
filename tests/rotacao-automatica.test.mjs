import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { ESPERA_APOS_INTERACAO_MS, INTERVALO_ROTACAO_MS, criarRotacaoAutomatica } from '../src/rotacao-automatica.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const carouselSource = readFileSync(new URL('../src/dashboard-carousel.jsx', import.meta.url), 'utf8');
const circularSource = readFileSync(new URL('../src/components/CircularCarousel.jsx', import.meta.url), 'utf8');

// Relógio falso: dispara os temporizadores na ordem, sem esperar o tempo real.
function criarRelogio() {
  let agora = 0;
  let proximoId = 0;
  const pendentes = new Map();
  return {
    agendar(callback, atraso) {
      const id = ++proximoId;
      pendentes.set(id, { callback, atraso, quando: agora + atraso });
      return id;
    },
    cancelar(id) {
      pendentes.delete(id);
    },
    passar(ms) {
      const fim = agora + ms;
      for (;;) {
        let escolhido = null;
        for (const entrada of pendentes) {
          if (entrada[1].quando <= fim && (!escolhido || entrada[1].quando < escolhido[1].quando)) escolhido = entrada;
        }
        if (!escolhido) break;
        pendentes.delete(escolhido[0]);
        agora = escolhido[1].quando;
        escolhido[1].callback();
      }
      agora = fim;
    },
    atrasos() {
      return [...pendentes.values()].map(({ atraso }) => atraso).sort((a, b) => a - b);
    }
  };
}

function montar(opcoes = {}) {
  const relogio = criarRelogio();
  const avancos = [];
  const rotacao = criarRotacaoAutomatica({
    avancar: () => avancos.push(avancos.length + 1),
    agendar: relogio.agendar,
    cancelar: relogio.cancelar,
    ...opcoes
  });
  return { relogio, avancos, rotacao };
}

test('a roleta avança um cartão a cada 10 segundos com um único temporizador', () => {
  assert.equal(INTERVALO_ROTACAO_MS, 10_000);
  const { relogio, avancos, rotacao } = montar();
  assert.equal(rotacao.obterEstado().rodando, true);
  assert.deepEqual(relogio.atrasos(), [10_000]);
  relogio.passar(9_999);
  assert.equal(avancos.length, 0);
  relogio.passar(1);
  assert.equal(avancos.length, 1);
  relogio.passar(30_000);
  assert.equal(avancos.length, 4);
  assert.deepEqual(relogio.atrasos(), [10_000], 'nunca acumula temporizadores');
});

test('motivos de pausa se somam e a contagem recomeça do zero quando o último sai', () => {
  const { relogio, avancos, rotacao } = montar();
  relogio.passar(8_000);
  rotacao.pausar('usuario');
  rotacao.pausar('detalhes');
  assert.equal(rotacao.obterEstado().rodando, false);
  assert.deepEqual(relogio.atrasos(), []);
  relogio.passar(60_000);
  assert.equal(avancos.length, 0);
  rotacao.retomar('usuario');
  assert.equal(rotacao.obterEstado().rodando, false, 'o dashboard ampliado ainda segura a rotação');
  rotacao.retomar('detalhes');
  relogio.passar(9_999);
  assert.equal(avancos.length, 0, 'não aproveita os 8 s contados antes da pausa');
  relogio.passar(1);
  assert.equal(avancos.length, 1);
});

test('mexer na roleta adia a troca e um cursor parado não segura a apresentação', () => {
  const { relogio, avancos, rotacao } = montar();
  relogio.passar(9_000);
  rotacao.registrarInteracao();
  assert.deepEqual(rotacao.obterEstado().motivos, ['interacao']);
  for (let i = 0; i < 10; i++) {
    relogio.passar(1_000);
    rotacao.registrarInteracao();
  }
  assert.equal(avancos.length, 0, 'não gira enquanto a pessoa mexe');
  assert.deepEqual(relogio.atrasos(), [ESPERA_APOS_INTERACAO_MS], 'só a espera da interação fica agendada');
  relogio.passar(ESPERA_APOS_INTERACAO_MS);
  assert.equal(rotacao.obterEstado().rodando, true, 'volta a contar quando o cursor para');
  relogio.passar(INTERVALO_ROTACAO_MS);
  assert.equal(avancos.length, 1);

  rotacao.pausar('usuario');
  rotacao.registrarInteracao();
  relogio.passar(ESPERA_APOS_INTERACAO_MS);
  assert.deepEqual(rotacao.obterEstado().motivos, ['usuario'], 'a pausa pedida no botão continua valendo');
  relogio.passar(60_000);
  assert.equal(avancos.length, 1);
});

test('começa parada com motivos iniciais e só avisa a interface quando o estado muda', () => {
  const { relogio, rotacao } = montar({ motivosIniciais: ['sem-dados', 'usuario'] });
  assert.deepEqual(relogio.atrasos(), []);
  let avisos = 0;
  const cancelarAssinatura = rotacao.assinar(() => { avisos += 1; });
  const antes = rotacao.obterEstado();
  assert.equal(rotacao.obterEstado(), antes, 'o retrato é estável entre leituras');
  assert.ok(Object.isFrozen(antes));

  rotacao.definir('sem-dados', false);
  rotacao.definir('sem-dados', false);
  assert.equal(avisos, 1, 'repetir o mesmo motivo não gera aviso');
  assert.equal(rotacao.obterEstado().rodando, false, 'movimento reduzido: só gira se a pessoa pedir');

  rotacao.alternar('usuario');
  assert.equal(avisos, 2);
  assert.equal(rotacao.obterEstado().rodando, true);
  assert.notEqual(rotacao.obterEstado(), antes);
  rotacao.alternar('usuario');
  assert.equal(rotacao.obterEstado().rodando, false);
  assert.equal(avisos, 3);

  cancelarAssinatura();
  rotacao.alternar('usuario');
  assert.equal(avisos, 3);
});

test('uma falha ao girar não interrompe a rotação', () => {
  let chamadas = 0;
  const relogio = criarRelogio();
  const rotacao = criarRotacaoAutomatica({
    avancar: () => {
      chamadas += 1;
      if (chamadas === 1) throw new Error('carrossel indisponível');
    },
    agendar: relogio.agendar,
    cancelar: relogio.cancelar
  });
  assert.throws(() => relogio.passar(INTERVALO_ROTACAO_MS), /carrossel indisponível/);
  assert.equal(rotacao.obterEstado().rodando, true);
  relogio.passar(INTERVALO_ROTACAO_MS);
  assert.equal(chamadas, 2);
});

test('a ilha liga a rotação ao carrossel, respeita movimento reduzido e silencia o anúncio enquanto gira', () => {
  assert.match(carouselSource, /criarRotacaoAutomatica\(/);
  assert.match(carouselSource, /focusIndex\(\(ativo\.current \+ 1\) % SENSORES\.length\)/);
  assert.match(carouselSource, /prefers-reduced-motion: reduce/);
  assert.match(carouselSource, /rotacao\.definir\('detalhes'/);
  assert.match(carouselSource, /live=\{estadoRotacao\.rodando \? 'off' : 'polite'\}/);
  assert.match(carouselSource, /onClick=\{\(\) => rotacao\.alternar\('usuario'\)\}/);
  // O botão discreto só mostra o ícone: o nome acessível precisa continuar dizendo o que ele faz.
  assert.match(carouselSource, /aria-label=\{pausadaPeloUsuario \? 'Retomar rotação automática' : 'Pausar rotação automática'\}/);
  assert.match(circularSource, /aria-live=\{live\}/);
});

test('parado no encaixe, o carrossel deixa de pedir quadros (reinstalar o componente desfaz o ajuste)', () => {
  assert.match(circularSource, /parado no encaixe, o laço dorme/);
  assert.match(circularSource, /if \(Math\.abs\(snapTarget - state\.angle\) < 0\.004 && Math\.abs\(state\.velocity\) < 0\.03\)/);
  assert.doesNotMatch(circularSource, /Math\.abs\(state\.velocity\) < SETTLE_SPEED\) \{\s*state\.target = nearest\(state\.angle\);/);
});

test('créditos do projeto aparecem na tela da roleta e os ícones do botão existem', () => {
  const { document } = new JSDOM(html).window;
  const creditos = document.querySelector('.carousel-shell .carousel-creditos');
  assert.ok(creditos, 'a faixa de créditos fica na tela da roleta');
  assert.equal(creditos.closest('[hidden]'), null);
  assert.ok(!document.getElementById('carousel-fallback').contains(creditos), 'não some quando a ilha React esconde os atalhos');
  const grupos = [...creditos.querySelectorAll('.creditos-grupo')].map((grupo) => ({
    titulo: grupo.querySelector('dt').textContent.trim(),
    nomes: [...grupo.querySelectorAll('dd')].map((nome) => nome.textContent.trim())
  }));
  assert.deepEqual(grupos, [
    { titulo: 'Desenvolvido por', nomes: ['Lucas Duarte', 'Gustavo de Brito', 'Marcio Andrey'] },
    { titulo: 'Professores', nomes: ['Huiatã Ribeiro', 'Jorge Guilherme'] }
  ]);
  assert.ok(document.getElementById('i-pausa'));
  assert.ok(document.getElementById('i-play'));
  assert.ok(creditos.classList.contains('so-apresentacao'), 'os créditos só aparecem no modo apresentação');
  assert.equal(
    document.querySelector('.carousel-cabecalho p.so-normal').textContent.trim(),
    'Passe o cursor sobre um cartão para girar a roleta. Dê um duplo clique para ampliar.',
    'desligado, o cabeçalho volta ao texto de antes'
  );
});
