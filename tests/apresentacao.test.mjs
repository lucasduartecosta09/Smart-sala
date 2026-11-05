import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { CENAS, criarApresentacao } from '../src/apresentacao.mjs';
import { GRUPOS, ORIENTADORES } from '../src/equipe.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ilha = readFileSync(new URL('../src/dashboard-carousel.jsx', import.meta.url), 'utf8');
const telas = readFileSync(new URL('../src/apresentacao.jsx', import.meta.url), 'utf8');
const estilos = readFileSync(new URL('../src/apresentacao.css', import.meta.url), 'utf8');
const estilosRoleta = readFileSync(new URL('../src/carousel.css', import.meta.url), 'utf8');

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
      return [...pendentes.values()].map(({ atraso }) => atraso);
    }
  };
}

function montar() {
  const relogio = criarRelogio();
  const apresentacao = criarApresentacao({ agendar: relogio.agendar, cancelar: relogio.cancelar });
  return { relogio, apresentacao };
}

test('a apresentação passa por gráficos, roleta, abertura e equipe e recomeça', () => {
  assert.deepEqual(CENAS.map(cena => cena.id), ['graficos', 'roleta', 'abertura', 'equipe']);
  assert.equal(CENAS[0].duracao, 10_000, 'os gráficos ficam 10 segundos, como pedido');
  const { relogio, apresentacao } = montar();
  assert.equal(apresentacao.obterEstado().ativa, false);
  apresentacao.iniciar();
  const vistas = [apresentacao.obterEstado().cena];
  for (const cena of CENAS) {
    relogio.passar(cena.duracao - 1);
    assert.equal(apresentacao.obterEstado().cena, cena.id, `${cena.id} fica o tempo inteiro`);
    relogio.passar(1);
    vistas.push(apresentacao.obterEstado().cena);
  }
  assert.deepEqual(vistas, ['graficos', 'roleta', 'abertura', 'equipe', 'graficos']);
  assert.deepEqual(relogio.atrasos(), [CENAS[0].duracao], 'um único temporizador');
});

test('parar volta ao painel normal e iniciar de novo recomeça pelos gráficos', () => {
  const { relogio, apresentacao } = montar();
  apresentacao.iniciar();
  apresentacao.iniciar();
  assert.equal(relogio.atrasos().length, 1, 'iniciar duas vezes não duplica a sequência');
  relogio.passar(CENAS[0].duracao);
  assert.equal(apresentacao.obterEstado().cena, 'roleta');
  apresentacao.parar();
  assert.deepEqual(
    { ativa: apresentacao.obterEstado().ativa, cena: apresentacao.obterEstado().cena },
    { ativa: false, cena: null }
  );
  assert.deepEqual(relogio.atrasos(), []);
  relogio.passar(120_000);
  assert.equal(apresentacao.obterEstado().ativa, false);
  apresentacao.iniciar();
  assert.equal(apresentacao.obterEstado().cena, 'graficos');
});

test('PageDown e PageUp pulam de tela sem acumular temporizadores', () => {
  const { relogio, apresentacao } = montar();
  apresentacao.avancar();
  assert.equal(apresentacao.obterEstado().ativa, false, 'pular não liga a apresentação');
  apresentacao.iniciar();
  apresentacao.avancar();
  apresentacao.avancar();
  assert.equal(apresentacao.obterEstado().cena, 'abertura');
  apresentacao.voltar();
  assert.equal(apresentacao.obterEstado().cena, 'roleta');
  apresentacao.voltar();
  apresentacao.voltar();
  assert.equal(apresentacao.obterEstado().cena, 'equipe', 'voltar da primeira tela vai para a última');
  assert.deepEqual(relogio.atrasos(), [CENAS[3].duracao], 'a tela nova ganha o tempo inteiro');
});

