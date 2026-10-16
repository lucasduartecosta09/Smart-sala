(function () {
    "use strict";

    const CONFIG = {
        idioma: "pt-BR",
        taxa: 0.94,
        tom: 1.02,
        volume: 1,
        template: "assistente-voz.html"
    };

    const comandos = [];
    let reconhecimento = null;
    let ativo = false;
    let pausadoParaResponder = false;
    let elementos = {};

    const normalizar = (texto) => texto.toLowerCase().normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ").trim();

    function registrarComando(nome, expressoes, executar, resposta = "Pronto.") {
        comandos.push({
            nome,
            expressoes: expressoes.map(normalizar),
            executar,
            resposta
        });
    }

    function identificarComando(texto) {
        const frase = normalizar(texto);
        return comandos.find((comando) =>
            comando.expressoes.some((expressao) => frase.includes(expressao))
        ) || null;
    }

    function selecionarVoz() {
        const vozes = speechSynthesis.getVoices().filter((voz) =>
            voz.lang.toLowerCase().startsWith("pt")
        );
        const pontos = (voz) => {
            const nome = voz.name.toLowerCase();
            let valor = voz.lang.toLowerCase() === "pt-br" ? 100 : 20;
            if (/natural|neural|premium|enhanced/.test(nome)) valor += 90;
            if (/francisca/.test(nome)) valor += 85;
            if (/google/.test(nome)) valor += 55;
            if (/microsoft/.test(nome)) valor += 35;
            if (!voz.localService) valor += 20;
            return valor;
        };
        return vozes.sort((a, b) => pontos(b) - pontos(a))[0] || null;
    }

    function definirEstado(estado, status) {
        const widget = elementos.widget;
        if (!widget) return;
        widget.classList.remove("ativo", "detectando-voz", "falando-resposta");
        if (estado !== "inativo") widget.classList.add("ativo");
        if (estado === "detectando") widget.classList.add("detectando-voz");
        if (estado === "falando") widget.classList.add("falando-resposta");
        if (status) elementos.status.textContent = status;
    }

    function falar(texto, aoTerminar) {
        if (!("speechSynthesis" in window)) {
            aoTerminar?.();
            return;
        }
        speechSynthesis.cancel();
        const fala = new SpeechSynthesisUtterance(texto);
        const voz = selecionarVoz();
        fala.lang = CONFIG.idioma;
        fala.rate = CONFIG.taxa;
        fala.pitch = CONFIG.tom;
        fala.volume = CONFIG.volume;
        if (voz) fala.voice = voz;
        fala.onstart = () => definirEstado("falando", texto);
        fala.onend = () => aoTerminar?.();
        fala.onerror = () => aoTerminar?.();
        speechSynthesis.speak(fala);
    }

    function retomar() {
        pausadoParaResponder = false;
        if (!ativo || !elementos.continuo.checked) {
            if (!elementos.continuo.checked) parar();
            return;
        }
        setTimeout(() => {
            if (!ativo) return;
            try { reconhecimento.start(); } catch (_) { /* já iniciado */ }
        }, 300);
    }

    function responder(texto) {
        pausadoParaResponder = true;
        try { reconhecimento.abort(); } catch (_) { /* já encerrado */ }
        falar(texto, retomar);
    }

    function processar(texto) {
        elementos.texto.textContent = texto;
        document.dispatchEvent(new CustomEvent("assistentevoz:transcricao", {
            detail: { texto, final: true }
        }));

        const comando = identificarComando(texto);
        if (!comando) {
            definirEstado("ativo", "Frase reconhecida");
            return;
        }

        try {
            comando.executar({ texto, nome: comando.nome });
            document.dispatchEvent(new CustomEvent("assistentevoz:comando", {
                detail: { nome: comando.nome, texto }
            }));
            responder(typeof comando.resposta === "function" ? comando.resposta() : comando.resposta);
        } catch (erro) {
            console.error("Falha no comando de voz:", erro);
            responder("Não consegui executar esse comando.");
        }
    }

    function iniciar() {
        if (!reconhecimento || ativo) return;
        ativo = true;
        elementos.botao.textContent = "Parar voz";
        elementos.botao.classList.add("ativo");
        elementos.botao.setAttribute("aria-pressed", "true");
        definirEstado("ativo", "Solicitando microfone…");
        try { reconhecimento.start(); } catch (_) { /* já iniciado */ }
    }

    function parar() {
        ativo = false;
        pausadoParaResponder = false;
        window.speechSynthesis?.cancel();
        try { reconhecimento?.stop(); } catch (_) { /* já encerrado */ }
        elementos.botao.textContent = "Iniciar voz";
        elementos.botao.classList.remove("ativo");
        elementos.botao.setAttribute("aria-pressed", "false");
        definirEstado("inativo", "Microfone desligado");
    }

    function aplicarTema(tema) {
        document.documentElement.dataset.tema = tema;
        try { localStorage.setItem("tema", tema); } catch (_) { /* armazenamento opcional */ }
        const meta = document.querySelector('meta[name="theme-color"]');
        meta?.setAttribute("content", tema === "claro" ? "#eef3f8" : "#07111f");
        if (typeof window.atualizarControleTema === "function") window.atualizarControleTema();
        if (typeof window.desenharGraficos === "function") requestAnimationFrame(window.desenharGraficos);
        document.dispatchEvent(new CustomEvent("tema:alterado", { detail: { tema } }));
    }

    function configurarReconhecimento() {
        const ClasseReconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!ClasseReconhecimento) {
            elementos.botao.disabled = true;
            definirEstado("inativo", "Reconhecimento não suportado neste navegador");
            return;
        }

        reconhecimento = new ClasseReconhecimento();
        reconhecimento.lang = CONFIG.idioma;
        reconhecimento.interimResults = true;
        reconhecimento.continuous = true;
        reconhecimento.onstart = () => definirEstado("ativo", "Pode falar…");
        reconhecimento.onspeechstart = () => definirEstado("detectando", "Estou ouvindo…");
        reconhecimento.onspeechend = () => { if (!pausadoParaResponder) definirEstado("ativo", "Processando…"); };
        reconhecimento.onresult = (evento) => {
            const resultados = Array.from(evento.results);
            const texto = resultados.map((item) => item[0].transcript).join(" ").trim();
            elementos.texto.textContent = texto || "Aguardando fala…";
            document.dispatchEvent(new CustomEvent("assistentevoz:transcricao", {
                detail: { texto, final: false }
            }));
            const finais = resultados.filter((item) => item.isFinal);
            if (finais.length) processar(finais.map((item) => item[0].transcript).join(" ").trim());
        };
        reconhecimento.onerror = (evento) => {
            if (evento.error !== "no-speech" && evento.error !== "aborted") {
                definirEstado("ativo", `Erro no microfone: ${evento.error}`);
            }
        };
        reconhecimento.onend = () => {
            if (ativo && elementos.continuo.checked && !pausadoParaResponder) {
                setTimeout(() => { try { reconhecimento.start(); } catch (_) { /* já iniciado */ } }, 250);
            }
        };
        elementos.botao.addEventListener("click", () => ativo ? parar() : iniciar());
    }

    async function carregarComponente() {
        const raiz = document.getElementById("assistente-voz-root");
        if (!raiz) return;
        try {
            const resposta = await fetch(raiz.dataset.template || CONFIG.template);
            if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
            raiz.innerHTML = await resposta.text();
        } catch (erro) {
            raiz.innerHTML = '<p class="voz-erro">Não foi possível carregar o assistente de voz.</p>';
            console.error("Abra a página por um servidor local para carregar assistente-voz.html.", erro);
            return;
        }

        elementos = {
            widget: document.getElementById("voz-widget"),
            status: document.getElementById("voz-status"),
            texto: document.getElementById("voz-texto"),
            botao: document.getElementById("btn-voz"),
            continuo: document.getElementById("voz-continuo")
        };
        configurarReconhecimento();
    }

    registrarComando("tema_claro", ["modo claro", "tema claro", "ativar modo claro"],
        () => aplicarTema("claro"), "Pronto, ativei o modo claro.");
    registrarComando("tema_escuro", ["modo escuro", "tema escuro", "ativar modo escuro"],
        () => aplicarTema("escuro"), "Tudo certo, modo escuro ativado.");

    window.AssistenteVoz = { iniciar, parar, registrarComando, aplicarTema };
    if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = selecionarVoz;
    document.addEventListener("DOMContentLoaded", carregarComponente);
}());
