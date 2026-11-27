# Clínica Ikigai

## 1. Sobre o Projeto

A Clínica Ikigai é um sistema web de gestão clínica desenvolvido em grupo como **Projeto Integrador do 3º semestre da graduação em Gestão da Tecnologia da Informação**, em parceria com a própria clínica e com os colaboradores do projeto.

A aplicação reúne em um único ambiente a operação diária da recepção, o acompanhamento clínico pelos profissionais, a comunicação via WhatsApp (bot de autoatendimento, lembretes automáticos e transbordo para atendimento humano) e o painel de indicadores gerenciais. Todas as áreas compartilham a mesma API e o mesmo banco de dados.

## 2. Colaboradores

Projeto desenvolvido em equipe para o 3º semestre de Gestão da Tecnologia da Informação, em parceria com a Clínica Ikigai:

- Alecsander Campos
- Gabriel Higo
- Ismael Nascimento
- Victor Domingos Bastos

## 3. Tecnologias e Estrutura

| Camada | Tecnologias |
| --- | --- |
| Interface | React 19, TypeScript, Vite, Tailwind CSS e SweetAlert2 |
| Indicadores | TypeScript e Chart.js |
| API | Node.js 24 LTS, Express e TypeScript |
| Banco de dados | MySQL 8.0+, InnoDB e mysql2 |
| WhatsApp e automação | Baileys (`@whiskeysockets/baileys`) e workflow auxiliar n8n |
| Tempo real | Server-Sent Events (SSE) |
| Proteções da API | Helmet, CORS, limite de requisições, sessões em banco (HttpOnly) e RBAC |
| Organização e qualidade | npm workspaces, ESLint, TypeScript e testes automatizados |

```text
Clinica_Ikigai/
├── frontend/
│   └── src/
│       ├── components/       # Agenda, pacientes, prontuário, serviços, usuários e comunicação
│       ├── hooks/            # Acessibilidade de modais e diálogos
│       ├── indicadores/      # Dashboard gerencial, gráficos e cálculos de métricas
│       ├── services/         # Autenticação e assinatura SSE de atualizações
│       └── utils/            # Máscaras, fuso horário da clínica e utilitários
├── backend/
│   ├── .env.example          # Modelo de configuração local
│   ├── n8n/                  # Fluxo de referência n8n (Etapa 1)
│   └── src/
│       ├── config/           # Pool MySQL, transações e polyfill WebCrypto
│       ├── controllers/      # Consultas agregadas do dashboard
│       ├── middleware/       # Autenticação, permissões por perfil e validação de entradas
│       ├── routes/           # Endpoints da operação, comunicação e indicadores
│       ├── scripts/          # Migração, backup, provisionamento de admin e carga de apresentação
│       ├── services/         # Agenda transacional, SSE, lembretes e motor WhatsApp/Baileys
│       └── utils/            # Regras auxiliares, runner Baileys e suítes de testes
├── database/
│   ├── schema.sql            # Estrutura, relacionamentos, views e gatilhos
│   ├── seed.sql              # Base reduzida usada em desenvolvimento e testes
│   └── queries_kpis.sql      # Consultas SQL de referência dos indicadores
├── package.json              # Workspaces e comandos integrados
├── package-lock.json         # Versões resolvidas das dependências
└── README.md
```

O projeto utiliza instalação unificada de dependências na raiz. As pastas `frontend/dist/`, `backend/dist/`, `.whatsapp-session/` e `backend/backups/` são geradas localmente e ficam fora do versionamento, assim como arquivos `.env`.

## 4. Banco de Dados

O banco padrão é `clinica_ikigai_db`, com codificação `utf8mb4`. O modelo concentra a operação clínica, o controle de acesso, a comunicação via WhatsApp e os dados históricos utilizados nos indicadores.

