"use strict";

// ==========================================================
// SENAI Smart Class - Controle da sala pelo celular
// O computador da sala (ponte) e o celular (controle) trocam mensagens
// por um canal Broadcast do Supabase Realtime. O canal é público, então
// cada mensagem leva uma assinatura HMAC feita com o código da sala:
// sem o código, ninguém lê o nome do canal nem forja um comando.
// ==========================================================

(() => {
  const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem I, O, 0 e 1
  const TAMANHO_CODIGO = 16; // 16 x 5 bits = 80 bits
  const TOLERANCIA_MS = 10 * 60 * 1000; // relógios de celular e computador podem diferir
  const LIMITE_DADOS = 64000;
  const CHAVE_LINK = "smartclass:sala";
  const ESCUTA = Object.freeze({
    ponte: ["comando", "ola"],
    controle: ["estado", "historico", "resposta"]
  });

  const codificar = (texto) => new TextEncoder().encode(texto);
  const hex = (buffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

  function normalizarCodigo(texto) {
    const limpo = String(texto ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (limpo.length !== TAMANHO_CODIGO) return null;
    for (const letra of limpo) if (!ALFABETO.includes(letra)) return null;
    return limpo;
  }

  function formatarCodigo(texto) {
    const limpo = normalizarCodigo(texto);
    return limpo ? limpo.match(/.{4}/g).join("-") : null;
  }

  function gerarCodigo() {
    // 256 é múltiplo de 32: o resto da divisão não favorece nenhuma letra.
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(TAMANHO_CODIGO));
    return formatarCodigo(Array.from(bytes, (byte) => ALFABETO[byte % 32]).join(""));
  }

  async function derivarSala(codigo) {
    const limpo = normalizarCodigo(codigo);
    if (!limpo) throw new Error("codigo-invalido");
    const sutil = globalThis.crypto.subtle;
    const canal = hex(await sutil.digest("SHA-256", codificar(`smartclass:canal:${limpo}`))).slice(0, 32);
    const material = await sutil.digest("SHA-256", codificar(`smartclass:chave:${limpo}`));
    const chave = await sutil.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    return { canal: `smartclass-sala-${canal}`, chave };
  }

  async function assinarMensagem(chave, evento, corpo, agora = Date.now()) {
    const n = hex(globalThis.crypto.getRandomValues(new Uint8Array(12)));
    const dados = JSON.stringify(corpo);
    const assinatura = hex(await globalThis.crypto.subtle.sign("HMAC", chave, codificar(`${evento}|${agora}|${n}|${dados}`)));
    return { v: 1, t: agora, n, dados, assinatura };
  }

  // Devolve o corpo só quando a assinatura confere, a mensagem é recente e ainda não foi vista.
  async function verificarMensagem(chave, evento, mensagem, vistos, agora = Date.now()) {
    if (!mensagem || mensagem.v !== 1 || !Number.isFinite(mensagem.t) ||
        typeof mensagem.n !== "string" || !/^[0-9a-f]{24}$/.test(mensagem.n) ||
        typeof mensagem.assinatura !== "string" || !/^[0-9a-f]{64}$/.test(mensagem.assinatura) ||
        typeof mensagem.dados !== "string" || mensagem.dados.length > LIMITE_DADOS) return null;
    if (Math.abs(agora - mensagem.t) > TOLERANCIA_MS || vistos.has(mensagem.n)) return null;
    const assinatura = Uint8Array.from(mensagem.assinatura.match(/../g), (par) => parseInt(par, 16));
    const confere = await globalThis.crypto.subtle.verify(
      "HMAC", chave, assinatura, codificar(`${evento}|${mensagem.t}|${mensagem.n}|${mensagem.dados}`)
    );
    if (!confere || vistos.has(mensagem.n)) return null;
    vistos.set(mensagem.n, agora);
    for (const [nonce, quando] of vistos) {
      if (agora - quando > TOLERANCIA_MS * 2) vistos.delete(nonce);
    }
    try {
      const corpo = JSON.parse(mensagem.dados);
      return corpo && typeof corpo === "object" ? corpo : null;
    } catch {
      return null;
    }
  }

  // papel "ponte": computador com a sala; papel "controle": celular que comanda de longe.
  function criarSala({ papel, codigo, criarCanal, aoMensagem = () => {}, aoEstado = () => {}, relogio = () => Date.now() }) {
    let canal = null;
    let chave = null;
    let estado = "desligada";
    let fila = Promise.resolve();
    const vistos = new Map();

    function mudar(novo, detalhe = null) {
      estado = novo;
      aoEstado(novo, detalhe);
    }

    async function iniciar() {
      if (canal) return true;
      mudar("conectando");
      let sala;
      try {
        sala = await derivarSala(codigo);
      } catch {
        mudar("erro", "Código da sala inválido. Confira as 16 letras e números.");
        return false;
      }
      chave = sala.chave;
      try {
        canal = criarCanal(sala.canal);
      } catch {
        mudar("erro", "Não foi possível abrir a conexão em tempo real. Verifique a internet.");
        return false;
      }
      for (const evento of ESCUTA[papel] || []) {
        canal.on("broadcast", { event: evento }, ({ payload } = {}) => {
          // Uma mensagem por vez, na ordem de chegada.
          fila = fila.then(async () => {
            const corpo = await verificarMensagem(chave, evento, payload, vistos, relogio());
            if (corpo) aoMensagem(evento, corpo);
          }).catch(() => {});
        });
      }
      canal.subscribe((status) => {
        if (estado === "desligada") return;
        if (status === "SUBSCRIBED") mudar("conectada");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") mudar("reconectando");
      });
      return true;
    }

    async function enviar(evento, corpo) {
      if (!canal || !chave) return false;
      try {
        const mensagem = await assinarMensagem(chave, evento, corpo, relogio());
        const resposta = await canal.send({ type: "broadcast", event: evento, payload: mensagem });
        return resposta === "ok";
      } catch {
        return false;
      }
    }

    async function encerrar() {
      const anterior = canal;
      canal = null;
      chave = null;
      estado = "desligada";
      try { await anterior?.unsubscribe(); } catch { /* canal já fechado */ }
      aoEstado("desligada", null);
    }

    return {
      get estado() { return estado; },
      get papel() { return papel; },
      get codigo() { return formatarCodigo(codigo); },
      iniciar,
      enviar,
      encerrar
    };
  }

  // Link "…/#sala=CODIGO": o código fica só no aparelho (o fragmento não vai ao servidor).
  function guardarCodigoDoLink() {
    try {
      const encontrado = globalThis.location?.hash?.match(/(?:^#|&)sala=([A-Za-z0-9-]{16,24})/);
      if (!encontrado) return;
      const codigo = formatarCodigo(decodeURIComponent(encontrado[1]));
      if (codigo) globalThis.sessionStorage?.setItem(CHAVE_LINK, codigo);
      globalThis.history?.replaceState(null, "", `${globalThis.location.pathname}${globalThis.location.search}`);
    } catch {
      // Sem armazenamento: a pessoa digita o código na tela de Configurações.
    }
  }

  function lerCodigoDoLink() {
    try {
      return formatarCodigo(globalThis.sessionStorage?.getItem(CHAVE_LINK));
    } catch {
      return null;
    }
  }

  function esquecerCodigoDoLink() {
    try { globalThis.sessionStorage?.removeItem(CHAVE_LINK); } catch { /* armazenamento bloqueado */ }
  }

  // Guarda o código só nesta aba: ao recarregar e entrar de novo, o celular volta para a sala.
  function lembrarCodigo(codigo) {
    const formatado = formatarCodigo(codigo);
    if (!formatado) return;
    try { globalThis.sessionStorage?.setItem(CHAVE_LINK, formatado); } catch { /* armazenamento bloqueado */ }
  }

  guardarCodigoDoLink();

  window.senaiRemoto = Object.freeze({
    normalizarCodigo,
    formatarCodigo,
    gerarCodigo,
    derivarSala,
    assinarMensagem,
    verificarMensagem,
    criarSala,
    lerCodigoDoLink,
    esquecerCodigoDoLink,
    lembrarCodigo
  });
})();
