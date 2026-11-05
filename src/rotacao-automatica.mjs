// Rotação automática da roleta de dashboards, pensada para o monitor de apresentação.
// Um único temporizador avança um cartão por intervalo. Qualquer motivo de pausa cancela a
// contagem; quando o último motivo sai, ela recomeça do zero (nunca gira "atrasada").

export const INTERVALO_ROTACAO_MS = 10_000;

// Tempo sem mexer o mouse, tocar ou usar o teclado sobre a roleta antes de voltar a contar.
// Um cursor parado em cima do cartão não segura a apresentação.
export const ESPERA_APOS_INTERACAO_MS = 2_500;

export function criarRotacaoAutomatica({
  avancar,
  intervalo = INTERVALO_ROTACAO_MS,
  esperaInteracao = ESPERA_APOS_INTERACAO_MS,
  motivosIniciais = [],
  agendar = (callback, atraso) => setTimeout(callback, atraso),
  cancelar = (id) => clearTimeout(id)
} = {}) {
  if (typeof avancar !== 'function') throw new TypeError('avancar precisa ser uma função.');

  const motivos = new Set(motivosIniciais);
  const ouvintes = new Set();
  let temporizador = null;
  let temporizadorInteracao = null;
  let ciclo = 0;
  let retrato = null;

  // O retrato só muda quando o estado muda, como o useSyncExternalStore exige.
  const fotografar = () => {
    retrato = Object.freeze({ rodando: temporizador !== null, ciclo, motivos: Object.freeze([...motivos]) });
  };

  const publicar = () => {
    fotografar();
    for (const ouvinte of [...ouvintes]) ouvinte();
  };

  const cancelarContagem = () => {
    if (temporizador === null) return;
    cancelar(temporizador);
    temporizador = null;
  };

  const contar = () => {
    cancelarContagem();
    if (motivos.size) return;
    ciclo += 1;
    temporizador = agendar(() => {
      temporizador = null;
      try {
        avancar();
      } finally {
        contar();
        publicar();
      }
    }, intervalo);
  };

  const pausar = (motivo) => {
    if (motivos.has(motivo)) return;
    motivos.add(motivo);
    cancelarContagem();
    publicar();
  };

  const retomar = (motivo) => {
    if (!motivos.delete(motivo)) return;
    contar();
    publicar();
  };

  contar();
  fotografar();

  return {
    pausar,
    retomar,
    definir(motivo, ativo) {
      if (ativo) pausar(motivo);
      else retomar(motivo);
    },
    alternar(motivo = 'usuario') {
      if (motivos.has(motivo)) retomar(motivo);
      else pausar(motivo);
    },
    // Mouse, toque, roda ou teclado sobre a roleta: espera a pessoa parar antes de girar.
    registrarInteracao() {
      if (temporizadorInteracao !== null) cancelar(temporizadorInteracao);
      temporizadorInteracao = agendar(() => {
        temporizadorInteracao = null;
        retomar('interacao');
      }, esperaInteracao);
      pausar('interacao');
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