| Tabelas principais | Responsabilidade |
| --- | --- |
| `usuario` e `sessao_usuario` | Contas de acesso por perfil (`ADMIN`, `RECEPCAO`, `PROFISSIONAL`), flag de primeiro acesso e sessões ativas. |
| `paciente`, `paciente_evolucao` e `prontuario_consulta` | Cadastro de pacientes com controle de versão, evolução clínica geral e registros individuais por consulta com autoria. |
| `especialidade` e `procedimento` | Categorias de atendimento, procedimentos, duração padrão, valor e status de atividade. |
| `profissional`, `profissional_especialidade` e `profissional_procedimento` | Profissionais, vínculos e configurações individuais de duração, preço e ativação por procedimento. |
| `agendamento` e `historico_status_agendamento` | Consultas vinculadas a paciente, profissional e procedimento, validação de chegada e trilha de auditoria de status. |
| `expediente_clinica`, `jornada_profissional`, `excecao_disponibilidade` e `bloqueio_agenda` | Grade padrão da clínica, expediente semanal do profissional, intervalos, feriados, horários especiais e bloqueios. |
| `agenda_capacidade_snapshot` | Capacidade diária registrada para cálculo histórico da taxa de ocupação. |
| `comunicacao_agendamento` | Registro de envios de lembretes e confirmações com controle de tentativas e estado. |
| `sessao_chatbot`, `whatsapp_sessao_conversa` e `whatsapp_evento_processado` | Histórico de atendimentos do robô, estado conversacional, transbordo humano e idempotência de mensagens. |
| `avaliacao_atendimento` e `pagamento` | Avaliações pós-atendimento (NPS 0 a 10) e registros financeiros previstos no modelo. |
| `revisao_clinica` | Controle de revisão usado para sincronizar atualizações em tempo real. |

As views `pacientes`, `profissionais`, `servicos`, `categorias`, `agendamentos` e `bloqueios` adaptam os nomes consumidos pela API. A tabela legada `capacidade_diaria` permanece no schema por compatibilidade; o cálculo atual da ocupação utiliza `agenda_capacidade_snapshot`. O script de migração registra cada etapa concluída em `schema_migrations`.

### Regras de integridade

- Reservas e reagendamentos validam o vínculo ativo do profissional com o procedimento (`ativo_profissional = 1`), usando duração e preço individuais quando definidos.
- Toda reserva considera a duração do procedimento somada a 15 minutos de intervalo adicional.
- Transações com bloqueio de linha impedem reservas simultâneas conflitantes para o profissional ou para o paciente.
- Alterações de jornada e exceções são bloqueadas quando invalidam atendimentos pendentes. Profissionais com reservas pendentes a partir da data atual não podem ser inativados.
- Serviços inativados deixam de aparecer para novos agendamentos sem perder o histórico de consultas anteriores.
- Pacientes com agendamentos vinculados não podem ser excluídos. A edição cadastral preserva os dados clínicos não enviados e rejeita gravações com versão desatualizada.
- O pré-cadastro aceita CPF ausente. Quando informado, o CPF é validado e não pode estar duplicado. Telefones compartilhados não identificam automaticamente a mesma pessoa no autoatendimento.

## 5. Funcionamento

### Páginas e fluxos

- **`/login` e `/primeiro-acesso`:** autenticação por e-mail ou login (`nome.ultimonome`). Contas novas com senha temporária são direcionadas para `/primeiro-acesso` até definirem uma senha pessoal.
- **`/inicio`:** resumo operacional do dia para administradores (total de consultas, aguardando confirmação e próximos horários).
- **`/agendamentos`:** grade diária e semanal por profissional, criação e reagendamento de consultas, filtro de serviços por profissional, mudança de status, bloqueios de horário, reserva excepcional e atalhos para histórico e prontuário.
- **`/pacientes`:** busca paginada, formulário de cadastro/edição com busca de endereço por CEP e listagem simplificada exibindo nome do paciente e ações (prontuário, histórico de atendimentos, edição e exclusão).
- **`/servicos` e `/meus-procedimentos`:** administração de categorias, procedimentos, profissionais, expediente da clínica, jornadas e exceções; o perfil profissional gerencia sua própria lista de procedimentos com duração, valor e ativação individuais.
- **`/usuarios`:** criação e manutenção de contas pela administração, geração automática de login, credencial temporária e vínculo com profissional.
- **`/comunicacao`:** painel de conexão do WhatsApp, fila de atendimentos encaminhados para a recepção (com identificação de pacientes cadastrados e confirmação direta de agendamento), busca de atendimentos, envio de confirmações, histórico de comunicações e avaliações NPS recentes.
- **`/dashboard`:** indicadores por período e especialidade, análises detalhadas, calendário anual e atualização em tempo real.

