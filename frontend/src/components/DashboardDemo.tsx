import { apiFetch } from '../api';
import { useClinicUpdates } from '../services/clinicUpdates';
import { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import ServicosAgendamentos from './ServicosAgendamentos';
import CadastroPacientes from './CadastroPacientes';
import ModalAgendamentoRapido, { type PacienteItem } from './ModalAgendamentoRapido';
import GradeAgenda from './GradeAgenda';
import GestaoUsuarios from './GestaoUsuarios';
import Inicio from './Inicio';
import Comunicacoes from './Comunicacoes';
import MeusProcedimentosProfissional from './MeusProcedimentosProfissional';
import { PERFIL_LABELS, type UsuarioSessao } from '../services/auth';

const IndicadoresDashboard = lazy(() => import('../indicadores/main'));

// Tipagem de dados para o frontend
interface Servico {
  id: number;
  categoria_id: number;
  categoria_nome: string;
  nome: string;
  duracao_minutos: number;
  ativo?: number | boolean;
}

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

// Configuração do Base URL do Backend (Express)

interface Profissional {
  id: number;
  nome: string;
  especialidade?: string;
  ativo?: number | boolean;
}


function dataHoje(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

type AbaAgenda = 'inicio' | 'grade' | 'cadastro' | 'procedimentos' | 'servicos' | 'usuarios' | 'comunicacao' | 'indicadores';

const ROTA_POR_ABA: Record<AbaAgenda, string> = {
  inicio: '/inicio',
  grade: '/agendamentos',
  cadastro: '/pacientes',
  procedimentos: '/procedimentos',
  servicos: '/servicos',
  usuarios: '/usuarios',
  comunicacao: '/comunicacao',
  indicadores: '/indicadores',
};

interface Props {
  usuario: UsuarioSessao;
  onLogout: () => void;
  rota: string;
  buscaUrl: string;
  onNavegar: (endereco: string) => void;
}

export default function DashboardDemo({ usuario, onLogout, rota, buscaUrl, onNavegar }: Props) {
  const currentTab = rota === '/dashboard' ? 'indicadores' :
    (Object.keys(ROTA_POR_ABA) as AbaAgenda[]).find(aba => ROTA_POR_ABA[aba] === rota) ?? 'grade';

  const selecionarAba = (aba: AbaAgenda) => onNavegar(ROTA_POR_ABA[aba]);

  // Controle de data e atualização da Grade
  const [gradeData, setGradeData] = useState<string>(dataHoje());
  const [gradeRefreshKey, setGradeRefreshKey] = useState<number>(0);
  const [gradeProfissionalSelecionadoId, setGradeProfissionalSelecionadoId] = useState<number | null>(() =>
    usuario?.perfil === 'PROFISSIONAL' && usuario.profissional_id ? Number(usuario.profissional_id) : null
  );

  // Estados dinâmicos conectados à API
  const [pacientes, setPacientes] = useState<PacienteItem[]>([]);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [profissionais, setProfissionais] = useState<Profissional[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);

  // Estados para o Modal de Novo Agendamento
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [bookingInitialPacienteId, setBookingInitialPacienteId] = useState<string | undefined>(undefined);
  const [bookingInitialData, setBookingInitialData] = useState<string | undefined>(undefined);
  const [bookingInitialHorario, setBookingInitialHorario] = useState<string | undefined>(undefined);
  const [bookingInitialProfissionalId, setBookingInitialProfissionalId] = useState<number | undefined>(undefined);

  // Sistema de Toasts/Notificações
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  };

  // Carregar dados da API
  const consulta = useRef<AbortController | null>(null);
  const fetchDashboardData = useCallback(() => {
    consulta.current?.abort();
    const controller = new AbortController();
    consulta.current = controller;
    return Promise.all(
        ['pacientes', 'servicos', 'profissionais'].map(async recurso => {
          const response = await apiFetch('/api/' + recurso, { signal: controller.signal });
          const json = await response.json();
          if (!response.ok || !json.sucesso || !Array.isArray(json.dados)) throw new Error(json.erro || 'Falha ao carregar ' + recurso + '.');
          return json.dados;
        })
      ).then(([listaPacientes, listaServicos, listaProfissionais]) => {
      if (controller.signal.aborted) return;
      setApiError(null);
      setPacientes(listaPacientes.map((p: { id: string; nome_completo: string; whatsapp?: string; telefone?: string; cpf?: string }) => ({
        id: p.id, nome: p.nome_completo, nome_completo: p.nome_completo,
        whatsapp: p.whatsapp || p.telefone, telefone: p.telefone, cpf: p.cpf
      })));
      setServicos(listaServicos);
      setProfissionais(listaProfissionais);
      setGradeProfissionalSelecionadoId(prev => prev !== null && !listaProfissionais.some((p: Profissional) => p.id === prev && p.ativo !== 0 && p.ativo !== false) ? null : prev);
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setApiError(error instanceof Error ? error.message : 'Falha na comunicação com o servidor.');
    });
  }, []);

  useEffect(() => {
    void fetchDashboardData();
    return () => consulta.current?.abort();
  }, [fetchDashboardData]);

  useClinicUpdates(() => { void fetchDashboardData(); }, ['pacientes', 'servicos', 'categorias', 'profissionais']);

  // Abrir agendamento a partir de slot clicado na grade
  const handleAbrirAgendamentoDaGrade = (params: {
    data: string;
    horario_inicio: string;
    profissional_id: number;
  }) => {
    setBookingInitialPacienteId(undefined);
    setBookingInitialData(params.data);
    setBookingInitialHorario(params.horario_inicio);
    setBookingInitialProfissionalId(params.profissional_id);
    setIsBookingModalOpen(true);
  };

  // Abrir agendamento a partir de um paciente específico (ex.: direto do histórico)
  const handleAbrirAgendamentoParaPaciente = (pacienteId: string) => {
    setBookingInitialPacienteId(pacienteId);
    setBookingInitialData(dataHoje());
    setBookingInitialHorario(undefined);
    setBookingInitialProfissionalId(undefined);
    setIsBookingModalOpen(true);
  };

  // Abrir agenda específica do profissional vindo da aba Serviços/Profissionais
  const handleAbrirAgendaDoProfissional = (profId: number) => {
    setGradeProfissionalSelecionadoId(profId);
    selecionarAba('grade');
    showToast('Agenda do profissional aberta com sucesso!', 'info');
  };

  return (
    <div className="min-h-screen bg-light-gray text-dark font-sans transition-colors duration-300">
      
      {/* Toast Notification Container */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-3 max-w-sm w-full">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`p-4 rounded-2xl shadow-premium border flex items-start gap-3 backdrop-blur-md animate-in slide-in-from-right duration-300 ${
              toast.type === 'success' ? 'bg-primary/10 border-primary/30 text-primary-dark' :
              toast.type === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-700' :
              'bg-white/95 border-gray/10 text-dark'
            }`}
          >
            <span className="text-sm font-bold">
              {toast.type === 'success' && '✓'}
              {toast.type === 'error' && '!'}
              {toast.type === 'info' && 'i'}
            </span>
            <p className="text-xs font-semibold leading-relaxed">{toast.message}</p>
          </div>
        ))}
      </div>

      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray/10 shadow-sm backdrop-blur-md bg-white/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 min-h-16 py-3 flex flex-wrap gap-3 items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="Clínica Ikigai Logo"
              className="h-11 w-11 rounded-full object-cover shadow-sm border border-secondary/30 transform hover:scale-105 transition-transform duration-300"
            />
            <div>
              <h1 className="text-lg font-bold tracking-tight text-dark flex items-center gap-2">
                Clínica Ikigai
                <span className="text-[11px] bg-secondary/15 text-primary-dark font-semibold px-2 py-0.5 rounded-full border border-secondary/30">
                  {usuario
                    ? usuario.perfil === 'PROFISSIONAL'
                      ? `Profissional • ${usuario.profissional_nome || usuario.nome}`
                      : PERFIL_LABELS[usuario.perfil]
                    : 'Recepção'}
                </span>
              </h1>
              <p className="text-xs text-gray">
                {usuario?.perfil === 'PROFISSIONAL' && usuario.profissional_especialidade
                  ? `Modo Consultório • ${usuario.profissional_especialidade}`
                  : 'Sistema de Gestão da Clínica'}
              </p>
            </div>
          </div>

          {/* Menu de Abas Padronizado */}
          <nav
            aria-label="Navegação principal"
            className="flex flex-wrap items-center gap-1 bg-light-gray p-1 rounded-xl border border-gray/10"
          >
            {usuario?.perfil === 'ADMIN' && (
              <button
                onClick={() => selecionarAba('inicio')}
                aria-current={currentTab === 'inicio' ? 'page' : undefined}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  currentTab === 'inicio'
                    ? 'bg-white text-primary font-extrabold shadow-sm'
                    : 'text-gray hover:text-dark hover:bg-white/50'
                }`}
              >
                Início
              </button>
            )}
            <button
              onClick={() => selecionarAba('grade')}
              aria-current={currentTab === 'grade' ? 'page' : undefined}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                currentTab === 'grade'
                  ? 'bg-white text-primary font-extrabold shadow-sm'
                  : 'text-gray hover:text-dark hover:bg-white/50'
              }`}
            >
              {usuario?.perfil === 'PROFISSIONAL' ? 'Minha Agenda' : 'Grade de Horários'}
            </button>
            {usuario && (
              <button
                onClick={() => selecionarAba('cadastro')}
                aria-current={currentTab === 'cadastro' ? 'page' : undefined}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer capitalize ${
                  currentTab === 'cadastro'
                    ? 'bg-white text-primary font-extrabold shadow-sm'
                    : 'text-gray hover:text-dark hover:bg-white/50'
                }`}
              >
                {usuario?.perfil === 'PROFISSIONAL' ? 'Meus Pacientes' : 'Pacientes'}
              </button>
            )}
            {usuario?.perfil === 'PROFISSIONAL' && (
              <button
                onClick={() => selecionarAba('procedimentos')}
                aria-current={currentTab === 'procedimentos' ? 'page' : undefined}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  currentTab === 'procedimentos'
                    ? 'bg-white text-primary font-extrabold shadow-sm'
                    : 'text-gray hover:text-dark hover:bg-white/50'
                }`}
              >
                Meus Procedimentos
              </button>
            )}
            {usuario?.perfil === 'ADMIN' && (
              <button
                onClick={() => selecionarAba('servicos')}
                aria-current={currentTab === 'servicos' ? 'page' : undefined}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  currentTab === 'servicos'
                    ? 'bg-white text-primary font-extrabold shadow-sm'
                    : 'text-gray hover:text-dark hover:bg-white/50'
                }`}
              >
                Serviços e Configurações
              </button>
            )}
            {usuario?.perfil === 'ADMIN' && (
              <button
                onClick={() => selecionarAba('usuarios')}
                aria-current={currentTab === 'usuarios' ? 'page' : undefined}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  currentTab === 'usuarios'
                    ? 'bg-white text-primary font-extrabold shadow-sm'
                    : 'text-gray hover:text-dark hover:bg-white/50'
                }`}
              >
                Usuários
              </button>
            )}
            {usuario?.perfil === 'ADMIN' && (
              <button
                onClick={() => selecionarAba('comunicacao')}
                aria-current={currentTab === 'comunicacao' ? 'page' : undefined}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  currentTab === 'comunicacao'
                    ? 'bg-white text-primary font-extrabold shadow-sm'
                    : 'text-gray hover:text-dark hover:bg-white/50'
                }`}
              >
                Comunicação
              </button>
            )}
            {usuario?.perfil !== 'PROFISSIONAL' && (
              <button
                onClick={() => selecionarAba('indicadores')}
                aria-current={currentTab === 'indicadores' ? 'page' : undefined}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  currentTab === 'indicadores'
                    ? 'bg-white text-primary font-extrabold shadow-sm'
                    : 'text-gray hover:text-dark hover:bg-white/50'
                }`}
              >
                Indicadores
              </button>
            )}
          </nav>

          <div className="flex items-center gap-3">
            {usuario && (usuario.perfil !== 'PROFISSIONAL' || usuario.profissional_id) && (
              <button
                disabled={Boolean(apiError)}
                onClick={() => setIsBookingModalOpen(true)}
                className="bg-primary hover:bg-primary-dark text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-md shadow-primary/10 hover:shadow-primary/25 active:scale-95 transition-all duration-150 flex items-center gap-1.5 cursor-pointer"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
                {usuario?.perfil === 'PROFISSIONAL' ? 'Reserva excepcional' : 'Novo Agendamento'}
              </button>
            )}
            {usuario && onLogout && (
              <button
                type="button"
                onClick={onLogout}
                title={usuario.email}
                className="px-3 py-2 rounded-xl border border-gray/25 text-xs font-bold text-dark hover:bg-light-gray transition-colors cursor-pointer"
              >
                Sair
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Banner de Erro da API */}
        {apiError && (
          <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-xl flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-3">
              <span className="text-red-500 text-sm font-bold">[Aviso]</span>
              <p className="text-sm text-red-700 font-semibold">{apiError}</p>
            </div>
            <button 
              onClick={() => {
                if (apiError.toLowerCase().includes('sessão') || apiError.toLowerCase().includes('autenticação')) {
                  onLogout?.();
                } else {
                  void fetchDashboardData();
                }
              }}
              className="bg-red-500 hover:bg-red-600 active:scale-95 text-white text-xs font-bold py-1.5 px-3 rounded-lg transition-all"
            >
              Tentar Novamente
            </button>
          </div>
        )}

        {/* Áreas do sistema integrado */}
        {currentTab === 'inicio' && usuario?.perfil === 'ADMIN' && (
          <Inicio onAbrirAgenda={() => selecionarAba('grade')} />
        )}

        {currentTab === 'grade' && (
          <GradeAgenda
            admin={usuario?.perfil === 'ADMIN'}
            profissionais={profissionais.filter(p => p.ativo !== 0 && p.ativo !== false)}
            dataSelecionada={gradeData}
            onDataChange={setGradeData}
            refreshTrigger={gradeRefreshKey}
            profissionalInicialId={gradeProfissionalSelecionadoId}
            onProfissionalChange={setGradeProfissionalSelecionadoId}
            onAbrirNovoAgendamento={usuario?.perfil === 'PROFISSIONAL' ? undefined : handleAbrirAgendamentoDaGrade}
            usuarioLogado={usuario}
            onAbrirComunicacao={onNavegar}
            onRefresh={() => {
              fetchDashboardData();
              setGradeRefreshKey(prev => prev + 1);
            }}
          />
        )}

        {currentTab === 'cadastro' && (
          <CadastroPacientes
            onNovoAgendamento={usuario?.perfil !== 'PROFISSIONAL' ? handleAbrirAgendamentoParaPaciente : undefined}
            usuarioLogado={usuario}
          />
        )}

        {currentTab === 'procedimentos' && usuario?.perfil === 'PROFISSIONAL' && (
          <MeusProcedimentosProfissional
            usuario={usuario}
            onUpdated={fetchDashboardData}
            onNotify={showToast}
          />
        )}

        {currentTab === 'usuarios' && usuario?.perfil === 'ADMIN' && (
          <GestaoUsuarios
            usuarioLogadoId={usuario.id}
            onNotify={showToast}
            onProfissionaisChange={fetchDashboardData}
          />
        )}

        {currentTab === 'servicos' && usuario?.perfil === 'ADMIN' && (
          <ServicosAgendamentos
            onProfissionaisAtualizados={fetchDashboardData}
            onStatusServicoAlterado={atualizado => {
              setServicos(prev => prev.map(servico => servico.id === atualizado.id ? { ...servico, ativo: atualizado.ativo } : servico));
            }}
            onAbrirAgendaProfissional={handleAbrirAgendaDoProfissional}
            isAdmin={true}
          />
        )}

        {currentTab === 'comunicacao' && usuario?.perfil === 'ADMIN' && (
          <Comunicacoes buscaUrl={buscaUrl} onNavegar={onNavegar} />
        )}

        {currentTab === 'indicadores' && usuario?.perfil !== 'PROFISSIONAL' && (
          <Suspense fallback={<p role="status">Carregando indicadores…</p>}>
            <IndicadoresDashboard />
          </Suspense>
        )}
      </main>

      {/* Modal de Agendamento Rápido com Pré-Cadastro e Cálculo de Tempo */}
      <ModalAgendamentoRapido
        admin={usuario?.perfil === 'ADMIN'}
        excepcional={usuario?.perfil === 'PROFISSIONAL'}
        isOpen={isBookingModalOpen}
        onClose={() => {
          setIsBookingModalOpen(false);
          setBookingInitialPacienteId(undefined);
          setBookingInitialData(undefined);
          setBookingInitialHorario(undefined);
          setBookingInitialProfissionalId(undefined);
        }}
        onSuccess={(dadosAgendamento) => {
          fetchDashboardData();
          if (dadosAgendamento?.data) {
            setGradeData(dadosAgendamento.data);
          }
          setGradeRefreshKey(prev => prev + 1);
          selecionarAba('grade');
          showToast('Agendamento realizado e adicionado à Grade de Horários!', 'success');
        }}
        initialPacienteId={bookingInitialPacienteId}
        initialDate={bookingInitialData}
        initialTime={bookingInitialHorario}
        initialProfissionalId={usuario?.perfil === 'PROFISSIONAL' ? usuario.profissional_id ?? undefined : bookingInitialProfissionalId}
        profissionais={profissionais.filter(p => p.ativo !== 0 && p.ativo !== false)}
        servicos={servicos.filter(s => s.ativo !== 0 && s.ativo !== false)}
        pacientesExistentes={pacientes}
        onPacienteCadastrado={(novoP) => {
          setPacientes(prev => [novoP, ...prev]);
        }}
      />

    </div>
  );
}
