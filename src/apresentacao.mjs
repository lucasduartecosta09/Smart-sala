// Modo apresentação: sequência automática de telas para a TV do evento.
// Um único temporizador troca de cena; parar cancela tudo e volta ao painel normal.

export const CENAS = Object.freeze([
  Object.freeze({ id: 'graficos', duracao: 10_000 }), // gráfico ampliado do cartão da frente
  Object.freeze({ id: 'roleta', duracao: 35_000 }),   // roleta girando (3 trocas de 10 s)
  Object.freeze({ id: 'abertura', duracao: 9_000 }),  // tela animada com a logo espelhada
  Object.freeze({ id: 'equipe', duracao: 16_000 })    // nomes dos alunos e orientadores
]);

export function criarApresentacao({
  cenas = CENAS,
  agendar = (callback, atraso) => setTimeout(callback, atraso),
  cancelar = (id) => clearTimeout(id)
} = {}) {
  if (!cenas.length) throw new TypeError('A apresentação precisa de pelo menos uma cena.');

  const ouvintes = new Set();
  let temporizador = null;
  let indice = -1;
  let passo = 0;
  let retrato = null;

  // O retrato só muda quando a cena muda, como o useSyncExternalStore exige.
  const fotografar = () => {
    const cena = indice >= 0 ? cenas[indice] : null;
    retrato = Object.freeze({
      ativa: indice >= 0,
      cena: cena ? cena.id : null,
      duracao: cena ? cena.duracao : 0,
      indice,
      passo
    });
  };

  const publicar = () => {
    fotografar();
    for (const ouvinte of [...ouvintes]) ouvinte();
  };

  const limpar = () => {
    if (temporizador === null) return;
    cancelar(temporizador);
    temporizador = null;
  };

  const ir = (proximo) => {
    limpar();
    indice = ((proximo % cenas.length) + cenas.length) % cenas.length;
    passo += 1;
    temporizador = agendar(() => {
      temporizador = null;
      ir(indice + 1);
    }, cenas[indice].duracao);
    publicar();
  };

  fotografar();

  return {
    iniciar() {
      if (indice < 0) ir(0);
    },
    parar() {
      if (indice < 0) return;
      limpar();
      indice = -1;
      publicar();
    },
    avancar() {
      if (indice >= 0) ir(indice + 1);
    },
    voltar() {
      if (indice >= 0) ir(indice - 1);
    },
    assinar(ouvinte) {
      ouvintes.add(ouvinte);
      return () => {
        ouvintes.delete(ouvinte);
      };
    },
    obterEstado() {
      return retrato;
    }
  };
}
