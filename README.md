# SENAI Smart Class

Painel de monitoramento e automação de sala desenvolvido com HTML, CSS e JavaScript, com autenticação e persistência no Supabase.

As leituras de ocupação, DHT11 (temperatura e umidade) e LDR (luminosidade) são **simuladas**. A ocupação representa de 0 a 40 pessoas na sala. Os controles do servo SG90, motor DC do ventilador e LEDs também operam a simulação; ainda não há acionamento de equipamentos físicos.

## Acesso online

- Sistema: https://senai-smart-class-one.vercel.app
- Código do painel: https://github.com/GustavobritoTDS/Painel-De-Controle-SALA
- Backend e scripts SQL: repositório privado `GustavobritoTDS/Banco-de-dados-`.

A Vercel publica automaticamente os commits enviados à branch `main` deste repositório.

## Funcionalidades

- Indicadores e carrossel circular para escolher o gráfico principal, com históricos contextuais das demais grandezas na aba **Sensores**.
- **Modo apresentação** para a TV de eventos: sequência automática de gráficos, roleta girando, abertura animada com a logo do SENAI e equipe do projeto. Desligado, o painel funciona como antes.
- Controles do servo SG90, ventilador DC e LEDs, regras automáticas, exportação de histórico e assistente de voz.
- Temas escuro e claro. O tema claro usa superfícies brancas, texto escuro e acentos roxos.
- Layout para computador, tablet e celular.
- Área de perfil separada do painel da sala.
- Criação, edição, busca e filtros de contas na área administrativa.

## Perfis de acesso

| Perfil | Acesso |
| --- | --- |
| Aluno | Observação do painel e acesso ao próprio perfil. |
| Professor | Operação do painel e persistência de leituras e eventos, sem gestão de contas. |
| Administrador | Operação do painel e gerenciamento de contas. |

As permissões são validadas em `public.profiles` e nas políticas RLS do Supabase. Dados de nome e série não concedem permissões. O cadastro público está desativado; novas contas são criadas por administradores pela função `senai-admin`.

## Executar localmente

1. Clone ou atualize este repositório.
2. Abra a pasta no VS Code e use **Open with Live Server** em `index.html`, ou execute `python -m http.server 5500` e acesse http://localhost:5500.
3. Entre com uma conta cadastrada. O login exige conexão com o Supabase.

Não é necessário instalar dependências para servir o painel com os arquivos compilados de `assets/` incluídos. As dependências de desenvolvimento são usadas para recompilar o carrossel e executar os testes.

## Dashboard unificado

1. Sirva `index.html` conforme as instruções acima e entre com uma conta cadastrada.
2. Abra **Sensores**: a roleta ocupa a área do dashboard. Passe o cursor sobre um cartão para trazê-lo ao centro e dê um duplo clique (ou pressione **Enter**) para ampliar a escolha com zoom. O dashboard escolhido aparece sozinho em uma tela dedicada. **Voltar à roleta** retorna à escolha sem perder filtros ou histórico.
3. Na tela ampliada, clique em **Atualizar** para atualizar todas as grandezas com uma única leitura. Professores e administradores podem habilitar a atualização automática em **Configurações**, mantendo o padrão de 5 segundos e a faixa de 2 a 30 segundos.
4. Em **Baixar histórico por período**, escolha **Data inicial** e **Data final** nos calendários e clique em **Baixar histórico**. Ambos começam no dia atual; **Hoje** restaura essa escolha. O PDF inclui os dois dias completos e as quatro métricas, consultando o histórico salvo da sala sem o limite de 100 amostras do gráfico. **Limpar histórico** mantém a última amostra no painel, sem apagar registros do Supabase.

Para explorar os gráficos:

