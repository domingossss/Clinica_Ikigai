readme = r'''# Clínica Ikigai
Repositório contém a arquitetura com duas aplicações relacionadas à operação da Clínica Ikigai:

1. **Agendamentos Ikigai** — interface React para agenda, pacientes e serviços, com API própria e integração prevista/implementada para fluxos de atendimento e WhatsApp.
2. **Dashboard Clínica Ikigai** — painel para análise de indicadores (KPIs), calendário operacional, visão macro e detalhamento, alimentado por uma API que consulta o MySQL.

> **Importante:** as duas aplicações são projetos independentes dentro do mesmo repositório. Cada uma possui seu próprio frontend, backend, dependências e configuração. Não existe, na raiz do repositório, um `package.json` único que inicialize tudo.

---

## 1. Visão geral da arquitetura

```text
Clinica_Ikigai/
├── README.md
├── LICENSE
│
├── agendamentos-ikigai/
│   ├── backend/                    # API REST: Node.js + Express + TypeScript
│   │   ├── src/
│   │   │   ├── config/             # Conexão com MySQL
│   │   │   ├── middleware/         # Segurança, CORS e limitação de requisições
│   │   │   ├── routes/             # Rotas de agendamentos
│   │   │   ├── services/           # Agente/fluxo de atendimento via WhatsApp
│   │   │   ├── utils/              # Validação e scripts auxiliares de teste
│   │   │   └── server.ts           # Inicialização da API
│   │   ├── update_profissionais.cjs
│   │   ├── .env.example
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── frontend/                   # SPA: React + TypeScript + Vite
│       ├── public/                 # Logos, ícones e favicon
│       ├── src/
│       │   ├── assets/             # Imagens e recursos estáticos
│       │   ├── components/         # Agenda, cadastro, serviços e modais
│       │   ├── App.tsx
│       │   ├── App.css
│       │   ├── index.css
│       │   └── main.tsx
│       ├── index.html
│       ├── package.json
│       └── vite.config.ts
│
└── dashboard-clinica_ikigai/
    ├── backend/                    # API REST: Node.js + Express + TypeScript
    │   ├── src/
    │   │   ├── config/             # Pool de conexões MySQL
    │   │   ├── controllers/        # Consultas e transformação dos dados
    │   │   ├── routes/             # Endpoints do dashboard
    │   │   ├── types/              # Tipos das linhas do banco
    │   │   └── server.ts           # Inicialização da API
    │   ├── .env.example
    │   ├── package.json
    │   └── tsconfig.json
    │
    ├── frontend/                   # SPA: TypeScript + Vite (sem React)
    │   ├── src/
    │   │   ├── components/         # Alertas, cartões, calendário e drill-down
    │   │   ├── core/               # Cálculo de métricas, KPIs e semáforo
    │   │   ├── services/           # Cliente HTTP da API
    │   │   ├── styles/             # Tokens, layout e componentes CSS
    │   │   ├── types/              # Contratos e interfaces
    │   │   ├── utils/              # Datas e formatação
    │   │   └── main.ts             # Orquestração da interface
    │   ├── index.html
    │   ├── package.json
    │   └── vite.config.ts
    │
    └── package.json                # Scripts auxiliares do dashboard
```

---

## 2. Arquitetura e responsabilidades

### 2.1 Agendamentos Ikigai

**Frontend**

Aplicação React 19 com TypeScript e Vite. O componente `App.tsx` monta o `DashboardDemo`, que organiza a experiência principal. Os componentes identificados incluem:

- `GradeAgenda.tsx`: consulta e apresenta a agenda diária, permite navegar por datas e acompanhar a evolução do status dos agendamentos.
- `CadastroPacientes.tsx`: interface de cadastro de pacientes.
- `ModalAgendamentoRapido.tsx`: fluxo de criação rápida de agendamentos.
- `ServicosAgendamentos.tsx`: interface relacionada aos serviços.
- `DashboardDemo.tsx`: composição da tela principal.

A URL base da API no componente de agenda pode ser configurada pela variável `VITE_API_URL`. O valor padrão no código é `http://localhost:3000`.

**Backend**

API Express em TypeScript. A estrutura separa configuração de banco, middleware de segurança, rotas, serviços e utilitários.

- `src/server.ts`: inicializa o servidor HTTP e registra middlewares/rotas.
- `src/config/database.ts`: configuração de acesso ao MySQL.
- `src/routes/agendamentos.ts`: endpoints relacionados a agendamentos.
- `src/middleware/security.ts`: configurações de segurança da API.
- `src/services/whatsappAgent.ts`: lógica do agente de atendimento, incluindo identificação de intenção e encaminhamento para atendimento humano.
- `src/utils/validation.ts`: validações reutilizáveis.
- `src/utils/test-*.ts`: rotinas auxiliares de teste.

O backend usa Express, `mysql2`, `dotenv`, `cors`, `helmet` e `express-rate-limit`.

### 2.2 Dashboard Clínica Ikigai

**Frontend**

Aplicação TypeScript sem framework de componentes, compilada e servida pelo Vite. O ponto de entrada é `src/main.ts`.

- `core/metricsEngine.ts`: filtra os agendamentos e calcula métricas do período, especialidades, ocupação, atrasos, satisfação e indicadores do chatbot.
- `core/kpiDefinitions.ts`: catálogo dos 11 indicadores e suas regras de apresentação.
- `core/trafficLight.ts`: metas, classificação verde/amarelo/vermelho, pontuação das quatro macroáreas e regra de veto.
- `components/alertBanner.ts`: banner de alerta.
- `components/macroCards.ts`: cartões das macroáreas.
- `components/informativeCards.ts`: indicadores informativos e tabela de regras.
- `components/calendarComponent.ts`: calendário operacional.
- `components/drilldownView.ts`: detalhamento de indicadores.
- `services/apiService.ts`: comunicação HTTP e conversão do contrato da API para os tipos internos.
- `styles/`: folhas CSS separadas para variáveis, layout e componentes.

As quatro macroáreas são **Perdas de agenda**, **Uso da agenda**, **Paciente e financeiro** e **Chatbot de IA**. O semáforo utiliza metas configuradas no código e impede que uma macroárea fique verde quando algum de seus indicadores estiver vermelho.

**Backend**

API Express que consulta o MySQL e disponibiliza dados agregados/normalizados para o painel.

- `src/server.ts`: middlewares, health check, registro das rotas e tratamento de erros.
- `src/routes/dashboardRoutes.ts`: rotas do dashboard.
- `src/controllers/dashboardController.ts`: consultas de especialidades, agendamentos e sessões abandonadas; converte os registros para o formato compacto consumido pelo frontend.
- `src/config/database.ts`: pool de conexões MySQL.
- `src/types/index.ts`: tipos relacionados aos registros do banco.

Endpoints:

| Método | Endpoint | Finalidade |
|---|---|---|
| `GET` | `/api/health` | Verifica se a API está ativa. |
| `GET` | `/api/dashboard/dados-painel` | Retorna especialidades, agendamentos e abandonos do chatbot. |
| `GET` | `/api/dashboard/especialidades` | Lista especialidades ativas. |

O endpoint `dados-painel` retorna um objeto com três propriedades: `SP` (especialidades), `D` (agendamentos em formato compacto) e `AB` (contagem diária de sessões abandonadas).

---

## 3. Tecnologias utilizadas

| Camada | Agendamentos | Dashboard |
|---|---|---|
| Linguagem | TypeScript | TypeScript |
| Frontend | React 19 + Vite 8 | TypeScript + Vite 8 |
| Estilos | CSS, Tailwind/PostCSS configurados | CSS modular próprio |
| Backend | Node.js + Express 4 | Node.js + Express 4 |
| Banco | MySQL (`mysql2`) | MySQL (`mysql2`) |
| Segurança | Helmet, CORS e rate limit (dependências/configuração no backend) | CORS e tratamento centralizado de erros |
| Execução TS | `tsc` | `tsx watch` no desenvolvimento |

As versões exatas e scripts disponíveis devem ser conferidos nos `package.json` de cada aplicação.

---

## 4. Pré-requisitos

- Node.js e npm instalados.
- MySQL Server.
- Git (para clonar/versionar o projeto).
- Um banco `clinica_ikigai_db` com as tabelas esperadas pelas consultas.

---

## 5. Configuração e execução

### 5.1 Agendamentos Ikigai

Abra dois terminais.

**Backend**

```bash
cd agendamentos-ikigai/backend
npm install
```

Crie o arquivo `.env` a partir do exemplo:

```bash
# macOS/Linux
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

Configure as variáveis conforme o ambiente local:

```env
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASS=sua_senha
DB_NAME=clinica_ikigai_db
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=100
```

Inicie a API:

```bash
npm run dev
```

**Frontend**

```bash
cd agendamentos-ikigai/frontend
npm install
```

Opcionalmente, crie `.env` para apontar para outra URL:

```env
VITE_API_URL=http://localhost:3000
```

Inicie o Vite:

```bash
npm run dev
```

O Vite normalmente informa no terminal a URL local, frequentemente `http://localhost:5173`.

### 5.2 Dashboard Clínica Ikigai

**Backend**

```bash
cd dashboard-clinica_ikigai/backend
npm install
```

Crie o `.env`:

```bash
# macOS/Linux
cp .env.example .env

# Windows PowerShell
Copy-Item .env.example .env
```

Exemplo de configuração:

```env
PORT=3001
NODE_ENV=development
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=sua_senha
DB_NAME=clinica_ikigai_db
DB_CONNECTION_LIMIT=10
```

Compile e inicie a API:

```bash
npm run dev
```

O script `dev` do backend do dashboard usa `tsx watch` para executar `src/server.ts`. A API fica, por padrão, na porta `3001`.

Teste o health check:

```text
http://localhost:3001/api/health
```

**Frontend**

```bash
cd dashboard-clinica_ikigai/frontend
npm install
npm run dev
```

O Vite exibirá o endereço local no terminal. O cliente HTTP do dashboard usa, por padrão, `http://localhost:3001/api`.

### 5.3 Scripts do pacote do dashboard

Na pasta `dashboard-clinica_ikigai/` há scripts auxiliares para instalar dependências e executar/buildar os dois módulos:

```bash
npm run install:all
npm run dev:backend
npm run dev:frontend
npm run build
```

**Observação de compatibilidade:** esses scripts usam `npm.cmd`, formato voltado ao Windows. Em macOS/Linux, execute `npm install`, `npm run dev` e `npm run build` diretamente dentro das pastas de backend e frontend.

---

## 6. Fluxo de dados do Dashboard

```text
MySQL
  │
  ├── especialidade / procedimento
  ├── agendamento / paciente
  ├── avaliacao_atendimento
  └── sessao_chatbot
        │
        ▼
API Dashboard (Express)
  │  GET /api/dashboard/dados-painel
  │  Consulta, relaciona e normaliza os registros
  ▼
ApiService (frontend)
  │  Converte o formato compacto para interfaces TypeScript
  ▼
ClinicDashboardApp
  │
  ├── filtros de período, especialidade e calendário
  ├── metricsEngine
  ├── kpiDefinitions
  ├── trafficLight
  └── componentes visuais e drill-down
        │
        ▼
Painel de indicadores operacionais
```

O backend do dashboard realiza consultas SQL para obter especialidades, agendamentos e sessões de chatbot abandonadas. O frontend recebe os dados por HTTP e calcula/organiza os indicadores para exibição.

---

## 7. Modelo de dados esperado pelo Dashboard

Pelo controller, o banco precisa disponibilizar pelo menos as seguintes tabelas e campos utilizados:

- `especialidade`: `id_especialidade`, `nome`, `ativo`.
- `procedimento`: `id_procedimento`, `id_especialidade`, `preco_base`.
- `agendamento`: `id_agendamento`, `data_hora_agendamento`, `id_procedimento`, `id_paciente`, `status`, `minutos_atraso`, `valor_cobrado`, `modalidade_pagamento`, `tipo_atendimento`, `origem`, `escalonado_humano`.
- `paciente`: `id_paciente`, `data_nascimento`, `sexo`.
- `avaliacao_atendimento`: `id_agendamento`, `nota_nps`.
- `sessao_chatbot`: `data_hora_inicio`, `status_sessao`.

Esses campos foram identificados nas queries existentes; não substituem um script oficial de criação do banco. Confira se os nomes, tipos e valores de status correspondem ao banco utilizado no ambiente.

---

## 8. Configuração, portas e integração

| Serviço | Porta padrão | Configuração |
|---|---:|---|
| Frontend de agendamentos (Vite) | `5173` | `VITE_API_URL` |
| Backend de agendamentos | `3000` | `PORT`, `DB_*`, CORS e rate limit |
| Frontend do dashboard (Vite) | `5173` (se executado separadamente) | Vite |
| Backend do dashboard | `3001` | `PORT`, `DB_*` |

Os dois frontends usam a porta padrão do Vite e não devem ser iniciados simultaneamente no mesmo endereço/porta sem alterar a configuração de um deles. Se o Vite detectar uma porta ocupada, poderá sugerir outra.

**Não confunda as variáveis de senha:** no exemplo do backend de agendamentos está `DB_PASS`; no backend do dashboard está `DB_PASSWORD`. Use o nome esperado pelo arquivo `config/database.ts` de cada aplicação.

---

## 9. Testes e qualidade

No backend de agendamentos existe um script:

```bash
cd agendamentos-ikigai/backend
npm test
```

Ele compila o TypeScript e executa `src/utils/test-runner.ts`. Também há scripts auxiliares individuais de teste para disponibilidade e pacientes.

No frontend de agendamentos:

```bash
cd agendamentos-ikigai/frontend
npm run lint
npm run build
```

No backend do dashboard:

```bash
cd dashboard-clinica_ikigai/backend
npm run build
```

No frontend do dashboard:

```bash
cd dashboard-clinica_ikigai/frontend
npm run build
```

---

## 10. Segurança e boas práticas

- Não versione arquivos `.env`, credenciais, tokens ou dados reais de pacientes.
- Use `.env.example` apenas como modelo, sem senhas reais.
- Restrinja CORS às origens efetivamente utilizadas no ambiente.
- Mantenha Helmet e rate limiting habilitados no backend de agendamentos.
- Não utilize dados pessoais reais em testes ou demonstrações sem autorização e controles adequados.
- Em produção, configure HTTPS, logs sem dados sensíveis, backups e gestão segura de credenciais.
- Valide os dados recebidos pela API no servidor; validações do frontend não substituem validações do backend.

---

## 11. Pontos de atenção identificados na análise

1. **São dois sistemas separados:** `agendamentos-ikigai` e `dashboard-clinica_ikigai` têm dependências, APIs e frontends próprios.
2. **Portas diferentes:** agendamentos usa `3000` por padrão; dashboard usa `3001`. O `ApiService` do dashboard já aponta para `http://localhost:3001/api`.
3. **Variável de senha divergente:** os exemplos usam `DB_PASS` e `DB_PASSWORD` em aplicações diferentes. Verifique a leitura correspondente em cada `config/database.ts`.
4. **Banco não incluído:** não foram encontrados scripts SQL no pacote enviado. O banco precisa ser providenciado separadamente.
5. **Mensagem de erro desatualizada no dashboard:** o `main.ts` menciona backend na porta `3000`, mas o backend e o `ApiService` estão configurados por padrão para `3001`. Se a mensagem continuar assim no código, atualize-a para evitar diagnóstico incorreto.
6. **Scripts raiz do dashboard são Windows-específicos:** usam `npm.cmd`; em outros sistemas operacionais, execute os comandos nas pastas de cada módulo.
7. **Configuração CORS do dashboard:** o servidor atual chama `cors()` sem restringir origens. Antes de publicar, configure uma lista explícita de origens permitidas.
8. **Contrato e schema precisam ser alinhados:** o dashboard depende de nomes específicos de tabelas, colunas e valores de status descritos acima. Confirme-os com o banco real.

---

## 12. Fluxo Git sugerido

```bash
git checkout -b feature/nome-da-funcionalidade
git add .
git commit -m "feat: descreve a alteração"
git push origin feature/nome-da-funcionalidade
```

Use commits pequenos e mensagens que indiquem claramente o objetivo da mudança.

---
