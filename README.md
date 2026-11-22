# Clínica Ikigai

## 1. Sobre o Projeto

A Clínica Ikigai é um sistema web de gestão clínica que reúne agendamento de consultas, cadastro de pacientes, configuração de serviços e profissionais e acompanhamento de indicadores. A operação da recepção e o dashboard gerencial têm páginas independentes e compartilham a mesma API e o mesmo banco de dados.

## 2. Tecnologias e Estrutura

| Camada | Tecnologias |
| --- | --- |
| Interface | React, TypeScript, Vite, Tailwind CSS e SweetAlert2 |
| Indicadores | TypeScript e Chart.js |
| API | Node.js, Express e TypeScript |
| Banco de dados | MySQL 8.0+, InnoDB e mysql2 |
| Proteções da API | Helmet, CORS, limite de requisições e validação de entradas |
| Organização e qualidade | npm workspaces, ESLint e verificações de tipos do TypeScript |

```text
Clinica_Ikigai/
├── frontend/
│   └── src/
│       ├── components/       # Agenda, cadastros e formulários
│       ├── indicadores/      # Dashboard, gráficos e cálculos
│       └── services/         # Comunicação compartilhada de atualizações
├── backend/
│   ├── .env.example          # Modelo de configuração local
│   └── src/
│       ├── config/           # Conexões, transações e eventos
│       ├── controllers/      # Consultas do dashboard
│       ├── middleware/       # Validações e tratamento seguro de erros
│       ├── routes/           # Endpoints da operação e dos indicadores
│       ├── scripts/          # Migração e backup
│       ├── services/         # Serviços de negócio
│       ├── types/            # Tipos compartilhados do backend
│       └── utils/            # Regras auxiliares e testes existentes
├── database/
│   ├── schema.sql            # Estrutura, relacionamentos, views e gatilhos
│   ├── seed.sql              # Dados fictícios de demonstração
│   └── queries_kpis.sql      # Consultas SQL de referência
├── package.json              # Workspaces e comandos integrados
├── package-lock.json         # Versões resolvidas das dependências
└── README.md
```

O projeto utiliza uma instalação de dependências na raiz. As pastas `frontend/dist/`, `backend/dist/` e os arquivos `*.tsbuildinfo` são gerados automaticamente e não são versionados. Credenciais e backups também ficam fora do Git.

## 3. Banco de Dados

O banco padrão é `clinica_ikigai_db`, com codificação `utf8mb4`. O modelo concentra os dados operacionais e os registros utilizados pelos indicadores.

| Tabelas principais | Responsabilidade |
| --- | --- |
| `paciente` | Identificação, contato, informações clínicas e versão do cadastro para controle de edições concorrentes. |
| `especialidade` e `procedimento` | Categorias de atendimento, serviços, duração, preço e situação de atividade. |
| `profissional`, `profissional_especialidade` e `profissional_procedimento` | Profissionais e vínculos com especialidades e procedimentos habilitados. |
| `agendamento` | Consulta vinculada a paciente, profissional e procedimento, com horários, status, tipo de atendimento e observações. |
| `historico_status_agendamento` | Histórico das mudanças de situação de cada agendamento. |
| `jornada_profissional`, `excecao_disponibilidade` e `bloqueio_agenda` | Expediente semanal, intervalos, feriados, horários especiais e períodos indisponíveis. |
| `agenda_capacidade_snapshot` | Capacidade diária registrada para cálculo histórico da ocupação. |
| `avaliacao_atendimento`, `pagamento` e `sessao_chatbot` | Registros de avaliação, pagamento e sessões de conversa previstos no modelo. |

As views `pacientes`, `profissionais`, `servicos`, `categorias`, `agendamentos` e `bloqueios` adaptam os nomes utilizados pela API às tabelas do modelo. A tabela legada `capacidade_diaria` permanece no schema; o cálculo atual da ocupação utiliza `agenda_capacidade_snapshot`. O script de migração registra sua execução em `schema_migrations`.

### Regras de integridade

