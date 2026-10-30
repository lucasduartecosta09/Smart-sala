"use strict";

// ==========================================
// DASHBOARD - SENSORES E COMANDOS DE VOZ
// ==========================================

const $ = (id) => document.getElementById(id);

const LIMITE_HISTORICO = 100;
const LIMITE_EVENTOS = 15;

const NOMES = {
  ventiladorLigado: ["Ventilador", "ligado", "desligado"],
  ledsLigados: ["Luz", "ligada", "desligada"],
  servoAberto: ["Porta", "aberta", "fechada"]
};

const estado = {
  sensores: null,
  historico: [],
  eventos: [],
  ventiladorLigado: false,
  ledsLigados: false,
  servoAberto: false,
  modoAuto: false,
  tempAlta: 28,
  luxBaixa: 40,
  autoRefresh: false,
  intervalo: 5
};

let temporizador = null;
let controleVoz = null;

// ==========================================
// FUNÇÕES AUXILIARES
// ==========================================

function limitar(valor, minimo, maximo) {
  return Math.max(minimo, Math.min(maximo, valor));
}

function aleatorio(min, max) {
  return min + Math.random() * (max - min);
}

function inteiroAleatorio(min, max) {
  return Math.floor(aleatorio(min, max + 1));
}

function arredondar(valor, casas = 1) {
  return Number(valor.toFixed(casas));
}

function corCss(nome, fallback) {
  const valor = getComputedStyle(document.documentElement)
    .getPropertyValue(nome)
    .trim();
  return valor || fallback;
}

// ==========================================
// SENSORES SIMULADOS
// ==========================================

function lerSensores(anterior = null) {
  if (!anterior) {
    return {
      temperatura: arredondar(aleatorio(20, 30)),
      umidade: inteiroAleatorio(40, 70),
      luminosidade: inteiroAleatorio(30, 80),
      pessoas: inteiroAleatorio(0, 30)
    };
  }

  return {
    temperatura: arredondar(
      limitar(anterior.temperatura + aleatorio(-1, 1), 16, 32)
    ),
    umidade: limitar(
      anterior.umidade + inteiroAleatorio(-3, 3),
      30,
      90
    ),
    luminosidade: limitar(
      anterior.luminosidade + inteiroAleatorio(-8, 8),
      10,
      100
    ),
    // Contador simulado de ocupação: pessoas entrando e saindo da sala.
    pessoas: limitar(
      anterior.pessoas + inteiroAleatorio(-4, 4),
      0,
      40
    )
  };
}

// Atualmente registra comandos simulados.
// A integração com Arduino pode ser adicionada aqui.
function enviarComando(chave, valor) {
  const prefixos = {
    ventiladorLigado: "VENTILADOR_DC",
    ledsLigados: "LEDS",
    servoAberto: "SERVO_SG90"
  };
  const prefixo = prefixos[chave] || chave.toUpperCase();
  console.log(`[SIMULAÇÃO] ${prefixo}:${valor ? 1 : 0}`);
}

// ==========================================
// EVENTOS E CONTROLES
// ==========================================

function registrarEvento(texto) {
  const hora = new Date().toLocaleTimeString("pt-BR");

  estado.eventos.unshift({ hora, texto });
  estado.eventos.splice(LIMITE_EVENTOS);

  if (window.senaiAuth && typeof window.senaiAuth.saveEvent === "function") {
    window.senaiAuth.saveEvent(texto);
  }
}

function definir(chave, valor, motivo) {
  if (estado[chave] === valor) return;

  estado[chave] = valor;

  const [nome, ligado, desligado] = NOMES[chave];

  registrarEvento(
    `${nome} ${valor ? ligado : desligado} (${motivo})`
  );

  enviarComando(chave, valor);
}

function aplicarAutomacao(leitura) {
  const temGente = leitura.pessoas > 0;

  if (!temGente) {
    definir("ventiladorLigado", false, "sala vazia");
    definir("ledsLigados", false, "sala vazia");
    return;
  }

  // Histerese: evita ligar e desligar sem parar.
  if (leitura.temperatura >= estado.tempAlta) {
    definir("ventiladorLigado", true, "temperatura alta no DHT11");
  } else if (leitura.temperatura <= estado.tempAlta - 2) {
    definir("ventiladorLigado", false, "temperatura normal no DHT11");
  }

  if (leitura.luminosidade <= estado.luxBaixa) {
    definir("ledsLigados", true, "pouca luz no LDR");
  } else if (
    leitura.luminosidade >= Math.min(estado.luxBaixa + 20, 100)
  ) {
    definir("ledsLigados", false, "luz suficiente no LDR");
  }
}

function atualizarSensores() {
  estado.sensores = lerSensores(estado.sensores);

  estado.historico.push({
    hora: new Date(),
    ...estado.sensores
  });

  if (estado.historico.length > LIMITE_HISTORICO) {
    estado.historico.shift();
  }

  if (estado.modoAuto) {
    aplicarAutomacao(estado.sensores);
  }

  if (window.senaiAuth && typeof window.senaiAuth.saveReading === "function") {
    window.senaiAuth.saveReading(estado.sensores);
  }
}

function inicializarHistorico(quantidade = 16) {
  const total = limitar(
    Math.trunc(quantidade),
    2,
    LIMITE_HISTORICO
  );
  const agora = Date.now();
  const intervaloMs = Math.max(estado.intervalo, 2) * 1000;

  estado.historico = [];
  let leitura = null;

  for (let indice = 0; indice < total; indice++) {
    leitura = lerSensores(leitura);
    estado.historico.push({
      hora: new Date(
        agora - (total - indice - 1) * intervaloMs
      ),
      ...leitura
    });
  }

  estado.sensores = leitura;

  if (estado.modoAuto && leitura) {
    aplicarAutomacao(leitura);
  }
}

function atualizarAgora() {
  atualizarSensores();
  desenhar();
}

function alternar(chave) {
  definir(chave, !estado[chave], "manual");
  desenhar();
}

function mudarModoAuto(ligado, motivo = "manual") {
  if (estado.modoAuto === ligado) {
    desenhar();
    return;
  }

  estado.modoAuto = ligado;

  registrarEvento(
    `Modo automático ${ligado ? "ligado" : "desligado"} (${motivo})`
  );

  if (ligado && estado.sensores) {
    aplicarAutomacao(estado.sensores);
  }

  desenhar();
}

function mudarAtualizacaoAutomatica(ligado, motivo = "manual") {
  if (estado.autoRefresh !== ligado) {
    estado.autoRefresh = ligado;

    registrarEvento(
      `Atualização automática ${ligado ? "ligada" : "desligada"} (${motivo})`
    );
  }

  const checkbox = $("auto-refresh");
  const intervalo = $("intervalo");

  if (checkbox) checkbox.checked = ligado;
  if (intervalo) intervalo.disabled = !ligado;

  configurarTemporizador();
  desenhar();
}

function desligarTudo() {
  if (estado.modoAuto) {
    mudarModoAuto(false, "desligar tudo");
  }

  definir("ventiladorLigado", false, "desligar tudo");
  definir("ledsLigados", false, "desligar tudo");
  definir("servoAberto", false, "desligar tudo");

  desenhar();
}

function limparHistorico() {
  // Mantém a leitura mais recente para preservar o estado atual do gráfico.
  estado.historico = estado.historico.slice(-1);

  registrarEvento("Histórico de sensores limpo");
  desenhar();
}

const downloadHistorico = {
  editados: { inicio: false, fim: false },
  baixando: false,
  temporizadorDia: null
};

function dataLocalParaCampo(data = new Date()) {
  return [data.getFullYear(), String(data.getMonth() + 1).padStart(2, "0"), String(data.getDate()).padStart(2, "0")].join("-");
}

function dataDoCampo(valor) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  const [ano, mes, dia] = valor.split("-").map(Number);
  const data = new Date(0);
  data.setHours(0, 0, 0, 0);
  data.setFullYear(ano, mes - 1, dia);
  return data.getFullYear() === ano && data.getMonth() === mes - 1 && data.getDate() === dia ? data : null;
}

function atualizarResumoDownload() {
  const inicio = dataDoCampo($("historico-inicio").value);
  const fim = dataDoCampo($("historico-fim").value);
  $("historico-download-periodo").textContent = inicio && fim
    ? `${inicio.toLocaleDateString("pt-BR")} a ${fim.toLocaleDateString("pt-BR")}`
    : "Selecione as duas datas";
}

function atualizarDatasDownload(redefinir = false) {
  if (downloadHistorico.baixando) return;
  const hoje = dataLocalParaCampo();
  for (const limite of ["inicio", "fim"]) {
    if (redefinir) downloadHistorico.editados[limite] = false;
    if (!downloadHistorico.editados[limite]) $("historico-" + limite).value = hoje;
  }
  atualizarResumoDownload();
}

function informarDownload(texto, erro = false) {
  const status = $("historico-download-status");
  status.textContent = texto;
  status.dataset.erro = String(erro);
}

function configurarDownloadHistorico() {
  atualizarDatasDownload();
  for (const limite of ["inicio", "fim"]) {
    const campo = $("historico-" + limite);
    const editar = () => {
      downloadHistorico.editados[limite] = true;
      for (const id of ["historico-inicio", "historico-fim"]) {
        $(id).setCustomValidity("");
        $(id).removeAttribute("aria-invalid");
      }
      informarDownload("");
      atualizarResumoDownload();
    };
    campo.addEventListener("input", editar);
    campo.addEventListener("change", editar);
  }
  $("btn-periodo-hoje").addEventListener("click", () => {
    atualizarDatasDownload(true);
    for (const id of ["historico-inicio", "historico-fim"]) {
      $(id).setCustomValidity("");
      $(id).removeAttribute("aria-invalid");
    }
    informarDownload("");
  });
  $("historico-download-form").addEventListener("submit", (evento) => {
    evento.preventDefault();
    baixarHistoricoPdf();
  });
  const acompanharDia = () => {
    clearTimeout(downloadHistorico.temporizadorDia);
    atualizarDatasDownload();
    const agora = new Date();
    const amanha = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1);
    downloadHistorico.temporizadorDia = setTimeout(acompanharDia, Math.max(1000, Number(amanha) - Number(agora)));
  };
  acompanharDia();
  window.addEventListener("focus", acompanharDia);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) acompanharDia();
  });
}

async function baixarHistoricoPdf() {
  if (downloadHistorico.baixando) return;
  if (window.senaiAuth?.canOperatePanel && !window.senaiAuth.canOperatePanel()) {
    informarDownload("Seu perfil não tem permissão para baixar o histórico.", true);
    return;
  }
  atualizarDatasDownload();
  const campoInicio = $("historico-inicio");
  const campoFim = $("historico-fim");
  for (const campo of [campoInicio, campoFim]) {
    campo.setCustomValidity("");
    campo.removeAttribute("aria-invalid");
  }
  const inicio = dataDoCampo(campoInicio.value);
  const fim = dataDoCampo(campoFim.value);
  const campoInvalido = !inicio ? campoInicio : !fim || inicio > fim ? campoFim : null;
  if (campoInvalido) {
    const mensagem = inicio && fim
      ? "A data final deve ser igual ou posterior à data inicial."
      : "Preencha uma data inicial e uma data final válidas.";
    campoInvalido.setCustomValidity(mensagem);
    campoInvalido.setAttribute("aria-invalid", "true");
    informarDownload(mensagem, true);
    campoInvalido.focus();
    campoInvalido.reportValidity();
    return;
  }
  const fimExclusivo = new Date(fim);
  fimExclusivo.setDate(fimExclusivo.getDate() + 1);
  fimExclusivo.setHours(0, 0, 0, 0);
  const datasArquivo = `${campoInicio.value}_a_${campoFim.value}`;
  const periodo = `${inicio.toLocaleDateString("pt-BR")} a ${fim.toLocaleDateString("pt-BR")}`;
  const botao = $("btn-baixar");
  const textoBotao = botao.lastChild;
  const textoOriginal = textoBotao.textContent;
  const controles = [campoInicio, campoFim, $("btn-periodo-hoje"), botao];
  const desabilitados = controles.map((controle) => controle.disabled);
  downloadHistorico.baixando = true;
  controles.forEach((controle) => { controle.disabled = true; });
  textoBotao.textContent = "Preparando PDF…";
  $("historico-download-form").setAttribute("aria-busy", "true");
  informarDownload("Buscando as leituras do período selecionado…");
  try {
    if (typeof window.senaiAuth?.loadHistoryForExport !== "function") {
      throw new Error("O serviço de exportação não está disponível.");
    }
    const leituras = await window.senaiAuth.loadHistoryForExport(inicio, fimExclusivo);
    const registros = leituras
      .filter((leitura) => Number(new Date(leitura.hora)) >= Number(inicio) && Number(new Date(leitura.hora)) < Number(fimExclusivo))
      .map((leitura) => ({ ...leitura, hora: new Date(leitura.hora) }))
      .sort((a, b) => a.hora - b.hora);
    if (!registros.length) {
      informarDownload(`Nenhuma leitura encontrada de ${periodo}. Escolha outro período.`, true);
      return;
    }
    gerarHistoricoPdf(registros, periodo, datasArquivo);
    informarDownload(`Download iniciado: ${registros.length} leitura${registros.length === 1 ? "" : "s"} de ${periodo}.`);
  } catch (erro) {
    console.warn("Não foi possível exportar o histórico:", erro);
    informarDownload("Não foi possível consultar o histórico desse período. Verifique sua conexão e tente novamente.", true);
  } finally {
    downloadHistorico.baixando = false;
    controles.forEach((controle, indice) => { controle.disabled = desabilitados[indice]; });
    textoBotao.textContent = textoOriginal;
    $("historico-download-form").removeAttribute("aria-busy");
    atualizarDatasDownload();
  }
}

