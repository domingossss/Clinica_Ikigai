# Clínica Ikigai · Painel de Inteligência Operacional & Agendamento

Este repositório contém a arquitetura completa do painel de operações clínicas da **Clínica Ikigai**, totalmente refatorado com **Clean Code**, **TypeScript como linguagem principal** em todas as camadas e banco de dados relacional **MySQL 8.0 normalizado (3FN)**.

---

## 🏗️ Arquitetura do Repositório

O projeto adota separação estrita de responsabilidades:

```
trabalho/
├── database/                    # Scripts SQL para o MySQL Workbench
│   ├── schema.sql               # DDL normalizado (3FN, chaves, índices, constraints)
│   ├── seed.sql                 # Dados fictícios realistas para testes
│   └── queries_kpis.sql         # Consultas SQL analíticas de alta performance
│
├── backend/                     # API REST em TypeScript (Node.js + Express)
│   ├── src/
│   │   ├── config/database.ts   # Pool de conexões MySQL com mysql2/promise
│   │   ├── controllers/         # Regras de negócio e agregação de dados
│   │   ├── routes/              # Endpoints REST (/api/dashboard/...)
│   │   ├── types/               # Tipagens e interfaces do banco
│   │   └── server.ts            # Ponto de entrada do servidor HTTP
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example             # Modelo seguro de variáveis de ambiente
│
├── frontend/                    # Aplicação Web Modular (TypeScript + CSS puro)
│   ├── index.html               # Marcação semântica limpa (SEM CSS/JS inline)
│   ├── src/
│   │   ├── styles/              # CSS modular (variables.css, layout.css, components.css)
│   │   ├── types/               # Interfaces e contratos de dados
│   │   ├── services/            # Cliente de API REST assíncrono
│   │   ├── utils/               # Formatadores (moeda, percentual, datas)
│   │   ├── core/                # Motores de cálculo (métricas, semáforo, regras de veto)
│   │   ├── components/          # Componentes visuais isolados (alertas, macros, calendário, drill-down)
│   │   └── main.ts              # Orquestrador da aplicação e listeners
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
├── .gitignore                   # Proteção contra envio de node_modules e .env
└── package.json                 # Scripts raiz para execução ágil
```

---

## 🚀 Como Executar o Projeto Localmente

### 1. Pré-requisitos
* **Node.js** v18+ instalado.
* **MySQL Server** 8.0+ em execução local.
* **Git** instalado.

---

### 2. Configurar o Banco de Dados (MySQL Workbench)
1. Abra o **MySQL Workbench** e conecte-se ao servidor local.
2. Abra e execute o script `database/schema.sql` (cria o schema `clinica_ikigai_db` e as 11 tabelas).
3. Abra e execute o script `database/seed.sql` (popula o banco com agendamentos de teste).

---

### 3. Configurar e Iniciar o Backend (TypeScript)
No terminal:
```powershell
cd backend
npm.cmd install
cp .env.example .env
```
Edite o arquivo `.env` com a sua senha do MySQL:
```env
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=sua_senha_aqui
DB_NAME=clinica_ikigai_db
```
Inicie o servidor em modo de desenvolvimento (com recarga automática):
```powershell
npm.cmd run dev
```
O servidor estará ativo em: `http://localhost:3000`.

---

### 4. Iniciar o Frontend (TypeScript + Vite)
Em outro terminal:
```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```
O Vite iniciará o painel e abrirá automaticamente no navegador em: `http://localhost:5173`.

---

## 💎 Padrões de Clean Code Aplicados

1. **Nomes Intencionais e Significativos:**
   * Todas as variáveis enigmáticas do código original (`c`, `p`, `A`, `AP`, `M`, `L`, `Rl`, `C`, `N`, `Mm`, `cp`, `bn`, `res`, `conv`) foram substituídas por nomes legíveis no domínio da clínica (`appointments`, `completedAppointments`, `rescheduledAppointments`, `occupancyRate`, `npsScore`, etc.).
2. **Princípio da Responsabilidade Única (SRP):**
   * Cada arquivo possui uma responsabilidade clara e isolada:
     * `metricsEngine.ts`: exclusivamente cálculos matemáticos e agregações.
     * `trafficLight.ts`: regras de corte do semáforo, pesos e regra de veto.
     * `calendarComponent.ts`: geração da matriz anual e calendários operacionais.
     * `drilldownView.ts`: geração dos gráficos analíticos do Chart.js.
     * `apiService.ts`: comunicação HTTP externa.
3. **Tipagem Estrita (Strict TypeScript):**
   * Tipos e interfaces definidos para cada modelo de dados, evitando uso de `any` e prevenindo bugs em tempo de compilação.
4. **Isolamento de Estilos:**
   * Zero código CSS misturado ao HTML ou JavaScript. Estilos 100% componentizados em arquivos `.css` dedicados com suporte nativo a temas claro e escuro via variáveis CSS.

---

## 🌿 Fluxo de Contribuição Git para a Equipe

1. **Clone o repositório:**
   ```bash
   git clone <URL_DO_REPOSITORIO>
   cd trabalho
   ```
2. **Crie uma branch para sua funcionalidade:**
   ```bash
   git checkout -b feature/nome-da-funcionalidade
   ```
3. **Faça commits atômicos e descritivos:**
   ```bash
   git commit -m "feat(calendar): adiciona filtro de visualização por período"
   ```
4. **Envie para o repositório remoto:**
   ```bash
   git push origin feature/nome-da-funcionalidade
   ```