- Passe o cursor sobre os cartões da **roleta circular** para girá-la diretamente até o dashboard apontado. Também é possível arrastar ou usar as setas do teclado sem abrir a análise. Um clique simples apenas seleciona; o duplo clique amplia. Os cartões apresentam prévias das mesmas leituras do dashboard, sem fotos ou fontes externas.
- A abertura mantém somente o dashboard escolhido, com seus KPIs e o histórico recente disponível. Os outros três gráficos e seus dados permanecem ocultos nessa visualização individual.
- Passe o cursor sobre o gráfico ampliado para consultar seus pontos. Clique ou toque para fixar uma leitura; clique novamente na mesma amostra para soltá-la. O resumo e o tooltip exibem somente a métrica escolhida.
- **Esc** libera a seleção. No celular, o toque substitui o hover e mantém a rolagem vertical livre.
- As datas filtram somente o download, sem recortar os gráficos ou suas estatísticas. Os calendários nativos permitem escolher dia, mês e ano também no celular. Datas padrão acompanham a virada do dia; escolhas manuais são mantidas até usar **Hoje**.
- Se o intervalo estiver invertido, faltar uma data ou não houver leituras no período, uma mensagem aparece junto aos campos e nenhum PDF é gerado. Falhas na consulta não geram um arquivo parcial.
- Com o gráfico em foco pelo Tab, use **←/→**, **Home/End**, **Enter/Espaço** para fixar ou soltar e **Esc** para liberar a seleção. O toque permite consultar os valores sem impedir a rolagem vertical da página.
- Escolher datas e inspecionar pontos não alteram as leituras, a aquisição ou as permissões. O PDF e seu nome identificam o período escolhido.
- A tela inicial foi simplificada: banner, indicadores duplicados, textos repetidos e abas de sensores por extenso foram retirados da área da roleta. O zoom respeita a preferência de movimento reduzido.

Temperatura e umidade (DHT11), ocupação e luminosidade (LDR) foram reunidas no mesmo ambiente lógico, **Sala SENAI Smart Class**. Cada grandeza tem cor e unidade próprias, tooltip e estatísticas. O indicador duplicado de pessoas e a aba **Verificação** foram incorporados a **Sensores**. A visualização reutiliza os quatro canvases existentes, sem novas bibliotecas de gráficos.

Todos os gráficos continuam usando `estado.historico`, com até 100 amostras. A exportação usa uma consulta separada e paginada em `sensor_readings`, limitada à sala e às datas escolhidas, com as mesmas permissões do painel. Foram preservados a geração simulada, o carregamento e a gravação das leituras, os alertas, a automação, a voz, os temas e os perfis de acesso. O painel é uma aplicação HTML/CSS/JS; a configuração completa está nos arquivos do projeto, sem JSON de importação para Grafana ou outra plataforma.

Verificação manual: confirme o acesso e o carregamento do histórico com uma conta real no Supabase. As leituras e os atuadores continuam simulados. O carregamento remoto existente não filtra sala/sensor; caso o banco contenha outros ambientes, confira a origem das leituras antes de tratá-las como pertencentes a uma única sala. Essa consulta foi preservada nesta junção.

## Modo apresentação (TV do evento)

- O botão **Modo apresentação**, na barra lateral do computador, liga e desliga o modo. Desligado, o painel é o de antes: a roleta não gira sozinha e não aparecem créditos nem a logo.
- Ligado, o painel entra em tela cheia, sem barra lateral e sem o assistente de voz, e o cursor some depois de 2,5 segundos parado.
- As telas se repetem nesta ordem: gráfico ampliado do cartão da frente (10 s), roleta girando (35 s), abertura animada com a logo do SENAI espelhada (9 s) e equipe do projeto (16 s). No gráfico ampliado ficam só o título, os indicadores e o gráfico.
- **Esc**, o botão **Sair da apresentação** (aparece ao mexer o mouse) ou sair da tela cheia voltam ao painel normal. **PageDown** e **PageUp** (passadores de slide) pulam de tela.
- A abertura mostra os mesmos valores dos sensores do painel. Os tempos ficam em `CENAS`, em `src/apresentacao.mjs`; os nomes da equipe e os orientadores, em `src/equipe.mjs`. Depois de alterar, execute `npm run build`.
- As animações usam GSAP (SplitText e DrawSVG), empacotado no próprio bundle. Com a preferência de movimento reduzido, as telas só aparecem e somem.
- A logo do SENAI fica em `assets/senai-marca*.png`: a colorida para o tema claro e a negativa (branca com o acento laranja) para o escuro e para as telas da apresentação.

### Rotação automática e créditos (no modo apresentação)

