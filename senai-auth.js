"use strict";

// ==========================================================
// SENAI Smart Class - Autenticação & Persistência Supabase RLS
// ==========================================================

const SENAI_URL = "https://xjmkftxvwsvxjujgaysd.supabase.co";
const SENAI_PUBLIC_KEY = "sb_publishable_maPRcTNjV8cCoC3ldwdlzg_cazswZCH";

let senaiClientInstance = null;

function obterClienteSupabase() {
  if (senaiClientInstance) return senaiClientInstance;
  if (window.supabase && typeof window.supabase.createClient === "function") {
    senaiClientInstance = window.supabase.createClient(SENAI_URL, SENAI_PUBLIC_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    });
    return senaiClientInstance;
  }
  return null;
}

async function esperarSupabase(timeoutMs = 6000) {
  const inicio = Date.now();
  let client = obterClienteSupabase();
  while (!client) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error("Não foi possível carregar o serviço de autenticação. Verifique a conexão com a internet.");
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
    client = obterClienteSupabase();
  }
  return client;
}

window.senaiAuth = (() => {
  let profile = null;
  let initialized = false;

  const isAdmin = () => profile?.role === "ADM" && profile?.status === "ATIVO";
  // Professores operam o painel como ADM, mas não gerenciam usuários.
  const canOperatePanel = () => ["ADM", "PROFESSOR"].includes(profile?.role) && profile?.status === "ATIVO";

  async function getProfile() {
    const client = await esperarSupabase();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) {
      throw new Error("Sessão inválida ou não autenticada.");
    }

    let dadosPerfil = null;
    let profileError = null;
    // A autorização vem exclusivamente de public.profiles; metadata do
    // navegador jamais é aceita como substituto de um perfil válido.
    try {
      const { data, error } = await client
        .from("profiles")
        .select("id,role,status,full_name,serie")
        .eq("id", user.id)
        .single();

      dadosPerfil = data;
      profileError = error;
    } catch (err) {
      profileError = err;
    }

    if (dadosPerfil && dadosPerfil.status && dadosPerfil.status !== "ATIVO") {
      throw new Error("Sua conta de acesso está inativa ou bloqueada.");
    }

    if (!dadosPerfil) {
      console.warn("Perfil de acesso ausente ou sem permissão de leitura.");
      throw new Error("Sua conta foi autenticada, mas ainda não possui um perfil de acesso no sistema. Peça a um administrador para sincronizar os perfis.");
    }
    const role = dadosPerfil.role;
    const status = dadosPerfil.status;
    const nomeCompleto = (dadosPerfil?.full_name || user.user_metadata?.full_name || user.email.split("@")[0]).trim();

    return {
      id: user.id,
      role: role,
      status: status,
      full_name: nomeCompleto,
      serie: dadosPerfil.serie,
      email: user.email || "E-mail não disponível"
    };
  }

  async function loadHistory(state, render) {
    if (!canOperatePanel()) return;

    try {
      const client = await esperarSupabase();
      const { data: rooms, error: roomError } = await client
        .from("rooms")
        .select("id")
        .eq("name", "Sala SENAI Smart Class")
        .limit(1);
      if (roomError) throw roomError;
      if (!rooms?.length) return;

      const { data, error } = await client
        .from("sensor_readings")
        .select("temperature,humidity,luminosity,people,recorded_at")
        .eq("room_id", rooms[0].id)
        .order("recorded_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      if (data && data.length > 0) {
        state.historico = data.reverse().map((item) => ({
          hora: new Date(item.recorded_at),
          temperatura: Number(item.temperature),
          umidade: Number(item.humidity),
          luminosidade: Number(item.luminosity),
          pessoas: Number(item.people)
        }));

        if (state.historico.length > 0) {
          state.sensores = { ...state.historico[state.historico.length - 1] };
        }
        if (typeof render === "function") render();
      }
    } catch (err) {
      console.warn("Não foi possível carregar o histórico de telemetria remoto.");
    }
  }

  async function loadHistoryForExport(inicio, fimExclusivo) {
    if (!canOperatePanel()) {
      throw new Error("Você não tem permissão para baixar o histórico.");
    }
    const dataValida = (valor) => Object.prototype.toString.call(valor) === "[object Date]"
      && Number.isFinite(valor.getTime());
    if (!dataValida(inicio) || !dataValida(fimExclusivo) || inicio >= fimExclusivo) {
      throw new Error("Informe um período válido para baixar o histórico.");
    }

    const client = await esperarSupabase();
    const { data: rooms, error: roomError } = await client
      .from("rooms")
      .select("id")
      .eq("name", "Sala SENAI Smart Class")
      .limit(1);
    if (roomError) throw roomError;
    if (!rooms?.length) return [];

    const registros = [];
    const tamanhoPagina = 500;
    let deslocamento = 0;
    // A exportação consulta todos os registros do período sem mudar o buffer do dashboard.
    while (true) {
      const { data, error } = await client
        .from("sensor_readings")
        .select("temperature,humidity,luminosity,people,recorded_at")
        .eq("room_id", rooms[0].id)
        .gte("recorded_at", inicio.toISOString())
        .lt("recorded_at", fimExclusivo.toISOString())
        .order("recorded_at", { ascending: true })
        .range(deslocamento, deslocamento + tamanhoPagina - 1);
      if (error) throw error;
      if (!data?.length) return registros;

      registros.push(...data.map((item) => ({
        hora: new Date(item.recorded_at),
        temperatura: Number(item.temperature),
        umidade: Number(item.humidity),
        luminosidade: Number(item.luminosity),
        pessoas: Number(item.people)
      })));
      // O servidor pode devolver menos linhas que o tamanho solicitado.
      deslocamento += data.length;
    }
  }

  async function saveReading(sensores) {
    if (!canOperatePanel() || !sensores) return;

    try {
      const client = await esperarSupabase();
      const { data: rooms, error: roomError } = await client
        .from("rooms")
        .select("id")
        .eq("name", "Sala SENAI Smart Class")
        .limit(1);

      if (roomError || !rooms?.length) return;

      const { data: { user } } = await client.auth.getUser();
      if (!user) return;

      await client.from("sensor_readings").insert({
        room_id: rooms[0].id,
        temperature: sensores.temperatura,
        humidity: sensores.umidade,
        luminosity: sensores.luminosidade,
        people: Number(sensores.pessoas),
        source: "SIMULADO",
        created_by: user.id
      });
    } catch (err) {
      console.warn("Falha ao salvar telemetria remota.");
    }
  }

  async function saveEvent(texto) {
    if (!canOperatePanel() || !texto) return;

    try {
      const client = await esperarSupabase();
      const { data: { user } } = await client.auth.getUser();
      if (!user) return;

      await client.from("system_events").insert({
        category: "DASHBOARD",
        description: texto,
        actor_id: user.id
      });
    } catch (err) {
      console.warn("Falha ao salvar evento remoto.");
    }
  }

  async function manage(action, attrs = {}) {
    if (!isAdmin()) throw new Error("Acesso restrito a administradores.");
    const client = await esperarSupabase();
    const { data, error } = await client.functions.invoke("senai-admin", {
      body: { action, ...attrs }
    });

    if (error) {
      let message = "Não foi possível concluir a operação. Tente novamente.";
      if (error.context && typeof error.context.json === "function") {
        try { message = (await error.context.json()).error || message; } catch { /* resposta sem JSON */ }
      }
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  function applyRole() {
    if (!profile) return;
    document.body.dataset.senaiRole = profile.role;
    const administrador = isAdmin();
    const professor = profile.role === "PROFESSOR";
    const nome = profile.full_name || profile.email.split("@")[0];

    if (!canOperatePanel()) {
      // Alunos usam o dashboard em modo de observação local
      for (const id of [
        "btn-baixar", "btn-limpar", "btn-toggle-voz", "btn-voz",
        "btn-desligar-tudo", "modo-auto", "temp-alta", "lux-baixa",
        "auto-refresh", "intervalo"
      ]) {
        const el = document.getElementById(id);
        if (el) el.disabled = true;
      }

      const configTab = document.getElementById("aba-btn-config");
      if (configTab) configTab.hidden = true;
    }

    const preencher = (seletor, valor) => {
      const elemento = document.querySelector(seletor);
      if (elemento) elemento.textContent = valor;
    };

    preencher("#conta-tipo", administrador ? "Administrador" : professor ? "Professor" : "Aluno");
    preencher("#conta-nome", nome);
    configurarGestaoContas();
  }

  function configurarGestaoContas() {
    const $ = (id) => document.getElementById(id);
    const painel = $("gestao-contas");
    if (!painel) return;
    $("conta-subnav").hidden = !isAdmin();
    const trocarSubaba = (gestao) => {
      gestao = gestao && isAdmin();
      painel.hidden = !gestao;
      $("conta-perfil-painel").hidden = gestao;
      for (const [id, ativo] of [["conta-tab-perfil", !gestao], ["conta-tab-gestao", gestao]]) {
        $(id).classList.toggle("ativa", ativo);
        $(id).setAttribute("aria-selected", String(ativo));
        $(id).tabIndex = ativo ? 0 : -1;
      }
    };
    if (!isAdmin()) { trocarSubaba(false); return; }
    if (painel.dataset.inicializado) return;
    painel.dataset.inicializado = "true";
    trocarSubaba(false);
    const form = $("criar-conta-form"), perfil = $("novo-perfil"), serie = $("nova-serie");
    const status = $("criar-conta-status"), atualizar = $("btn-atualizar-contas"), botao = $("btn-criar-conta");
    let usuarios = [], editando = null, salvando = false;
    const ajustarSerie = () => {
      const aluno = perfil.value === "ALUNO";
      $("nova-serie-campo").hidden = !aluno;
      serie.disabled = !aluno;
      serie.required = aluno;
      if (!aluno) serie.value = "";
      $("novo-perfil-ajuda").textContent = perfil.value === "ADM"
        ? "Administradores têm acesso total ao painel e podem gerenciar contas."
        : aluno ? "Alunos acompanham o painel e precisam informar a série."
        : "Professores acompanham o painel. Não é necessário informar série.";
    };
    const modoFormulario = (usuario = null) => {
      editando = usuario;
      form.reset();
      $("formulario-conta-titulo").textContent = usuario ? "Editar usuário" : "Criar conta";
      botao.textContent = usuario ? "Salvar alterações" : "Criar conta";
      $("btn-cancelar-edicao").hidden = !usuario;
      $("nova-senha").required = !usuario;
      $("nova-senha-rotulo").textContent = usuario ? "Nova senha (opcional)" : "Senha inicial";
      $("nova-senha-ajuda").textContent = usuario ? "Deixe em branco para manter a senha atual. Se trocar, use 12 caracteres ou mais, com maiúscula, minúscula, número e símbolo." : "De 12 a 128 caracteres, com maiúscula, minúscula, número e símbolo.";
      if (usuario) {
        $("novo-nome").value = usuario.full_name || "";
        $("novo-email").value = usuario.email || "";
        perfil.value = usuario.role;
      }
      ajustarSerie();
      if (usuario?.role === "ALUNO") serie.value = usuario.serie || "";
    };
    function renderizarContas() {
      const filtro = $("filtro-perfil").value;
      const busca = $("buscar-conta").value.trim().toLocaleLowerCase("pt-BR");
      const filtrados = usuarios.filter(u => (filtro === "TODOS" || u.role === filtro) && `${u.full_name || ""} ${u.email || ""}`.toLocaleLowerCase("pt-BR").includes(busca));
      const lista = $("contas-lista");
      lista.replaceChildren();
      for (const user of filtrados) {
        const linha = document.createElement("tr");
        const valores = [user.full_name || "Nome não informado", user.email || "—", user.role === "ADM" ? "Administrador" : user.role === "PROFESSOR" ? "Professor" : "Aluno", user.role === "ALUNO" ? user.serie || "Não informada" : "—", user.status === "ATIVO" ? "Ativo" : "Bloqueado"];
        for (const valor of valores) {
          const celula = document.createElement("td");
          celula.textContent = valor;
          linha.append(celula);
        }
        const acoes = document.createElement("td"), editar = document.createElement("button");
        editar.type = "button";
        editar.className = "btn editar-usuario";
        editar.textContent = "Editar usuário";
        editar.setAttribute("aria-label", `Editar usuário ${user.full_name || user.email || "sem nome"}`);
        editar.disabled = salvando;
        editar.addEventListener("click", () => {
          if (salvando) return;
          modoFormulario(user);
          status.hidden = true;
          form.scrollIntoView?.({ behavior: "smooth", block: "start" });
          $("novo-nome").focus({ preventScroll: true });
        });
        acoes.append(editar); linha.append(acoes); lista.append(linha);
      }
      $("contas-lista-status").textContent = filtrados.length ? `${filtrados.length} de ${usuarios.length} conta(s).` : "Nenhuma conta encontrada para este filtro.";
    }
    async function carregarContas() {
      atualizar.disabled = true;
      $("contas-lista-status").textContent = "Carregando contas...";
      try {
        const { users } = await manage("list");
        usuarios = users || [];
        renderizarContas();
      } catch (error) { $("contas-lista-status").textContent = error.message; }
      finally { atualizar.disabled = false; }
    }
    for (const [id, gestao] of [["conta-tab-perfil", false], ["conta-tab-gestao", true]]) {
      $(id).addEventListener("click", () => trocarSubaba(gestao));
      $(id).addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const proxima = event.key === "Home" ? false : event.key === "End" ? true : !gestao;
        trocarSubaba(proxima);
        $(proxima ? "conta-tab-gestao" : "conta-tab-perfil").focus();
      });
    }
    $("btn-cancelar-edicao").addEventListener("click", () => { if (!salvando) { modoFormulario(); status.hidden = true; } });
    $("filtro-perfil").addEventListener("change", renderizarContas);
    $("buscar-conta").addEventListener("input", renderizarContas);
    perfil.addEventListener("change", ajustarSerie);
    atualizar.addEventListener("click", carregarContas);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (salvando || !form.reportValidity()) return;
      const nome = $("novo-nome").value.trim(), senha = $("nova-senha");
      const idEditado = editando?.id;
      const payload = { full_name: nome, email: $("novo-email").value.trim(), role: perfil.value, serie: perfil.value === "ALUNO" ? serie.value.trim() : null };
      if (senha.value) payload.password = senha.value;
      if (idEditado) payload.user_id = idEditado;
      salvando = true; botao.disabled = true;
      $("btn-cancelar-edicao").disabled = true;
      renderizarContas();
      botao.textContent = "Salvando...";
      status.hidden = false; status.textContent = "Salvando os dados da conta..."; status.dataset.tipo = "info";
      try {
        await manage(idEditado ? "update" : "create", payload);
        status.textContent = idEditado ? `Dados de ${nome} atualizados.` : `Conta de ${nome} criada. O usuário já pode entrar com o e-mail e a senha cadastrados.`;
        status.dataset.tipo = "sucesso";
        modoFormulario();
        if (idEditado === profile.id) { profile = await getProfile(); applyRole(); }
        if (isAdmin()) await carregarContas();
      } catch (error) { status.textContent = error.message; status.dataset.tipo = "erro"; }
      finally {
        senha.value = ""; salvando = false; botao.disabled = false;
        $("btn-cancelar-edicao").disabled = false;
        botao.textContent = editando ? "Salvar alterações" : "Criar conta";
        renderizarContas();
      }
    });
    ajustarSerie();
    carregarContas();
  }

  async function start(init, state, render) {
    const overlay = document.getElementById("senai-login");
    const form = document.getElementById("senai-login-form");
    const statusEl = document.getElementById("senai-status");
    const emailInput = document.getElementById("senai-email");
    const passInput = document.getElementById("senai-password");
    const btnEntrar = document.getElementById("senai-btn-entrar");
    const btnToggleSenha = document.getElementById("btn-toggle-senha");

    // Garante que o overlay de login fique aberto, visível e limpo
    if (overlay) {
      overlay.hidden = false;
      overlay.classList.remove("fechando");
    }
    if (emailInput) emailInput.value = "";
    if (passInput) passInput.value = "";

    // Força limpeza de qualquer sessão local anterior ao abrir o site
    try {
      for (const chave of Object.keys(localStorage)) {
        if (chave.startsWith("sb-") && chave.includes("-auth-token")) {
          localStorage.removeItem(chave);
        }
      }
      for (const chave of Object.keys(sessionStorage)) {
        if (chave.startsWith("sb-") && chave.includes("-auth-token")) {
          sessionStorage.removeItem(chave);
        }
      }
    } catch (e) {
      console.warn("Não foi possível limpar uma sessão local anterior.");
    }

    // Alternar visibilidade da senha
    if (btnToggleSenha && passInput) {
      btnToggleSenha.addEventListener("click", () => {
        const tipoAtual = passInput.getAttribute("type");
        const novoTipo = tipoAtual === "password" ? "text" : "password";
        passInput.setAttribute("type", novoTipo);
        btnToggleSenha.setAttribute("aria-label", novoTipo === "text" ? "Ocultar senha" : "Exibir senha");
      });
    }

    const avisar = (msg, tipo = "erro") => {
      if (!statusEl) return;
      if (!msg) {
        statusEl.textContent = "";
        statusEl.hidden = true;
        return;
      }
      statusEl.textContent = msg;
      statusEl.dataset.tipo = tipo;
      statusEl.hidden = false;
    };

    let bloqueadoAte = 0;
    let temporizadorBloqueio = null;

    const setCarregando = (carregando) => {
      if (!btnEntrar) return;
      btnEntrar.disabled = carregando || Date.now() < bloqueadoAte;
      const spinner = btnEntrar.querySelector(".senai-spinner");
      const texto = btnEntrar.querySelector(".btn-texto");
      if (spinner) spinner.hidden = !carregando;
      if (texto) texto.textContent = carregando ? "Verificando credenciais..." : "Entrar no painel";
    };

    const bloquearLogin = (segundos = 900) => {
      bloqueadoAte = Date.now() + Math.max(1, segundos) * 1000;
      if (temporizadorBloqueio) clearInterval(temporizadorBloqueio);
      const atualizarBloqueio = () => {
        const restante = Math.max(0, Math.ceil((bloqueadoAte - Date.now()) / 1000));
        if (!restante) {
          clearInterval(temporizadorBloqueio);
          temporizadorBloqueio = null;
          bloqueadoAte = 0;
          avisar("");
          setCarregando(false);
          return;
        }
        const minutos = String(Math.floor(restante / 60)).padStart(2, "0");
        const segundosRestantes = String(restante % 60).padStart(2, "0");
        avisar(`Muitas tentativas de acesso. Tente novamente em ${minutos}:${segundosRestantes}.`);
        setCarregando(false);
      };
      atualizarBloqueio();
      temporizadorBloqueio = setInterval(atualizarBloqueio, 1000);
    };

    const launch = async () => {
      profile = await getProfile();

      if (!initialized) {
        init();
        initialized = true;
      }

      if (overlay) {
        overlay.classList.add("fechando");
        setTimeout(() => {
          overlay.hidden = true;
          overlay.classList.remove("fechando");
        }, 320);
      }

      applyRole();

      const sair = document.getElementById("btn-sair");
      if (sair) {
        sair.onclick = async () => {
          try {
            const client = await esperarSupabase();
            await client.auth.signOut({ scope: "local" });
          } catch (e) {
            console.warn("Não foi possível concluir a saída normalmente.");
          }
          location.reload();
        };
      }

      loadHistory(state, render).catch((error) =>
        console.warn("Histórico remoto indisponível.")
      );
    };

    // Sempre exige login: foca no e-mail e aguarda envio das credenciais
    avisar("");
    if (emailInput) {
      setTimeout(() => emailInput.focus(), 150);
    }

    if (form) {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        avisar("");

        const email = emailInput?.value?.trim();
        const password = passInput?.value;

        if (!email || !password) {
          avisar("Por favor, preencha o e-mail e a senha de acesso.");
          return;
        }

        setCarregando(true);
        avisar("Autenticando...", "info");

        try {
          const client = await esperarSupabase();
          const { data, error } = await client.functions.invoke("senai-login", {
            body: { email, password }
          });

          if (error || !data?.access_token || !data?.refresh_token) {
            let resposta = data || null;
            if (!resposta && error?.context && typeof error.context.json === "function") {
              try { resposta = await error.context.json(); } catch { /* resposta sem JSON */ }
            }
            const codigo = resposta?.code;
            const restante = Number(resposta?.attempts_remaining);
            const espera = Number(resposta?.retry_after_seconds);
            if (codigo === "login_locked" || (codigo === "invalid_credentials" && restante === 0)) {
              bloquearLogin(Number.isFinite(espera) && espera > 0 ? espera : 900);
              return;
            }
            if (codigo === "invalid_credentials") {
              avisar(`E-mail ou senha incorretos. Restam ${Number.isFinite(restante) ? restante : 0} tentativa(s).`);
            } else if (codigo === "upstream_rate_limit") {
              avisar("Muitas solicitações. Aguarde alguns minutos e tente novamente.");
            } else {
              avisar("Não foi possível realizar o login agora. Tente novamente.");
            }
            setCarregando(false);
            return;
          }

          const { error: sessionError } = await client.auth.setSession({
            access_token: data.access_token,
            refresh_token: data.refresh_token
          });
          if (sessionError) throw new Error("session_setup_failed");

          avisar("Login efetuado com sucesso! Carregando painel...", "sucesso");
          await launch();
        } catch {
          avisar("Não foi possível realizar o login agora. Tente novamente.");
          setCarregando(false);
        }
      });
    }
  }

  return { start, saveReading, saveEvent, loadHistory, loadHistoryForExport, manage, isAdmin, canOperatePanel, getProfile };
})();