test('o retrato da apresentação só muda quando a cena muda', () => {
  const { relogio, apresentacao } = montar();
  let avisos = 0;
  const cancelarAssinatura = apresentacao.assinar(() => { avisos += 1; });
  const antes = apresentacao.obterEstado();
  assert.equal(apresentacao.obterEstado(), antes);
  assert.ok(Object.isFrozen(antes));
  apresentacao.iniciar();
  const primeiro = apresentacao.obterEstado();
  relogio.passar(CENAS[0].duracao);
  assert.equal(avisos, 2);
  assert.equal(apresentacao.obterEstado().passo, primeiro.passo + 1);
  cancelarAssinatura();
  apresentacao.parar();
  assert.equal(avisos, 2);
});

test('a equipe tem os nomes do banner, por grupo, e os orientadores', () => {
  assert.deepEqual(GRUPOS.map(grupo => [grupo.nome, [...grupo.nomes]]), [
    ['Programação embarcada e eletrônica', ['Warlley José', 'Pedro Fellipe', 'Maria Eduarda', 'Mariana Evelleyn', 'Larissa Marques', 'Isabelly Moreira', 'Davi Brito']],
    ['Desenvolvimento web e controle', ['Felipe Gabriel', 'Marcio Andrey', 'Gustavo de Brito', 'Luiz Haniel', 'Yan Kennedy']],
    ['Comandos de voz', ['Kauã Oliveira', 'Lucas Duarte', 'Davi Pereira', 'Izabella Rodrigues', 'Lucas Alves']]
  ]);
  assert.deepEqual([...ORIENTADORES], ['Jorge Guilherme', 'Huiatã Ribeiro']);
  assert.equal(GRUPOS.flatMap(grupo => grupo.nomes).length, 17);
});

test('desligado, o painel fica como antes: créditos, logo e texto da apresentação ficam escondidos', () => {
  const { document } = new JSDOM(html).window;
  const botao = document.getElementById('btn-apresentacao');
  assert.ok(botao, 'a barra lateral tem o botão Modo apresentação');
  assert.equal(botao.getAttribute('type'), 'button');
  assert.equal(botao.getAttribute('aria-pressed'), 'false');
  for (const seletor of ['.carousel-creditos', '.marca-senai', '.carousel-cabecalho p.so-apresentacao']) {
    assert.ok(document.querySelector(seletor).classList.contains('so-apresentacao'), seletor);
  }
  assert.ok(document.querySelector('.carousel-sala').classList.contains('so-normal'));
  assert.match(estilosRoleta, /body:not\(\.modo-apresentacao\) \.so-apresentacao \{ display: none !important; \}/);
  assert.match(estilosRoleta, /body\.modo-apresentacao \.so-normal \{ display: none !important; \}/);
  assert.equal(document.querySelector('.marca-senai').getAttribute('aria-label'), 'SENAI – Serviço Nacional de Aprendizagem Industrial');
  assert.ok(document.getElementById('i-apresentacao') && document.getElementById('i-fechar'));
});

test('a rotação automática e o controle discreto só existem no modo apresentação', () => {
  assert.match(ilha, /motivosIniciais: \['montagem', 'sem-dados', 'modo-normal'/);
  assert.match(ilha, /rotacao\.definir\('modo-normal', !ativa\)/);
  assert.match(ilha, /\{ativa && \(\s*<div className="rotacao-controle">/);
  assert.match(ilha, /ariaLabel=\{ativa \? ROTULO_ROLETA_APRESENTACAO : ROTULO_ROLETA\}/);
});

test('ligado, a TV mostra só o conteúdo, sai com Esc e as telas respeitam movimento reduzido', () => {
  assert.match(estilos, /body\.modo-apresentacao \.sidebar,/);
  assert.match(estilos, /body\.modo-apresentacao #btn-toggle-voz,/);
  assert.match(estilos, /body\.modo-apresentacao \.historico-download,/);
  assert.match(ilha, /evento\.key === 'Escape'\) pararApresentacao\(\)/);
  assert.match(ilha, /requestFullscreen\(\)/);
  assert.match(telas, /gsap\.registerPlugin\(useGSAP, SplitText, DrawSVGPlugin\)/);
  assert.match(telas, /\(prefers-reduced-motion: reduce\)/);
  assert.equal((telas.match(/\{ scope: raiz \}/g) || []).length, 2, 'as duas telas limpam as animações ao sair');
});
