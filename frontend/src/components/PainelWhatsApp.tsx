import { useCallback, useEffect, useRef, useState } from 'react';
import Swal from 'sweetalert2';
import { apiFetch, lerJsonSeguro } from '../api';
import { useClinicUpdates } from '../services/clinicUpdates';

type StatusConexao =
  | 'disabled'
  | 'connecting'
  | 'awaiting_qr'
  | 'connected'
  | 'reconnecting'
  | 'logged_out'
  | 'stopped';

interface ConexaoWhatsApp {
  status: StatusConexao;
  mode: string;
  enabled: boolean;
  sendEnabled: boolean;
  allowAnyNumber?: boolean;
  sessionRecovered: boolean;
  reconnectAttempts: number;
  allowedNumbersCount: number;
  provedorAtivo: string | null;
  prontoParaEnvio: boolean;
}

interface TransbordoSessao {
  id_sessao: number;
  identificador_chat: string;
  data_hora_inicio: string;
  data_hora_fim: string | null;
  status_sessao: string;
  escalonado_humano: number;
  pendente: boolean;
  etapa: string | null;
  intencao_atual: string | null;
  paciente_uuid: string | null;
  paciente_nome: string | null;
  contato_final: string | null;
  motivo: string;
}

interface AgendamentoEscalonado {
  id: number;
  paciente: string;
  contato_final: string | null;
  ocorrencia: string;
  status: string;
  profissional: string | null;
  procedimento: string | null;
}

interface ComunicacaoItem {
  id: number;
  id_agendamento: number;
  paciente: string;
  ocorrencia: string;
  tipo: 'LEMBRETE' | 'CONFIRMACAO';
  canal: string;
  estado: 'PENDENTE' | 'SUBMETIDA' | 'ENTREGUE' | 'FALHA' | 'INCERTA';
  provedor: string;
  tentativa: number;
  erro: string | null;
  referencia_externa: string | null;
  criado_em: string;
  status_agendamento: string;
  profissional: string | null;
  procedimento: string | null;
}

interface AvaliacaoRecente {
  id_avaliacao: number;
  id_agendamento: number;
  nota_nps: number;
  comentario: string | null;
  data_resposta: string;
  paciente: string;
  procedimento: string | null;
  profissional: string | null;
}

interface DadosPainelWhatsApp {
  conexao: ConexaoWhatsApp;
  transbordos: TransbordoSessao[];
  agendamentosEscalonados: AgendamentoEscalonado[];
  comunicacoes: ComunicacaoItem[];
  avaliacoesRecentes: AvaliacaoRecente[];
  resumo: {
    transbordosPendentes: number;
    transbordosTotal: number;
    agendamentosEscalonadosTotal: number;
    comunicacoesTotal: number;
    comunicacoesEntregues: number;
    comunicacoesSubmetidas: number;
    comunicacoesFalhas: number;
    avaliacoesTotal: number;
    mediaNpsRecente: number | null;
  };
}

const statusConexaoConfig: Record<StatusConexao, { rotulo: string; classe: string; ponto: string }> = {
  connected: { rotulo: 'Conectado', classe: 'bg-emerald-50 text-emerald-800 border-emerald-200', ponto: 'bg-emerald-500' },
  awaiting_qr: { rotulo: 'Aguardando QR Code', classe: 'bg-amber-50 text-amber-800 border-amber-200', ponto: 'bg-amber-500' },
  connecting: { rotulo: 'Conectando…', classe: 'bg-sky-50 text-sky-800 border-sky-200', ponto: 'bg-sky-500' },
  reconnecting: { rotulo: 'Reconectando…', classe: 'bg-amber-50 text-amber-800 border-amber-200', ponto: 'bg-amber-500' },
  logged_out: { rotulo: 'Sessão desconectada (reparear)', classe: 'bg-red-50 text-red-800 border-red-200', ponto: 'bg-red-500' },
  stopped: { rotulo: 'Parado', classe: 'bg-gray/10 text-dark border-gray/20', ponto: 'bg-gray' },
  disabled: { rotulo: 'Desabilitado / Modo Simulação', classe: 'bg-secondary-light text-primary-dark border-secondary/30', ponto: 'bg-secondary' }
};

const rotulosEstadoCom: Record<ComunicacaoItem['estado'], string> = {
  PENDENTE: 'Pendente',
  SUBMETIDA: 'Enviada ao canal',
  ENTREGUE: 'Confirmada / Entregue',
  FALHA: 'Falha',
  INCERTA: 'Sem confirmação'
};