function gerarHistoricoPdf(registros, periodoSelecionado, datasArquivo) {
  const codificador = new TextEncoder();
  const normalizarTexto = (valor) => String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7e]/g, "?");
  const escaparTexto = (valor) => normalizarTexto(valor)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
  const formatarNumero = (valor, casas = 0) => {
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return "--";
    return numero.toLocaleString("pt-BR", {
      minimumFractionDigits: casas,
      maximumFractionDigits: casas
    });
  };
  const cor = (valores) => valores.map((valor) => Number(valor).toFixed(3)).join(" ");
  const adicionarRetangulo = (comandos, x, y, largura, altura, preenchimento) => {
    comandos.push(`${cor(preenchimento)} rg ${x} ${y} ${largura} ${altura} re f`);
  };
  const adicionarTexto = (comandos, texto, x, y, tamanho, opcoes = {}) => {
    const negrito = Boolean(opcoes.negrito);
    const preenchimento = opcoes.cor || [0.11, 0.16, 0.25];
    const largura = Number(opcoes.largura) || 0;
    const alinhamento = opcoes.alinhamento || "esquerda";
    const textoSeguro = normalizarTexto(texto);
    const larguraEstimada = textoSeguro.length * tamanho * (negrito ? 0.54 : 0.5);
    let posicaoX = x;
    if (alinhamento === "centro") posicaoX += Math.max(0, (largura - larguraEstimada) / 2);
    if (alinhamento === "direita") posicaoX += Math.max(0, largura - larguraEstimada);
    comandos.push(`BT /${negrito ? "F2" : "F1"} ${tamanho} Tf ${cor(preenchimento)} rg 1 0 0 1 ${posicaoX.toFixed(2)} ${y.toFixed(2)} Tm (${escaparTexto(textoSeguro)}) Tj ET`);
  };

  const larguraPagina = 842;
  const alturaPagina = 595;
  const margem = 36;
  const larguraTabela = larguraPagina - margem * 2;
  const alturaLinha = 20;
  const leiturasPorPagina = 20;
  const totalPaginas = Math.max(1, Math.ceil(registros.length / leiturasPorPagina));
  const colunas = [
    { titulo: "Data", largura: 110 },
    { titulo: "Hora", largura: 95 },
    { titulo: "Temperatura (C)", largura: 160 },
    { titulo: "Umidade (%)", largura: 130 },
    { titulo: "Luminosidade (%)", largura: 155 },
    { titulo: "Pessoas", largura: 120 }
  ];
  const agora = new Date();
  const periodo = `Periodo selecionado: ${periodoSelecionado}`;
  const paginas = [];

  for (let pagina = 0; pagina < totalPaginas; pagina++) {
    const comandos = [];
    const leituras = registros.slice(pagina * leiturasPorPagina, (pagina + 1) * leiturasPorPagina);

    adicionarRetangulo(comandos, margem, 508, larguraTabela, 67, [0.027, 0.071, 0.153]);
    adicionarRetangulo(comandos, margem, 508, 6, 67, [0.133, 0.827, 0.933]);
    adicionarTexto(comandos, "SENAI SMART CLASS", margem + 22, 551, 10, { negrito: true, cor: [0.133, 0.827, 0.933] });
    adicionarTexto(comandos, "Historico de sensores por periodo", margem + 22, 526, 18, { negrito: true, cor: [1, 1, 1] });
    adicionarTexto(comandos, `Pagina ${pagina + 1} de ${totalPaginas}`, 690, 550, 9, { negrito: true, cor: [0.8, 0.87, 0.96], largura: 96, alinhamento: "direita" });
    adicionarTexto(comandos, `Gerado em ${agora.toLocaleString("pt-BR")}`, 620, 529, 8, { cor: [0.65, 0.72, 0.82], largura: 166, alinhamento: "direita" });

    adicionarRetangulo(comandos, margem, 472, larguraTabela, 24, [0.941, 0.965, 0.992]);
    adicionarTexto(comandos, periodo, margem + 10, 480, 8.5, { cor: [0.2, 0.29, 0.42] });
    adicionarTexto(comandos, `Total: ${registros.length} leitura${registros.length === 1 ? "" : "s"}`, 674, 480, 8.5, { negrito: true, cor: [0.04, 0.45, 0.58], largura: 112, alinhamento: "direita" });

    const topoTabela = 461;
    adicionarRetangulo(comandos, margem, topoTabela - 26, larguraTabela, 26, [0.075, 0.145, 0.278]);
    let colunaX = margem;
    for (const coluna of colunas) {
      adicionarTexto(comandos, coluna.titulo, colunaX, topoTabela - 17, 8.5, {
        negrito: true,
        cor: [1, 1, 1],
        largura: coluna.largura,
        alinhamento: "centro"
      });
      colunaX += coluna.largura;
    }

    if (!leituras.length) {
      adicionarRetangulo(comandos, margem, topoTabela - 26 - alturaLinha, larguraTabela, alturaLinha, [0.975, 0.98, 0.988]);
      adicionarTexto(comandos, "Nenhuma leitura disponivel.", margem, topoTabela - 40, 9, {
        cor: [0.39, 0.45, 0.55],
        largura: larguraTabela,
        alinhamento: "centro"
      });
    }

    leituras.forEach((leitura, indice) => {
      const y = topoTabela - 26 - alturaLinha * (indice + 1);
      adicionarRetangulo(comandos, margem, y, larguraTabela, alturaLinha, indice % 2 ? [0.948, 0.965, 0.985] : [0.985, 0.989, 0.995]);
      const valores = [
        leitura.hora.toLocaleDateString("pt-BR"),
        leitura.hora.toLocaleTimeString("pt-BR"),
        `${formatarNumero(leitura.temperatura, 1)} C`,
        `${formatarNumero(leitura.umidade)} %`,
        `${formatarNumero(leitura.luminosidade)} %`,
        formatarNumero(leitura.pessoas)
      ];
      let x = margem;
      valores.forEach((valor, indiceColuna) => {
        adicionarTexto(comandos, valor, x, y + 6.5, 8.5, {
          cor: [0.12, 0.18, 0.28],
          largura: colunas[indiceColuna].largura,
          alinhamento: "centro"
        });
        x += colunas[indiceColuna].largura;
      });
    });

    adicionarTexto(comandos, "Relatorio gerado pelo painel SENAI Smart Class", margem, 17, 7.5, { cor: [0.45, 0.5, 0.58] });
    adicionarTexto(comandos, `${registros.length} registros no periodo selecionado`, 620, 17, 7.5, { cor: [0.45, 0.5, 0.58], largura: 166, alinhamento: "direita" });
    paginas.push(comandos.join("\n"));
  }

  const objetos = [null];
  const paginasIds = paginas.map((_, indice) => ({ pagina: 3 + indice * 2, conteudo: 4 + indice * 2 }));
  const fonteNormalId = 3 + paginas.length * 2;
  const fonteNegritoId = fonteNormalId + 1;
  const informacoesId = fonteNegritoId + 1;
  objetos[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objetos[2] = `<< /Type /Pages /Count ${paginas.length} /Kids [${paginasIds.map(({ pagina }) => `${pagina} 0 R`).join(" ")}] >>`;
  paginas.forEach((conteudo, indice) => {
    const ids = paginasIds[indice];
    const tamanhoConteudo = codificador.encode(conteudo).length;
    objetos[ids.pagina] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${larguraPagina} ${alturaPagina}] /Resources << /Font << /F1 ${fonteNormalId} 0 R /F2 ${fonteNegritoId} 0 R >> >> /Contents ${ids.conteudo} 0 R >>`;
    objetos[ids.conteudo] = `<< /Length ${tamanhoConteudo} >>\nstream\n${conteudo}\nendstream`;
  });
  objetos[fonteNormalId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objetos[fonteNegritoId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objetos[informacoesId] = `<< /Title (Historico de sensores) /Author (SENAI Smart Class) /Subject (${registros.length} leituras do ambiente) /Creator (Painel SENAI Smart Class) >>`;

  let documento = "%PDF-1.4\n";
  let tamanhoDocumento = codificador.encode(documento).length;
  const deslocamentos = [0];
  for (let id = 1; id < objetos.length; id++) {
    deslocamentos[id] = tamanhoDocumento;
    const objeto = `${id} 0 obj\n${objetos[id]}\nendobj\n`;
    documento += objeto;
    tamanhoDocumento += codificador.encode(objeto).length;
  }
  const inicioXref = tamanhoDocumento;
  documento += `xref\n0 ${objetos.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objetos.length; id++) {
    documento += `${String(deslocamentos[id]).padStart(10, "0")} 00000 n \n`;
  }
  documento += `trailer\n<< /Size ${objetos.length} /Root 1 0 R /Info ${informacoesId} 0 R >>\nstartxref\n${inicioXref}\n%%EOF`;
  const blob = new Blob([codificador.encode(documento)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `historico-sensores_${datasArquivo}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);

  registrarEvento("Histórico baixado em PDF");
  desenhar();
}

function configurarTemporizador() {
  clearInterval(temporizador);
  temporizador = null;

  if (estado.autoRefresh) {
    temporizador = setInterval(
      atualizarAgora,
      estado.intervalo * 1000
    );
  }
}

// ==========================================
// ALERTAS
// ==========================================

function calcularAlertas(sensor) {
  const alertas = [];

  if (sensor.temperatura >= estado.tempAlta) {
    alertas.push("Temperatura muito alta");
  }

  if (sensor.umidade < 40) {
    alertas.push("Ar muito seco");
  }

  if (sensor.umidade > 75) {
    alertas.push("Umidade muito alta");
  }

  if (
    sensor.pessoas === 0 &&
    (estado.ventiladorLigado || estado.ledsLigados)
  ) {
    alertas.push("Equipamentos ligados com a sala vazia");
  }

  return alertas;
}

// ==========================================
// GRÁFICOS
// ==========================================

const geometriaGraficos = new WeakMap();
let redesenhoGraficosPendente = null;

// Todas as séries usam a mesma aquisição e os mesmos horários do histórico.
const METRICAS_GRAFICOS = {
  temperatura: { titulo: "temperatura", unidade: "°C", casas: 1, amplitudeMinima: 4, cor: "--cor-temperatura", fallback: "#fb923c" },
  umidade: { titulo: "umidade", unidade: "%", casas: 0, amplitudeMinima: 10, cor: "--cor-umidade", fallback: "#22d3ee" },
  pessoas: { titulo: "ocupação da sala", unidade: "pessoas", casas: 0, amplitudeMinima: 6, cor: "--cor-pessoas", fallback: "#34d399" },
  luminosidade: { titulo: "luminosidade", unidade: "%", casas: 0, amplitudeMinima: 10, cor: "--cor-luminosidade", fallback: "#c4b5fd" }
};
let metricaPrincipal = "temperatura";
let visualizacaoDashboard = "roleta";
let animacaoAberturaDashboard = null;

// A seleção de pontos não altera as leituras nem o período escolhido para o download.
const visaoHistorico = {
  selecionado: null,
  fixado: false,
  detalhesAbertos: false
};
let historicoExibido = [];

function atualizarTitulosPagina() {
  const titulos = {
    sensores: "Monitoramento dos sensores",
    controles: "Controles da sala",
    config: "Configurações da automação",
    conta: "Perfil e acesso"
  };
  const subtitulos = {
    sensores: "Monitoramento inteligente",
    controles: "Operação dos equipamentos simulados",
    config: "Regras e atualização do painel",
    conta: "Dados do usuário e permissões"
  };
  const tituloHistorico = `Histórico de ${METRICAS_GRAFICOS[metricaPrincipal].titulo}`;
  const tituloDetalhes = $("dashboard-detalhes-titulo");
  if (tituloDetalhes) tituloDetalhes.textContent = tituloHistorico;
  const aba = document.body.dataset.abaAtiva || "sensores";
  const titulo = aba === "sensores" && visualizacaoDashboard === "detalhes"
    ? tituloHistorico
    : titulos[aba];
  const tituloBanner = document.querySelector(".banner .titulo");
  if (tituloBanner) tituloBanner.textContent = titulo;
  const subtituloBanner = document.querySelector(".banner .subtitulo");
  if (subtituloBanner) subtituloBanner.textContent = subtitulos[aba] || subtitulos.sensores;
  document.title = `${titulo} | SENAI Smart Class`;
}

function emitirEstadoDashboard() {
  const sensores = estado.sensores ? { ...estado.sensores } : null;
  if (sensores && sensores.hora instanceof Date) sensores.hora = Number(sensores.hora);
  document.dispatchEvent(new CustomEvent("dashboard:state", {
    detail: {
      principal: metricaPrincipal,
      visualizacao: visualizacaoDashboard,
      sensores,
      historico: estado.historico.map((leitura) => ({ ...leitura, hora: Number(leitura.hora) }))
    }
  }));
}

function selecionarMetricaPrincipal(chave) {
  if (typeof chave !== "string" || !Object.prototype.hasOwnProperty.call(METRICAS_GRAFICOS, chave) || chave === metricaPrincipal) return false;
  const slot = $("grafico-principal-slot");
  const grade = document.querySelector("#graficos-complementares .complementares-grade");
  const selecionado = $(`grafico-${chave}`)?.closest("article");
  if (!slot || !grade || !selecionado) return false;

  // Reutiliza os quatro canvases e seus listeners, preservando leituras e filtros.
  metricaPrincipal = chave;
  slot.appendChild(selecionado);
  for (const metrica of Object.keys(METRICAS_GRAFICOS)) {
    const canvas = $(`grafico-${metrica}`);
    const card = canvas?.closest("article");
    if (!card) continue;
    const principal = metrica === chave;
    card.classList.toggle("grafico-principal", principal);
    const legenda = card.querySelector(".kpi-mini .kpi-legenda");
    if (legenda) legenda.textContent = principal ? "Atual" : "No ponto";
    canvas.removeAttribute("aria-controls");
    if (!principal) {
      grade.appendChild(card);
    }
  }
  const titulo = METRICAS_GRAFICOS[chave].titulo;
  const ajuda = $("graficos-ajuda");
  if (ajuda) ajuda.textContent = `Passe o cursor no gráfico de ${titulo} para consultar cada leitura. Clique ou toque para fixar um ponto. Pelo teclado: ← → para navegar, Enter para fixar ou soltar e Esc para liberar a seleção.`;
  const espera = $("complementares-espera");
  if (espera) espera.textContent = `Os outros dashboards permanecem ocultos nesta visualização individual de ${titulo}.`;
  document.querySelectorAll("#carousel-fallback [data-dashboard-metric]").forEach((botao) => {
    botao.setAttribute("aria-pressed", String(botao.dataset.dashboardMetric === chave));
  });
  atualizarTitulosPagina();
  limparSelecaoGraficos();
  emitirEstadoDashboard();
  return true;
}

function cancelarZoomDashboard() {
  if (animacaoAberturaDashboard) {
    animacaoAberturaDashboard.cancel();
    animacaoAberturaDashboard = null;
  }
  $("dashboard-detalhes")?.classList.remove("dashboard-zoom-entrada");
}

function aplicarZoomDashboard(painel) {
  cancelarZoomDashboard();
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
  if (typeof painel.animate === "function") {
    const animacao = painel.animate([
      { opacity: 0, transform: "translateY(12px) scale(0.9)" },
      { opacity: 1, transform: "translateY(0) scale(1)" }
    ], { duration: 380, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)", fill: "both" });
    animacaoAberturaDashboard = animacao;
    animacao.onfinish = () => {
      if (animacaoAberturaDashboard !== animacao) return;
      animacaoAberturaDashboard = null;
      animacao.cancel();
    };
  } else {
    // A classe usa o mesmo zoom para navegadores sem Web Animations.
    void painel.offsetWidth;
    painel.classList.add("dashboard-zoom-entrada");
  }
}

function abrirDashboard(chave) {
  if (typeof chave !== "string" || !Object.prototype.hasOwnProperty.call(METRICAS_GRAFICOS, chave)) return false;
  const painel = $("dashboard-detalhes");
  const roleta = document.querySelector("#aba-sensores .carousel-shell");
  const aba = $("aba-sensores");
  if (!painel || !roleta || !aba) return false;
  selecionarMetricaPrincipal(chave);
  visualizacaoDashboard = "detalhes";
  atualizarTitulosPagina();
  aba.dataset.visualizacao = visualizacaoDashboard;
  roleta.hidden = true;
  painel.hidden = false;
  desenharGraficos();
  if (historicoExibido.length) destacarLeitura(historicoExibido.length - 1);
  aplicarZoomDashboard(painel);
  aba.scrollIntoView?.({ block: "start", behavior: "instant" });
  $(`grafico-${metricaPrincipal}`)?.focus({ preventScroll: true });
  emitirEstadoDashboard();
  return true;
}

function voltarParaRoleta() {
  const painel = $("dashboard-detalhes");
  const roleta = document.querySelector("#aba-sensores .carousel-shell");
  const aba = $("aba-sensores");
  if (!painel || !roleta || !aba) return false;
  cancelarZoomDashboard();
  visualizacaoDashboard = "roleta";
  atualizarTitulosPagina();
  aba.dataset.visualizacao = visualizacaoDashboard;
  painel.hidden = true;
  roleta.hidden = false;
  limparSelecaoGraficos();
  const alvo = document.querySelector("#dashboard-carousel-root .circular-carousel") ||
    document.querySelector(`#carousel-fallback [data-dashboard-metric="${metricaPrincipal}"]`);
  alvo?.focus({ preventScroll: true });
  aba.scrollIntoView?.({ block: "start", behavior: "instant" });
  emitirEstadoDashboard();
  return true;
}

function corComAlpha(cor, alpha) {
  const hex = cor.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (hex) {
    let valor = hex[1];
    if (valor.length === 3) {
      valor = valor.split("").map((parte) => parte + parte).join("");
    }
    const r = parseInt(valor.slice(0, 2), 16);
    const g = parseInt(valor.slice(2, 4), 16);
    const b = parseInt(valor.slice(4, 6), 16);
    return "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";
  }

  const rgb = cor.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgb) {
    return "rgba(" + rgb[1] + ", " + rgb[2] + ", " + rgb[3] + ", " + alpha + ")";
  }

  return cor;
}

function pontosBezierCatmull(pontos, tensao = 1) {
  const comandos = [];
  const fator = tensao / 6;

  for (let i = 0; i < pontos.length - 1; i++) {
    const p0 = pontos[Math.max(i - 1, 0)];
    const p1 = pontos[i];
    const p2 = pontos[i + 1];
    const p3 = pontos[Math.min(i + 2, pontos.length - 1)];

    const minimoY = Math.min(p1[1], p2[1]);
    const maximoY = Math.max(p1[1], p2[1]);

    comandos.push([
      limitar(
        p1[0] + (p2[0] - p0[0]) * fator,
        p1[0],
        p2[0]
      ),
      limitar(
        p1[1] + (p2[1] - p0[1]) * fator,
        minimoY,
        maximoY
      ),
      limitar(
        p2[0] - (p3[0] - p1[0]) * fator,
        p1[0],
        p2[0]
      ),
      limitar(
        p2[1] - (p3[1] - p1[1]) * fator,
        minimoY,
        maximoY
      ),
      p2[0],
      p2[1]
    ]);
  }

  return comandos;
}

function calcularEscala(valores, amplitudeMinima, somenteInteiros) {
  const menorDado = Math.min(...valores);
  const maiorDado = Math.max(...valores);
  const centro = (menorDado + maiorDado) / 2;
  const amplitude = Math.max(maiorDado - menorDado, amplitudeMinima);

  let minimo = Math.max(0, centro - amplitude / 2);
  let maximo = minimo + amplitude;

  if (maiorDado > maximo) {
    maximo = maiorDado;
    minimo = Math.max(0, maximo - amplitude);
  }

  if (somenteInteiros) {
    minimo = Math.floor(minimo);
    maximo = Math.ceil(maximo);
    if (maximo - minimo < amplitudeMinima) {
      maximo = minimo + amplitudeMinima;
    }
  }

  return { minimo, maximo };
}

function formatarHorario(data, mostrarSegundos = true) {
  return data.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: mostrarSegundos ? "2-digit" : undefined
  });
}