- Reservas e reagendamentos respeitam a habilitação do profissional, a jornada, os intervalos, as exceções e os bloqueios.
- A reserva inclui a duração do procedimento e 15 minutos de intervalo adicional.
- Transações impedem reservas simultâneas conflitantes para o profissional ou para o paciente.
- Alterações de jornada e exceções são rejeitadas quando invalidam atendimentos pendentes. Profissionais com reservas pendentes a partir da data atual não podem ser inativados.
- Serviços inativados deixam de aparecer nas opções de novos agendamentos, preservando os vínculos históricos.
- Pacientes com agendamentos vinculados não podem ser excluídos. A edição cadastral preserva informações clínicas não enviadas e rejeita versões desatualizadas.
- O pré-cadastro aceita CPF ausente. Quando informado, o CPF deve ser válido e não pode estar duplicado. Telefones compartilhados não identificam automaticamente uma mesma pessoa.
- Novos cadastros sem data de nascimento mantêm o campo nulo. Datas legadas exigem conferência antes de qualquer correção.

## 4. Funcionamento

### Páginas e fluxos

- **`/agendamentos`:** grade diária e semanal por profissional, criação e reagendamento de consultas, alteração de status e bloqueio de horários.
- **Pacientes:** cadastro completo ou rápido, busca com paginação, edição e consulta ao histórico de atendimentos.
- **Serviços e configurações:** categorias, procedimentos, profissionais, vínculos de habilitação, jornadas e exceções de disponibilidade.
- **`/dashboard`:** indicadores por período e especialidade, análises detalhadas e calendário de atendimentos.
- **`/`:** redirecionamento para a agenda.

O acesso começa em `/login`. Cada conta possui um perfil e o administrador gerencia as contas na interface. O servidor revalida a conta e o perfil em cada requisição autenticada. A sessão dura até 12 horas e o logout a revoga no banco. Desativar uma conta ou trocar sua senha revoga todas as suas sessões.

### Atualização automática

A API publica avisos por Server-Sent Events (SSE). As páginas consultam novamente os recursos afetados após alterações concluídas, inclusive entre abas conectadas à mesma instância da API, sem recarregar a página. Os avisos não transportam dados de pacientes.

A reconexão e o retorno à aba recuperam os dados atuais. Alterações realizadas diretamente no MySQL não emitem eventos. O mecanismo atual atende uma única instância da API.

### Indicadores

O dashboard acompanha não comparecimento, reagendamento, ocupação, atraso, retorno, ticket médio, satisfação e métricas de sessões do chatbot, conforme os registros disponíveis. A existência de tabelas de apoio não representa uma integração externa ativa de WhatsApp ou chatbot.

A capacidade diária é registrada enquanto a API está em execução. Períodos sem cobertura completa não exibem taxa de ocupação; dados anteriores não são recalculados com jornadas novas. Atraso não registrado e ausência de amostra são apresentados separadamente de valores iguais a zero. Indicadores do chatbot são globais e não seguem o filtro de especialidade.

### Endpoints principais

| Endpoint | Finalidade |
| --- | --- |
| `GET /api/health` e `GET /health` | Verificar a disponibilidade da API e do banco. |
| `POST /api/auth/login`, `GET /api/auth/me` e `POST /api/auth/logout` | Abrir, consultar e encerrar a sessão com cookie HttpOnly. |
| `/api/usuarios` | Listar, criar, editar e ativar ou desativar contas, com acesso administrativo. |
| `/api/pacientes` | Cadastros, busca e histórico dos pacientes. |
| `/api/agendamentos` | Reservas, consultas da agenda e mudanças de situação. |
| `/api/servicos`, `/api/categorias` e `/api/profissionais` | Configuração de atendimentos e profissionais. |
| `/api/bloqueios`, `/api/excecoes` e `/api/janelas` | Disponibilidade da agenda. |
| `GET /api/eventos` | Fluxo de avisos de atualização. |
| `GET /api/dashboard/dados-painel` e `GET /api/dashboard/especialidades` | Dados dos indicadores e filtros. |

## 5. Instalação e Execução

### Pré-requisitos

- Git.
- Node.js 24 LTS e npm.
- MySQL 8.0 ou superior em execução.
- Cliente `mysql` disponível no terminal; `mysqldump` é necessário para backups.

Os comandos abaixo são executados a partir da raiz do repositório. Os exemplos de configuração de arquivos utilizam PowerShell.

### 1. Clonar e instalar

```powershell
git clone https://github.com/domingossss/Clinica_Ikigai.git
cd Clinica_Ikigai
npm install
```

O `npm install` instala os dois workspaces e executa `npm run build` por meio do `postinstall`, gerando as duas pastas `dist`. A compilação não precisa de conexão com o banco. Dependências de desenvolvimento são necessárias nessa etapa; `--ignore-scripts` desativa a compilação automática.