- A roleta avança um cartão a cada 10 segundos. Abaixo dela fica um controle discreto: o ícone de pausa e uma linha fina, na cor do cartão da frente, que mostra o tempo até a próxima troca. Ele fica apagado no painel e ganha nitidez ao passar o mouse ou receber foco pelo teclado.
- O ícone de pausa para a roleta e o de play volta a girar. Com a preferência de movimento reduzido do sistema, a roleta começa parada e só gira se alguém pedir.
- Mover o mouse, tocar, rolar, usar o teclado ou chegar à roleta pelo Tab adia a troca. A contagem recomeça do zero 2,5 segundos depois da última interação; um cursor parado ou um foco esquecido na roleta não seguram a apresentação.
- A contagem também para no dashboard ampliado, em outra aba do painel, com a roleta fora da tela ou com a aba do navegador escondida, e volta sozinha quando a roleta reaparece.
- Enquanto a roleta gira sozinha, as trocas não são anunciadas ao leitor de tela; com a rotação pausada, voltam a ser anunciadas.
- A faixa de créditos fica abaixo da roleta, com quem desenvolveu o projeto e os professores, e a logo do SENAI aparece discreta no cabeçalho, com um reflexo suave.
- O intervalo é `INTERVALO_ROTACAO_MS` em `src/rotacao-automatica.mjs`. Depois de alterar, execute `npm run build`.

## Carrossel circular (React Bits)

O componente oficial [CircularCarousel](https://reactbits.dev/components/circular-carousel) foi instalado por shadcn:

```sh
npx shadcn@latest add @react-bits/CircularCarousel-JS-CSS
```

`components.json` configura o registry e `jsconfig.json` resolve os aliases. React e React DOM são usados somente na navegação circular; o restante continua em HTML, CSS e JavaScript. O esbuild gera um bundle de produção local, sem CDN de React, scripts inline ou alteração da CSP.

Após editar o carrossel, execute:

```sh
npm ci
npm run build
npm test
```

Os arquivos em `assets/` acompanham o código, portanto a página continua funcionando com Live Server sem executar um servidor React. O CI também executa o build. A instalação por shadcn não precisa ser repetida para usar o dashboard; reinstalar com overwrite substitui as adaptações locais.

- `src/components/CircularCarousel.jsx` e `.css`: componente instalado. Adaptações locais pequenas adicionam rótulos em português e a API `ref.focusIndex()` para os atalhos acessíveis. A licença original fica ao lado do componente e é copiada para `assets/`.
- `src/dashboard-carousel.jsx`: ilha React, navegação, mudança de tema e sincronização com o dashboard.
- `src/sensor-cards.mjs`: prévias SVG calculadas a partir das leituras reais da sessão (atualmente simuladas).
- `src/rotacao-automatica.mjs`: temporizador único da rotação automática e motivos de pausa, testado em `tests/rotacao-automatica.test.mjs`.
- `src/apresentacao.mjs`: sequência e tempos do modo apresentação, testada em `tests/apresentacao.test.mjs`.
- `src/apresentacao.jsx` e `src/apresentacao.css`: telas de abertura e da equipe (GSAP) e o visual do painel no modo apresentação.
- `src/equipe.mjs`: nomes da equipe por grupo e orientadores.
- `src/carousel.css`: integração do carrossel ao tema e ao layout responsivo.
- `scripts/build-carousel.mjs`: gera `assets/dashboard-carousel.js`, CSS e avisos de licença.
- `app.js`: recebe `dashboard:select-metric` (navegar), `dashboard:open` (abrir com zoom) e `dashboard:close` (voltar), e publica `dashboard:state` somente após o início autenticado. A troca move os canvases existentes; não duplica leituras, filtros, temporizadores ou consultas. O hover não dispara renders React.

O HTML inclui atalhos para escolher sensores caso o bundle não carregue; autenticação e permissões permanecem sob `senai-auth.js`.


## Arquivos principais

| Arquivo | Responsabilidade |
| --- | --- |
| `index.html` | Estrutura, abas, formulário de login e gerenciamento de contas. |
| `visual.css` | Layout, gráficos, temas e responsividade. |
| `senai-auth.css` | Tela de login e área de contas. |
| `app.js` | Sensores simulados, automação, gráficos e voz. |
| `senai-auth.js` | Login, validação de perfil e chamadas ao Supabase. |
| `theme-init.js` | Aplica o tema salvo antes de desenhar a página. |
| `vercel.json` | Cabeçalhos de segurança da publicação. |
| `tests/` | Testes da interface e das proteções do frontend. |

## Créditos

- Desenvolvido por: Lucas Duarte, Gustavo de Brito e Marcio Andrey.
- Professores: Huiatã Ribeiro e Jorge Guilherme.

## Validação

Com Node.js 22 ou superior:

```sh
npm ci
npm test
```

Os testes usam serviços simulados e não criam nem alteram contas reais. Os testes da função administrativa ficam junto ao backend no repositório privado.

Consulte [SECURITY.md](SECURITY.md) para detalhes de CSP, integridade do SDK e autorização. Nunca inclua senhas, chaves secretas ou `service_role` no frontend.
