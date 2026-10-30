import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import CircularCarousel from './components/CircularCarousel.jsx';
import { SENSORES, criarCartao } from './sensor-cards.mjs';
import './carousel.css';

function escolherMetrica(chave) {
  document.dispatchEvent(new CustomEvent('dashboard:select-metric', { detail: { chave } }));
}

function abrirDashboard(chave) {
  document.dispatchEvent(new CustomEvent('dashboard:open', { detail: { chave } }));
}

function DashboardCarousel() {
  const [snapshot, setSnapshot] = useState(null);
  const [tema, setTema] = useState(() => document.documentElement.dataset.tema);
  const visualizacao = useRef('roleta');

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

  const items = useMemo(() => snapshot ? SENSORES.map(sensor => criarCartao(sensor, snapshot, tema)) : [], [snapshot, tema]);
  const trocar = useCallback(index => {
    const sensor = SENSORES[index];
    if (sensor && visualizacao.current === 'roleta') escolherMetrica(sensor.chave);
  }, []);
  const abrir = useCallback(index => {
    const sensor = SENSORES[index];
    if (!sensor) return;
    visualizacao.current = 'detalhes';
    abrirDashboard(sensor.chave);
  }, []);

  if (!snapshot) return null;
  const atual = SENSORES.find(sensor => sensor.chave === snapshot.principal);

  return (
    <div className="dashboard-carousel" data-principal={atual.chave}>
      <div className="dashboard-carousel-anel">
        <CircularCarousel
          ariaLabel="Roleta de dashboards. Passe o cursor sobre um cartão para trazê-lo ao centro. Dê um duplo clique ou pressione Enter para ampliar."
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