function desenharGrafico(canvas, registros, configuracao) {
  const {
    chave,
    cor,
    casas = 0,
    unidade = "",
    amplitudeMinima = 4
  } = configuracao;

  const valores = registros.map((registro) => registro[chave]);
  const horarios = registros.map((registro) => registro.hora);
  const retangulo = canvas.getBoundingClientRect();
  const largura = retangulo.width;
  const altura = retangulo.height;

  geometriaGraficos.delete(canvas);
  if (!largura || !altura || !valores.length) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(largura * dpr));
  canvas.height = Math.max(1, Math.round(altura * dpr));

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, largura, altura);

  const margem = {
    esquerda: largura < 520 ? 44 : 54,
    direita: 16,
    topo: 24,
    baixo: 34
  };
  const areaLargura = largura - margem.esquerda - margem.direita;
  const areaAltura = altura - margem.topo - margem.baixo;

  if (areaLargura <= 0 || areaAltura <= 0) return;

  const escala = calcularEscala(
    valores,
    amplitudeMinima,
    casas === 0
  );
  const minimo = escala.minimo;
  const maximo = escala.maximo;

  const xPos = (indice) => margem.esquerda +
    (valores.length === 1
      ? areaLargura / 2
      : (indice / (valores.length - 1)) * areaLargura);
  const yPos = (valor) => margem.topo + areaAltura -
    ((valor - minimo) / (maximo - minimo)) * areaAltura;

  const corGrade = corCss("--grade", "rgba(148,163,184,0.16)");
  const corSuave = corCss("--suave", "#64748b");

  ctx.fillStyle = corSuave;
  ctx.font = "600 10px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(unidade.trim(), margem.esquerda, 4);

  const quantidadeGrades = 4;
  ctx.lineWidth = 1;

  for (let i = 0; i <= quantidadeGrades; i++) {
    const valor = minimo + ((maximo - minimo) * i) / quantidadeGrades;
    const py = yPos(valor);

    ctx.setLineDash([3, 6]);
    ctx.strokeStyle = corGrade;
    ctx.beginPath();
    ctx.moveTo(margem.esquerda, py);
    ctx.lineTo(largura - margem.direita, py);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = corSuave;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(valor.toFixed(casas), margem.esquerda - 8, py);
  }

  if (horarios.length > 1) {
    const intervaloTotal = horarios[horarios.length - 1] - horarios[0];
    const mostrarSegundos = intervaloTotal < 60 * 60 * 1000;
    const quantidadeRotulos = Math.max(
      2,
      Math.min(5, Math.floor(areaLargura / 115), horarios.length - 1)
    );

    ctx.fillStyle = corSuave;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textBaseline = "top";

    for (let i = 0; i <= quantidadeRotulos; i++) {
      const indice = Math.round(
        (i / quantidadeRotulos) * (horarios.length - 1)
      );
      const px = xPos(indice);
      ctx.textAlign = i === 0
        ? "left"
        : i === quantidadeRotulos
          ? "right"
          : "center";
      ctx.fillText(
        formatarHorario(horarios[indice], mostrarSegundos),
        px,
        margem.topo + areaAltura + 9
      );
    }
  }

  const pontos = valores.map((valor, indice) => [
    xPos(indice),
    yPos(valor)
  ]);

  ctx.save();
  ctx.beginPath();
  ctx.rect(
    margem.esquerda - 8,
    margem.topo - 8,
    areaLargura + 16,
    areaAltura + 16
  );
  ctx.clip();

  if (pontos.length > 1) {
    const comandos = pontosBezierCatmull(pontos);
    const gradienteArea = ctx.createLinearGradient(
      0,
      margem.topo,
      0,
      margem.topo + areaAltura
    );
    gradienteArea.addColorStop(0, corComAlpha(cor, 0.26));
    gradienteArea.addColorStop(0.65, corComAlpha(cor, 0.07));
    gradienteArea.addColorStop(1, corComAlpha(cor, 0));

    ctx.beginPath();
    ctx.moveTo(pontos[0][0], pontos[0][1]);
    comandos.forEach((comando) => {
      ctx.bezierCurveTo(...comando);
    });
    ctx.lineTo(pontos[pontos.length - 1][0], margem.topo + areaAltura);
    ctx.lineTo(pontos[0][0], margem.topo + areaAltura);
    ctx.closePath();
    ctx.fillStyle = gradienteArea;
    ctx.fill();

    const gradienteLinha = ctx.createLinearGradient(
      margem.esquerda,
      0,
      largura - margem.direita,
      0
    );
    gradienteLinha.addColorStop(0, corComAlpha(cor, 0.65));
    gradienteLinha.addColorStop(0.55, cor);
    gradienteLinha.addColorStop(1, cor);

    ctx.beginPath();
    ctx.moveTo(pontos[0][0], pontos[0][1]);
    comandos.forEach((comando) => {
      ctx.bezierCurveTo(...comando);
    });
    ctx.strokeStyle = gradienteLinha;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    const passoMarcador = Math.max(1, Math.ceil(pontos.length / 24));
    pontos.slice(0, -1).forEach((ponto, indice) => {
      if (indice % passoMarcador !== 0) return;
      ctx.beginPath();
      ctx.arc(ponto[0], ponto[1], 2, 0, Math.PI * 2);
      ctx.fillStyle = corComAlpha(cor, 0.72);
      ctx.fill();
    });
  }

  const ultimoPonto = pontos[pontos.length - 1];
  const halo = ctx.createRadialGradient(
    ultimoPonto[0],
    ultimoPonto[1],
    2,
    ultimoPonto[0],
    ultimoPonto[1],
    13
  );
  halo.addColorStop(0, corComAlpha(cor, 0.42));
  halo.addColorStop(1, corComAlpha(cor, 0));

  ctx.beginPath();
  ctx.arc(ultimoPonto[0], ultimoPonto[1], 13, 0, Math.PI * 2);
  ctx.fillStyle = halo;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(ultimoPonto[0], ultimoPonto[1], 4.5, 0, Math.PI * 2);
  ctx.fillStyle = cor;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  geometriaGraficos.set(canvas, {
    pontos,
    valores,
    horarios,
    margem,
    areaLargura,
    areaAltura,
    casas,
    unidade,
    cor
  });
}

function atualizarKpisGrafico(valores, sensor, indiceAtual = valores.length - 1) {
  if (!valores.length) {
    for (const campo of ["atual", "min", "med", "max", "tend-texto"]) {
      const elemento = $(`graf-${sensor}-${campo}`);
      if (elemento) elemento.textContent = "--";
    }
    return;
  }

  const { casas, unidade } = METRICAS_GRAFICOS[sensor];
  const prefixo = `graf-${sensor}`;
  const minimo = Math.min(...valores);
  const maximo = Math.max(...valores);
  const media = valores.reduce((soma, valor) => soma + valor, 0) / valores.length;
  const atual = valores[indiceAtual];
  const anterior = valores[Math.max(0, indiceAtual - 1)];
  const diferenca = atual - anterior;

  const preencher = (id, texto) => {
    const elemento = $(id);
    if (elemento) elemento.textContent = texto;
  };

  preencher(`${prefixo}-atual`, atual.toFixed(casas) + " " + unidade);
  preencher(`${prefixo}-min`, minimo.toFixed(casas) + " " + unidade);
  preencher(`${prefixo}-med`, media.toFixed(casas) + " " + unidade);
  preencher(`${prefixo}-max`, maximo.toFixed(casas) + " " + unidade);

  const tendencia = $(`${prefixo}-tend-texto`);
  const tendenciaPai = $(`${prefixo}-tend`);

  if (tendencia && tendenciaPai) {
    tendencia.textContent = diferenca > 0.05
      ? "Subindo"
      : diferenca < -0.05
        ? "Caindo"
        : "Estável";
    tendenciaPai.className = "kpi-valor kpi-tendencia " +
      (diferenca > 0.05
        ? "tend-subindo"
        : diferenca < -0.05
          ? "tend-caindo"
          : "tend-estavel");
  }
}

function desenharGraficos() {
  historicoExibido = estado.historico;
  const indiceSelecionado = historicoExibido.findIndex((leitura) => Number(leitura.hora) === visaoHistorico.selecionado);
  if (indiceSelecionado < 0) {
    visaoHistorico.selecionado = null;
    visaoHistorico.fixado = false;
    visaoHistorico.detalhesAbertos = false;
  }
  const contexto = [];
  const complementares = $("graficos-complementares");
  if (complementares) complementares.hidden = true;
  const espera = $("complementares-espera");
  if (espera) espera.hidden = true;
  const descricaoContexto = $("complementares-contexto");
  if (descricaoContexto) descricaoContexto.textContent = "";

  for (const [chave, metrica] of Object.entries(METRICAS_GRAFICOS)) {
    const canvas = $(`grafico-${chave}`);
    if (!canvas) continue;

    const principal = chave === metricaPrincipal;
    const registros = principal ? historicoExibido : contexto;
    const valores = registros.map((leitura) => leitura[chave]);
    const indiceAtual = principal
      ? valores.length - 1
      : registros.findIndex((leitura) => Number(leitura.hora) === visaoHistorico.selecionado);
    desenharGrafico(canvas, registros, {
      ...metrica,
      chave,
      cor: corCss(metrica.cor, metrica.fallback)
    });
    atualizarKpisGrafico(valores, chave, indiceAtual);

    if (valores.length) {
      canvas.setAttribute("aria-label", `Histórico de ${metrica.titulo}. ${principal ? "Atual" : "No ponto"}: ${valores[indiceAtual].toFixed(metrica.casas)} ${metrica.unidade}. ${valores.length} leituras ${principal ? "no período exibido" : "na janela contextual"}.`);
    } else {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.setAttribute("aria-label", `Histórico de ${metrica.titulo}. Sem leituras no período.`);
    }
  }

  const periodo = $("historico-periodo");
  if (periodo && historicoExibido.length) {
    const inicio = historicoExibido[0].hora;
    const fim = historicoExibido[historicoExibido.length - 1].hora;
    const formatarDataHora = (data) => data.toLocaleString("pt-BR");
    periodo.textContent = `${formatarDataHora(inicio)} — ${formatarDataHora(fim)} · ${historicoExibido.length} de ${estado.historico.length} leituras no período`;
  } else if (periodo) {
    periodo.textContent = "Sem leituras no período.";
  }

  const atualizacao = $("historico-atualizacao");
  if (atualizacao) {
    atualizacao.textContent = estado.autoRefresh
      ? `Atualização automática a cada ${estado.intervalo} s`
      : "Atualização manual";
  }
  atualizarLeituraDestacada();
}