A sessão dura até 12 horas em cookie `HttpOnly` (`SameSite=Lax`). O servidor revalida conta e perfil em cada requisição, e o logout, a desativação da conta ou a troca de senha revogam as sessões no banco.

### Perfis de acesso

- **Administrador (`ADMIN`):** acesso completo a todas as telas, gestão de usuários, configurações da clínica, envio manual de confirmações e processamento manual da fila de lembretes.
- **Recepção (`RECEPCAO`):** opera a agenda, realiza reservas, cadastra e edita pacientes (sem acesso à evolução clínica/prontuário), acompanha o painel do WhatsApp em Comunicação (atendendo transbordos humanos e confirmando agendamentos) e consulta os indicadores.
- **Profissional (`PROFISSIONAL`):** acessa a própria agenda, edita jornada e bloqueios, cria reserva excepcional em dia fechado, personaliza seus procedimentos em **Meus Procedimentos** e registra a evolução clínica e o prontuário dos pacientes vinculados aos seus atendimentos.

### Atualização automática

A API publica avisos de alteração via Server-Sent Events (`/api/eventos`). As telas conectadas atualizam automaticamente os dados afetados sem recarregar a página e sem trafegar dados pessoais nos eventos. A reconexão e o retorno à aba recuperam o estado atual.

### Comunicação e WhatsApp

O sistema oferece suporte ao modo de simulação e ao conector WhatsApp via Baileys:

- **Bot de autoatendimento:** menu com opções para agendar consulta (`1`), consultar agendamentos (`2`), confirmar presença (`3`), reagendar (`4`), responder pesquisa de satisfação NPS de 0 a 10 (`5`) e falar com a recepção (`6` ou solicitação em linguagem natural).
- **Segurança (LGPD):** as opções de autoatendimento exigem validação por CPF vinculado ao telefone, com bloqueio temporário após tentativas inválidas. Quando um paciente já cadastrado solicita atendimento humano sem informar o CPF, seu nome aparece para a equipe na tela de Comunicação, sem liberar o autoatendimento sem CPF.
- **Lembretes e confirmações:** a fila executa a cada minuto para atendimentos futuros dentro da antecedência configurada (padrão de 24 horas no fuso `America/Sao_Paulo`). Na tela de Comunicação, a equipe pode acompanhar os envios, confirmar agendamentos diretamente e marcar solicitações encaminhadas como atendidas.

### Indicadores

O dashboard consolida métricas de comparecimento, faltas, reagendamentos, taxa de ocupação, atraso registrado, retorno, ticket médio, NPS e funil de conversas do chatbot.

A capacidade diária é gravada enquanto a API está em execução. Períodos sem cobertura completa não exibem taxa de ocupação e registros passados não são recalculados com jornadas novas. Atraso não registrado e ausência de amostra são diferenciados de zero. Os indicadores do chatbot são globais e não seguem filtro por especialidade.

### Endpoints principais

