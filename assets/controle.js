"use strict";

// ==========================================================
// SENAI Smart Class - Controle da bancada pelo celular
// Página aberta pelo QR code do notebook da sala, sem login: o código da sala
// (no link) assina cada pedido, e o notebook executa com a conta dele.
// ==========================================================

(() => {
  // ===== FALA → COMANDO (mesmas palavras da assistente do painel) =====
  function interpretarFala(texto) {
    const frase = ` ${String(texto ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()} `;
    const tem = (...termos) => termos.some((termo) => frase.includes(` ${termo} `));

    const desligar = tem("desligar", "desliga", "desligue", "desative", "desativar", "apagar", "apaga", "apague", "parar", "pare", "corta", "cortar");
    const ligar = tem("ligar", "liga", "ligue", "ative", "ativar", "acender", "acenda", "acende", "iniciar");
    const fechar = tem("fechar", "fecha", "feche");
    const abrir = tem("abrir", "abre", "abra");
    // Uma frase negada não aciona nada por engano.
    if (tem("nao", "nunca") && (ligar || desligar || abrir || fechar)) return null;

    const automatico = tem("automatico", "automatica", "automacao") || (tem("modo") && tem("auto"));
    if (automatico && desligar) return { acao: "modo", valor: false, descricao: "desligar o modo automático" };
    if (automatico && ligar) return { acao: "modo", valor: true, descricao: "ligar o modo automático" };
    if (desligar && tem("tudo", "todos", "equipamentos")) return { acao: "desligar-tudo", valor: true, descricao: "desligar tudo" };

    const ar = tem("ar", "ventilador", "ventilacao", "motor", "cooler");
    const luz = tem("luz", "luzes", "iluminacao", "liz", "lis", "luiz", "lus", "lampada", "lampadas", "led", "leds");
    const porta = tem("porta", "servo");
    if (desligar && ar) return { acao: "ventilador", valor: false, descricao: "desligar o ventilador" };
    if (desligar && luz) return { acao: "luz", valor: false, descricao: "desligar a luz" };
    if ((desligar || fechar) && porta) return { acao: "porta", valor: false, descricao: "fechar a porta" };
    if (ligar && ar) return { acao: "ventilador", valor: true, descricao: "ligar o ventilador" };
    if (ligar && luz) return { acao: "luz", valor: true, descricao: "ligar a luz" };
    if ((ligar || abrir) && porta) return { acao: "porta", valor: true, descricao: "abrir a porta" };
    return null;
  }

  window.senaiControle = Object.freeze({ interpretarFala });
  if (typeof document === "undefined") return;

  // ===== PÁGINA =====
  const SEM_SINAL_MS = 12000;
  const $ = (id) => document.getElementById(id);
  const sala = {
    conexao: null,
    estado: "desligada",
    detalhe: "",
    ultimoSinal: 0,
    ultimoOla: 0,
    fonte: null,
    arduino: null,
    equipamentos: {},
    sensores: null,
    enviados: new Map()
  };

  const numero = (valor) => (typeof valor === "number" && Number.isFinite(valor) ? valor : null);
  const formatar = (valor, casas) => valor.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

  function avisar(texto, erro = false) {
    const retorno = $("retorno");
    retorno.textContent = texto;
    retorno.dataset.erro = String(erro);
  }

  function texto(id, valor) {
    const elemento = $(id);
    if (elemento && elemento.textContent !== valor) elemento.textContent = valor;
  }

  function situacao() {
    if (sala.estado === "erro") return ["alerta", sala.detalhe || "Não foi possível entrar na sala."];
    if (!sala.conexao) return ["aguardando", "Digite o código da sala"];
    if (sala.estado === "reconectando") return ["alerta", "Sem internet: tentando de novo…"];
    if (sala.estado !== "conectada") return ["aguardando", "Conectando à sala…"];
    if (!sala.ultimoSinal) return ["aguardando", "Aguardando o notebook da sala…"];
    if (Date.now() - sala.ultimoSinal > SEM_SINAL_MS) return ["alerta", "Sem sinal do notebook da sala"];
    if (sala.fonte === "arduino") {
      return sala.arduino?.estado === "conectado"
        ? ["ao-vivo", "Ao vivo · Arduino da bancada"]
        : ["alerta", "O Arduino está desconectado no notebook"];
    }
    return ["aguardando", "Sala em modo simulado (sem Arduino)"];
  }

  function pronto() {
    return sala.estado === "conectada" && sala.ultimoSinal && Date.now() - sala.ultimoSinal <= SEM_SINAL_MS;
  }

  function estadoBotao(botaoId, estadoId, valor, ligado, desligado) {
    const botao = $(botaoId);
    const conhecido = typeof valor === "boolean";
    botao.setAttribute("aria-pressed", String(conhecido && valor));
    texto(estadoId, conhecido ? (valor ? ligado : desligado) : "--");
  }

  function desenhar() {
    const [tipo, mensagem] = situacao();
    const selo = $("selo");
    if (selo.dataset.tipo !== tipo) selo.dataset.tipo = tipo;
    texto("selo-texto", mensagem);

    const s = sala.sensores || {};
    const digital = sala.fonte === "arduino";
    const temperatura = numero(s.temperatura);
    const umidade = numero(s.umidade);
    const pessoas = numero(s.pessoas);
    const luz = numero(s.luminosidade);
    texto("v-temp", temperatura === null ? "--" : `${formatar(temperatura, 1)} °C`);
    texto("v-umid", umidade === null ? "--" : `${formatar(umidade, 0)} %`);
    texto("v-pessoas", pessoas === null ? "--" : digital ? (pessoas > 0 ? "Ocupada" : "Vazia") : `${pessoas} pessoas`);
    texto("v-luz", luz === null ? "--" : digital ? (luz >= 50 ? "Claro" : "Escuro") : `${luz} %`);

    const eq = sala.equipamentos || {};
    estadoBotao("b-ventilador", "e-ventilador", eq.ventiladorLigado, "Ligado", "Desligado");
    estadoBotao("b-luz", "e-luz", eq.ledsLigados, "Ligada", "Desligada");
    estadoBotao("b-modo", "e-modo", eq.modoAuto, "Ligado", "Desligado");
    estadoBotao("b-porta", "e-porta", eq.servoAberto, "Aberta", "Fechada");
    // A porta só aparece quando existe: no simulado ou com o firmware v3.7 (servo).
    $("b-porta").hidden = digital && sala.arduino?.temPorta !== true;

    const liberado = Boolean(pronto());
    for (const id of ["b-ventilador", "b-luz", "b-modo", "b-porta", "b-desligar"]) {
      const botao = $(id);
      if (botao.disabled === liberado) botao.disabled = !liberado;
    }
  }

  function pedirEstado() {
    if (!sala.conexao || sala.estado !== "conectada") return;
    sala.ultimoOla = Date.now();
    sala.conexao.enviar("ola", { historico: false });
  }

  function receber(evento, corpo) {
    sala.ultimoSinal = Date.now();
    if (evento === "estado") {
      sala.fonte = corpo.fonte === "arduino" ? "arduino" : "simulado";
      sala.arduino = corpo.arduino && typeof corpo.arduino === "object" ? corpo.arduino : null;
      sala.equipamentos = corpo.equipamentos && typeof corpo.equipamentos === "object" ? corpo.equipamentos : {};
      sala.sensores = corpo.sensores && typeof corpo.sensores === "object" ? corpo.sensores : null;
    } else if (evento === "resposta" && sala.enviados.has(corpo.id)) {
      const descricao = sala.enviados.get(corpo.id);
      sala.enviados.delete(corpo.id);
      if (corpo.ok) avisar(`Feito: ${descricao}.`);
      else avisar(typeof corpo.mensagem === "string" ? corpo.mensagem.slice(0, 160) : "A sala recusou o pedido.", true);
    }
    desenhar();
  }

  function comandar(acao, valor, descricao) {
    if (!pronto()) {
      avisar("Sem conexão com a sala agora. Aguarde um instante.", true);
      return;
    }
    const id = Math.random().toString(36).slice(2, 12);
    sala.enviados.set(id, descricao);
    if (sala.enviados.size > 30) sala.enviados.delete(sala.enviados.keys().next().value);
    sala.conexao.enviar("comando", { id, acao, valor });
    avisar(`Enviando: ${descricao}…`);
  }

  async function entrar(codigo) {
    const anterior = sala.conexao;
    sala.conexao = null;
    await anterior?.encerrar();
    const conexao = window.senaiRemoto.criarSala({
      papel: "controle",
      codigo,
      criarCanal: (nome) => window.senaiAuth.realtimeChannel(nome),
      aoMensagem: receber,
      aoEstado: (novo, detalhe) => {
        if (sala.conexao !== conexao) return;
        sala.estado = novo;
        sala.detalhe = detalhe || "";
        if (novo === "conectada") pedirEstado();
        desenhar();
      }
    });
    Object.assign(sala, { conexao, estado: "conectando", detalhe: "", ultimoSinal: 0, fonte: null, arduino: null, equipamentos: {}, sensores: null });
    window.senaiRemoto.lembrarCodigo(codigo);
    $("form-codigo").hidden = true;
    desenhar();
    return conexao.iniciar();
  }

  function configurarBotoes() {
    const alternar = (acao, chave, ligar, desligar) => () => {
      const valor = sala.equipamentos?.[chave] !== true;
      comandar(acao, valor, valor ? ligar : desligar);
    };
    $("b-ventilador").addEventListener("click", alternar("ventilador", "ventiladorLigado", "ligar o ventilador", "desligar o ventilador"));
    $("b-luz").addEventListener("click", alternar("luz", "ledsLigados", "ligar a luz", "desligar a luz"));
    $("b-modo").addEventListener("click", alternar("modo", "modoAuto", "ligar o modo automático", "desligar o modo automático"));
    $("b-porta").addEventListener("click", alternar("porta", "servoAberto", "abrir a porta", "fechar a porta"));
    $("b-desligar").addEventListener("click", () => comandar("desligar-tudo", true, "desligar tudo"));
  }

  function configurarVoz() {
    const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;
    const botao = $("b-voz");
    if (!Reconhecimento) {
      botao.disabled = true;
      texto("voz-texto", "Este navegador não reconhece voz: use os botões. No Android, abra no Chrome; no iPhone, no Safari.");
      return;
    }
    let ouvindo = null;
    botao.addEventListener("click", () => {
      if (ouvindo) {
        ouvindo.stop();
        return;
      }
      const reconhecimento = new Reconhecimento();
      reconhecimento.lang = "pt-BR";
      reconhecimento.interimResults = true;
      reconhecimento.continuous = false;
      ouvindo = reconhecimento;
      botao.setAttribute("aria-pressed", "true");
      texto("b-voz-texto", "Ouvindo… toque para parar");
      texto("voz-texto", "Pode falar.");

      reconhecimento.onresult = (evento) => {
        const resultados = Array.from(evento.results);
        const falado = resultados.map((resultado) => resultado[0].transcript).join(" ").trim();
        texto("voz-texto", `"${falado}"`);
        const finais = resultados.slice(evento.resultIndex || 0).filter((resultado) => resultado.isFinal);
        if (!finais.length) return;
        const pedido = interpretarFala(finais.map((resultado) => resultado[0].transcript).join(" "));
        if (pedido) comandar(pedido.acao, pedido.valor, pedido.descricao);
        else avisar(`Não entendi "${falado}". Tente "ligar o ventilador".`, true);
      };
      reconhecimento.onerror = (evento) => {
        avisar(evento.error === "not-allowed"
          ? "Permita o uso do microfone para falar um comando."
          : "Não consegui ouvir. Toque e fale de novo.", true);
      };
      reconhecimento.onend = () => {
        ouvindo = null;
        botao.setAttribute("aria-pressed", "false");
        texto("b-voz-texto", "Falar um comando");
      };
      try {
        reconhecimento.start();
      } catch {
        reconhecimento.onend();
        avisar("Não consegui abrir o microfone.", true);
      }
    });
  }

  function configurarCodigo() {
    $("form-codigo").addEventListener("submit", (evento) => {
      evento.preventDefault();
      const codigo = window.senaiRemoto.formatarCodigo($("campo-codigo").value);
      if (!codigo) {
        texto("erro-codigo", "Confira o código: são 16 letras e números, como ABCD-EFGH-JKLM-NPQR.");
        return;
      }
      texto("erro-codigo", "");
      entrar(codigo);
    });
  }

  // O celular da demonstração fica nas mãos de quem apresenta: a tela não deve apagar no meio.
  let telaAcesa = null;
  async function manterTelaAcesa() {
    if (telaAcesa || document.hidden || !navigator.wakeLock?.request) return;
    try {
      telaAcesa = await navigator.wakeLock.request("screen");
      telaAcesa.addEventListener?.("release", () => { telaAcesa = null; });
    } catch {
      // Sem suporte ou negado: a tela segue a configuração do celular.
    }
  }

  function iniciar() {
    configurarBotoes();
    configurarVoz();
    configurarCodigo();
    setInterval(() => {
      if (sala.estado === "conectada" && Date.now() - sala.ultimoOla > 15000) pedirEstado();
      desenhar();
    }, 1000);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      pedirEstado();
      manterTelaAcesa();
    });
    document.addEventListener("click", manterTelaAcesa);
    manterTelaAcesa();

    const codigo = window.senaiRemoto?.lerCodigoDoLink();
    if (codigo) entrar(codigo);
    else $("form-codigo").hidden = false;
    desenhar();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar, { once: true });
  else iniciar();
})();