function formatarDataHora(valor: string | null) {
  if (!valor) return '—';
  const [data, hora] = valor.split(' ');
  if (!data) return valor;
  const br = data.split('-').reverse().join('/');
  return hora ? `${br} às ${hora.slice(0, 5)}` : br;
}

export default function PainelWhatsApp({
  isAdmin = false,
  compacto = false,
  onTransbordosPendentesChange,
  onNotify
}: {
  isAdmin?: boolean;
  compacto?: boolean;
  onTransbordosPendentesChange?: (quantidade: number) => void;
  onNotify?: (message: string, type?: 'success' | 'error' | 'info') => void;
}) {
  const [dados, setDados] = useState<DadosPainelWhatsApp | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [filtroTransbordo, setFiltroTransbordo] = useState<'pendentes' | 'todos'>('pendentes');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [resolvendoId, setResolvendoId] = useState<number | null>(null);
  const [processandoFila, setProcessandoFila] = useState(false);

  const consultaRef = useRef<AbortController | null>(null);

  const carregar = useCallback(async () => {
    consultaRef.current?.abort();
    const controller = new AbortController();
    consultaRef.current = controller;
    try {
      const qs = new URLSearchParams();
      if (filtroEstado) qs.set('estado', filtroEstado);
      if (filtroTipo) qs.set('tipo', filtroTipo);
      const sufixo = qs.toString() ? `?${qs}` : '';
      const resposta = await apiFetch('/api/comunicacoes/whatsapp/painel' + sufixo, {
        signal: controller.signal,
      });
      const json = await lerJsonSeguro<{ sucesso?: boolean; erro?: string; dados?: DadosPainelWhatsApp }>(resposta);
      if (controller.signal.aborted) return;
      if (!resposta.ok || !json?.sucesso || !json.dados) {
        throw new Error(json?.erro || 'Não foi possível carregar o painel do WhatsApp.');
      }
      setDados(json.dados);
      setErro('');
      onTransbordosPendentesChange?.(json.dados.resumo.transbordosPendentes);
    } catch (e) {
      if (controller.signal.aborted) return;
      setErro(e instanceof Error ? e.message : 'Erro ao consultar o painel do WhatsApp.');
    } finally {
      if (!controller.signal.aborted) {
        setCarregando(false);
      }
    }
  }, [filtroEstado, filtroTipo, onTransbordosPendentesChange]);

  useEffect(() => {
    const inicio = window.setTimeout(() => { void carregar(); }, 0);
    const timer = window.setInterval(() => { void carregar(); }, 30000);
    return () => {
      window.clearTimeout(inicio);
      window.clearInterval(timer);
      consultaRef.current?.abort();
    };
  }, [carregar]);

  useClinicUpdates(carregar, ['comunicacoes', 'agendamentos']);

  async function resolverTransbordo(idSessao: number) {
    const confirmacao = await Swal.fire({
      icon: 'question',
      titleText: 'Marcar atendimento como concluído?',
      text: `Confirme que a recepção já atendeu a solicitação da sessão #${idSessao}.`,
      showCancelButton: true,
      confirmButtonText: 'Marcar como atendido',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#0f766e',
    });
    if (!confirmacao.isConfirmed) return;

    setResolvendoId(idSessao);
    try {
      const resposta = await apiFetch(`/api/comunicacoes/whatsapp/transbordos/${idSessao}/resolver`, {
        method: 'PATCH'
      });
      const json = await lerJsonSeguro<{ sucesso?: boolean; erro?: string }>(resposta);
      if (!resposta.ok || !json?.sucesso) {
        throw new Error(json?.erro || 'Não foi possível encerrar o atendimento.');
      }
      onNotify?.(`Atendimento humano #${idSessao} marcado como atendido.`, 'success');
      await carregar();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao atualizar atendimento.';
      setErro(msg);
      onNotify?.(msg, 'error');
    } finally {
      setResolvendoId(null);
    }
  }

  async function processarLembretesAgora() {
    setProcessandoFila(true);
    try {
      const resposta = await apiFetch('/api/comunicacoes/whatsapp/processar-lembretes', {
        method: 'POST'
      });
      const json = await lerJsonSeguro<{
        sucesso?: boolean;
        erro?: string;
        dados?: { motivo?: string; lembretesEnfileirados?: number };
      }>(resposta);
      if (!resposta.ok || !json?.sucesso || !json.dados) {
        throw new Error(json?.erro || 'Não foi possível processar a fila de lembretes.');
      }
      const res = json.dados;
      const msg =
        res.motivo === 'provedor_desabilitado'
          ? 'Canal de envio desabilitado na configuração.'
          : res.motivo === 'provedor_nao_pronto'
            ? 'WhatsApp não está conectado com envio ativo no momento.'
            : `Fila processada: ${res.lembretesEnfileirados ?? 0} lembrete(s) disparado(s).`;
      onNotify?.(msg, res.motivo === 'ok' ? 'success' : 'info');
      await carregar();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao processar lembretes.';
      onNotify?.(msg, 'error');
    } finally {
      setProcessandoFila(false);
    }
  }

  const conexao = dados?.conexao;
  const stVisual = conexao ? statusConexaoConfig[conexao.status] : statusConexaoConfig.disabled;
  const transbordosFiltrados = (dados?.transbordos || []).filter(t =>
    filtroTransbordo === 'pendentes' ? t.pendente : true
  );

  return (
    <div className="space-y-6">
      {/* Cabeçalho e Status da Conexão WhatsApp */}
      <section className="rounded-2xl border border-gray/10 bg-white p-5 shadow-premium sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-xl font-bold text-primary">Central WhatsApp &amp; Automação</h2>
              {conexao && (
                <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold ${stVisual.classe}`}>
                  <span className={`h-2 w-2 rounded-full ${stVisual.ponto}`} />
                  {stVisual.rotulo}
                </span>
              )}
            </div>
            <p className="text-xs text-gray">
              Monitoramento de conexão, atendimentos aguardando a recepção, lembretes automáticos e confirmações de pacientes.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && (
              <button
                type="button"
                disabled={processandoFila}
                onClick={() => void processarLembretesAgora()}
                className="rounded-xl border border-primary/25 bg-primary/5 px-3.5 py-2 text-xs font-bold text-primary hover:bg-primary/10 disabled:opacity-50 cursor-pointer"
              >
                {processandoFila ? 'Processando fila…' : 'Processar lembretes agora'}
              </button>
            )}
            <button
              type="button"
              onClick={() => void carregar()}
              className="rounded-xl border border-gray/20 px-3.5 py-2 text-xs font-bold text-dark hover:bg-light-gray cursor-pointer"
            >
              Atualizar
            </button>
          </div>
        </div>

        {erro && (
          <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
            {erro}
          </p>
        )}

        {dados && conexao && conexao.enabled && conexao.allowAnyNumber === false && conexao.allowedNumbersCount === 0 && (
          <p role="status" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-900">
            Atenção: o WhatsApp está ativado, mas nenhum número está autorizado para conversar com o robô de atendimento no momento. Enquanto a lista de números autorizados estiver vazia (e o atendimento aberto desativado), mensagens recebidas não serão processadas nem encaminhadas para Pendentes.
          </p>
        )}

        {carregando && !dados ? (
          <p role="status" className="mt-4 text-sm text-gray">Consultando status do WhatsApp…</p>
        ) : dados && conexao && (
          <>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-gray/10 bg-light-gray/60 p-4">
                <p className="text-xs font-semibold text-gray">Canal de Comunicação</p>
                <p className="mt-1 text-base font-bold text-dark">
                  {conexao.provedorAtivo === 'whatsapp'
                    ? 'WhatsApp (Ativo)'
                    : conexao.provedorAtivo === 'simulado'
                      ? 'Simulação (Teste)'
                      : 'Desabilitado'}
                </p>
                <p className="mt-0.5 text-[11px] text-gray">
                  Envio automático: <strong>{conexao.sendEnabled ? 'Liberado' : 'Pausado'}</strong>
                </p>
              </div>

              <div className={`rounded-xl border p-4 ${dados.resumo.transbordosPendentes > 0 ? 'border-amber-300 bg-amber-50/70' : 'border-gray/10 bg-light-gray/60'}`}>
                <p className="text-xs font-semibold text-gray">Aguardando Recepção</p>
                <p className={`mt-1 text-2xl font-extrabold ${dados.resumo.transbordosPendentes > 0 ? 'text-amber-800' : 'text-primary'}`}>
                  {dados.resumo.transbordosPendentes}
                </p>
                <p className="mt-0.5 text-[11px] text-gray">
                  Total encaminhado: {dados.resumo.transbordosTotal} conversa(s)
                </p>
              </div>

              <div className="rounded-xl border border-gray/10 bg-light-gray/60 p-4">
                <p className="text-xs font-semibold text-gray">Comunicações Registradas</p>
                <p className="mt-1 text-2xl font-extrabold text-primary">{dados.resumo.comunicacoesTotal}</p>
                <p className="mt-0.5 text-[11px] text-gray">
                  {dados.resumo.comunicacoesEntregues} confirmadas · {dados.resumo.comunicacoesSubmetidas} enviadas · {dados.resumo.comunicacoesFalhas} falhas
                </p>
              </div>

              <div className="rounded-xl border border-gray/10 bg-light-gray/60 p-4">
                <p className="text-xs font-semibold text-gray">NPS Recente (Pós-Atendimento)</p>
                <p className="mt-1 text-2xl font-extrabold text-primary">
                  {dados.resumo.mediaNpsRecente !== null ? `${dados.resumo.mediaNpsRecente}/10` : '—'}
                </p>
                <p className="mt-0.5 text-[11px] text-gray">
                  {dados.resumo.avaliacoesTotal} avaliação(ões) recente(s)
                </p>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Fila de Atendimentos com Transbordo Humano (escalonado_humano = 1) */}
      {dados && (
        <section className="rounded-2xl border border-gray/10 bg-white p-5 shadow-premium sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-primary">Atendimentos Encaminhados para a Recepção</h3>
              <p className="text-xs text-gray">
                Conversas em que o paciente solicitou falar diretamente com a recepção.
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-xl border border-gray/15 bg-light-gray p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setFiltroTransbordo('pendentes')}
                className={`rounded-lg px-3 py-1.5 cursor-pointer ${filtroTransbordo === 'pendentes' ? 'bg-white text-primary shadow-sm font-bold' : 'text-gray hover:text-dark'}`}
              >
                Pendentes ({dados.resumo.transbordosPendentes})
              </button>
              <button
                type="button"
                onClick={() => setFiltroTransbordo('todos')}
                className={`rounded-lg px-3 py-1.5 cursor-pointer ${filtroTransbordo === 'todos' ? 'bg-white text-primary shadow-sm font-bold' : 'text-gray hover:text-dark'}`}
              >
                Todos ({dados.resumo.transbordosTotal})
              </button>
            </div>
          </div>

          {transbordosFiltrados.length === 0 ? (
            <p className="mt-4 rounded-xl bg-light-gray p-4 text-sm text-gray">
              {filtroTransbordo === 'pendentes'
                ? 'Nenhum atendimento aguardando recepção humana no momento.'
                : 'Nenhum registro de transbordo humano encontrado.'}
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-gray/10">
              {transbordosFiltrados.map(item => (
                <li key={item.id_sessao} className="flex flex-wrap items-center justify-between gap-4 py-3.5">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm text-dark">
                        {item.paciente_nome || 'Paciente ainda não identificado'}
                      </strong>
                      <span className="text-xs text-gray">Sessão #{item.id_sessao}</span>
                      {item.contato_final && (
                        <span className="rounded-md bg-light-gray px-2 py-0.5 text-xs font-semibold text-dark">
                          WhatsApp final {item.contato_final}
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                          item.pendente
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-emerald-50 text-emerald-800'
                        }`}
                      >
                        {item.pendente ? 'Aguardando recepção' : 'Atendido'}
                      </span>
                    </div>
                    <p className="text-xs text-gray">
                      {item.motivo} · Iniciado em {formatarDataHora(item.data_hora_inicio)}
                      {item.data_hora_fim ? ` · Encerrado em ${formatarDataHora(item.data_hora_fim)}` : ''}
                    </p>
                  </div>
                  {item.pendente && (
                    <button
                      type="button"
                      disabled={resolvendoId === item.id_sessao}
                      onClick={() => void resolverTransbordo(item.id_sessao)}
                      className="rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-primary-dark disabled:opacity-50 cursor-pointer"
                    >
                      {resolvendoId === item.id_sessao ? 'Salvando…' : 'Marcar como atendido'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {dados.agendamentosEscalonados.length > 0 && (
            <div className="mt-5 border-t border-gray/10 pt-4">
              <h4 className="text-sm font-bold text-dark">Agendamentos marcados para suporte humano</h4>
              <ul className="mt-2 divide-y divide-gray/10">
                {dados.agendamentosEscalonados.map(ag => (
                  <li key={ag.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs">
                    <div>
                      <strong className="text-primary">{ag.paciente} · #{ag.id}</strong>
                      <span className="ml-2 text-gray">
                        {formatarDataHora(ag.ocorrencia)} · {ag.procedimento || 'Procedimento'} ({ag.profissional || 'Profissional'})
                      </span>
                    </div>
                    <span className="rounded-full bg-secondary-light px-2.5 py-0.5 font-semibold text-primary-dark">
                      {ag.status}{ag.contato_final ? ` · Final ${ag.contato_final}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Histórico de Comunicações Enviadas (exibido completo no modo aba Recepção/Admin) */}
      {dados && !compacto && (
        <section className="rounded-2xl border border-gray/10 bg-white p-5 shadow-premium sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-primary">Histórico de Comunicações Enviadas</h3>
              <p className="text-xs text-gray">Lembretes automáticos, solicitações de confirmação e respostas registradas.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Filtrar tipo de comunicação"
                value={filtroTipo}
                onChange={e => setFiltroTipo(e.target.value)}
                className="rounded-xl border border-gray/25 bg-white px-3 py-1.5 text-xs font-semibold text-dark"
              >
                <option value="">Todos os tipos</option>
                <option value="LEMBRETE">Lembretes</option>
                <option value="CONFIRMACAO">Confirmações</option>
              </select>
              <select
                aria-label="Filtrar estado da comunicação"
                value={filtroEstado}
                onChange={e => setFiltroEstado(e.target.value)}
                className="rounded-xl border border-gray/25 bg-white px-3 py-1.5 text-xs font-semibold text-dark"
              >
                <option value="">Todos os estados</option>
                {Object.entries(rotulosEstadoCom).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>

          {dados.comunicacoes.length === 0 ? (
            <p className="mt-4 rounded-xl bg-light-gray p-4 text-sm text-gray">
              Nenhuma comunicação encontrada para os filtros selecionados.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-gray/10">
              {dados.comunicacoes.map(m => (
                <li key={m.id} className="flex flex-wrap items-start justify-between gap-3 py-3.5">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm text-primary">
                        {m.paciente} · Atendimento #{m.id_agendamento}
                      </strong>
                      <span className="rounded-md bg-light-gray px-2 py-0.5 text-[11px] font-bold text-dark">
                        {m.tipo === 'LEMBRETE' ? 'Lembrete' : 'Confirmação'}
                      </span>
                      <span className="text-xs text-gray">
                        Status agenda: <strong>{m.status_agendamento}</strong>
                      </span>
                    </div>
                    <p className="text-xs text-dark">
                      {formatarDataHora(m.ocorrencia)}
                      {m.procedimento ? ` · ${m.procedimento}` : ''}
                      {m.profissional ? ` · ${m.profissional}` : ''}
                    </p>
                    <p className="text-[11px] text-gray">
                      Tentativa {m.tentativa} via {m.canal === 'WHATSAPP' ? 'WhatsApp' : m.canal} em {new Date(m.criado_em).toLocaleString('pt-BR')}
                    </p>
                    {m.erro && <p className="text-xs font-medium text-red-700">{m.erro}</p>}
                  </div>
                  <span
                    className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                      m.estado === 'FALHA'
                        ? 'bg-red-50 text-red-800'
                        : m.estado === 'ENTREGUE'
                          ? 'bg-emerald-50 text-emerald-800'
                          : 'bg-secondary-light text-primary-dark'
                    }`}
                  >
                    {rotulosEstadoCom[m.estado]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Últimas Avaliações NPS coletadas */}
      {dados && dados.avaliacoesRecentes.length > 0 && (
        <section className="rounded-2xl border border-gray/10 bg-white p-5 shadow-premium sm:p-6">
          <h3 className="text-lg font-bold text-primary">Avaliações NPS Recentes</h3>
          <p className="text-xs text-gray">Respostas coletadas após o atendimento e refletidas nos indicadores da clínica.</p>
          <ul className="mt-4 divide-y divide-gray/10">
            {dados.avaliacoesRecentes.map(av => (
              <li key={av.id_avaliacao} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="space-y-0.5">
                  <strong className="text-sm text-dark">{av.paciente} · #{av.id_agendamento}</strong>
                  <p className="text-xs text-gray">
                    {av.procedimento || 'Atendimento'}{av.profissional ? ` · ${av.profissional}` : ''} · {formatarDataHora(av.data_resposta)}
                  </p>
                  {av.comentario && <p className="text-xs italic text-dark">“{av.comentario}”</p>}
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-extrabold ${
                    av.nota_nps >= 9
                      ? 'bg-emerald-50 text-emerald-800'
                      : av.nota_nps >= 7
                        ? 'bg-amber-50 text-amber-800'
                        : 'bg-red-50 text-red-800'
                  }`}
                >
                  NPS {av.nota_nps}/10
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

