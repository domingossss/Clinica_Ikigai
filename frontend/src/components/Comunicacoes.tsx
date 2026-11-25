import { type FormEvent, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api';
import PainelWhatsApp from './PainelWhatsApp';

const rotulos = {
  PENDENTE: 'Pendente', SUBMETIDA: 'Submetida ao provedor', ENTREGUE: 'Entrega confirmada',
  FALHA: 'Falha', INCERTA: 'Submissão sem confirmação',
};
type Estado = keyof typeof rotulos;
type Atendimento = { id: number; paciente: string; ocorrencia: string; status: string; contatoFinal: string | null };
type ResultadoBusca = Omit<Atendimento, 'contatoFinal'> & { profissional: string; procedimento: string };
type Busca = { dados: ResultadoBusca[]; temMais: boolean };
type Mensagem = {
  id: number; id_agendamento: number; paciente: string; ocorrencia: string; tipo: 'LEMBRETE' | 'CONFIRMACAO';
  canal: string; ultima_tentativa: 0 | 1; criado_em: string; estado: Estado; tentativa: number; erro: string | null; provedor: string;
};
type Consulta = { atendimento: Atendimento | null; dados: Mensagem[]; proxima: boolean; provedor: string | null };

const campo = 'w-full rounded-xl border border-gray/25 bg-white px-3 py-2 text-xs font-normal text-dark focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';
const botao = 'rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-primary-dark transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50';
async function lerResposta<T>(resposta: Response, mensagem: string): Promise<T> {
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok || !dados || typeof dados !== 'object') {
    throw new Error(typeof dados?.erro === 'string' ? dados.erro : mensagem);
  }
  return dados as T;
}

function horario(ocorrencia: string) {
  if (!ocorrencia) return '—';
  const [data, hora] = ocorrencia.split(' ');
  const dataFmt = data ? data.split('-').reverse().join('/') : ocorrencia;
  return hora ? `${dataFmt} às ${hora.slice(0, 5)}` : dataFmt;
}

