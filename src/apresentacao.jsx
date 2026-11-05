import { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { SplitText } from 'gsap/SplitText';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { SENSORES, formatarValor } from './sensor-cards.mjs';
import { GRUPOS, ORIENTADORES } from './equipe.mjs';
import './apresentacao.css';

gsap.registerPlugin(useGSAP, SplitText, DrawSVGPlugin);

const LOGO = 'assets/senai-marca-negativa.png';
const LOGO_BASE = 'assets/senai-marca-negativa-base.png';
const LOGO_ACENTO = 'assets/senai-marca-acento.png';
const ROTULO_SENAI = 'SENAI – Serviço Nacional de Aprendizagem Industrial';
const MOVIMENTO_COMPLETO = '(prefers-reduced-motion: no-preference)';
const MOVIMENTO_REDUZIDO = '(prefers-reduced-motion: reduce)';
const SAIDA = 0.7; // segundos reservados para cada tela sair antes da próxima cena
const CORES = { temperatura: '#fb923c', umidade: '#22d3ee', pessoas: '#34d399', luminosidade: '#c4b5fd' };

// Trilhas de circuito que chegam das bordas até o centro (viewBox 1600 x 900).
// As pontas ficam fora da área da logo, do título e dos sensores, de 1280 x 720 a 1920 x 1080.
const TRACOS = [
  'M0 200 H240 L300 260 H400',
  'M0 450 H330',
  'M0 690 H160 L230 760 H420',
  'M170 0 V110 L230 170 H330',
  'M1600 200 H1360 L1300 260 H1200',
  'M1600 450 H1270',
  'M1600 690 H1440 L1370 760 H1180',
  'M1430 0 V110 L1370 170 H1270'
];
const NOS = [[400, 260], [330, 450], [420, 760], [330, 170], [1200, 260], [1270, 450], [1180, 760], [1270, 170]];

// Logo em camadas (letras + acento laranja) e um brilho recortado pelo próprio desenho.
function Marca() {
  const mascara = `url(${LOGO})`;
  return (
    <span className="ap-marca">
      <img className="ap-marca-base" src={LOGO_BASE} alt="" draggable={false} />
      <img className="ap-marca-acento" src={LOGO_ACENTO} alt="" draggable={false} />
      <span className="ap-marca-brilho" style={{ WebkitMaskImage: mascara, maskImage: mascara }}>
        <span className="ap-marca-brilho-faixa" />
      </span>
    </span>
  );
}

function MarcaEspelhada({ className = '' }) {
  return (
    <div className={`ap-marca-espelhada ${className}`.trim()} role="img" aria-label={ROTULO_SENAI}>
      <Marca />
      <div className="ap-marca-reflexo"><Marca /></div>
    </div>
  );
}

function Palco() {
  return (
    <div className="ap-fundo" aria-hidden="true">
      <span className="ap-aurora ap-aurora-1" />
      <span className="ap-aurora ap-aurora-2" />
      <div className="ap-piso"><div className="ap-piso-plano"><div className="ap-piso-grade" /></div></div>
    </div>
  );
}

// Movimento de fundo contínuo (só transform): luzes à deriva e piso avançando.
function animarPalco() {
  gsap.to('.ap-aurora-1', { xPercent: 14, yPercent: -10, duration: 7, ease: 'sine.inOut', yoyo: true, repeat: -1 });
  gsap.to('.ap-aurora-2', { xPercent: -12, yPercent: 12, duration: 8.5, ease: 'sine.inOut', yoyo: true, repeat: -1 });
  gsap.fromTo('.ap-piso-grade', { y: 0 }, { y: 64, duration: 2.6, ease: 'none', repeat: -1 });
}

function animarReduzido(raiz, duracao) {
  gsap.timeline()
    .from(raiz, { autoAlpha: 0, duration: 0.4, ease: 'none' }, 0)
    .to(raiz, { autoAlpha: 0, duration: 0.4, ease: 'none' }, Math.max(duracao / 1000 - 0.4, 0.5));
}

export function TelaAbertura({ duracao, sensores, fonte = 'simulado' }) {
  const raiz = useRef(null);

  useGSAP(() => {
    const fim = Math.max(duracao / 1000 - SAIDA, 1);
    const mm = gsap.matchMedia();
    mm.add(MOVIMENTO_COMPLETO, () => {
      animarPalco();
      const titulo = SplitText.create('.ap-abertura-titulo', { type: 'chars', mask: 'chars' });
      gsap.set('.ap-pulso', { drawSVG: '0% 0%' });
      gsap.timeline({ defaults: { ease: 'power3.out' } })
        .from(raiz.current, { autoAlpha: 0, duration: 0.6, ease: 'power2.out' }, 0)
        .from('.ap-aurora', { scale: 0.7, autoAlpha: 0, duration: 1.8, stagger: 0.2 }, 0)
        .from('.ap-piso', { autoAlpha: 0, duration: 1.2 }, 0.1)
        .from('.ap-traco', { drawSVG: '0% 0%', duration: 1.3, stagger: 0.07, ease: 'power2.inOut' }, 0.3)
        .from('.ap-no', { scale: 0, transformOrigin: '50% 50%', duration: 0.5, stagger: 0.05, ease: 'back.out(2.2)' }, 1.2)
        .from('.ap-marca-base', { clipPath: 'inset(0% 100% 0% 0%)', duration: 1, ease: 'power3.inOut' }, 0.9)
        .from('.ap-marca-acento', { yPercent: -140, rotation: -14, autoAlpha: 0, duration: 1.2, ease: 'elastic.out(1, 0.5)' }, 1.75)
        .from('.ap-marca-reflexo', { autoAlpha: 0, duration: 0.9, ease: 'power1.out' }, 1.5)
        .fromTo('.ap-marca-brilho-faixa', { xPercent: -160 }, { xPercent: 380, duration: 1.4, ease: 'power2.inOut' }, 2.35)
        .from(titulo.chars, { yPercent: 115, duration: 0.75, stagger: 0.03 }, 2.4)
        .from('.ap-abertura-subtitulo', { autoAlpha: 0, y: 18, duration: 0.7 }, 3)
        .from('.ap-sensor', { autoAlpha: 0, y: 20, scale: 0.94, duration: 0.6, stagger: 0.09, ease: 'back.out(1.6)' }, 3.35)
        .from(raiz.current.querySelectorAll('.ap-ao-vivo'), { autoAlpha: 0, y: 12, duration: 0.5 }, 3.2)
        .set('.ap-pulso', { autoAlpha: 1 }, 2)
        .fromTo('.ap-pulso', { drawSVG: '0% 6%' }, {
          drawSVG: '94% 100%', duration: 1.6, ease: 'power1.in', stagger: { each: 0.22, repeat: -1, repeatDelay: 0.9 }
        }, 2)
        .to(raiz.current, { autoAlpha: 0, scale: 1.015, duration: SAIDA, ease: 'power2.in' }, fim);
    });
    mm.add(MOVIMENTO_REDUZIDO, () => animarReduzido(raiz.current, duracao));
  }, { scope: raiz });

  return (
    <section className="ap-cena ap-abertura" ref={raiz} aria-label="Abertura do projeto SENAI Smart Class">
      <Palco />
      <svg className="ap-circuito" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        {TRACOS.map((d, i) => <path key={`t${i}`} className="ap-traco" d={d} />)}
        {TRACOS.map((d, i) => <path key={`p${i}`} className="ap-pulso" d={d} />)}
        {NOS.map(([cx, cy], i) => <circle key={`n${i}`} className="ap-no" cx={cx} cy={cy} r="6" />)}
      </svg>
      <div className="ap-abertura-conteudo">
        <MarcaEspelhada />
        <h2 className="ap-abertura-titulo">SENAI <em>Smart Class</em></h2>
        <p className="ap-abertura-subtitulo">Sala de aula inteligente: sensores, automação e comandos de voz</p>
        {fonte === 'arduino' && (
          <p className="ap-ao-vivo"><span className="ap-ao-vivo-ponto" aria-hidden="true" />Ao vivo da bancada · Arduino UNO R4 WiFi</p>
        )}
        <ul className="ap-sensores">
          {SENSORES.map(sensor => (
            <li key={sensor.chave} className="ap-sensor" style={{ '--cor': CORES[sensor.chave] }}>
              <svg className="ico" aria-hidden="true"><use href={`#${sensor.icone}`} /></svg>
              <span className="ap-sensor-nome">{sensor.titulo}</span>
              <strong className="ap-sensor-valor">{formatarValor(sensor, sensores?.[sensor.chave], fonte)}</strong>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function TelaEquipe({ duracao }) {
  const raiz = useRef(null);

  useGSAP(() => {
    const fim = Math.max(duracao / 1000 - SAIDA, 1);
    const mm = gsap.matchMedia();
    mm.add(MOVIMENTO_COMPLETO, () => {
      animarPalco();
      const titulo = SplitText.create('.ap-equipe-titulo', { type: 'words', mask: 'words' });
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
        .from(raiz.current, { autoAlpha: 0, duration: 0.6, ease: 'power2.out' }, 0)
        .from('.ap-aurora', { scale: 0.7, autoAlpha: 0, duration: 1.6, stagger: 0.2 }, 0)
        .from('.ap-piso', { autoAlpha: 0, duration: 1.2 }, 0.1)
        .from('.ap-equipe-sobretitulo', { autoAlpha: 0, y: 12, duration: 0.5 }, 0.3)
        .from(titulo.words, { yPercent: 110, duration: 0.8, stagger: 0.08 }, 0.4)
        .from('.ap-grupo', { autoAlpha: 0, y: 26, duration: 0.7, stagger: 0.12 }, 0.8)
        .from('.ap-grupo-linha', { scaleX: 0, transformOrigin: '0% 50%', duration: 0.8, stagger: 0.12, ease: 'power2.inOut' }, 1);
      // Cada coluna entra em cascata própria, para o conjunto aparecer em pouco mais de meio segundo.
      gsap.utils.toArray('.ap-grupo', raiz.current).forEach((grupo, i) => {
        tl.from(grupo.querySelectorAll('.ap-grupo-nome'), { autoAlpha: 0, y: 14, duration: 0.45, stagger: 0.06 }, 1.2 + i * 0.08);
      });
      tl.from('.ap-equipe-rodape', { autoAlpha: 0, y: 16, duration: 0.6 }, 2.2)
        .fromTo('.ap-marca-brilho-faixa', { xPercent: -160 }, { xPercent: 380, duration: 1.4, ease: 'power2.inOut' }, 2.8)
        .to(raiz.current, { autoAlpha: 0, scale: 1.015, duration: SAIDA, ease: 'power2.in' }, fim);
    });
    mm.add(MOVIMENTO_REDUZIDO, () => animarReduzido(raiz.current, duracao));
  }, { scope: raiz });

  return (
    <section className="ap-cena ap-equipe" ref={raiz} aria-labelledby="ap-equipe-titulo">
      <Palco />
      <div className="ap-equipe-conteudo">
        <header className="ap-equipe-topo">
          <span className="ap-equipe-sobretitulo">SENAI Smart Class</span>
          <h2 className="ap-equipe-titulo" id="ap-equipe-titulo">Equipe do projeto</h2>
        </header>
        <div className="ap-grupos">
          {GRUPOS.map(grupo => (
            <section key={grupo.nome} className="ap-grupo" style={{ '--cor': grupo.cor }}>
              <h3 className="ap-grupo-titulo">{grupo.nome}</h3>
              <span className="ap-grupo-linha" aria-hidden="true" />
              <ul>
                {grupo.nomes.map(nome => <li key={nome} className="ap-grupo-nome">{nome}</li>)}
              </ul>
            </section>
          ))}
        </div>
        <footer className="ap-equipe-rodape">
          <p className="ap-orientadores"><span>Orientadores</span>{ORIENTADORES.join(' e ')}</p>
          <MarcaEspelhada className="ap-marca-rodape" />
        </footer>
      </div>
    </section>
  );
}

export function BotaoSairApresentacao({ onSair }) {
  return (
    <button type="button" className="ap-sair" onClick={onSair}>
      <svg className="ico" aria-hidden="true"><use href="#i-fechar" /></svg>
      Sair da apresentação <kbd>Esc</kbd>
    </button>
  );
}