### 2. Configurar o ambiente

Na primeira configuração, copie o modelo sem substituir um arquivo local existente:

```powershell
if (-not (Test-Path backend/.env)) {
    Copy-Item backend/.env.example backend/.env
}
```

Edite `backend/.env` com as credenciais da máquina:

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

`DB_USER` e `DB_PASS` são usados pela API. Migração, backup e testes utilizam `DB_ADMIN_USER` e `DB_ADMIN_PASS` quando configurados; caso contrário, utilizam as credenciais da aplicação. `DB_PASSWORD` é aceito como alternativa a `DB_PASS`.

O frontend utiliza a API no mesmo endereço do site. Em desenvolvimento, o Vite encaminha `/api` para `http://127.0.0.1:3000`. Se a porta da API mudar, ajuste também o destino em `frontend/vite.config.ts`. `VITE_API_URL` é opcional para configurações com API externa e exige alinhamento das origens permitidas e da política de conteúdo.

### 3. Criar o banco em uma instalação nova

Execute com uma conta administrativa do MySQL. A senha será solicitada pelo cliente:

```powershell
mysql --default-character-set=utf8mb4 -h localhost -P 3306 -u root -p --execute="SOURCE database/schema.sql"
```

O script cria o banco `clinica_ikigai_db`, suas tabelas, views e gatilhos. Para utilizar outro nome, ajuste o `CREATE DATABASE`, o `USE` do script e `DB_NAME` antes da criação.

Crie a conta de operação pelo cliente MySQL:

```powershell
mysql -h localhost -P 3306 -u root -p
```

No console SQL, substitua a senha abaixo pela mesma definida em `DB_PASS`. Os comandos pressupõem uma conta ainda inexistente:

```sql
CREATE USER 'ikigai_app'@'localhost'
IDENTIFIED BY 'SUBSTITUA_PELA_SENHA_DA_APLICACAO';

GRANT SELECT, INSERT, UPDATE, DELETE
ON clinica_ikigai_db.* TO 'ikigai_app'@'localhost';

EXIT;
```

A instalação inicial não exige dados fictícios. Cadastre categorias, serviços e profissionais pela aplicação e configure os vínculos e jornadas antes de agendar.

#### Primeiro administrador

Após criar ou migrar o banco, provisione a primeira conta pelo terminal local. A API inicia sem criar contas automaticamente. No PowerShell, informe o e-mail e uma senha exclusiva de pelo menos 12 caracteres. O comando recusa bancos que já possuem usuários.

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