function limparSelecaoGraficos() {
  visaoHistorico.selecionado = null;
  visaoHistorico.fixado = false;
  visaoHistorico.detalhesAbertos = false;
  desenharGraficos();
}

function destacarLeitura(indice, fixado = false) {
  const leitura = historicoExibido[indice];
  if (!leitura) return;
  // Mantém a interação e o tooltip apenas no dashboard principal.
  const mesmoPonto = visaoHistorico.selecionado === Number(leitura.hora);
  visaoHistorico.selecionado = Number(leitura.hora);
  visaoHistorico.fixado = fixado;
  visaoHistorico.detalhesAbertos = false;
  if (mesmoPonto) atualizarLeituraDestacada();
  else desenharGraficos();
}

function atualizarLeituraDestacada() {
  const indice = historicoExibido.findIndex((leitura) => Number(leitura.hora) === visaoHistorico.selecionado);
  const leitura = historicoExibido[indice];
  if (!leitura) {
    visaoHistorico.selecionado = null;
    visaoHistorico.fixado = false;
  }

  for (const chave of Object.keys(METRICAS_GRAFICOS)) {
    const canvas = $(`grafico-${chave}`);
    if (!canvas) continue;
    const wrapper = canvas.parentElement;
    const tooltip = $(`grafico-${chave}-tooltip`);
    const cursor = wrapper.querySelector(".grafico-cursor");
    const marcador = wrapper.querySelector(".grafico-marcador");
    const dados = geometriaGraficos.get(canvas);
    const indiceLocal = dados
      ? dados.horarios.findIndex((hora) => Number(hora) === visaoHistorico.selecionado)
      : -1;
    const visivel = chave === metricaPrincipal && Boolean(leitura && dados && dados.pontos[indiceLocal]);
    for (const elemento of [tooltip, cursor, marcador]) {
      if (elemento) elemento.hidden = !visivel;
    }
    if (!visivel || !tooltip) continue;

    const ponto = dados.pontos[indiceLocal];
    if (cursor) {
      cursor.style.left = ponto[0] + "px";
      cursor.style.top = dados.margem.topo + "px";
      cursor.style.height = dados.areaAltura + "px";
    }
    if (marcador) {
      marcador.style.left = ponto[0] + "px";
      marcador.style.top = ponto[1] + "px";
    }
    const valorEl = document.createElement("strong");
    valorEl.textContent = dados.valores[indiceLocal].toFixed(dados.casas) + " " + dados.unidade;
    const horaEl = document.createElement("span");
    horaEl.textContent = formatarHorario(leitura.hora);
    tooltip.replaceChildren(valorEl, horaEl);
    tooltip.style.setProperty("--tooltip-cor", dados.cor);
    const larguraTooltip = tooltip.offsetWidth;
    const esquerda = wrapper.clientWidth <= larguraTooltip + 16
      ? wrapper.clientWidth / 2
      : limitar(ponto[0], larguraTooltip / 2 + 8, wrapper.clientWidth - larguraTooltip / 2 - 8);
    tooltip.style.left = esquerda + "px";
    tooltip.style.top = ponto[1] + "px";
    tooltip.style.transform = ponto[1] > 72
      ? "translate(-50%, calc(-100% - 12px))"
      : "translate(-50%, 12px)";
  }

  const resumo = $("historico-selecao");
  if (resumo) {
    const metrica = METRICAS_GRAFICOS[metricaPrincipal];
    resumo.dataset.fixado = String(visaoHistorico.fixado);
    resumo.textContent = leitura
      ? `${visaoHistorico.fixado ? "Leitura fixada" : "Leitura"} em ${leitura.hora.toLocaleString("pt-BR")} · ` +
        `${metrica.titulo}: ${leitura[metricaPrincipal].toFixed(metrica.casas)} ${metrica.unidade}`
      : "Nenhuma leitura selecionada.";
  }
}

function configurarTooltipGrafico(canvasId, tooltipId) {
  const canvas = $(canvasId);
  if (!canvas || !$(tooltipId)) return;
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-describedby", "graficos-ajuda historico-selecao");
  canvas.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight Home End Enter Space Escape");
  for (const classe of ["grafico-cursor", "grafico-marcador"]) {
    const elemento = document.createElement("span");
    elemento.className = classe;
    elemento.hidden = true;
    elemento.setAttribute("aria-hidden", "true");
    canvas.parentElement.appendChild(elemento);
  }

  const indiceDoPonteiro = (evento) => {
    const dados = geometriaGraficos.get(canvas);
    if (!dados || !historicoExibido.length) return -1;
    const x = evento.clientX - canvas.getBoundingClientRect().left;
    const indiceLocal = Math.round(limitar((x - dados.margem.esquerda) / dados.areaLargura, 0, 1) * (dados.horarios.length - 1));
    return historicoExibido.findIndex((leitura) => Number(leitura.hora) === Number(dados.horarios[indiceLocal]));
  };
  const alternarFixacao = (evento) => {
    const indice = indiceDoPonteiro(evento);
    const leitura = historicoExibido[indice];
    if (!leitura) return;
    const jaFixada = visaoHistorico.fixado && Number(leitura.hora) === visaoHistorico.selecionado;
    if (jaFixada) limparSelecaoGraficos();
    else destacarLeitura(indice, true);
  };
  // A seleção permanece ao sair para permitir ler os detalhes abaixo do principal.
  const explorarPrincipal = (evento) => {
    if (canvasId === `grafico-${metricaPrincipal}` && !visaoHistorico.fixado && evento.pointerType !== "touch") destacarLeitura(indiceDoPonteiro(evento));
  };
  canvas.addEventListener("pointerenter", explorarPrincipal);
  canvas.addEventListener("pointermove", explorarPrincipal);

  // Um toque seleciona; rolagem e gestos cancelados continuam livres no celular.
  let toque = null;
  let ignorarCliqueAte = 0;
  canvas.addEventListener("pointerdown", (evento) => {
    if (evento.pointerType === "touch") toque = { x: evento.clientX, y: evento.clientY, id: evento.pointerId };
  });
  canvas.addEventListener("pointerup", (evento) => {
    if (!toque || evento.pointerId !== toque.id) return;
    const curto = Math.hypot(evento.clientX - toque.x, evento.clientY - toque.y) < 12;
    toque = null;
    ignorarCliqueAte = Date.now() + 700;
    if (curto) alternarFixacao(evento);
  });
  canvas.addEventListener("pointercancel", () => { toque = null; });
  canvas.addEventListener("click", (evento) => {
    if (Date.now() >= ignorarCliqueAte) alternarFixacao(evento);
  });
  canvas.addEventListener("keydown", (evento) => {
    const teclas = ["ArrowLeft", "ArrowRight", "Home", "End", "Escape", "Enter", " "];
    if (!teclas.includes(evento.key)) return;
    evento.preventDefault();
    if (evento.key === "Escape") { limparSelecaoGraficos(); return; }
    if (!historicoExibido.length) return;
    let indice = historicoExibido.findIndex((leitura) => Number(leitura.hora) === visaoHistorico.selecionado);
    if (evento.key === "Enter" || evento.key === " ") {
      if (visaoHistorico.fixado) limparSelecaoGraficos();
      else destacarLeitura(indice < 0 ? historicoExibido.length - 1 : indice, true);
      return;
    }
    if (evento.key === "Home") indice = 0;
    else if (evento.key === "End") indice = historicoExibido.length - 1;
    else if (indice < 0) indice = evento.key === "ArrowLeft" ? historicoExibido.length - 1 : 0;
    else indice += evento.key === "ArrowLeft" ? -1 : 1;
    destacarLeitura(limitar(indice, 0, historicoExibido.length - 1), true);
  });
}

function agendarRedesenhoGraficos() {
  if (redesenhoGraficosPendente !== null) {
    cancelAnimationFrame(redesenhoGraficosPendente);
  }

  redesenhoGraficosPendente = requestAnimationFrame(() => {
    redesenhoGraficosPendente = null;
    desenharGraficos();
  });
}

function configurarGraficos() {
  document.addEventListener("dashboard:select-metric", (evento) => {
    selecionarMetricaPrincipal(evento.detail?.chave);
  });
  document.addEventListener("dashboard:request-state", emitirEstadoDashboard);
  document.addEventListener("dashboard:open", (evento) => abrirDashboard(evento.detail?.chave));
  document.addEventListener("dashboard:close", voltarParaRoleta);
  $("btn-voltar-roleta")?.addEventListener("click", voltarParaRoleta);
  $("carousel-fallback")?.addEventListener("click", (evento) => {
    const botao = evento.target.closest("[data-dashboard-metric]");
    if (botao) abrirDashboard(botao.dataset.dashboardMetric);
  });
  for (const chave of Object.keys(METRICAS_GRAFICOS)) {
    configurarTooltipGrafico(`grafico-${chave}`, `grafico-${chave}-tooltip`);
  }

  $("btn-ocultar-detalhes").addEventListener("click", () => {
    limparSelecaoGraficos();
    $(`grafico-${metricaPrincipal}`).focus({ preventScroll: true });
  });

  if ("ResizeObserver" in window) {
    const observador = new ResizeObserver(agendarRedesenhoGraficos);
    document.querySelectorAll(".grafico-canvas-wrapper").forEach(
      (wrapper) => observador.observe(wrapper)
    );
  }
}

// ==========================================
// ATUALIZAÇÃO VISUAL
// ==========================================

function mostrarDelta(id, valor, texto, inverso = false) {
  const elemento = $(id);
  if (!elemento) return;

  if (valor === null) {
    elemento.textContent = "";
    elemento.className = "delta";
    return;
  }

  const bom = inverso ? valor < 0 : valor > 0;

  elemento.textContent =
    `${valor > 0 ? "▲" : valor < 0 ? "▼" : "•"} ${texto}`;

  elemento.className = valor === 0
    ? "delta neutro"
    : `delta ${bom ? "bom" : "ruim"}`;
}

function mostrarPill(id, ligado, textoLigado, textoDesligado) {
  const elemento = $(id);
  if (!elemento) return;

  elemento.className = `pill ${ligado ? "on" : "off"}`;
  elemento.textContent = ligado ? textoLigado : textoDesligado;
}

function desenhar() {
  const s = estado.sensores;
  const hist = estado.historico;

  if (!s || hist.length === 0) {
    agendarRedesenhoGraficos();
    return;
  }

  const alertas = calcularAlertas(s);

  $("m-temp").textContent = `${s.temperatura.toFixed(1)} °C`;
  $("m-umid").textContent = `${s.umidade} %`;
  $("m-lux").textContent = `${s.luminosidade} %`;

  const presenca = $("m-presenca");
  presenca.textContent = s.pessoas > 0 ? "Ocupada" : "Vazia";
  presenca.dataset.ocupada = String(s.pessoas > 0);
  $("m-pessoas").nextElementSibling.textContent = s.pessoas === 1 ? "pessoa" : "pessoas";

  const anterior = hist.length > 1
    ? hist[hist.length - 2]
    : null;

  const difTemp = anterior
    ? arredondar(s.temperatura - anterior.temperatura)
    : null;

  mostrarDelta(
    "m-temp-delta",
    difTemp,
    difTemp === null ? "" : `${difTemp.toFixed(1)} °C`,
    true
  );

  $("m-pessoas").textContent = s.pessoas;

  const difPessoas = anterior
    ? s.pessoas - anterior.pessoas
    : null;

  mostrarDelta(
    "m-pessoas-delta",
    difPessoas,
    difPessoas === null ? "" : `${Math.abs(difPessoas)} pessoa${Math.abs(difPessoas) === 1 ? "" : "s"}`
  );

  // Alertas.
  const caixa = $("alertas");

  if (caixa) {
    caixa.replaceChildren();
    caixa.hidden = alertas.length === 0;

    alertas.forEach((texto) => {
      const div = document.createElement("div");
      div.className = "alerta aviso";
      div.textContent = texto;
      caixa.appendChild(div);
    });
  }

  // Controles.
  const modoAuto = $("modo-auto");
  if (modoAuto) modoAuto.checked = estado.modoAuto;

  const autoRefresh = $("auto-refresh");
  if (autoRefresh) autoRefresh.checked = estado.autoRefresh;

  const intervalo = $("intervalo");
  if (intervalo) intervalo.disabled = !estado.autoRefresh;

  mostrarPill(
    "pill-ventilador",
    estado.ventiladorLigado,
    "LIGADO",
    "DESLIGADO"
  );

  mostrarPill(
    "pill-leds",
    estado.ledsLigados,
    "LIGADA",
    "DESLIGADA"
  );

  mostrarPill("pill-servo", estado.servoAberto, "ABERTO", "FECHADO");

  const btnVentilador = $("btn-ventilador");
  const btnLeds = $("btn-leds");

  if (btnVentilador) btnVentilador.disabled = estado.modoAuto;
  if (btnLeds) btnLeds.disabled = estado.modoAuto;

  // Registro de eventos.
  const lista = $("lista-eventos");

  if (lista) {
    lista.replaceChildren();

    if (estado.eventos.length === 0) {
      const p = document.createElement("p");
      p.className = "vazio";
      p.textContent = "Nenhum evento ainda.";
      lista.appendChild(p);
    } else {
      estado.eventos.forEach((evento) => {
        const div = document.createElement("div");
        div.className = "evento";

        const b = document.createElement("b");
        b.textContent = evento.hora;

        div.appendChild(b);
        div.appendChild(
          document.createTextNode(` ${evento.texto}`)
        );

        lista.appendChild(div);
      });
    }
  }

  agendarRedesenhoGraficos();
  emitirEstadoDashboard();
}

function mostrarAba(nome) {
  document.body.dataset.abaAtiva = nome;
  atualizarTitulosPagina();
  if (nome === "conta" && controleVoz && (controleVoz.ativo || controleVoz.iniciando)) controleVoz.parar();
  document.querySelectorAll(".aba-btn").forEach((botao) => {
    const selecionada = botao.dataset.aba === nome;
    botao.classList.toggle("ativa", selecionada);
    botao.setAttribute("aria-selected", String(selecionada));
    botao.tabIndex = selecionada || botao.id === "aba-btn-conta" ? 0 : -1;
  });

  document.querySelectorAll(".aba").forEach((secao) => {
    const selecionada = secao.id === `aba-${nome}`;
    secao.classList.toggle("ativa", selecionada);
    secao.hidden = !selecionada;
  });

  agendarRedesenhoGraficos();
}

