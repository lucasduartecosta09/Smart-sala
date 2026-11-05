"use strict";

// ==========================================================
// SENAI Smart Class - Arduino na USB (Web Serial)
// Conversa com o firmware v3.6 do UNO R4 WiFi sem alterá-lo:
// lê as linhas que ele já imprime (115200 baud) e envia os
// comandos de texto que ele já entende (LUZ 1, VENTILADOR 0...).
// ==========================================================

(() => {
  const VELOCIDADE = 115200;
  const LIMITE_LINHA = 512;
  const CHAVE_PREFERENCIA = "smartclass:arduino";

  // ===== PROTOCOLO =====

  function numero(texto) {
    if (texto === null || texto === undefined) return null;
    const valor = Number(texto);
    return Number.isFinite(valor) ? valor : null;
  }

  // Ex.: [SENSORES] PIR=PRESENCA | LDR=1 | luz_relativa=100% | T=24.0C UR=55.0% |
  //      LUZ=OFF | FAN=OFF | SMART=OFF | LUMINARIA_PIR=ON | RETENCAO=0s | MODO=AUTO
  function interpretarSensores(linha) {
    const campo = (regex) => linha.match(regex)?.[1] ?? null;
    const pir = campo(/\bPIR=(PRESENCA|SEM_PRESENCA)\b/);
    const luz = numero(campo(/\bluz_relativa=(\d{1,3})%/));
    const lampada = campo(/\bLUZ=(ON|OFF)\b/);
    const ventilador = campo(/\bFAN=(ON|OFF)\b/);
    const modo = campo(/\bMODO=(AUTO|MANUAL)\b/);
    if (!pir || luz === null || !lampada || !ventilador || !modo) return null;

    // A partir do firmware v3.7 a linha também traz o servo da porta; no v3.6 vem nulo.
    const porta = campo(/\bPORTA=(ABERTA|FECHADA)\b/);
    const temperatura = numero(campo(/\bT=(-?\d+(?:\.\d+)?)C\b/));
    const umidade = numero(campo(/\bUR=(\d+(?:\.\d+)?)%/));
    // DHT=ERRO/AGUARDANDO ou valores impossíveis contam como leitura inválida do DHT11.
    const dhtValido = temperatura !== null && umidade !== null &&
      temperatura > -40 && temperatura < 85 && umidade >= 0 && umidade <= 100;

    return {
      presenca: pir === "PRESENCA",
      luminosidade: Math.min(100, Math.max(0, luz)),
      temperatura: dhtValido ? temperatura : null,
      umidade: dhtValido ? umidade : null,
      dhtValido,
      luz: lampada === "ON",
      ventilador: ventilador === "ON",
      luminaria: campo(/\bLUMINARIA_PIR=(ON|OFF)\b/) === "ON",
      retencao: numero(campo(/\bRETENCAO=(\d+)s\b/)) ?? 0,
      modo,
      porta: porta === null ? null : porta === "ABERTA"
    };
  }

  // Linhas do bloco STATUS que o firmware imprime depois de cada comando.
  const LINHAS_STATUS = [
    [/^Modo: (AUTO|MANUAL)$/, (m) => ({ modo: m[1] })],
    [/^Lampada Smart: (LIGADO|DESLIGADO)$/, (m) => ({ luz: m[1] === "LIGADO" })],
    [/^Ventilador: (LIGADO|DESLIGADO)$/, (m) => ({ ventilador: m[1] === "LIGADO" })],
    [/^Luminaria simples \(PIR\): (LIGADA|DESLIGADA)$/, (m) => ({ luminaria: m[1] === "LIGADA" })],
    [/^Porta \(servo\): (ABERTA|FECHADA)$/, (m) => ({ porta: m[1] === "ABERTA" })]
  ];

  function interpretarLinha(texto) {
    const linha = String(texto ?? "").trim();
    if (!linha) return null;

    if (linha.startsWith("[SENSORES]")) {
      const dados = interpretarSensores(linha);
      return dados ? { tipo: "sensores", dados } : null;
    }
    for (const [regex, montar] of LINHAS_STATUS) {
      const encontrado = linha.match(regex);
      if (encontrado) return { tipo: "status", dados: montar(encontrado) };
    }
    const firmware = linha.match(/^SENAI SMART CLASS\b.*\bFirmware v(\d+(?:\.\d+)*)/i);
    if (firmware) return { tipo: "firmware", versao: firmware[1] };
    const palmas = linha.match(/^\[SOM\] (\d+) palmas:/);
    if (palmas) return { tipo: "palmas", quantidade: Number(palmas[1]) };
    if (/^(Uso: |Comando nao reconhecido|Comando muito longo)/.test(linha)) {
      return { tipo: "recusado", texto: linha };
    }
    return null;
  }

  // Comandos aceitos pelo processSerial() do firmware v3.6 (PORTA só a partir do v3.7).
  function criarComando(acao, valor) {
    switch (acao) {
      case "luz":
        return `LUZ ${valor ? 1 : 0}`;
      case "ventilador":
        return `VENTILADOR ${valor ? 1 : 0}`;
      case "modo":
        return valor ? "AUTO" : "MANUAL";
      case "porta": // firmware v3.7 ou mais novo
        return `PORTA ${valor ? 1 : 0}`;
      case "limiar-temperatura": {
        const graus = Number(valor);
        return Number.isFinite(graus) && graus >= 15 && graus <= 45
          ? `LIMIAR_TEMP ${Math.round(graus * 10) / 10}`
          : null;
      }
      case "limiar-luz": {
        const porcentagem = Number(valor);
        return Number.isInteger(porcentagem) && porcentagem >= 0 && porcentagem <= 100
          ? `LIMIAR_LUZ ${porcentagem}`
          : null;
      }
      case "status":
        return "STATUS";
      default:
        return null;
    }
  }

  // A USB entrega pedaços soltos; as linhas só valem quando chegam inteiras.
  function criarSeparadorDeLinhas(aoLinha) {
    let resto = "";
    return {
      receber(texto) {
        resto += texto;
        const partes = resto.split(/\r\n|\r|\n/);
        resto = partes.pop();
        if (resto.length > LIMITE_LINHA) resto = "";
        for (const parte of partes) {
          const linha = parte.trim();
          if (linha) aoLinha(linha);
        }
      },
      limpar() {
        resto = "";
      }
    };
  }

  // ===== CONEXÃO WEB SERIAL =====

  function descreverErro(erro) {
    if (erro?.name === "NetworkError" || erro?.name === "InvalidStateError") {
      return "A porta do Arduino está em uso. Feche o Monitor Serial da IDE do Arduino (ou outra aba do painel) e tente de novo.";
    }
    if (erro?.name === "SecurityError") {
      return "O navegador bloqueou o acesso à USB nesta página.";
    }
    return "Não foi possível abrir a porta do Arduino. Confira o cabo USB e tente de novo.";
  }

  function criarConexao({
    serial = globalThis.navigator?.serial,
    velocidade = VELOCIDADE,
    aoLinha = () => {},
    aoEstado = () => {},
    armazenamento = (() => { try { return globalThis.localStorage; } catch { return null; } })()
  } = {}) {
    let porta = null;
    let leitor = null;
    let laco = null;
    let encerrando = false;
    let estado = serial ? "desconectado" : "sem-suporte";
    let fila = Promise.resolve(true);
    const codificador = new TextEncoder();

    function lerPreferencia() {
      try {
        return JSON.parse(armazenamento?.getItem(CHAVE_PREFERENCIA) || "null");
      } catch {
        return null;
      }
    }

    function gravarPreferencia(valor) {
      try {
        if (valor) armazenamento?.setItem(CHAVE_PREFERENCIA, JSON.stringify(valor));
        else armazenamento?.removeItem(CHAVE_PREFERENCIA);
      } catch {
        // Armazenamento bloqueado: só perde a reconexão automática.
      }
    }

    function mudar(novo, detalhe = null) {
      estado = novo;
      aoEstado(novo, detalhe);
    }

    function informacoes(alvo) {
      try {
        return alvo?.getInfo?.() || {};
      } catch {
        return {};
      }
    }

    function mesmaPlaca(candidata, preferencia) {
      if (!preferencia?.usbVendorId) return true;
      const info = informacoes(candidata);
      return info.usbVendorId === preferencia.usbVendorId && info.usbProductId === preferencia.usbProductId;
    }

    async function lerSempre(alvo) {
      const decodificador = new TextDecoder();
      const separador = criarSeparadorDeLinhas(aoLinha);
      let terminou = false;
      let falhasSeguidas = 0;
      // Erros não fatais (ex.: buffer cheio) trocam o "readable"; a perda do cabo o deixa nulo.
      while (alvo.readable && !encerrando && !terminou && falhasSeguidas < 20) {
        leitor = alvo.readable.getReader();
        try {
          while (true) {
            const { value, done } = await leitor.read();
            if (done) {
              terminou = true;
              break;
            }
            if (value) {
              falhasSeguidas = 0;
              separador.receber(decodificador.decode(value, { stream: true }));
            }
          }
        } catch {
          falhasSeguidas++;
          separador.limpar();
        } finally {
          try { leitor.releaseLock(); } catch { /* leitor já liberado */ }
          leitor = null;
        }
      }
      if (encerrando) return;
      // O cabo saiu, a placa reiniciou a USB ou a porta parou de responder.
      porta = null;
      try { await alvo.close(); } catch { /* a porta já fechou */ }
      mudar("perdido");
    }

    async function abrir(candidata) {
      if (porta || estado === "conectando" || !candidata) return estado === "conectado";
      mudar("conectando");
      try {
        await candidata.open({ baudRate: velocidade });
      } catch (erro) {
        mudar("erro", descreverErro(erro));
        return false;
      }
      porta = candidata;
      encerrando = false;
      gravarPreferencia({ automatico: true, ...informacoes(candidata) });
      mudar("conectado", informacoes(candidata));
      laco = lerSempre(candidata);
      return true;
    }

    // Abre a janela do navegador para escolher a porta: precisa vir de um clique.
    async function conectar() {
      if (!serial) {
        mudar("sem-suporte");
        return false;
      }
      if (porta) return true;
      let escolhida;
      try {
        escolhida = await serial.requestPort();
      } catch (erro) {
        // Fechar a janela sem escolher não muda nada.
        if (erro?.name !== "NotFoundError") mudar("erro", descreverErro(erro));
        return false;
      }
      return abrir(escolhida);
    }

    // Reabre sozinho a placa já autorizada (depois do login ou ao religar o cabo).
    async function reconectarAutomatico() {
      if (!serial || porta) return false;
      const preferencia = lerPreferencia();
      if (!preferencia?.automatico) return false;
      let portas = [];
      try {
        portas = await serial.getPorts();
      } catch {
        return false;
      }
      return abrir(portas.find((candidata) => mesmaPlaca(candidata, preferencia)));
    }

    async function desconectar() {
      gravarPreferencia(null);
      const alvo = porta;
      if (!alvo) {
        mudar("desconectado");
        return;
      }
      encerrando = true;
      try { await leitor?.cancel(); } catch { /* leitura já encerrada */ }
      try { await laco; } catch { /* laço já terminou */ }
      try { await fila; } catch { /* escrita pendente já falhou */ }
      try { await alvo.close(); } catch { /* porta já fechada */ }
      porta = null;
      mudar("desconectado");
    }

    // Uma escrita por vez: o "writable" só aceita um escritor.
    function enviar(texto) {
      if (!texto) return Promise.resolve(false);
      fila = fila.catch(() => false).then(async () => {
        const alvo = porta;
        if (!alvo?.writable) return false;
        let escritor;
        try {
          escritor = alvo.writable.getWriter();
        } catch {
          return false;
        }
        try {
          await escritor.write(codificador.encode(`${texto}\n`));
          return true;
        } catch {
          return false;
        } finally {
          escritor.releaseLock();
        }
      });
      return fila;
    }

    if (serial?.addEventListener) {
      serial.addEventListener("connect", (evento) => {
        const preferencia = lerPreferencia();
        if (!porta && preferencia?.automatico && mesmaPlaca(evento.target, preferencia)) {
          abrir(evento.target);
        }
      });
    }

    return {
      get estado() { return estado; },
      get suportado() { return Boolean(serial); },
      conectar,
      desconectar,
      reconectarAutomatico,
      enviar
    };
  }

  window.senaiArduino = Object.freeze({
    VELOCIDADE,
    interpretarLinha,
    criarComando,
    criarSeparadorDeLinhas,
    criarConexao
  });
})();
