# Segurança e validação

O painel usa Supabase Auth e autorização em `public.profiles`, protegida por RLS.
As chaves publishable do frontend são públicas; nunca adicionar service_role ou segredos ao cliente.

## Correções do relatório de 23/10/2026

- Cadastro público desativado no projeto Supabase; a criação administrativa continua pela função `senai-admin`.
- SDK Supabase fixado em 2.57.0, com SRI SHA-384 e crossorigin.
- CSP aplicada no HTML e nos cabeçalhos Vercel; scripts inline foram movidos para `theme-init.js`.
- Estilos inline continuam permitidos porque o gráfico posiciona tooltips dinamicamente.
- Testes de interface restaurados de Banco-de-dados-; executar `npm ci` e `npm test`.
- Backend, testes administrativos e fotografia das políticas ficam no repositório privado `GustavobritoTDS/Banco-de-dados-`.

Os testes locais usam serviços simulados e não substituem testes autenticados no ambiente publicado.
O cabeçalho frame-ancestors exige Vercel ou configuração equivalente no provedor de hospedagem.
Integração com ESP32/Arduino, acionamento físico e projeto piloto dependem de hardware e não fazem parte destas correções.

## Hardening AppSec de 30/10/2026

Foram corrigidos três riscos do OWASP Top 10:

1. **A07 — Falhas de identificação e autenticação:** o login agora passa pela Edge Function `senai-login`, com limite atômico no servidor. Dez tentativas são permitidas por combinação de conta e origem de rede em uma janela de 15 minutos; novas tentativas ficam bloqueadas por 15 minutos. O navegador apenas exibe o estado — apagar o armazenamento local não remove o bloqueio.
2. **A05 — Configuração de segurança inadequada:** respostas inesperadas das funções são genéricas, o CORS não usa mais `*`, páginas estáticas `404.html` e `500.html` evitam detalhes internos, e os cabeçalhos HSTS, Permissions-Policy, X-Frame-Options e COOP foram adicionados.
3. **A01 — Controle de acesso quebrado:** o histórico é filtrado explicitamente pela sala; inserções de leituras, eventos e comandos exigem que o autor seja `auth.uid()`; registros de auditoria ficaram imutáveis para usuários autenticados.

Senhas novas ou alteradas pela gestão exigem de 12 a 128 caracteres, com letra maiúscula, minúscula, número e símbolo. O Supabase continua responsável por hash e armazenamento das senhas. A proteção contra senhas conhecidas como vazadas ainda depende da opção **Leaked Password Protection** do plano/projeto Supabase.

Backend aplicado no projeto `senai-smart-class01`:

- Migrations `harden_auth_rate_limit_and_audit_rows` e `fix_login_rate_limit_timestamp_variable`.
- Edge Function `senai-login` versão 6, sem JWT porque recebe credenciais antes da sessão e executa seu próprio controle de origem e abuso.
- Edge Function `senai-admin` versão 12, com JWT obrigatório, política forte de senha, CORS restrito e erros inesperados sanitizados.

## Hardening do frontend de 31/10/2026

- A CSP agora bloqueia atributos de script inline (`script-src-attr 'none'`), limita workers, mídia e manifestos à própria origem e exige upgrade de subrecursos HTTP para HTTPS no deployment.
- A publicação aplica `Cross-Origin-Resource-Policy: same-origin`, `Origin-Agent-Cluster: ?1`, bloqueio de prefetch DNS e de políticas cross-domain legadas, além de impedir indexação do painel autenticado.
- A política de permissões mantém câmera, geolocalização, pagamentos e USB bloqueados; o microfone é permitido somente à própria origem porque o assistente de voz depende dessa capacidade.
- O formulário de login limita e-mail a 254 caracteres e senha a 128 caracteres, desliga autocapitalização/corretor no e-mail e preserva o fluxo atual de autenticação.

### Verificações de backend em 31/10/2026

- O allowlist CORS das funções `senai-login` e `senai-admin` foi reduzido para `https://smart-sala.vercel.app` e desenvolvimento local. Os domínios Vercel legado e de teste foram removidos.
- Todas as tabelas em `public` têm RLS ativo. As políticas usam `auth.uid()`, `is_active()`, `can_operate_panel()` e `is_admin()` conforme a ação; inserções de comandos, leituras e eventos também conferem o autor com `WITH CHECK`.
- O limite de login é atômico no servidor por hash de conta e origem de rede. A tabela técnica `app_private.login_rate_limits` não possui política RLS porque não é exposta pela API pública; ela só é acessada pelas RPCs privilegiadas da função.
- A criação e troca de senha pela função administrativa exigem agora 12 a 128 caracteres, com maiúscula, minúscula, número e símbolo, igual à interface.

### Pendências operacionais

1. Ativar **Leaked Password Protection** em Supabase Auth; o Security Advisor ainda aponta esse recurso como desativado.
2. Executar matriz autenticada de ALUNO, PROFESSOR e ADM em homologação para validar RBAC, IDOR, exportação e revogação de sessão.
3. Exercitar o bloqueio de login com contas descartáveis, em homologação, para confirmar o ciclo completo de bloqueio e liberação sem realizar força bruta em produção.
