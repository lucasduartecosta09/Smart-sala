import { Component, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import CircularCarousel from './components/CircularCarousel.jsx';
import { SENSORES, criarCartao } from './sensor-cards.mjs';
import { INTERVALO_ROTACAO_MS, criarRotacaoAutomatica } from './rotacao-automatica.mjs';
import './carousel.css';

const SEGUNDOS_ROTACAO = INTERVALO_ROTACAO_MS / 1000;

function escolherMetrica(chave) {
  document.dispatchEvent(new CustomEvent('dashboard:select-metric', { detail: { chave } }));
}

function abrirDashboard(chave) {
  document.dispatchEvent(new CustomEvent('dashboard:open', { detail: { chave } }));
}

function prefereMenosMovimento() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}

// O foco que chega pelo teclado conta como interação; o foco devolvido depois de um clique não.
function focoPeloTeclado(elemento) {
  try {
    return elemento.matches(':focus-visible');
  } catch {
    return true;
  }
}

function textoRotacao(estado, proximo) {
  if (estado.motivos.includes('usuario')) return 'Rotação pausada';
  if (estado.rodando) return `A seguir: ${proximo.titulo}`;
  if (estado.motivos.includes('interacao')) return 'Em espera enquanto você interage';
  return 'Rotação em espera';
}