// ==========================================
// RECONHECIMENTO DE VOZ
// ==========================================

class VozController {
  /**
   * Verifica se o navegador suporta a Web Speech API
   */
  static suportado() {
    return Boolean(
      window.SpeechRecognition ||
      window.webkitSpeechRecognition
    );
  }

  /**
   * @param {Object} callbacks
   * @param {Function} callbacks.onStatus - Mensagens de status (ex: "Ouvindo...", "Erro...")
   * @param {Function} callbacks.onTranscript - Transcrição em tempo real do que está sendo falado
   * @param {Function} callbacks.onSpeech - Dispara true/false se está captando voz
   * @param {Function} callbacks.onCommand - Dispara a chave do comando reconhecido
   */
  constructor({ onStatus, onTranscript, onSpeech, onCommand } = {}) {
    const Recognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!Recognition) {
      throw new Error("Reconhecimento de voz não suportado neste navegador.");
    }

    this.reconhecimento = new Recognition();
    this.reconhecimento.lang = "pt-BR";
    this.reconhecimento.continuous = false;
    this.reconhecimento.interimResults = true;

    this.ativo = false;
    this.iniciando = false;
    this.preservarStatusNoFim = false;
    this.onStatus = onStatus || (() => {});
    this.onTranscript = onTranscript || (() => {});
    this.onSpeech = onSpeech || (() => {});
    this.onCommand = onCommand || (() => {});

    // Eventos do Reconhecimento
    this.reconhecimento.onstart = () => {
      this.iniciando = false;
      this.ativo = true;
      this.onStatus("Ouvindo...");
      this.onSpeech(true);
    };

    this.reconhecimento.onend = () => {
      this.iniciando = false;
      this.ativo = false;
      this.onSpeech(false);
      if (!this.preservarStatusNoFim) {
        this.onStatus("Pronto para ouvir");
      } else {
        this.onStatus(null);
      }
    };

    this.reconhecimento.onerror = (evento) => {
      this.iniciando = false;
      this.ativo = false;
      this.preservarStatusNoFim = true;
      this.onSpeech(false);
      this.onStatus(`Erro no microfone: ${evento.error}`);
    };

    this.reconhecimento.onresult = (evento) => {
      const resultados = Array.from(evento.results);

      // Texto captado em tempo real
      const texto = resultados
        .map((resultado) => resultado[0].transcript)
        .join(" ");

      this.onTranscript(texto);

      // Só avalia comandos quando a fala for finalizada
      const inicio = Number.isInteger(evento.resultIndex)
        ? evento.resultIndex
        : 0;
      const finais = resultados
        .slice(inicio)
        .filter((resultado) => resultado.isFinal);
      if (!finais.length) return;

      const falaFinal = finais
        .map((resultado) => resultado[0].transcript)
        .join(" ");

      const comando = VozController.identificarComando(falaFinal);
      this.preservarStatusNoFim = true;

      if (comando) {
        this.onCommand(comando);
        this.onStatus(`Comando recebido: ${falaFinal.trim()}`);
      } else {
        this.onStatus("Comando não reconhecido");
      }
    };
  }

  /**
   * Normaliza o texto e mapeia para identificadores de ação
   */
  static identificarComando(texto) {
    const frase = texto
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Remove acentos
      .replace(/[^a-z0-9\s]/g, " ")     // Remove pontuações
      .replace(/\s+/g, " ")
      .trim();

    // Compara palavras ou frases completas, evitando falsos positivos por substring.
    const fraseDelimitada = ` ${frase} `;
    const tem = (...termos) => termos.some(
      (termo) => fraseDelimitada.includes(` ${termo} `)
    );

    const desligar = tem(
      "desligar", "desliga", "desligue", "desative", "desativar",
      "apagar", "apaga", "apague", "parar", "pare", "desabilitar", "corta", "cortar"
    );
    const ligar = tem(
      "ligar", "liga", "ligue", "ative", "ativar", "acender",
      "acenda", "acende", "habilitar", "iniciar"
    );
    const fechar = tem("fechar", "fecha", "feche");
    const historico = tem("historico", "historia", "csv", "registros");
    const atualizacao = tem("atualizacao", "atualizacoes", "atualizar automaticamente", "atualizacao automatica");
    const modoAutomatico = tem("automatico", "automatica", "automacao") || (tem("modo") && tem("auto"));

    // Uma frase negada não deve acionar equipamentos por engano.
    if (tem("nao", "nunca") && (ligar || desligar)) return null;

    // Comandos de histórico
    if (historico && tem("baixar", "baixa", "exportar", "exporte", "download")) {
      return "baixar_historico";
    }

    if (historico && tem("limpar", "limpa", "apagar", "apague", "excluir", "remover")) {
      return "limpar_historico";
    }

    // Comandos de atualização
    if (atualizacao && desligar) return "desligar_atualizacao";
    if (atualizacao && ligar) return "ligar_atualizacao";

    // Modo automático
    if (modoAutomatico && desligar) return "desligar_modo_auto";
    if (modoAutomatico && ligar) return "ligar_modo_auto";

    if (desligar && tem("tudo", "todos", "equipamentos")) {
      return "desligar_tudo";
    }

    // Dispositivos (inclui variações fonéticas comuns como liz/lis/luiz/lâmpada)
    const ar = tem("ar", "ventilador", "ventilacao", "motor", "cooler");
    const luz = tem("luz", "luzes", "iluminacao", "liz", "lis", "luiz", "lus", "lampada", "lampadas", "led", "leds");
    const servo = tem("servo", "sg90", "porta");

    if (desligar && ar) return "desligar_ventilador";
    if (desligar && luz) return "desligar_leds";
    if ((desligar || fechar) && servo) return "fechar_servo";
    if (ligar && ar) return "ligar_ventilador";
    if (ligar && luz) return "ligar_leds";
    if ((ligar || tem("abrir", "abra")) && servo) return "abrir_servo";

    // Simulação manual
    if (tem("simular", "simule", "simulacao", "nova deteccao")) {
      return "simular";
    }

    return null;
  }

  iniciar() {
    if (this.ativo || this.iniciando) return;
    this.iniciando = true;
    this.preservarStatusNoFim = false;
    try {
      this.onStatus("Solicitando microfone...");
      this.reconhecimento.start();
    } catch (erro) {
      this.iniciando = false;
      this.preservarStatusNoFim = true;
      this.onStatus(`Não foi possível iniciar: ${erro.message}`);
    }
  }

  parar() {
    if (!this.ativo && !this.iniciando) return;
    try {
      this.reconhecimento.stop();
    } catch (erro) {
      this.onStatus(`Não foi possível parar: ${erro.message}`);
    }
  }
}

// ==========================================
// INTEGRAÇÃO DA VOZ COM O DASHBOARD
// ==========================================

function configurarVoz() {
  const widget = $("voz-widget");
  const botaoToggle = $("btn-toggle-voz");
  const botao = $("btn-voz");
  const status = $("voz-status");
  const transcricao = $("voz-texto");
  const botaoTexto = $("btn-voz-texto");
  const icoEstado = $("ico-voz-estado");
  const statusDot = $("voz-status-dot");

  if (!widget || !botaoToggle || !botao || !status || !transcricao) return;

  const alternarPainelVoz = (aberto) => {
    widget.hidden = !aberto;
    botaoToggle.setAttribute("aria-expanded", String(aberto));
    botaoToggle.setAttribute(
      "aria-label",
      aberto ? "Ocultar assistente de voz" : "Abrir assistente de voz"
    );
    botaoToggle.title = aberto ? "Ocultar assistente de voz" : "Assistente de voz";

    // O painel nunca fica oculto enquanto o microfone continua ativo.
    if (!aberto && controleVoz) controleVoz.parar();
  };

  botaoToggle.addEventListener("click", () => {
    alternarPainelVoz(widget.hidden);
  });

  if (!VozController.suportado()) {
    botao.disabled = true;
    status.textContent = "Voz não suportada neste navegador";
    return;
  }

  controleVoz = new VozController({
    onStatus(mensagem) {
      if (mensagem) status.textContent = mensagem;

      const iniciando = controleVoz.iniciando;
      const ativo = controleVoz.ativo;

      botao.disabled = iniciando;

      // Atualiza texto do botão (sem emojis)
      if (botaoTexto) {
        botaoTexto.textContent = iniciando
          ? "Solicitando..."
          : ativo
            ? "Ouvindo... (clique para parar)"
            : "Iniciar comando de voz";
      }

      // Troca ícone: microfone → stop
      if (icoEstado) {
        icoEstado.querySelector("use").setAttribute(
          "href",
          ativo ? "#i-stop" : "#i-mic"
        );
      }

      // Ponto de status
      if (statusDot) {
        statusDot.className = "voz-status-dot " + (ativo ? "ativo" : "");
      }

      botao.classList.toggle("ativo", ativo);
      botao.setAttribute("aria-pressed", String(ativo));
    },

    onTranscript(texto) {
      transcricao.textContent = texto;
    },

    onSpeech(falando) {
      if (widget) {
        widget.classList.toggle("falando", falando);
      }
    },

    onCommand(comando) {
      const comandosManuais = [
        "ligar_ventilador",
        "desligar_ventilador",
        "ligar_leds",
        "desligar_leds",
        "abrir_servo",
        "fechar_servo"
      ];

      // Um comando manual interrompe o modo automático.
      if (
        comandosManuais.includes(comando) &&
        estado.modoAuto
      ) {
        mudarModoAuto(false, "comando de voz");
      }

      switch (comando) {
        case "ligar_ventilador":
          definir("ventiladorLigado", true, "comando de voz");
          desenhar();
          break;

        case "desligar_ventilador":
          definir("ventiladorLigado", false, "comando de voz");
          desenhar();
          break;

        case "ligar_leds":
          definir("ledsLigados", true, "comando de voz");
          desenhar();
          break;

        case "desligar_leds":
          definir("ledsLigados", false, "comando de voz");
          desenhar();
          break;

        case "abrir_servo":
          definir("servoAberto", true, "comando de voz");
          desenhar();
          break;

        case "fechar_servo":
          definir("servoAberto", false, "comando de voz");
          desenhar();
          break;

        case "ligar_modo_auto":
          mudarModoAuto(true, "comando de voz");
          break;

        case "desligar_modo_auto":
          mudarModoAuto(false, "comando de voz");
          break;

        case "ligar_atualizacao":
          mudarAtualizacaoAutomatica(true, "comando de voz");
          break;

        case "desligar_atualizacao":
          mudarAtualizacaoAutomatica(false, "comando de voz");
          break;

        case "desligar_tudo":
          desligarTudo();
          break;

        case "baixar_historico":
          baixarHistoricoPdf();
          break;

        case "limpar_historico":
          limparHistorico();
          break;

        case "simular":
          atualizarAgora();
          break;
      }
    }
  });

  botao.addEventListener("click", () => {
    if (controleVoz.ativo) {
      controleVoz.parar();
    } else {
      controleVoz.iniciar();
    }
  });

}

function configurarTema() {
  const botao = $("btn-tema");
  const texto = $("tema-texto");

  if (!botao || !texto) return;

  const aplicarRotulo = () => {
    const temaAtual = document.documentElement.dataset.tema;
    const proximoTema = temaAtual === "claro" ? "escuro" : "claro";
    texto.textContent = proximoTema === "claro" ? "Modo claro" : "Modo escuro";
    botao.setAttribute("aria-label", `Ativar ${texto.textContent.toLowerCase()}`);
  };

  const temaInicial = document.documentElement.dataset.tema === "claro"
    ? "claro"
    : "escuro";
  document.documentElement.dataset.tema = temaInicial;
  aplicarRotulo();

  botao.addEventListener("click", () => {
    const novoTema = document.documentElement.dataset.tema === "claro"
      ? "escuro"
      : "claro";

    document.documentElement.dataset.tema = novoTema;
    try {
      localStorage.setItem("tema", novoTema);
    } catch (erro) {
      console.warn("Não foi possível salvar o tema.", erro);
    }

    aplicarRotulo();
    requestAnimationFrame(desenharGraficos);
  });
}

// ==========================================
// INICIALIZAÇÃO
// ==========================================

function iniciar() {
  $("temp-alta").addEventListener("input", (evento) => {
    estado.tempAlta = Number(evento.target.value);
    $("temp-alta-valor").textContent = estado.tempAlta;
    if (estado.modoAuto && estado.sensores) {
      aplicarAutomacao(estado.sensores);
    }
    desenhar();
  });

  $("lux-baixa").addEventListener("input", (evento) => {
    estado.luxBaixa = Number(evento.target.value);
    $("lux-baixa-valor").textContent = estado.luxBaixa;
    if (estado.modoAuto && estado.sensores) {
      aplicarAutomacao(estado.sensores);
    }
    desenhar();
  });

  $("auto-refresh").addEventListener("change", (evento) => {
    mudarAtualizacaoAutomatica(evento.target.checked);
  });

  $("intervalo").addEventListener("input", (evento) => {
    estado.intervalo = Number(evento.target.value);
    $("intervalo-valor").textContent = estado.intervalo;
    configurarTemporizador();
    desenhar();
  });

  $("btn-atualizar").addEventListener(
    "click",
    atualizarAgora
  );

  configurarDownloadHistorico();

  $("btn-limpar").addEventListener(
    "click",
    limparHistorico
  );

  $("btn-desligar-tudo").addEventListener(
    "click",
    desligarTudo
  );

  $("btn-ventilador").addEventListener("click", () => {
    alternar("ventiladorLigado");
  });

  $("btn-leds").addEventListener("click", () => {
    alternar("ledsLigados");
  });

  $("btn-servo").addEventListener("click", () => {
    alternar("servoAberto");
  });

  $("modo-auto").addEventListener("change", (evento) => {
    mudarModoAuto(evento.target.checked);
  });

  const botoesAba = Array.from(document.querySelectorAll(".aba-btn"));

  botoesAba.forEach((botao, indice) => {
    botao.addEventListener("click", () => {
      mostrarAba(botao.dataset.aba);
    });

    botao.addEventListener("keydown", (evento) => {
      const teclas = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"];
      if (!teclas.includes(evento.key)) return;

      evento.preventDefault();
      let proximoIndice = indice;
      if (evento.key === "Home") proximoIndice = 0;
      else if (evento.key === "End") proximoIndice = botoesAba.length - 1;
      else if (["ArrowDown", "ArrowRight"].includes(evento.key)) {
        proximoIndice = (indice + 1) % botoesAba.length;
      } else {
        proximoIndice = (indice - 1 + botoesAba.length) % botoesAba.length;
      }

      const proximaAba = botoesAba[proximoIndice];
      proximaAba.focus();
      mostrarAba(proximaAba.dataset.aba);
    });
  });

  window.addEventListener("resize", agendarRedesenhoGraficos);

  inicializarHistorico();
  configurarTema();
  configurarGraficos();
  desenhar();
  mostrarAba("sensores");
  configurarVoz();
  if (typeof aprimorarWidgetVoz === "function") aprimorarWidgetVoz();
  if (typeof aprimorarVozConversa === "function") aprimorarVozConversa();
}