| Endpoint | Finalidade |
| --- | --- |
| `GET /api/health` e `GET /health` | Verificar disponibilidade da API e do banco. |
| `POST /api/auth/login`, `POST /api/auth/primeiro-acesso/senha`, `GET /api/auth/me` e `POST /api/auth/logout` | Autenticação, definição de senha no primeiro acesso, sessão atual e logout. |
| `/api/usuarios` | Gestão administrativa de contas. |
| `/api/pacientes` e `/api/pacientes/:id/prontuario` | Cadastros, busca, histórico de consultas e prontuário clínico. |
| `/api/agendamentos` | Reservas, grade da agenda, mudanças de status, reagendamentos e auditoria. |
| `/api/servicos`, `/api/categorias`, `/api/profissionais` e `/api/profissionais/:id/procedimentos` | Catálogo de serviços, profissionais e vínculos individuais. |
| `/api/expediente-clinica`, `/api/bloqueios`, `/api/excecoes` e `/api/janelas` | Configuração de expediente e cálculo de disponibilidade. |
| `/api/comunicacoes` e `/api/comunicacoes/whatsapp/painel` | Histórico de mensagens, confirmações, status do WhatsApp, transbordos e NPS. |
| `GET /api/eventos` | Fluxo SSE de avisos de atualização. |
| `GET /api/dashboard/dados-painel` e `GET /api/dashboard/especialidades` | Dados agregados dos indicadores e filtros. |

## 6. Instalação e Execução

### Pré-requisitos

- Git.
- Node.js 24 LTS e npm.
- MySQL 8.0 ou superior em execução.
- Cliente `mysql` disponível no terminal (`mysqldump` para backups).

Os comandos abaixo partem da raiz do repositório e os exemplos de ambiente usam PowerShell.

### 1. Clonar e instalar

```powershell
git clone https://github.com/domingossss/Clinica_Ikigai.git
cd Clinica_Ikigai
npm install
```

O `npm install` instala os dois workspaces e executa `npm run build` via `postinstall`, gerando `frontend/dist/` e `backend/dist/`. A compilação não depende de conexão com o banco.

### 2. Configurar o ambiente

Copie o arquivo modelo sem sobrescrever um `.env` já existente:

```powershell
if (-not (Test-Path backend/.env)) {
    Copy-Item backend/.env.example backend/.env
}
```

Preencha `backend/.env` conforme o ambiente local (consulte `backend/.env.example` para todas as opções):

```dotenv
HOST=127.0.0.1
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_NAME=clinica_ikigai_db
DB_USER=ikigai_app
DB_PASS=SUBSTITUA_PELA_SENHA_DA_APLICACAO
DB_ADMIN_USER=root
DB_ADMIN_PASS=SUBSTITUA_PELA_SENHA_ADMINISTRATIVA
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=100
```

`DB_USER` e `DB_PASS` (ou `DB_PASSWORD`) são usados pela API. Migração, backup e testes utilizam `DB_ADMIN_USER` e `DB_ADMIN_PASS` quando definidos.

Para habilitar comunicação em simulação ou WhatsApp via Baileys, ajuste também no `backend/.env`:

```dotenv
COMUNICACAO_PROVEDOR=simulado
WHATSAPP_MODE=simulation
```

No modo Baileys, defina `WHATSAPP_MODE=baileys`, `WHATSAPP_BAILEYS_ENABLED=true`, `WHATSAPP_SEND_ENABLED=true`, `COMUNICACAO_PROVEDOR=whatsapp` e informe os números autorizados em `WHATSAPP_ALLOWED_NUMBERS` (ou `WHATSAPP_ALLOW_ANY_NUMBER=true` quando desejar atendimento aberto). Para parear o QR Code separadamente, utilize `npm run whatsapp:baileys`.

O frontend acessa a API na mesma origem. Em desenvolvimento, o Vite redireciona `/api` para `http://127.0.0.1:3000` (ajustável em `frontend/vite.config.ts`). `VITE_API_URL` é opcional.

### 3. Criar o banco em uma instalação nova

Execute com uma conta administrativa do MySQL:

```powershell
mysql --default-character-set=utf8mb4 -h localhost -P 3306 -u root -p --execute="SOURCE database/schema.sql"
```

Em seguida, crie o usuário da aplicação no MySQL:

```powershell
mysql -h localhost -P 3306 -u root -p
```

```sql
CREATE USER 'ikigai_app'@'localhost'
IDENTIFIED BY 'SUBSTITUA_PELA_SENHA_DA_APLICACAO';

GRANT SELECT, INSERT, UPDATE, DELETE
ON clinica_ikigai_db.* TO 'ikigai_app'@'localhost';

EXIT;
```

