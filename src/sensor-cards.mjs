export const SENSORES = [
  { chave: 'temperatura', titulo: 'Temperatura', fonte: 'DHT11', unidade: '°C', casas: 1, icone: 'i-temp' },
  { chave: 'umidade', titulo: 'Umidade', fonte: 'DHT11', unidade: '%', casas: 0, icone: 'i-gota' },
  { chave: 'pessoas', titulo: 'Ocupação', fonte: 'Pessoas na sala', unidade: 'pessoas', casas: 0, icone: 'i-users' },
  { chave: 'luminosidade', titulo: 'Luminosidade', fonte: 'LDR', unidade: '%', casas: 0, icone: 'i-luz' }
];

export function formatarValor(sensor, valor) {
  return typeof valor === 'number' && Number.isFinite(valor)
    ? `${valor.toLocaleString('pt-BR', { minimumFractionDigits: sensor.casas, maximumFractionDigits: sensor.casas })} ${sensor.unidade}`
    : 'Sem leitura';
}

// Prévias geradas das próprias leituras, sem fotos ou serviços externos.
export function criarCartao(sensor, snapshot, tema) {
  const claro = tema === 'claro';
  const cores = claro
    ? { temperatura: '#c2410c', umidade: '#0369a1', pessoas: '#047857', luminosidade: '#6d28d9' }
    : { temperatura: '#fb923c', umidade: '#22d3ee', pessoas: '#34d399', luminosidade: '#c4b5fd' };
  const cor = cores[sensor.chave];
  const texto = claro ? '#0f172a' : '#f1f5f9';
  const suave = claro ? '#475569' : '#94a3b8';
  const fundo = claro ? '#ffffff' : '#0f1b35';
  const serie = (snapshot.historico || []).slice(-24)
    .map(leitura => leitura[sensor.chave]).filter(valor => typeof valor === 'number' && Number.isFinite(valor));
  const menor = serie.length ? Math.min(...serie) : 0;
  const amplitude = Math.max(serie.length ? Math.max(...serie) - menor : 1, 1);
  const pontos = serie.map((valor, i) => [
    serie.length === 1 ? 260 : 30 + i / (serie.length - 1) * 460,
    275 - (valor - menor) / amplitude * 95
  ]);
  const caminho = pontos.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const valor = formatarValor(sensor, snapshot.sensores?.[sensor.chave]);
  const ultimo = pontos.at(-1);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="340" viewBox="0 0 520 340">
    <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${cor}" stop-opacity=".25"/><stop offset="1" stop-color="${cor}" stop-opacity="0"/></linearGradient></defs>
    <rect width="520" height="340" rx="20" fill="${fundo}"/>
    <rect x="1" y="1" width="518" height="338" rx="20" fill="none" stroke="${cor}" stroke-opacity=".65" stroke-width="2"/>
    <circle cx="34" cy="35" r="5" fill="${cor}"/>
    <g font-family="system-ui, sans-serif"><text x="50" y="43" fill="${texto}" font-size="26" font-weight="700">${sensor.titulo}</text>
    <text x="30" y="121" fill="${texto}" font-size="52" font-weight="800">${valor}</text>
    <text x="30" y="151" fill="${suave}" font-size="17">${sensor.fonte} · Sala SENAI Smart Class</text>
    <path d="M30 185H490 M30 232H490 M30 280H490" fill="none" stroke="${suave}" stroke-opacity=".18" stroke-dasharray="3 6"/>
    ${pontos.length > 1 ? `<path d="${caminho} L490,290 L30,290 Z" fill="url(#area)"/><path d="${caminho}" fill="none" stroke="${cor}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${ultimo ? `<circle cx="${ultimo[0]}" cy="${ultimo[1]}" r="6" fill="${cor}"/>` : `<text x="30" y="235" fill="${suave}" font-size="18">Aguardando histórico</text>`}
    <text x="30" y="317" fill="${suave}" font-size="15">${serie.length} leituras recentes</text></g></svg>`;
  return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, alt: `Prévia de ${sensor.titulo}: ${valor}`, title: sensor.titulo, subtitle: valor };
}
