import { apiFetch } from '../api';
import { useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import './styles.css';
import { initDashboard } from './app.js';


export default function IndicadoresDashboard() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dashboardData, setDashboardData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // 1. Busca dados da API
  useEffect(() => {
    let ativo = true;

    async function carregarDados() {
      try {
        const response = await apiFetch(`/api/dashboard/dados-painel`);
        if (!response.ok) {
          throw new Error(`Falha ao obter dados da clínica (Status HTTP: ${response.status})`);
        }
        const data = await response.json();
        if (ativo) {
          setDashboardData(data);
          setLoading(false);
        }
      } catch (err) {
        if (ativo) {
          console.error('[Dashboard] Erro na API:', err);
          setErro(err instanceof Error ? err.message : 'Falha ao conectar com o servidor da clínica.');
          setLoading(false);
        }
      }
    }

    carregarDados();

    return () => {
      ativo = false;
    };
  }, []);

  // 2. Inicializa o dashboard assim que o DOM for montado com os dados
  useEffect(() => {
    if (!dashboardData || !containerRef.current) return;

    const cleanup = initDashboard(dashboardData, containerRef.current, Chart);

    return () => {
      if (cleanup) cleanup();
    };
  }, [dashboardData]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-gray">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm font-semibold">Carregando métricas e indicadores da Clínica Ikigai...</p>
      </div>
    );
  }

  if (erro) {
    return (
      <div className="max-w-2xl mx-auto my-12 p-6 bg-red-50 border border-red-200 rounded-2xl text-center">
        <h3 className="text-red-800 font-bold text-lg mb-2">Erro ao carregar Dashboard</h3>
        <p className="text-red-600 text-xs mb-4">{erro}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-primary text-white text-xs font-bold rounded-xl hover:bg-primary-dark transition-all cursor-pointer"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="dashboard-wrapper">
      <div className="wrap">
        <header>
          <div className="brand">
            <img className="brand-logo" src="/logo.png" alt="Logo da Clínica Ikigai" />
            <div className="brand-copy">
              <h1>Dashboard de Métricas</h1>
              <p>Clínica Ikigai · saúde integrativa com agendamento por chatbot de IA</p>
            </div>
          </div>
          <div className="ctl">
            <label>
              Período
              <select id="per" aria-label="Período" defaultValue="30">
                <option value="7">Últimos 7 dias</option>
                <option value="30">Últimos 30 dias</option>
                <option value="90">Últimos 90 dias</option>
                <option value="180">Últimos 6 meses</option>
                <option value="365">Últimos 12 meses</option>
              </select>
            </label>
            <label>
              Especialidade
              <select id="esp" aria-label="Especialidade"></select>
            </label>
          </div>
        </header>

        <p className="note">
          Dados operacionais reais calculados a partir dos agendamentos no banco de dados da clínica; respostas da pesquisa são registradas neste navegador. Cada indicador informa sua fonte. As variações comparam com o período anterior de mesmo tamanho.
        </p>

        <div id="home">
          <div id="alerta"></div>
          <h2>Visão macro: 8 painéis</h2>
          <p className="leg">
            <b>Como ler:</b> cada painel reúne indicadores com peso. A nota do painel vai de 0 a 100 (indicador verde vale 100, amarelo 50 e vermelho 0, multiplicado pelo peso). Painel verde: nota de 75 ou mais. Amarelo: de 30 a 74. Vermelho: abaixo de 30. Um painel nunca fica verde se tiver indicador vermelho. Clique em um painel para ver só os indicadores dele. As metas são provisórias; a tabela completa está no fim da página.
          </p>
          <div className="tiles" id="tiles"></div>
          <details open>
            <summary>Metas, pesos, fórmulas e fonte de cada indicador</summary>
            <div className="tb"><table id="rt"></table></div>
          </details>
        </div>

        <section id="pan" hidden>
          <button className="bk" data-back id="bk2">← Todos os painéis</button>
          <div id="ph"></div>
          <div className="kpis kp panel-kpis" id="pk"></div>
          <div className="grid panel-charts" id="px"></div>
          <div id="calblk" hidden>
            <h2>Calendário de atendimentos</h2>
            <div className="cs">
              <label>Ano<select id="cy" aria-label="Ano"></select></label>
              <label>
                Colorir por
                <select id="cm" aria-label="Colorir por" defaultValue="NC">
                  <option value="NC">Não comparecimento (%)</option>
                  <option value="C">Cancelamentos (%)</option>
                  <option value="N">No-show (%)</option>
                  <option value="R">Atendimentos realizados</option>
                  <option value="A">Agendamentos</option>
                </select>
              </label>
            </div>
            <p className="h calendar-description">
              Não comparecimento = cancelamentos + no-show, em % dos agendamentos. Segue o filtro de especialidade; o filtro de período não se aplica aqui.
            </p>
            <div className="ins" id="ci"></div>
            <div className="chips" id="cc"></div>
            <div className="grid" id="cyr"></div>
            <h3 className="month-heading">Mês a mês</h3>
            <div className="cal" id="cal"></div>
            <div id="cd"></div>
          </div>
        </section>

        <section id="det" hidden aria-live="polite">
          <button className="bk" data-back id="bk">← Voltar ao painel</button>
          <div id="dh"></div>
          <div className="chips" id="ch"></div>
          <div className="grid" id="dg"></div>
        </section>
      </div>
    </div>
  );
}