#### Dados fictícios para apresentação (opcional)

Para popular uma base demonstrativa completa (38 pacientes, agendamentos de `01/06/2026` a `30/11/2026`, avaliações NPS, sessões do bot, pendências de transbordo humano e snapshots de capacidade), execute após `schema.sql`, `seed.sql` e `npm run db:migrate`:

```powershell
npm run db:seed:apresentacao
```

O script é idempotente e não duplica registros ao ser executado novamente. Observação: `database/seed.sql` executa `TRUNCATE` e deve ser usado apenas em bancos de desenvolvimento ou demonstração.

#### Primeiro administrador

A API inicia sem criar contas padrão. Provisione o primeiro administrador pelo terminal (senha com no mínimo 12 caracteres):

```powershell
$env:ADMIN_INITIAL_EMAIL = Read-Host 'E-mail do administrador'
$senhaInicial = Read-Host 'Senha do administrador' -AsSecureString
try {
    $env:ADMIN_INITIAL_PASSWORD = [System.Net.NetworkCredential]::new('', $senhaInicial).Password
    npm run admin:provisionar
} finally {
    Remove-Item Env:ADMIN_INITIAL_PASSWORD,Env:ADMIN_INITIAL_EMAIL -ErrorAction SilentlyContinue
    $senhaInicial.Dispose()
}
```

Em produção, defina `NODE_ENV=production`, configure um `SESSION_SECRET` estável de pelo menos 32 bytes (gerado com `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`) e sirva a aplicação via HTTPS. Com proxy reverso na mesma máquina, mantenha o Express em loopback, sobrescreva `X-Forwarded-Proto` no proxy e habilite `TRUST_PROXY_LOOPBACK=true`.

### 4. Atualizar um banco existente

Com a API parada e as credenciais administrativas configuradas no `.env`:

```powershell
npm run db:backup
npm run db:migrate
```

Prossiga com a migração somente após a conclusão do backup. O migrador registra cada versão concluída em `schema_migrations` e pode ser executado novamente com segurança.

Para reservas excepcionais criadas pelo próprio profissional, a recepção ou administração valida a chegada na Agenda (**Validar chegada**), autorizando o acesso ao prontuário vinculado àquele atendimento.

### 5. Iniciar em desenvolvimento

```powershell
npm run dev
```

| Serviço | Endereço |
| --- | --- |
| Interface web | http://127.0.0.1:5173/agendamentos |
| Dashboard | http://127.0.0.1:5173/dashboard |
| Saúde da API | http://127.0.0.1:3000/api/health |

Para subir backend e frontend em terminais separados:

```powershell
npm run dev:backend
npm run dev:frontend
```

### 6. Executar a versão compilada

```powershell
npm run build
npm start
```

O Express serve a interface compilada e a API na porta `3000`:

- Agenda: http://127.0.0.1:3000/agendamentos
- Dashboard: http://127.0.0.1:3000/dashboard

### 7. Verificações e testes

```powershell
npm run lint
npm run build
npm test
```

A suíte (`npm test`) executa os testes unitários do frontend, a suíte de integração em um banco MySQL temporário descartável (criado e removido automaticamente, sem alterar o banco operacional) e os testes do módulo WhatsApp. Para rodar apenas os testes de WhatsApp, utilize `npm run test:whatsapp`.

### 8. Backup e recuperação

```powershell
npm run db:backup
```

Os arquivos concluídos são salvos em `backend/backups/` com extensão `.sql` (arquivos `.partial` indicam processo interrompido). Caso `mysqldump` não esteja no `PATH`, informe `MYSQLDUMP_PATH` no `backend/.env`:

```dotenv
MYSQLDUMP_PATH="C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqldump.exe"
```

Para validar uma restauração, importe o arquivo em um banco separado antes de apontar `DB_NAME` para ele. Não versionar backups nem arquivos `.env`.