function DashboardCarousel() {
  const [snapshot, setSnapshot] = useState(null);
  const [tema, setTema] = useState(() => document.documentElement.dataset.tema);
  const visualizacao = useRef('roleta');
  const carrossel = useRef(null);
  const anel = useRef(null);
  const ativo = useRef(0);
  const [indiceFrente, setIndiceFrente] = useState(0);
  const [rotacao] = useState(() => criarRotacaoAutomatica({
    avancar: () => carrossel.current?.focusIndex((ativo.current + 1) % SENSORES.length),
    // Parada até receber leituras; com movimento reduzido, só gira se a pessoa pedir.
    motivosIniciais: ['montagem', 'sem-dados', ...(prefereMenosMovimento() ? ['usuario'] : [])]
  }));
  const estadoRotacao = useSyncExternalStore(rotacao.assinar, rotacao.obterEstado);
  const temDados = Boolean(snapshot);

  useEffect(() => {
    const receber = event => {
      if (SENSORES.some(sensor => sensor.chave === event.detail?.principal)) {
        visualizacao.current = event.detail.visualizacao;
        setSnapshot(event.detail);
      }
    };
    document.addEventListener('dashboard:state', receber);
    document.dispatchEvent(new Event('dashboard:request-state'));
    return () => document.removeEventListener('dashboard:state', receber);
  }, []);

  useEffect(() => {
    const observador = new MutationObserver(() => setTema(document.documentElement.dataset.tema));
    observador.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] });
    return () => observador.disconnect();
  }, []);

  useEffect(() => {
    const fallback = document.getElementById('carousel-fallback');
    if (fallback) fallback.hidden = Boolean(snapshot);
    return () => { if (fallback) fallback.hidden = false; };
  }, [Boolean(snapshot)]);

  // Rotação automática: só conta com a roleta montada, com leituras, visível e na tela inicial.
  useEffect(() => {
    rotacao.retomar('montagem');
    return () => rotacao.pausar('montagem');
  }, [rotacao]);

  useEffect(() => {
    rotacao.definir('sem-dados', !temDados);
  }, [rotacao, temDados]);

  useEffect(() => {
    rotacao.definir('detalhes', snapshot?.visualizacao === 'detalhes');
  }, [rotacao, snapshot?.visualizacao]);

  useEffect(() => {
    const atualizar = () => rotacao.definir('aba-oculta', document.hidden);
    atualizar();
    document.addEventListener('visibilitychange', atualizar);
    return () => document.removeEventListener('visibilitychange', atualizar);
  }, [rotacao]);

  useEffect(() => {
    const consulta = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!consulta?.addEventListener) return undefined;
    const aoMudar = evento => { if (evento.matches) rotacao.pausar('usuario'); };
    consulta.addEventListener('change', aoMudar);
    return () => consulta.removeEventListener('change', aoMudar);
  }, [rotacao]);

  useEffect(() => {
    const alvo = anel.current;
    if (!alvo || typeof IntersectionObserver !== 'function') return undefined;
    const observador = new IntersectionObserver(([entrada]) => rotacao.definir('fora-da-tela', !entrada.isIntersecting));
    observador.observe(alvo);
    return () => {
      observador.disconnect();
      rotacao.retomar('fora-da-tela');
    };
  }, [rotacao, temDados]);

  const items = useMemo(() => snapshot ? SENSORES.map(sensor => criarCartao(sensor, snapshot, tema)) : [], [snapshot, tema]);
  const trocar = useCallback(index => {
    const sensor = SENSORES[index];
    if (!sensor) return;
    // A rotação e o "A seguir" partem do cartão da frente da roleta.
    ativo.current = index;
    setIndiceFrente(index);
    if (visualizacao.current === 'roleta') escolherMetrica(sensor.chave);
  }, []);
  const abrir = useCallback(index => {
    const sensor = SENSORES[index];
    if (!sensor) return;
    visualizacao.current = 'detalhes';
    abrirDashboard(sensor.chave);
  }, []);
  // Mexer na roleta adia a troca; o monitor nunca fica parado por um cursor ou foco esquecido.
  const interagir = useCallback(() => rotacao.registrarInteracao(), [rotacao]);
  const focar = useCallback(evento => {
    if (focoPeloTeclado(evento.target)) rotacao.registrarInteracao();
  }, [rotacao]);

  if (!snapshot) return null;
  const atual = SENSORES.find(sensor => sensor.chave === snapshot.principal);
  const frente = SENSORES[indiceFrente] ?? atual;
  const proximo = SENSORES[(SENSORES.indexOf(frente) + 1) % SENSORES.length];
  const pausadaPeloUsuario = estadoRotacao.motivos.includes('usuario');

  return (
    <div className="dashboard-carousel" data-principal={atual.chave} style={{ '--rotacao-cor': `var(--cor-${frente.chave})` }}>
      <div
        ref={anel}
        className="dashboard-carousel-anel"
        onPointerMove={interagir}
        onPointerDown={interagir}
        onWheel={interagir}
        onKeyDown={interagir}
        onFocus={focar}
      >
        <CircularCarousel
          ref={carrossel}
          ariaLabel={`Roleta de dashboards. Gira sozinha a cada ${SEGUNDOS_ROTACAO} segundos; use o botão Pausar rotação para parar. Passe o cursor sobre um cartão para trazê-lo ao centro. Dê um duplo clique ou pressione Enter para ampliar.`}
          live={estadoRotacao.rodando ? 'off' : 'polite'}
          items={items}
          preset="orbit"
          intro="none"
          autoplay="off"
          cardWidth={560}
          aspectRatio={520 / 340}
          gap={24}
          tilt={-12}
          perspective={2200}
          momentum={0.3}
          parallax={0}
          stretch={0.15}
          depthFade={0.3}
          innerShade={1}
          fadeColor={tema === 'claro' ? '#ffffff' : '#0f1b35'}
          onChange={trocar}
          focusOnHover
          onItemHover={(_item, index) => trocar(index)}
          onItemClick={(_item, index) => trocar(index)}
          onItemDoubleClick={(_item, index) => abrir(index)}
        />
      </div>
      <div className="rotacao-controle">
        <button type="button" className="btn rotacao-botao" onClick={() => rotacao.alternar('usuario')} aria-describedby="rotacao-status">
          <svg className="ico" aria-hidden="true"><use href={pausadaPeloUsuario ? '#i-play' : '#i-pausa'} /></svg>
          {pausadaPeloUsuario ? 'Retomar rotação' : 'Pausar rotação'}
        </button>
        <span className="rotacao-trilho" aria-hidden="true">
          {estadoRotacao.rodando && (
            <span key={estadoRotacao.ciclo} className="rotacao-barra" style={{ animationDuration: `${INTERVALO_ROTACAO_MS}ms` }} />
          )}
        </span>
        <span id="rotacao-status" className="rotacao-status">{textoRotacao(estadoRotacao, proximo)}</span>
      </div>
    </div>
  );
}

class CarouselBoundary extends Component {
  state = { falhou: false };
  static getDerivedStateFromError() { return { falhou: true }; }
  componentDidCatch(error) {
    const fallback = document.getElementById('carousel-fallback');
    if (fallback) fallback.hidden = false;
    console.error('Não foi possível iniciar o carrossel.', error);
  }
  render() { return this.state.falhou ? null : this.props.children; }
}

const container = document.getElementById('dashboard-carousel-root');
if (container) createRoot(container).render(<CarouselBoundary><DashboardCarousel /></CarouselBoundary>);