interface Props {
  buscaUrl: string;
  onNavegar: (endereco: string) => void;
  isAdmin?: boolean;
  onTransbordosPendentesChange?: (quantidade: number) => void;
  onNotify?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export default function Comunicacoes({
  buscaUrl,
  onNavegar,
  isAdmin = true,
  onTransbordosPendentesChange,
  onNotify,
}: Props) {
  const params = new URLSearchParams(buscaUrl);
  const numeroAtendimento = params.get('agendamento') || '';
  const estadoFiltro = params.get('estado') || '';
  const paginaFiltro = params.get('pagina') || '';
  const pagina = Number(paginaFiltro || 1);
  const numeroInvalido = numeroAtendimento !== '' &&
    (!/^[1-9]\d*$/.test(numeroAtendimento) || Number(numeroAtendimento) > 2147483647);

  const [resultadoConsulta, setResultadoConsulta] = useState<{ buscaUrl: string; dados: Consulta | null; erro: string } | null>(null);
  const resultadoAtual = resultadoConsulta?.buscaUrl === buscaUrl ? resultadoConsulta : null;
  const consulta = resultadoAtual?.dados;
  const erro = resultadoAtual?.erro;
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [abrindoWhatsApp, setAbrindoWhatsApp] = useState(false);
  const [linkWhatsApp, setLinkWhatsApp] = useState<{ buscaUrl: string; href: string } | null>(null);
  const [revisao, setRevisao] = useState(0);
  const [busca, setBusca] = useState<Busca | null>(null);
  const [buscando, setBuscando] = useState(false);
  const buscaOcupada = useRef(false);
  const [erroBusca, setErroBusca] = useState('');

  useEffect(() => {
    if (!isAdmin || numeroInvalido) return;
    const controller = new AbortController();
    async function carregar() {
      const filtros = new URLSearchParams();
      if (numeroAtendimento) filtros.set('agendamento', numeroAtendimento);
      if (estadoFiltro) filtros.set('estado', estadoFiltro);
      if (paginaFiltro) filtros.set('pagina', paginaFiltro);
      try {
        const resposta = await apiFetch('/api/comunicacoes?' + filtros, { signal: controller.signal });
        const json = await lerResposta<Consulta>(resposta, 'Falha ao consultar mensagens.');
        if (!controller.signal.aborted) setResultadoConsulta({ buscaUrl, dados: json, erro: '' });
      } catch (e) {
        if (!controller.signal.aborted) setResultadoConsulta({ buscaUrl, dados: null, erro: e instanceof Error ? e.message : 'Consulta indisponível.' });
      }
    }
    void carregar();
    return () => controller.abort();
  }, [isAdmin, buscaUrl, numeroAtendimento, estadoFiltro, paginaFiltro, numeroInvalido, revisao]);

  function aplicarFiltros(alteracao: { agendamento?: string; estado?: string; pagina?: string }) {
    const filtros = new URLSearchParams(buscaUrl);
    for (const [campoFiltro, valor] of Object.entries(alteracao)) {
      if (valor) filtros.set(campoFiltro, valor);
      else filtros.delete(campoFiltro);
    }
    setLinkWhatsApp(null);
    setAviso('');
    onNavegar('/comunicacao' + (filtros.size ? '?' + filtros : ''));
  }

  async function buscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const termo = String(new FormData(evento.currentTarget).get('termo') || '').trim();
    if (!termo || buscaOcupada.current) return;
    buscaOcupada.current = true;
    setBuscando(true);
    setBusca(null);
    setErroBusca('');
    try {
      const resposta = await apiFetch('/api/comunicacoes/buscar-atendimentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ termo }),
      });
      const json = await lerResposta<Busca>(resposta, 'Falha ao buscar agendamentos. Tente novamente.');
      if (!Array.isArray(json.dados)) throw new Error('A busca retornou uma resposta inválida.');
      setBusca(json);
    } catch (erro) {
      setErroBusca(erro instanceof Error ? erro.message : 'Falha ao buscar agendamentos.');
    } finally {
      buscaOcupada.current = false;
      setBuscando(false);
    }
  }

  async function abrirWhatsApp(atendimento: Atendimento) {
    const aba = window.open('about:blank', '_blank');
    if (aba) aba.opener = null;
    setAbrindoWhatsApp(true);
    setLinkWhatsApp(null);
    setAviso('');
    try {
      const parametros = new URLSearchParams({ ocorrencia: atendimento.ocorrencia, formato: 'json' });
      const resposta = await apiFetch(`/api/comunicacoes/${atendimento.id}/confirmacao/whatsapp?${parametros}`, { cache: 'no-store' });
      const json = await lerResposta<{ dados: { url: string } }>(resposta, 'Não foi possível abrir a confirmação.');
      if (!json.dados?.url) throw new Error('O endereço da confirmação está indisponível.');
      const link = new URL(json.dados.url);
      if (link.origin !== 'https://wa.me') throw new Error('Endereço do WhatsApp inválido.');
      if (aba && !aba.closed) aba.location.replace(link.href);
      else setLinkWhatsApp({ buscaUrl, href: link.href });
    } catch (e) {
      aba?.close();
      setAviso(e instanceof Error ? e.message : 'Não foi possível abrir a confirmação.');
      setRevisao(valor => valor + 1);
    } finally {
      setAbrindoWhatsApp(false);
    }
  }

  async function enviar(atendimento: Atendimento, tentativaAnterior?: number) {
    setEnviando(true);
    setAviso('');
    try {
      const resposta = await apiFetch('/api/comunicacoes/' + atendimento.id + '/confirmacao', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ocorrencia: atendimento.ocorrencia, tentativaAnterior }),
      });
      const json = await lerResposta<{ dados: Mensagem }>(resposta, 'Não foi possível solicitar a confirmação.');
      setAviso(rotulos[json.dados.estado] + (json.dados.erro ? ' · ' + json.dados.erro : ''));
    } catch (e) { setAviso(e instanceof Error ? e.message : 'Não foi possível obter o resultado do envio.'); }
    finally { setEnviando(false); setRevisao(v => v + 1); }
  }

  const atendimento = consulta?.atendimento;
  const podeConfirmar = !!atendimento?.contatoFinal && ['Agendado', 'Confirmado', 'Reagendado'].includes(atendimento.status);
  const provedor = consulta?.provedor;

  if (!isAdmin) {
    return (
      <PainelWhatsApp
        isAdmin={false}
        onTransbordosPendentesChange={onTransbordosPendentesChange}
        onNotify={onNotify}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PainelWhatsApp
        isAdmin
        compacto
        onTransbordosPendentesChange={onTransbordosPendentesChange}
        onNotify={(msg, type) => {
          setAviso(msg);
          onNotify?.(msg, type);
        }}
      />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* COLUNA ESQUERDA: Busca de Agendamento e Filtro de Estado */}
        <div className="lg:col-span-1 space-y-6">
          <section className="bg-white rounded-2xl shadow-premium border border-gray/10 p-6 space-y-4">
            <div>
              <h2 className="text-base font-bold text-dark flex items-center gap-2">
                <span className="p-1.5 bg-primary/10 rounded-lg text-primary text-xs font-bold">
                  Canais
                </span>
                Comunicação com Pacientes
              </h2>
              <p className="text-xs text-gray mt-1">
                Pesquise agendamentos e filtre o status de confirmações e lembretes enviados.
              </p>
            </div>

            <form onSubmit={buscar} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-dark mb-1">
                  Buscar agendamento
                  <input
                    key={numeroAtendimento}
                    className={`${campo} mt-1`}
                    type="search"
                    name="termo"
                    required
                    maxLength={150}
                    defaultValue={numeroAtendimento}
                    placeholder="Nome, CPF, telefone ou nº do agendamento"
                  />
                </label>
              </div>
              <button className={`${botao} w-full`} disabled={buscando}>
                {buscando ? 'Buscando…' : 'Buscar'}
              </button>
            </form>

            {erroBusca && (
              <p role="alert" className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
                {erroBusca}
              </p>
            )}

            {busca && (
              <div aria-live="polite" className="pt-2 border-t border-gray/10 space-y-2">
                <h3 className="text-xs font-bold text-dark uppercase tracking-wider">
                  Agendamentos encontrados
                </h3>
                {!busca.dados.length ? (
                  <p className="text-xs text-gray py-2">Nenhum agendamento encontrado.</p>
                ) : (
                  <ul className="divide-y divide-gray/10 max-h-64 overflow-y-auto rounded-xl border border-gray/10 bg-light-gray/20">
                    {busca.dados.map(item => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => aplicarFiltros({ agendamento: String(item.id), pagina: '' })}
                          className="w-full text-left block py-2.5 px-3 hover:bg-white transition-colors cursor-pointer"
                        >
                          <strong className="text-xs font-bold text-primary block">
                            {item.paciente} · #{item.id}
                          </strong>
                          <p className="text-[11px] text-dark mt-0.5">
                            {horario(item.ocorrencia)} · <span className="font-semibold">{item.status}</span>
                          </p>
                          <p className="text-[11px] text-gray">
                            {item.procedimento} · {item.profissional}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {busca.temMais && (
                  <p className="text-[11px] text-gray">
                    Mostrando os primeiros 20 resultados. Refine a busca para encontrar outro atendimento.
                  </p>
                )}
              </div>
            )}

            <form
              className="pt-4 border-t border-gray/10 space-y-3"
              onSubmit={e => {
                e.preventDefault();
                const estadoForm = String(new FormData(e.currentTarget).get('estado') || '');
                aplicarFiltros({ estado: estadoForm, pagina: '' });
              }}
            >
              <div>
                <label className="block text-xs font-bold text-dark mb-1">
                  Estado da mensagem
                  <select key={estadoFiltro} name="estado" className={`${campo} mt-1`} defaultValue={estadoFiltro}>
                    <option value="">Todos</option>
                    {Object.entries(rotulos).map(([id, titulo]) => (
                      <option key={id} value={id}>
                        {titulo}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button className="w-full rounded-xl border border-gray/25 bg-light-gray/60 px-3.5 py-2 text-xs font-bold text-dark hover:bg-light-gray transition-all cursor-pointer">
                Filtrar histórico
              </button>
            </form>

            <div className="pt-3 border-t border-gray/10 flex flex-col gap-2">
              {numeroAtendimento && (
                <button
                  type="button"
                  onClick={() => aplicarFiltros({ agendamento: '', pagina: '' })}
                  className="w-full rounded-xl border border-gray/25 px-3 py-2 text-xs font-bold text-gray hover:text-dark hover:bg-light-gray transition-colors cursor-pointer"
                >
                  Limpar atendimento #{numeroAtendimento}
                </button>
              )}
              <button
                type="button"
                onClick={() => onNavegar('/agendamentos')}
                className="w-full rounded-xl border border-gray/25 px-3 py-2 text-xs font-bold text-dark hover:bg-light-gray transition-colors cursor-pointer"
              >
                Voltar à agenda
              </button>
            </div>
          </section>
        </div>

      {/* COLUNA DIREITA: Detalhes do Atendimento Selecionado e Histórico de Mensagens */}
      <div className="lg:col-span-2 space-y-6">
        {erro && (
          <div role="alert" className="p-4 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-center justify-between">
            <span>{erro}</span>
            <button className="font-bold underline cursor-pointer" onClick={() => setRevisao(v => v + 1)}>
              Tentar novamente
            </button>
          </div>
        )}

        {numeroInvalido && (
          <p role="alert" className="rounded-2xl bg-red-50 border border-red-200 p-4 text-xs text-red-800">
            Informe um número de agendamento válido. O telefone fica no cadastro do paciente.
          </p>
        )}

        {provedor === 'whatsapp' && (
          <div className="rounded-2xl border border-secondary/30 bg-secondary-light/60 px-4 py-3 text-xs font-semibold text-primary-dark">
            Canal WhatsApp configurado para envios ativos e lembretes automáticos.
          </div>
        )}

        {provedor === 'simulado' && (
          <div className="rounded-2xl border border-secondary/30 bg-secondary-light/60 px-4 py-3 text-xs font-semibold text-primary-dark">
            Os envios pelo simulador são registrados apenas para teste.
          </div>
        )}

        {aviso && (
          <div role="status" className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-xs font-semibold text-primary-dark">
            {aviso}
          </div>
        )}

        {atendimento && (
          <section className="bg-white rounded-2xl shadow-premium border border-gray/10 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray/10 bg-light-gray/30 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-dark">
                  {atendimento.paciente} · Atendimento #{atendimento.id}
                </h2>
                <p className="text-xs text-gray mt-0.5">
                  {horario(atendimento.ocorrencia)} · <span className="font-semibold text-dark">{atendimento.status}</span>
                </p>
              </div>
              <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-light-gray text-dark border border-gray/15">
                {atendimento.contatoFinal
                  ? 'WhatsApp cadastrado com final ' + atendimento.contatoFinal
                  : 'Atualize o WhatsApp no cadastro do paciente.'}
              </span>
            </div>

            <div className="p-6 space-y-3">
              <div className="flex flex-wrap items-center gap-2.5">
                {podeConfirmar && (
                  <button
                    type="button"
                    className={botao}
                    disabled={abrindoWhatsApp}
                    onClick={() => void abrirWhatsApp(atendimento)}
                  >
                    {abrindoWhatsApp ? 'Abrindo WhatsApp…' : 'Enviar confirmação pelo WhatsApp'}
                  </button>
                )}
                {podeConfirmar && linkWhatsApp?.buscaUrl === buscaUrl && (
                  <a
                    className="text-xs font-bold text-primary underline"
                    href={linkWhatsApp.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setLinkWhatsApp(null)}
                  >
                    Abrir conversa no WhatsApp
                  </a>
                )}
                {provedor && (
                  <button
                    className="rounded-xl border border-primary px-3.5 py-2 text-xs font-bold text-primary hover:bg-light-gray transition-all cursor-pointer disabled:opacity-50"
                    disabled={enviando || !podeConfirmar}
                    onClick={() => void enviar(atendimento)}
                  >
                    {provedor === 'simulado' ? 'Simular confirmação' : 'Solicitar confirmação pelo sistema'}
                  </button>
                )}
              </div>
              {podeConfirmar && (
                <p className="text-xs text-gray">
                  A conversa abre com a mensagem pronta. Revise e clique em Enviar no WhatsApp.
                </p>
              )}
              {atendimento.contatoFinal && !podeConfirmar && (
                <p className="text-xs text-gray">
                  O status deste atendimento não permite solicitar confirmação.
                </p>
              )}
            </div>
          </section>
        )}

        <section className="bg-white rounded-2xl shadow-premium border border-gray/10 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray/10 bg-light-gray/30 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-dark">Histórico de mensagens</h2>
              <p className="text-xs text-gray mt-0.5">
                Registro de confirmações e lembretes automáticos
              </p>
            </div>
            <button
              type="button"
              className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-gray/20 bg-white text-dark hover:bg-light-gray transition-all cursor-pointer"
              onClick={() => setRevisao(v => v + 1)}
            >
              Atualizar
            </button>
          </div>

          {!numeroInvalido && !erro && !consulta ? (
            <p role="status" className="p-8 text-center text-xs text-gray font-semibold">
              Consultando mensagens…
            </p>
          ) : consulta ? (
            <div className="p-6 space-y-4">
              {!consulta.dados.length ? (
                <p className="rounded-xl bg-light-gray/50 p-6 text-xs text-gray text-center">
                  Nenhuma mensagem para os filtros selecionados.
                </p>
              ) : (
                <ul className="divide-y divide-gray/10">
                  {consulta.dados.map(m => (
                    <li className="space-y-1.5 py-3.5 first:pt-0 last:pb-0" key={m.id}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => aplicarFiltros({ agendamento: String(m.id_agendamento), pagina: '' })}
                          className="text-xs font-bold text-primary hover:underline cursor-pointer text-left"
                        >
                          {m.paciente} · Atendimento #{m.id_agendamento}
                        </button>
                        <span
                          className={
                            'inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-bold border ' +
                            (m.estado === 'FALHA'
                              ? 'bg-red-50 text-red-800 border-red-200'
                              : m.estado === 'ENTREGUE'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : 'bg-secondary-light/60 text-primary-dark border-secondary/30')
                          }
                        >
                          {rotulos[m.estado]}
                        </span>
                      </div>
                      <p className="text-xs text-dark">
                        {horario(m.ocorrencia)} ·{' '}
                        <span className="font-semibold">
                          {m.tipo === 'LEMBRETE' ? 'Lembrete' : 'Confirmação'}
                        </span>{' '}
                        por {m.canal === 'WHATSAPP' ? 'WhatsApp' : m.canal}
                      </p>
                      <p className="text-[11px] text-gray">
                        Tentativa {m.tentativa} em {new Date(m.criado_em).toLocaleString('pt-BR')}
                        {m.provedor === 'simulado' ? ' · Simulação' : ''}
                      </p>
                      {m.erro && <p className="text-xs text-red-700 font-medium">{m.erro}</p>}
                      {atendimento &&
                        m.tipo === 'CONFIRMACAO' &&
                        m.estado === 'FALHA' &&
                        m.ultima_tentativa === 1 &&
                        atendimento.ocorrencia === m.ocorrencia && (
                          <button
                            type="button"
                            className="text-xs font-bold text-primary underline cursor-pointer"
                            disabled={enviando || !provedor || !podeConfirmar}
                            onClick={() => void enviar(atendimento, m.id)}
                          >
                            Tentar confirmação novamente
                          </button>
                        )}
                    </li>
                  ))}
                </ul>
              )}

              {(pagina > 1 || consulta.proxima) && (
                <nav aria-label="Páginas do histórico" className="flex items-center justify-between pt-3 border-t border-gray/10">
                  <div>
                    {pagina > 1 && (
                      <button
                        type="button"
                        className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-gray/20 hover:bg-light-gray cursor-pointer"
                        onClick={() => aplicarFiltros({ pagina: pagina > 2 ? String(pagina - 1) : '' })}
                      >
                        Página anterior
                      </button>
                    )}
                  </div>
                  <div>
                    {consulta.proxima && (
                      <button
                        type="button"
                        className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-gray/20 hover:bg-light-gray cursor-pointer"
                        onClick={() => aplicarFiltros({ pagina: String(pagina + 1) })}
                      >
                        Próxima página
                      </button>
                    )}
                  </div>
                </nav>
              )}
            </div>
          ) : null}
        </section>
      </div>
      </div>
    </div>
  );
}