document.addEventListener("DOMContentLoaded", () => {
  if (window.senaiAuth && typeof window.senaiAuth.start === "function") {
    window.senaiAuth.start(iniciar, estado, desenhar);
  } else {
    iniciar();
  }
});
// ==========================================
// AJUSTES DO ASSISTENTE DE VOZ (ADICIONAL)
// Bloco independente: não altera nenhuma função acima.
// Adiciona o visual do widget (CSS), o indicador animado e os
// estados: ativo, detectando-voz e falando-resposta.
// ==========================================

const VOZ_WIDGET_CSS = `
/* Componente independente do assistente de voz. */
.voz-widget {
    position: fixed;
    right: max(1rem, env(safe-area-inset-right));
    bottom: max(1rem, env(safe-area-inset-bottom));
    z-index: 1000;
    box-sizing: border-box;
    width: min(24rem, calc(100vw - 2rem));
    padding: .85rem;
    display: flex;
    flex-direction: column;
    gap: .65rem;
    color: var(--texto, #e8f1ff);
    background: color-mix(in srgb, var(--superficie-elevada, #101d2e) 94%, transparent);
    border: 1px solid var(--borda-forte, #34455d);
    border-radius: var(--raio-md, .9rem);
    box-shadow: var(--sombra-elevada, 0 16px 45px rgba(0, 0, 0, .35));
    backdrop-filter: blur(16px);
    font-family: inherit;
    transition: border-color .2s ease, box-shadow .2s ease;
}

/* Mantém o funcionamento do atributo hidden usado por alternarPainelVoz(). */
.voz-widget[hidden] { display: none; }

.voz-widget.ativo { border-color: rgba(50, 140, 255, .55); }
.voz-widget.detectando-voz { border-color: rgba(61, 220, 151, .7); box-shadow: 0 0 30px rgba(61, 220, 151, .22); }
.voz-widget.falando-resposta { border-color: rgba(246, 185, 78, .7); box-shadow: 0 0 28px rgba(246, 185, 78, .2); }
.voz-cabecalho { display: flex; min-width: 0; align-items: center; gap: .75rem; }
.voz-identidade { display: grid; min-width: 0; flex: 1; }
.voz-identidade strong { font-size: .74rem; }
#voz-status { overflow: hidden; color: var(--texto-suave, #9aabc0); font-size: .65rem; text-overflow: ellipsis; white-space: nowrap; }

.voz-indicador-container {
    position: relative;
    width: 2.8rem;
    height: 2.8rem;
    flex: 0 0 2.8rem;
    display: flex;
    align-items: center;
    justify-content: center;
    perspective: 120px;
    transform-style: preserve-3d;
}
.voz-indicador-onda { position: absolute; inset: 0; border-radius: 50%; opacity: 0; pointer-events: none; }
.voz-indicador-onda-interna { inset: .35rem; animation-delay: -.55s !important; }
.voz-indicador {
    position: relative;
    z-index: 2;
    width: 1.2rem;
    height: 1.2rem;
    color: var(--texto-suave, #8fa1b8);
    background: radial-gradient(circle at 32% 26%, #fff 0 5%, transparent 19%),
        radial-gradient(circle at 38% 32%, color-mix(in srgb, currentColor 35%, white), currentColor 68%, #07172b 125%);
    border-radius: 50%;
    box-shadow: inset -.18rem -.2rem .35rem rgba(0, 5, 20, .5), inset .15rem .15rem .3rem rgba(255,255,255,.48), 0 0 0 3px rgba(120,140,170,.2), 0 .35rem .7rem rgba(0,7,22,.5);
    transform: translateZ(14px);
}
.voz-widget.ativo .voz-indicador { color: var(--marca-brilho, #69d5ff); }
.voz-widget.detectando-voz .voz-indicador { color: var(--sucesso, #3ddc97); animation: voz-nucleo .72s ease-in-out infinite; }
.voz-widget.falando-resposta .voz-indicador { color: var(--aviso, #f6b94e); animation: voz-nucleo .82s ease-in-out infinite; }
.voz-widget.detectando-voz .voz-indicador-onda { opacity: 1; background: radial-gradient(circle, rgba(61,220,151,.48), transparent 70%); animation: voz-onda 1.05s ease-out infinite; }
.voz-widget.falando-resposta .voz-indicador-onda { opacity: 1; background: radial-gradient(circle, rgba(246,185,78,.4), transparent 70%); animation: voz-onda 1.15s ease-out infinite; }
.voz-equalizador { position: absolute; z-index: 4; display: flex; align-items: center; gap: 2px; height: 1.35rem; opacity: 0; transform: translateZ(24px); }
.voz-equalizador i { width: 2px; height: 70%; border-radius: 1rem; background: #efffff; }
.detectando-voz .voz-equalizador, .falando-resposta .voz-equalizador { opacity: 1; }
.detectando-voz .voz-equalizador i, .falando-resposta .voz-equalizador i { animation: voz-barra .58s ease-in-out infinite alternate; }
.voz-equalizador i:nth-child(2) { animation-delay: -.31s !important; }
.voz-equalizador i:nth-child(3) { animation-delay: -.48s !important; }
.voz-equalizador i:nth-child(4) { animation-delay: -.17s !important; }
.voz-equalizador i:nth-child(5) { animation-delay: -.39s !important; }

#btn-voz {
    min-height: 2.4rem;
    padding: .5rem .85rem;
    color: #ffffff;
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: .65rem;
    font: inherit;
    font-size: .78rem;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: .5rem;
    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
    transition: all .2s ease;
}
#btn-voz:hover:not(:disabled) {
    background: linear-gradient(135deg, #1d4ed8, #1e40af);
    transform: translateY(-1px);
    box-shadow: 0 6px 16px rgba(37, 99, 235, 0.45);
}
#btn-voz.ativo,
#btn-voz[aria-pressed="true"] {
    background: linear-gradient(135deg, #ef4444, #dc2626) !important;
    color: #ffffff !important;
    border-color: rgba(254, 202, 202, 0.45) !important;
    box-shadow: 0 0 16px rgba(239, 68, 68, 0.55), inset 0 1px 2px rgba(255, 255, 255, 0.2) !important;
    animation: pulsoBtnGravando 1.6s ease-in-out infinite alternate !important;
}
@keyframes pulsoBtnGravando {
    0% { box-shadow: 0 0 10px rgba(239, 68, 68, 0.4); }
    100% { box-shadow: 0 0 20px rgba(239, 68, 68, 0.75); }
}
#btn-voz:disabled { cursor: not-allowed; opacity: .5; }
.voz-modo-continuo { display: flex; align-items: center; gap: .5rem; padding: .4rem .6rem; color: var(--texto-secundario, #bac7d8); background: var(--superficie-input, rgba(0,0,0,.12)); border-radius: .55rem; font-size: .68rem; }
.voz-transcricao, .voz-transcricao-bloco { display: flex; flex-direction: column; gap: .4rem; padding: .6rem .8rem; color: var(--texto-suave, #9aabc0); background: rgba(8, 15, 30, 0.7); border: 1px solid var(--borda, #2b3a4e); border-radius: .65rem; font-size: .72rem; width: 100%; box-sizing: border-box; min-width: 0; }
#voz-texto, .voz-transcricao-saida { display: block; width: 100%; box-sizing: border-box; overflow-y: auto; max-height: 100px; color: var(--texto-secundario, #bac7d8); white-space: normal !important; word-break: break-word !important; overflow-wrap: anywhere !important; line-height: 1.45; font-size: .8rem; }

@keyframes voz-nucleo { 0%,100% { transform: translateZ(14px) scale(.92); } 50% { transform: translateZ(23px) scale(1.2); } }
@keyframes voz-onda { 0% { transform: rotateX(64deg) scale(.62); opacity: .95; } 70% { transform: rotateX(64deg) scale(1.65); opacity: .15; } 100% { transform: rotateX(64deg) scale(2.15); opacity: 0; } }
@keyframes voz-barra { 0% { transform: scaleY(.35); } 45% { transform: scaleY(1.15); } 100% { transform: scaleY(.62); } }

@media (max-width: 440px) { .voz-widget { right: .65rem; bottom: .65rem; width: calc(100vw - 1.3rem); } .voz-identidade strong { display: none; } }
@media (prefers-reduced-motion: reduce) { .voz-widget *, .voz-widget *::before, .voz-widget *::after { animation: none !important; transition: none !important; } .voz-equalizador { display: none; } }
`;

const vozWidgetEstados = {
  widget: null,
  botao: null,
  temporizadorSilencio: null,
  falandoResposta: false
};

function injetarEstilosVozWidget() {
  if (document.getElementById("voz-widget-estilos")) return;

  const estilo = document.createElement("style");
  estilo.id = "voz-widget-estilos";
  estilo.textContent = VOZ_WIDGET_CSS;
  document.head.appendChild(estilo);
}

function garantirIndicadorVozWidget(widget) {
  if (widget.querySelector(".voz-indicador-container")) return;

  const container = document.createElement("div");
  container.className = "voz-indicador-container";
  container.setAttribute("aria-hidden", "true");
  container.innerHTML =
    '<span class="voz-indicador-onda"></span>' +
    '<span class="voz-indicador-onda voz-indicador-onda-interna"></span>' +
    '<span class="voz-indicador"></span>' +
    '<span class="voz-equalizador"><i></i><i></i><i></i><i></i><i></i></span>';

  const cabecalho = widget.querySelector(".voz-cabecalho") || widget;
  cabecalho.insertBefore(container, cabecalho.firstChild);
}

function atualizarEstadoVozWidget() {
  const { widget, botao } = vozWidgetEstados;
  if (!widget) return;

  const ativo = Boolean(
    controleVoz && (controleVoz.ativo || controleVoz.iniciando)
  );

  widget.classList.toggle("ativo", ativo);
  if (botao) botao.classList.toggle("ativo", Boolean(controleVoz && controleVoz.ativo));

  // Ao encerrar o microfone, a detecção de voz também termina.
  if (!ativo) widget.classList.remove("detectando-voz");

  widget.classList.toggle("falando-resposta", vozWidgetEstados.falandoResposta);
}

function marcarVozDetectada() {
  const { widget } = vozWidgetEstados;
  if (!widget || !controleVoz || !controleVoz.ativo) return;

  widget.classList.add("detectando-voz");
  clearTimeout(vozWidgetEstados.temporizadorSilencio);
  vozWidgetEstados.temporizadorSilencio = setTimeout(() => {
    widget.classList.remove("detectando-voz");
  }, 900);
}

function definirFalandoRespostaVoz(falando) {
  vozWidgetEstados.falandoResposta = falando;
  atualizarEstadoVozWidget();
}

function observarRespostaFalada() {
  if (!("speechSynthesis" in window)) return;
  if (window.speechSynthesis.__vozWidgetObservado) return;

  try {
    const falarOriginal = window.speechSynthesis.speak.bind(window.speechSynthesis);

    window.speechSynthesis.speak = (fala) => {
      fala.addEventListener("start", () => definirFalandoRespostaVoz(true));
      fala.addEventListener("end", () => definirFalandoRespostaVoz(false));
      fala.addEventListener("error", () => definirFalandoRespostaVoz(false));
      return falarOriginal(fala);
    };

    window.speechSynthesis.__vozWidgetObservado = true;
  } catch (erro) {
    console.warn("Não foi possível observar a resposta falada.", erro);
  }
}