Em produção, configure `NODE_ENV=production` e um `SESSION_SECRET` aleatório e estável de pelo menos 32 bytes no ambiente protegido do serviço. Gere um valor com `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Sirva a aplicação via HTTPS. Para um proxy reverso na mesma máquina, mantenha o Express em loopback, configure o proxy para sobrescrever `X-Forwarded-Proto` e habilite `TRUST_PROXY_LOOPBACK=true`. O cookie usa `HttpOnly`, `SameSite=Lax`, caminho `/` e `Secure` em produção. O cliente web utiliza o cookie de sessão. Clientes da API devem guardar o cookie de login e enviá-lo nas chamadas seguintes.

Ao atualizar uma instalação anterior, os usuários existentes são preservados e precisam entrar novamente. Se a instalação criou o administrador com a senha padrão da versão anterior, altere a senha em Gestão de usuários antes de disponibilizar o serviço. Para recuperar o banco anterior, restaure o backup feito antes da migração em um banco separado e use a versão correspondente da aplicação.

**Dados de demonstração:** `database/seed.sql` contém operações `TRUNCATE` que apagam registros existentes. Seu uso é exclusivo de bancos descartáveis de desenvolvimento. Ele não faz parte da instalação operacional.

### 4. Atualizar um banco existente

Para um banco criado por uma versão anterior, configure as credenciais administrativas, interrompa a API e execute:

```powershell
npm run db:backup
npm run db:migrate
```

Prossiga com a migração somente após a conclusão do backup. O comando `db:migrate` atualiza um banco já existente; não substitui a criação inicial com `schema.sql`. A instalação de dependências não executa migrações nem cargas de dados.

### 5. Iniciar em desenvolvimento

```powershell
npm run dev
```

O comando inicia a API e o frontend com acompanhamento das alterações no código.

| Serviço | Endereço |
| --- | --- |
| Agenda | http://127.0.0.1:5173/agendamentos |
| Dashboard | http://127.0.0.1:5173/dashboard |
| Saúde da API | http://127.0.0.1:3000/api/health |

Para iniciar cada parte separadamente, use terminais distintos:

```powershell
npm run dev:backend
```

```powershell
npm run dev:frontend
```

### 6. Executar a versão compilada

A primeira compilação já ocorre durante `npm install`:

```powershell
npm start
```

O Express entrega o site e a API na porta 3000:

- Agenda: http://127.0.0.1:3000/agendamentos
- Dashboard: http://127.0.0.1:3000/dashboard

Após modificar o código, atualize a versão compilada antes de iniciá-la novamente:

```powershell
npm run build
npm start
```

### Comunicação com pacientes em simulação

Administradores acessam `/comunicacao` ou abrem as mensagens a partir do atendimento. A confirmação usa o WhatsApp cadastrado para o paciente. Cada tentativa identifica o atendimento, o horário a que se refere e o resultado. Apenas uma falha definitiva permite solicitar nova tentativa. Uma submissão com resultado incerto fica disponível para conferência.

Após a migração, configure `COMUNICACAO_PROVEDOR=simulado` em um ambiente de teste e reinicie o servidor. O simulador não envia mensagens a pacientes. Use `COMUNICACAO_SIMULAR_RESULTADO` para exercitar os resultados `submetida`, `entregue`, `rejeitada` e `timeout`. Deixe o provedor vazio para desabilitar o envio.

A clínica usa uma antecedência de 24 horas (1440 minutos), no fuso `America/Sao_Paulo`. A cada minuto o servidor seleciona atendimentos futuros agendados, confirmados e reagendados que entraram na janela. O horário atual do atendimento identifica a ocorrência. Alterar o horário pode gerar um lembrete para a nova ocorrência quando ela se tornar elegível. Tentativas pendentes são reavaliadas após o reinício.

### Verificações do projeto

```powershell
npm run lint
npm run build
npm test
```

Os testes criam um banco temporário isolado, aplicam o schema e dados fictícios e removem esse banco ao terminar. A conta utilizada precisa de permissões para criar e remover bancos, tabelas e gatilhos de teste. A suíte principal não usa o banco operacional para gravar seus cenários.

### Backup e recuperação

```powershell
npm run db:backup
```

O backup utiliza `mysqldump`, inclui gatilhos e rotinas e grava arquivos em `backend/backups/`. Somente arquivos concluídos recebem a extensão `.sql`; arquivos `.partial` não são backups válidos. Caso o executável não esteja no `PATH`, configure `MYSQLDUMP_PATH` no `.env`:

```dotenv
MYSQLDUMP_PATH="C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqldump.exe"
```

Mantenha uma cópia protegida fora da máquina. Para recuperar dados, interrompa a API, importe o backup em um banco de recuperação e confira registros e vínculos antes de alterar `DB_NAME`. Não valide restaurações sobrescrevendo o banco operacional. Backups e arquivos `.env` contêm informações privadas e não devem ser enviados ao repositório.

### Perfis e comunicação

O administrador abre o resumo do dia em `/inicio` e tem acesso a todas as telas. A recepção abre a agenda, realiza reservas, gerencia cadastros de pacientes e consulta os indicadores. O profissional vinculado pode editar a jornada, os bloqueios e o status dos atendimentos da própria agenda e registrar a evolução clínica de pacientes. O administrador pode vincular uma conta profissional a um cadastro existente ou criar o cadastro em Gestão de Usuários. O botão **Reserva excepcional** permite ao profissional selecionar um paciente existente e confirmar uma reserva na própria agenda em dia fechado. A reserva respeita jornada individual, pausas, bloqueios e ocupações.

Em **Serviços e Configurações → Exceções**, o administrador configura o expediente semanal da clínica. Até configurar um dia da semana, a disponibilidade segue a jornada individual e as exceções da data.

A área **Comunicação** fica disponível ao administrador, inclusive pelo detalhe do atendimento. Para testes locais com dados fictícios, configure `COMUNICACAO_PROVEDOR=simulado`. A simulação distingue submissão, entrega, rejeição e resultado incerto. O simulador usa a regra de 24 horas da clínica. O WhatsApp externo aguarda homologação.