function aprimorarWidgetVoz() {
  const widget = $("voz-widget");
  if (!widget) return;

  injetarEstilosVozWidget();
  garantirIndicadorVozWidget(widget);

  vozWidgetEstados.widget = widget;
  vozWidgetEstados.botao = $("btn-voz");

  const observador = new MutationObserver(atualizarEstadoVozWidget);

  // O status e o aria-pressed do botão são atualizados a cada mudança do microfone.
  const status = $("voz-status");
  if (status) {
    observador.observe(status, { childList: true, characterData: true, subtree: true });
  }
  if (vozWidgetEstados.botao) {
    observador.observe(vozWidgetEstados.botao, {
      attributes: true,
      attributeFilter: ["aria-pressed", "disabled"]
    });
  }

  // A transcrição em tempo real indica que há voz sendo captada.
  const transcricao = $("voz-texto");
  if (transcricao) {
    new MutationObserver(marcarVozDetectada).observe(transcricao, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  observarRespostaFalada();
  atualizarEstadoVozWidget();
}

// Registrado depois do listener de iniciar(), então roda após configurarVoz().
document.addEventListener("DOMContentLoaded", aprimorarWidgetVoz);

// ==========================================
// VOZ FALADA, CONVERSA CONTÍNUA E BOTÃO FECHAR (ADICIONAL)
// Bloco independente: não altera o código-fonte das funções acima.
// Usa apenas a instância controleVoz já criada por configurarVoz().
// ==========================================

const VOZ_CONVERSA_CSS = `
.voz-fechar { flex: 0 0 auto; width: 1.9rem; height: 1.9rem; display: inline-flex; align-items: center; justify-content: center; padding: 0; color: var(--texto-suave, #9aabc0); background: transparent; border: 1px solid var(--borda, #2b3a4e); border-radius: .55rem; font: inherit; font-size: 1.05rem; line-height: 1; cursor: pointer; }
.voz-fechar:hover, .voz-fechar:focus-visible { color: var(--perigo, #ff6b76); border-color: currentColor; }
.voz-fechar-solto { position: absolute; top: .5rem; right: .5rem; }
.voz-modo-continuo { justify-content: space-between; cursor: pointer; }
.voz-alavanca { appearance: none; -webkit-appearance: none; position: relative; flex: 0 0 auto; width: 2.3rem; height: 1.25rem; margin: 0; border: 0; border-radius: 999px; background: rgba(120, 140, 170, .4); cursor: pointer; transition: background .2s ease; }
.voz-alavanca::after { content: ""; position: absolute; top: .15rem; left: .15rem; width: .95rem; height: .95rem; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, .4); transition: transform .2s ease; }
.voz-alavanca:checked { background: var(--sucesso, #3ddc97); }
.voz-alavanca:checked::after { transform: translateX(1.05rem); }
.voz-alavanca:focus-visible { outline: 2px solid var(--marca-brilho, #69d5ff); outline-offset: 2px; }
`;

const VOZ_PERGUNTA_FINAL = " Mais alguma coisa?";

const VOZ_RESPOSTAS = {
  ligar_ventilador: "O ventilador está ligado.",
  desligar_ventilador: "O ventilador está desligado.",
  ligar_leds: "A luz está ligada.",
  desligar_leds: "A luz está desligada.",
  abrir_servo: "A porta está aberta.",
  fechar_servo: "A porta está fechada.",
  ligar_modo_auto: "O modo automático está ativado.",
  desligar_modo_auto: "O modo automático está desativado.",
  ligar_atualizacao: "A atualização automática está ativada.",
  desligar_atualizacao: "A atualização automática está desativada.",
  desligar_tudo: "Todos os equipamentos foram desligados.",
  baixar_historico: "O histórico está sendo baixado.",
  limpar_historico: "O histórico foi limpo.",
  simular: "Fiz uma nova leitura dos sensores."
};

const VOZ_FRASES_FIM = /^(nao|nada|nada mais|nao obrigad[oa]|obrigad[oa]|so isso|e so isso|isso e tudo|tchau|ate logo|encerrar|encerrar conversa|pode encerrar|nao quero mais nada)$/;
const VOZ_FRASES_CONTINUAR = /^(sim|tenho|quero|pode ser)$/;

const vozConversa = {
  ligada: false,
  falando: false,
  idFala: 0,
  pararPedido: false,
  silencios: 0,
  ultimoErro: null,
  respondeuFinal: false,
  silencioAte: 0,
  ecoAte: 0,
  palavrasFala: new Set(),
  alavanca: null,
  chaveSalva: "vozConversaContinua"
};

function normalizarFalaVoz(texto) {
  return String(texto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Prefere a Francisca (voz Microsoft pt-BR do Edge/Windows) e,
// se ela não existir no navegador, usa a voz do Google pt-BR.
function escolherVozAssistente() {
  if (!("speechSynthesis" in window)) return null;

  const vozes = window.speechSynthesis.getVoices();

  return (
    vozes.find((v) => /francisca/i.test(v.name)) ||
    vozes.find((v) => /google/i.test(v.name) && /^pt[-_]BR$/i.test(v.lang)) ||
    vozes.find((v) => /^pt[-_]BR$/i.test(v.lang)) ||
    vozes.find((v) => /^pt/i.test(v.lang)) ||
    null
  );
}

function cancelarFalaVoz() {
  vozConversa.idFala += 1;
  vozConversa.falando = false;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

function reiniciarEscutaVoz() {
  const widget = $("voz-widget");

  if (!vozConversa.ligada || vozConversa.pararPedido || vozConversa.falando) return;
  if (!widget || widget.hidden || !controleVoz) return;
  if (!controleVoz.ativo && !controleVoz.iniciando) controleVoz.iniciar();
}

// Ignora tudo que o microfone captar enquanto o assistente fala, logo depois
// que ele termina (reverberação) e frases formadas só por palavras que o
// próprio assistente acabou de dizer (eco do alto-falante).
function resultadoEhEcoVoz(evento) {
  if (vozConversa.falando) return true;

  const agora = Date.now();
  if (agora < vozConversa.silencioAte) return true;

  if (agora < vozConversa.ecoAte) {
    const texto = Array.from(evento.results)
      .map((resultado) => resultado[0].transcript)
      .join(" ");
    const palavras = normalizarFalaVoz(texto).split(" ").filter(Boolean);

    if (palavras.length && palavras.every((p) => vozConversa.palavrasFala.has(p))) {
      return true;
    }
  }

  return false;
}

function falarVoz(texto) {
  if (!texto) return;
  const id = ++vozConversa.idFala;

  // Marca como "falando" desde já, para o microfone não aproveitar a própria resposta.
  vozConversa.falando = true;
  vozConversa.palavrasFala = new Set(normalizarFalaVoz(texto).split(" "));

  // Atualiza também o feedback visual da transcrição com a fala da IA (sem emojis)
  const transcricao = $("voz-texto");
  if (transcricao) {
    transcricao.textContent = texto;
  }

  if (!("speechSynthesis" in window)) {
    vozConversa.falando = false;
    setTimeout(reiniciarEscutaVoz, 250);
    return;
  }

  const falar = () => {
    if (id !== vozConversa.idFala) return; // substituída por uma fala mais nova

    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      window.speechSynthesis.cancel();
    } catch (e) {
      console.warn("SpeechSynthesis cancel:", e);
    }

    setTimeout(() => {
      if (id !== vozConversa.idFala) return;

      const fala = new SpeechSynthesisUtterance(texto);
      window.__falaAtual = fala; // Previne coleta prematura pelo Garbage Collector do Chrome

      const voz = escolherVozAssistente();
      fala.lang = "pt-BR";
      if (voz) fala.voice = voz;
      fala.rate = 1.05;
      fala.pitch = 1.0;

      let tentativas = 0;
      const terminou = () => {
        window.__falaAtual = null;
        if (id !== vozConversa.idFala) return;

        if (window.speechSynthesis.speaking && tentativas < 30) {
          tentativas += 1;
          setTimeout(terminou, 150);
          return;
        }

        vozConversa.falando = false;
        const agora = Date.now();
        vozConversa.silencioAte = agora + 500;
        vozConversa.ecoAte = agora + 3500;

        // Conversa contínua: volta a ouvir só depois de a voz sumir da sala.
        setTimeout(reiniciarEscutaVoz, 600);
      };

      fala.onend = terminou;
      fala.onerror = (err) => {
        console.warn("Erro no sintetizador de voz:", err);
        terminou();
      };

      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        window.speechSynthesis.speak(fala);
      } catch (err) {
        console.warn("Falha ao invocar speak:", err);
        terminou();
      }
    }, 40);
  };

  // O microfone precisa estar desligado antes de o assistente começar a falar.
  if (controleVoz && (controleVoz.ativo || controleVoz.iniciando)) {
    let jaFalou = false;
    const falarUmaVez = () => {
      if (jaFalou) return;
      jaFalou = true;
      falar();
    };

    controleVoz.reconhecimento.addEventListener("end", falarUmaVez, { once: true });
    setTimeout(falarUmaVez, 350); // garantia rápida se o evento "end" demorar

    try {
      controleVoz.reconhecimento.stop();
    } catch (erro) {
      falarUmaVez();
    }
  } else {
    falar();
  }
}

function definirConversaVoz(ligada) {
  vozConversa.ligada = ligada;
  vozConversa.silencios = 0;
  if (vozConversa.alavanca) vozConversa.alavanca.checked = ligada;

  try {
    localStorage.setItem(vozConversa.chaveSalva, ligada ? "1" : "0");
  } catch (erro) {
    console.warn("Não foi possível salvar a conversa contínua.", erro);
  }
}

function fecharPainelVoz() {
  const widget = $("voz-widget");
  const botaoToggle = $("btn-toggle-voz");
  if (!widget || widget.hidden) return;

  if (botaoToggle) {
    botaoToggle.click(); // usa o mesmo caminho do botão de abrir/fechar
  } else {
    widget.hidden = true;
    if (controleVoz) controleVoz.parar();
  }

  cancelarFalaVoz();
}

function garantirBotaoFecharVoz(widget) {
  if (widget.querySelector(".voz-fechar")) return;

  const botao = document.createElement("button");
  botao.type = "button";
  botao.className = "voz-fechar";
  botao.title = "Fechar";
  botao.setAttribute("aria-label", "Fechar assistente de voz");
  botao.textContent = "\u00d7";
  botao.addEventListener("click", fecharPainelVoz);

  const cabecalho = widget.querySelector(".voz-cabecalho");
  if (cabecalho) {
    cabecalho.appendChild(botao);
  } else {
    botao.classList.add("voz-fechar-solto");
    widget.appendChild(botao);
  }
}

function garantirAlavancaConversaVoz(widget) {
  let alavanca = widget.querySelector(".voz-modo-continuo input[type='checkbox']");

  if (!alavanca) {
    const rotulo = document.createElement("label");
    rotulo.className = "voz-modo-continuo";

    const texto = document.createElement("span");
    texto.textContent = "Conversa contínua";

    alavanca = document.createElement("input");
    alavanca.type = "checkbox";
    alavanca.id = "voz-conversa-continua";
    alavanca.setAttribute("role", "switch");

    rotulo.htmlFor = alavanca.id;
    rotulo.append(texto, alavanca);

    const referencia = widget.querySelector(".voz-transcricao");
    if (referencia && referencia.parentNode) {
      referencia.parentNode.insertBefore(rotulo, referencia);
    } else {
      widget.appendChild(rotulo);
    }
  }

  alavanca.classList.add("voz-alavanca");
  return alavanca;
}

function instalarComandosDeEncerramentoVoz() {
  if (VozController.__conversaInstalada) return;

  const identificarOriginal = VozController.identificarComando;

  VozController.identificarComando = function (texto) {
    const frase = normalizarFalaVoz(texto);
    if (VOZ_FRASES_FIM.test(frase)) return "encerrar_conversa";
    if (VOZ_FRASES_CONTINUAR.test(frase)) return "continuar_conversa";
    return identificarOriginal.call(VozController, texto);
  };

  VozController.__conversaInstalada = true;
}

function aoFimReconhecimentoVoz() {
  if (!vozConversa.ligada || vozConversa.pararPedido || vozConversa.falando) return;

  // Houve fala final: a resposta falada é quem reinicia o ciclo.
  if (vozConversa.respondeuFinal && "speechSynthesis" in window) return;

  const erro = vozConversa.ultimoErro;
  if (erro && erro !== "no-speech") {
    definirConversaVoz(false);
    return;
  }

  vozConversa.silencios += 1;
  if (vozConversa.silencios > 2) {
    definirConversaVoz(false);
    falarVoz("Não ouvi nada, vou encerrar a conversa contínua.");
    return;
  }

  setTimeout(reiniciarEscutaVoz, 350);
}

function aprimorarVozConversa() {
  const widget = $("voz-widget");
  if (!widget) return;

  if (!document.getElementById("voz-conversa-estilos")) {
    const estilo = document.createElement("style");
    estilo.id = "voz-conversa-estilos";
    estilo.textContent = VOZ_CONVERSA_CSS;
    document.head.appendChild(estilo);
  }

  // 1. Botão para fechar o painel (também fecha com a tecla Esc).
  garantirBotaoFecharVoz(widget);

  if (!aprimorarVozConversa.__teclaEscInstalada) {
    document.addEventListener("keydown", (evento) => {
      if (evento.key === "Escape" && !widget.hidden) fecharPainelVoz();
    });
    aprimorarVozConversa.__teclaEscInstalada = true;
  }

  const botaoToggle = $("btn-toggle-voz");
  if (botaoToggle && !botaoToggle.__vozCancelInstalado) {
    botaoToggle.addEventListener("click", () => {
      if (widget.hidden) cancelarFalaVoz();
      if ("speechSynthesis" in window && window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    });
    botaoToggle.__vozCancelInstalado = true;
  }

  const botaoVoz = $("btn-voz");
  if (botaoVoz && !botaoVoz.__vozResumeInstalado) {
    botaoVoz.addEventListener("click", () => {
      if ("speechSynthesis" in window && window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    });
    botaoVoz.__vozResumeInstalado = true;
  }

  if (!controleVoz || aprimorarVozConversa.__instaladoNoControle) return;
  aprimorarVozConversa.__instaladoNoControle = true;

  // 3. Alavanca de conversa contínua.
  vozConversa.alavanca = garantirAlavancaConversaVoz(widget);
  try {
    vozConversa.ligada = localStorage.getItem(vozConversa.chaveSalva) === "1";
  } catch (erro) {
    vozConversa.ligada = false;
  }
  if (vozConversa.alavanca) {
    vozConversa.alavanca.checked = vozConversa.ligada;

    vozConversa.alavanca.addEventListener("change", () => {
      const ligada = vozConversa.alavanca.checked;
      definirConversaVoz(ligada);

      if (ligada) {
        vozConversa.pararPedido = false;
        falarVoz("Conversa contínua ativada. Pode falar.");
      } else {
        falarVoz("Conversa contínua desativada.");
      }
    });
  }

  // Distingue parada manual (botão, fechar painel) de fim natural da escuta.
  const iniciarOriginal = controleVoz.iniciar.bind(controleVoz);
  controleVoz.iniciar = () => {
    vozConversa.pararPedido = false;
    if ("speechSynthesis" in window && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    iniciarOriginal();
  };

  const pararOriginal = controleVoz.parar.bind(controleVoz);
  controleVoz.parar = () => {
    vozConversa.pararPedido = true;
    pararOriginal();
  };

  // 2. Respostas faladas para cada comando.
  instalarComandosDeEncerramentoVoz();

  const comandoOriginal = controleVoz.onCommand;
  controleVoz.onCommand = (comando) => {
    vozConversa.silencios = 0;

    if (comando === "encerrar_conversa") {
      definirConversaVoz(false);
      falarVoz("Tudo bem! Até logo.");
      return;
    }

    if (comando === "continuar_conversa") {
      falarVoz("Pode falar.");
      return;
    }

    // Modo automático ligado: ventilador e LEDs não podem ser desligados individualmente.
    const bloqueio = VOZ_BLOQUEIOS_AUTO[comando];
    if (bloqueio && estado.modoAuto) {
      registrarEvento(`${bloqueio.nome} não pode ser ${bloqueio.desligado} no modo automático`);
      desenhar();
      falarVoz(
        `O modo automático está ligado, então ${bloqueio.artigo} ${bloqueio.nome.toLowerCase()} ` +
        `não pode ser ${bloqueio.desligado}. Diga desligar tudo para desligar o modo automático ` +
        `e os equipamentos.` + (vozConversa.ligada ? VOZ_PERGUNTA_FINAL : "")
      );
      return;
    }

    comandoOriginal.call(controleVoz, comando);
    sincronizarModoAutoVoz();

    const resposta = VOZ_RESPOSTAS[comando];
    if (resposta) {
      const textoFinal = vozConversa.ligada ? (resposta + VOZ_PERGUNTA_FINAL) : resposta;
      falarVoz(textoFinal);
    }
  };

  const statusOriginal = controleVoz.onStatus;
  controleVoz.onStatus = (mensagem) => {
    statusOriginal.call(controleVoz, mensagem);

    if (mensagem === "Comando não reconhecido") {
      falarVoz("Não entendi o comando. Pode repetir?");
    }
  };

  const reconhecimento = controleVoz.reconhecimento;
  reconhecimento.addEventListener("start", () => {
    vozConversa.ultimoErro = null;
    vozConversa.respondeuFinal = false;
  });
  reconhecimento.addEventListener("error", (evento) => {
    vozConversa.ultimoErro = evento.error;
  });

  // Descarta resultados que sejam a própria voz do assistente.
  const resultadoOriginal = reconhecimento.onresult;
  reconhecimento.onresult = (evento) => {
    if (resultadoEhEcoVoz(evento)) return;
    resultadoOriginal.call(reconhecimento, evento);
  };

  reconhecimento.addEventListener("result", (evento) => {
    if (resultadoEhEcoVoz(evento)) return;
    for (let i = evento.resultIndex || 0; i < evento.results.length; i += 1) {
      if (evento.results[i].isFinal) vozConversa.respondeuFinal = true;
    }
  });
  reconhecimento.addEventListener("end", aoFimReconhecimentoVoz);

  // Carrega a lista de vozes do navegador (é preenchida de forma assíncrona).
  if ("speechSynthesis" in window) {
    window.speechSynthesis.getVoices();
    if (typeof window.speechSynthesis.onvoiceschanged !== "undefined") {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
      };
    }
  }
}

document.addEventListener("DOMContentLoaded", aprimorarVozConversa);

// ==========================================
// ANIMAÇÃO AO ABRIR E FECHAR O PAINEL DE VOZ (ADICIONAL)
// Bloco independente: não altera nenhuma função acima.
// ==========================================

const VOZ_ANIMACAO_CSS = `
@keyframes voz-painel-entrar {
    0% { opacity: 0; transform: scale(.82); }
    60% { opacity: 1; transform: scale(1.05); }
    100% { opacity: 1; transform: scale(1); }
}
@keyframes voz-painel-sair {
    0% { opacity: 1; transform: scale(1); }
    30% { opacity: 1; transform: scale(1.04); }
    100% { opacity: 0; transform: scale(.8); }
}
@keyframes voz-botao-pop {
    0%, 100% { transform: scale(1); }
    40% { transform: scale(1.14); }
    70% { transform: scale(.94); }
}
.voz-widget.voz-entrando { transform-origin: bottom right; animation: voz-painel-entrar .28s cubic-bezier(.2, .9, .3, 1.2) both; }
.voz-widget.voz-saindo { transform-origin: bottom right; animation: voz-painel-sair .22s ease-in both; pointer-events: none; }
.voz-botao-pop { animation: voz-botao-pop .3s ease; }
@media (prefers-reduced-motion: reduce) {
    .voz-widget.voz-entrando, .voz-widget.voz-saindo, .voz-botao-pop { animation: none; }
}
`;

const vozAnimacao = { clone: null };

function reduzirMovimentoVoz() {
  return Boolean(
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function reiniciarClasseAnimacaoVoz(elemento, classe) {
  elemento.classList.remove(classe);
  void elemento.offsetWidth; // força o navegador a reiniciar a animação
  elemento.classList.add(classe);
}

function removerCloneSaidaVoz() {
  if (vozAnimacao.clone) {
    vozAnimacao.clone.remove();
    vozAnimacao.clone = null;
  }
}

function aprimorarAnimacaoPainelVoz() {
  const widget = $("voz-widget");
  const botaoToggle = $("btn-toggle-voz");
  if (!widget || !botaoToggle) return;

  const estilo = document.createElement("style");
  estilo.id = "voz-animacao-estilos";
  estilo.textContent = VOZ_ANIMACAO_CSS;
  document.head.appendChild(estilo);

  // Roda depois do clique original, quando o painel já abriu ou fechou.
  botaoToggle.addEventListener("click", () => {
    if (reduzirMovimentoVoz()) return;

    reiniciarClasseAnimacaoVoz(botaoToggle, "voz-botao-pop");
    setTimeout(() => botaoToggle.classList.remove("voz-botao-pop"), 350);

    removerCloneSaidaVoz();

    // Abrindo: o painel cresce com um pequeno "pop".
    if (!widget.hidden) {
      reiniciarClasseAnimacaoVoz(widget, "voz-entrando");
      setTimeout(() => widget.classList.remove("voz-entrando"), 320);
      return;
    }

    // Fechando: o painel original já está oculto, então uma cópia visual
    // (sem interação) faz a animação de saída e some em seguida.
    const copia = widget.cloneNode(true);
    copia.hidden = false;
    copia.setAttribute("aria-hidden", "true");
    copia.setAttribute("inert", "");
    copia.classList.remove("voz-entrando");
    copia.classList.add("voz-saindo");
    document.body.appendChild(copia);
    vozAnimacao.clone = copia;

    setTimeout(() => {
      if (vozAnimacao.clone === copia) removerCloneSaidaVoz();
    }, 240);
  });
}

document.addEventListener("DOMContentLoaded", aprimorarAnimacaoPainelVoz);

// ==========================================
// PAINEL DE VOZ COMPACTO E MINIMALISTA (ADICIONAL)
// Bloco independente: só reduz o tamanho visual do widget.
// ==========================================

const VOZ_COMPACTO_CSS = `
.voz-widget {
    width: min(340px, calc(100vw - 2rem));
    padding: .85rem 1rem;
    gap: .65rem;
    border-radius: var(--raio-md, .9rem);
    box-shadow: var(--sombra-elevada, 0 16px 45px rgba(0, 0, 0, .45));
    box-sizing: border-box;
    overflow: hidden;
}
.voz-cabecalho { gap: .6rem; }
.voz-identidade strong { font-size: .76rem; }
#voz-status { font-size: .68rem; }

.voz-indicador-container { width: 2.4rem; height: 2.4rem; flex: 0 0 2.4rem; }
.voz-indicador { width: 1.05rem; height: 1.05rem; }
.voz-equalizador { height: 1rem; }

#btn-voz {
    width: 100%;
    min-height: 2.5rem;
    padding: .55rem 1rem;
    border-radius: .65rem;
    font-size: .82rem;
    font-weight: 600;
    box-sizing: border-box;
}

.voz-fechar { width: 1.7rem; height: 1.7rem; border-radius: .5rem; font-size: .95rem; }
.voz-modo-continuo { gap: .4rem; padding: .35rem .6rem; border-radius: .5rem; font-size: .68rem; }
.voz-alavanca { width: 2rem; height: 1.1rem; }

.voz-transcricao, .voz-transcricao-bloco {
    width: 100% !important;
    box-sizing: border-box !important;
    min-width: 0 !important;
    overflow: hidden !important;
    gap: .35rem !important;
    padding: .6rem .85rem !important;
}

#voz-texto, .voz-transcricao-saida {
    display: block !important;
    width: 100% !important;
    max-width: 100% !important;
    box-sizing: border-box !important;
    white-space: normal !important;
    word-break: break-word !important;
    overflow-wrap: anywhere !important;
    max-height: 100px !important;
    overflow-y: auto !important;
    line-height: 1.45 !important;
    font-size: .82rem !important;
}

@media (max-width: 440px) {
    .voz-widget { width: min(340px, calc(100vw - 1.2rem)); }
}
`;

function aplicarPainelVozCompacto() {
  if (!$("voz-widget")) return;
  if (document.getElementById("voz-compacto-estilos")) return;

  const estilo = document.createElement("style");
  estilo.id = "voz-compacto-estilos";
  estilo.textContent = VOZ_COMPACTO_CSS;
  document.head.appendChild(estilo); // por último, para prevalecer sobre os estilos anteriores
}

document.addEventListener("DOMContentLoaded", aplicarPainelVozCompacto);

// ==========================================
// CORREÇÃO DA ALAVANCA DE CONVERSA CONTÍNUA (ADICIONAL)
// Evita a "bolinha dupla": o checkbox recebia a bolinha do estilo
// geral de switches da página + a bolinha criada pelo bloco de voz.
// Agora a alavanca é autossuficiente e desenha uma única bolinha
// com background (sem ::before/::after).
// ==========================================

const VOZ_ALAVANCA_CSS = `
.voz-widget input.voz-alavanca[type="checkbox"] {
    all: unset !important;
    display: inline-block !important;
    box-sizing: border-box !important;
    position: relative !important;
    flex: 0 0 auto !important;
    width: 1.9rem !important;
    height: 1.05rem !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 999px !important;
    cursor: pointer !important;
    -webkit-appearance: none !important;
    appearance: none !important;
    background-color: rgba(120, 140, 170, .4) !important;
    background-image: radial-gradient(circle, #fff 0, #fff 49%, transparent 52%) !important;
    background-repeat: no-repeat !important;
    background-size: .8rem .8rem !important;
    background-position: .125rem center !important;
    transition: background-color .2s ease, background-position .2s ease !important;
}
.voz-widget input.voz-alavanca[type="checkbox"]:checked {
    background-color: var(--sucesso, #3ddc97) !important;
    background-position: calc(100% - .125rem) center !important;
}
.voz-widget input.voz-alavanca[type="checkbox"]:focus-visible {
    outline: 2px solid var(--marca-brilho, #69d5ff) !important;
    outline-offset: 2px !important;
}
.voz-widget input.voz-alavanca[type="checkbox"]::before,
.voz-widget input.voz-alavanca[type="checkbox"]::after {
    content: none !important;
    display: none !important;
}
@media (prefers-reduced-motion: reduce) {
    .voz-widget input.voz-alavanca[type="checkbox"] { transition: none !important; }
}
`;

function corrigirAlavancaConversaVoz() {
  if (!$("voz-widget")) return;
  if (document.getElementById("voz-alavanca-estilos")) return;

  const estilo = document.createElement("style");
  estilo.id = "voz-alavanca-estilos";
  estilo.textContent = VOZ_ALAVANCA_CSS;
  document.head.appendChild(estilo); // por último, para prevalecer
}

document.addEventListener("DOMContentLoaded", corrigirAlavancaConversaVoz);

// ==========================================
// MODO AUTOMÁTICO: VENTILADOR E LEDS NÃO DESLIGAM SOZINHOS (ADICIONAL)
// Com o modo automático ligado, ventilador e LEDs não podem ser desligados
// pelos botões nem por voz.
// O caminho para desligar é "Desligar tudo", que também desliga o
// modo automático. A própria automação continua gerenciando os dois.
// ==========================================

const VOZ_BLOQUEIOS_AUTO = {
  desligar_ventilador: { nome: "Ventilador", artigo: "o", desligado: "desligado" },
  desligar_leds: { nome: "Luz", artigo: "a", desligado: "desligada" }
};

const BLOQUEIO_AUTO_TITULO = "Bloqueado no modo automático. Use “Desligar tudo”.";

const VOZ_AUTO_CSS = `
.bloqueado-auto { opacity: .6; cursor: not-allowed; }
.voz-dica-auto { display: flex; align-items: center; justify-content: space-between; gap: .5rem; padding: .3rem .5rem; color: var(--aviso, #f6b94e); background: rgba(246, 185, 78, .1); border-radius: .5rem; font-size: .6rem; line-height: 1.3; }
.voz-dica-auto[hidden] { display: none; }
`;

function sincronizarModoAutoVoz() {
  const dica = $("voz-dica-auto");
  if (dica && dica.hidden === estado.modoAuto) dica.hidden = !estado.modoAuto;

  [["btn-ventilador", "ventiladorLigado"], ["btn-leds", "ledsLigados"]].forEach(([id, chave]) => {
    const botao = $(id);
    if (!botao) return;

    const bloqueado = estado.modoAuto && estado[chave];
    botao.classList.toggle("bloqueado-auto", bloqueado);

    if (bloqueado) {
      if (botao.getAttribute("aria-disabled") !== "true") botao.setAttribute("aria-disabled", "true");
      if (botao.title !== BLOQUEIO_AUTO_TITULO) botao.title = BLOQUEIO_AUTO_TITULO;
    } else {
      if (botao.hasAttribute("aria-disabled")) botao.removeAttribute("aria-disabled");
      if (botao.title === BLOQUEIO_AUTO_TITULO) botao.removeAttribute("title");
    }
  });
}

function garantirDicaModoAutoVoz(widget) {
  if ($("voz-dica-auto")) return;

  const dica = document.createElement("div");
  dica.id = "voz-dica-auto";
  dica.className = "voz-dica-auto";
  dica.hidden = true;

  const texto = document.createElement("span");
  texto.textContent = "Modo automático ligado: para desligar ventilador e luz, diga “desligar tudo”.";

  dica.appendChild(texto);

  const referencia = widget.querySelector(".voz-transcricao");
  if (referencia && referencia.parentNode) {
    referencia.parentNode.insertBefore(dica, referencia);
  } else {
    widget.appendChild(dica);
  }
}

// Com o modo automático ligado, nada desliga ventilador e LEDs (nem a própria automação:
// sala vazia, temperatura normal, luz suficiente). Só "desligar tudo" desliga,
// e ele antes desliga o modo automático. A função original não é editada:
// apenas é envolvida por uma verificação.
function instalarBloqueioAutomacao() {
  if (definir.__bloqueioAuto) return;

  const definirOriginal = definir;

  definir = function (chave, valor, motivo) {
    if (estado.modoAuto && valor === false && motivo !== "desligar tudo") return;
    return definirOriginal(chave, valor, motivo);
  };

  definir.__bloqueioAuto = true;
}

function aplicarBloqueioModoAuto() {
  instalarBloqueioAutomacao();

  const estilo = document.createElement("style");
  estilo.id = "voz-auto-estilos";
  estilo.textContent = VOZ_AUTO_CSS;
  document.head.appendChild(estilo);

  // Ventilador e LEDs: impede desligar enquanto o modo automático estiver ligado.
  [["btn-ventilador", "ventiladorLigado", "O ventilador", "desligado"],
   ["btn-leds", "ledsLigados", "A luz", "desligada"]].forEach(([id, chave, nome, desligado]) => {
    const botao = $(id);
    if (!botao) return;

    // Fase de captura: roda antes do clique original e o cancela.
    botao.addEventListener("click", (evento) => {
      if (!estado.modoAuto || !estado[chave]) return;

      evento.stopImmediatePropagation();
      evento.preventDefault();
      registrarEvento(`${nome} não pode ser ${desligado} no modo automático (use Desligar tudo)`);
      desenhar();
      sincronizarModoAutoVoz();
    }, true);
  });

  const widget = $("voz-widget");
  if (widget) garantirDicaModoAutoVoz(widget);

  const alternadorAuto = $("modo-auto");
  if (alternadorAuto) alternadorAuto.addEventListener("change", sincronizarModoAutoVoz);

  sincronizarModoAutoVoz();
  setInterval(sincronizarModoAutoVoz, 400); // cobre mudanças vindas de voz, automação e botões
}

document.addEventListener("DOMContentLoaded", aplicarBloqueioModoAuto);
