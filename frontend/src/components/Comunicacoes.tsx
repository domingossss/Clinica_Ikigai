import { type FormEvent, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api';

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

const campo = 'rounded-xl border border-gray/25 bg-white px-3 py-2.5 text-sm font-normal text-dark focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15';
const botao = 'rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-primary-dark cursor-pointer disabled:cursor-not-allowed disabled:opacity-50';
async function lerResposta<T>(resposta: Response, mensagem: string): Promise<T> {
  const dados = await resposta.json().catch(() => null);
  if (!resposta.ok || !dados || typeof dados !== 'object') {
    throw new Error(typeof dados?.erro === 'string' ? dados.erro : mensagem);
  }
  return dados as T;
}

function horario(ocorrencia: string) {
  const [data, hora] = ocorrencia.split(' ');
  return data.split('-').reverse().join('/') + ' às ' + hora.slice(0, 5);
}

interface Props {
  buscaUrl: string;
  onNavegar: (endereco: string) => void;
}

export default function Comunicacoes({ buscaUrl, onNavegar }: Props) {
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
    if (numeroInvalido) return;
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
  }, [buscaUrl, numeroAtendimento, estadoFiltro, paginaFiltro, numeroInvalido, revisao]);

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
  return <div className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border-t-4 border-secondary bg-primary px-6 py-7 text-white shadow-premium sm:px-8">
      <h1 className="text-3xl font-bold tracking-tight">Comunicação com pacientes</h1>
      <div className="flex flex-wrap items-center gap-2">
        {numeroAtendimento && (
          <button
            type="button"
            onClick={() => aplicarFiltros({ agendamento: '', pagina: '' })}
            className="rounded-xl border border-white/30 px-4 py-2.5 text-sm font-bold hover:bg-white/10 cursor-pointer"
          >
            Limpar atendimento #{numeroAtendimento}
          </button>
        )}
        <button
          type="button"
          onClick={() => onNavegar('/agendamentos')}
          className="rounded-xl border border-white/30 px-4 py-2.5 text-sm font-bold hover:bg-white/10 cursor-pointer"
        >
          Voltar à agenda
        </button>
      </div>
    </header>
    <section className="space-y-4 rounded-2xl border border-gray/10 bg-white p-5 shadow-premium sm:p-6">
      <form onSubmit={buscar} className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
        <label className="grid min-w-0 gap-1.5 text-sm font-semibold">Buscar agendamento
          <input className={campo} type="search" name="termo" required maxLength={150}
            defaultValue={numeroAtendimento} placeholder="Nome, CPF, telefone ou número do agendamento" />
        </label>
        <button className={botao} disabled={buscando}>{buscando ? 'Buscando…' : 'Buscar'}</button>
      </form>
      {erroBusca && <p role="alert" className="text-sm text-red-800">{erroBusca}</p>}
      {busca && <div aria-live="polite">
        <h2 className="font-bold text-primary">Agendamentos encontrados</h2>
        {!busca.dados.length && <p className="mt-2 text-sm text-gray">Nenhum agendamento encontrado.</p>}
        <ul className="divide-y divide-gray/10">
          {busca.dados.map(item => <li key={item.id}>
            <button
              type="button"
              onClick={() => aplicarFiltros({ agendamento: String(item.id), pagina: '' })}
              className="w-full text-left block rounded-lg py-3 px-2 hover:bg-light-gray cursor-pointer"
            >
              <strong className="text-primary">{item.paciente} · #{item.id}</strong>
              <p className="text-sm">{horario(item.ocorrencia)} · {item.status}</p>
              <p className="text-sm text-gray">{item.procedimento} · {item.profissional}</p>
            </button>
          </li>)}
        </ul>
        {busca.temMais && <p className="text-sm text-gray">Mostrando os primeiros 20 resultados. Refine a busca para encontrar outro atendimento.</p>}
      </div>}
    </section>
    <form
      className="flex flex-wrap items-end gap-3 rounded-2xl border border-gray/10 bg-white p-5 shadow-premium sm:p-6"
      onSubmit={e => {
        e.preventDefault();
        const estadoForm = String(new FormData(e.currentTarget).get('estado') || '');
        aplicarFiltros({ estado: estadoForm, pagina: '' });
      }}
    >
      <label className="grid min-w-0 gap-1.5 text-sm font-semibold">Estado da mensagem
        <select key={estadoFiltro} name="estado" className={campo} defaultValue={estadoFiltro}>
          <option value="">Todos</option>
          {Object.entries(rotulos).map(([id, titulo]) => <option key={id} value={id}>{titulo}</option>)}
        </select>
      </label>
      <button className={botao}>Filtrar histórico</button>
    </form>
    {erro && <p role="alert">{erro} <button className="underline cursor-pointer" onClick={() => setRevisao(v => v + 1)}>Tentar novamente</button></p>}
    {numeroInvalido && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">Informe um número de agendamento válido. O telefone fica no cadastro do paciente.</p>}
    {!numeroInvalido && !erro && !consulta && <p role="status">Consultando mensagens…</p>}
    {provedor === 'simulado' && <p className="rounded-xl border border-secondary/30 bg-secondary-light px-4 py-3 text-sm font-semibold text-primary-dark">Os envios pelo simulador são registrados apenas para teste.</p>}
    {atendimento && <section className="space-y-3 rounded-2xl border border-gray/10 bg-white p-5 shadow-premium sm:p-6">
      <h2 className="font-bold">{atendimento.paciente} · Atendimento #{atendimento.id}</h2>
      <p>{horario(atendimento.ocorrencia)} · {atendimento.status}</p>
      <p>{atendimento.contatoFinal ? 'WhatsApp cadastrado com final ' + atendimento.contatoFinal : 'Atualize o WhatsApp no cadastro do paciente.'}</p>
      <div className="flex flex-wrap items-center gap-3">
        {podeConfirmar && <button type="button" className={botao} disabled={abrindoWhatsApp}
          onClick={() => void abrirWhatsApp(atendimento)}>
          {abrindoWhatsApp ? 'Abrindo WhatsApp…' : 'Enviar confirmação pelo WhatsApp'}
        </button>}
        {podeConfirmar && linkWhatsApp?.buscaUrl === buscaUrl && <a className="text-sm font-semibold text-primary underline"
          href={linkWhatsApp.href} target="_blank" rel="noopener noreferrer" onClick={() => setLinkWhatsApp(null)}>
          Abrir conversa no WhatsApp
        </a>}
        {provedor && <button className="rounded-xl border border-primary px-4 py-2.5 text-sm font-bold text-primary hover:bg-light-gray disabled:opacity-50"
          disabled={enviando || !podeConfirmar} onClick={() => void enviar(atendimento)}>
          {provedor === 'simulado' ? 'Simular confirmação' : 'Solicitar confirmação pelo sistema'}
        </button>}
      </div>
      {podeConfirmar && <p className="text-sm text-gray">A conversa abre com a mensagem pronta. Revise e clique em Enviar no WhatsApp.</p>}
      {atendimento.contatoFinal && !podeConfirmar && <p className="text-sm text-gray">O status deste atendimento não permite solicitar confirmação.</p>}
    </section>}
    {aviso && <p role="status">{aviso}</p>}
    {consulta && <section className="space-y-4 rounded-2xl border border-gray/10 bg-white p-5 shadow-premium sm:p-6">
      <div className="flex items-center justify-between"><h2 className="text-xl font-bold text-primary">Histórico de mensagens</h2>
        <button className="text-sm underline cursor-pointer" onClick={() => setRevisao(v => v + 1)}>Atualizar</button>
      </div>
      {!consulta.dados.length && <p className="rounded-xl bg-light-gray p-5 text-sm text-gray">Nenhuma mensagem para os filtros selecionados.</p>}
      <ul className="divide-y divide-gray/10">{consulta.dados.map(m => <li className="space-y-2 py-4" key={m.id}>
        <button
          type="button"
          onClick={() => aplicarFiltros({ agendamento: String(m.id_agendamento), pagina: '' })}
          className="font-semibold text-primary hover:underline cursor-pointer text-left"
        >
          {m.paciente} · Atendimento #{m.id_agendamento}
        </button>
        <p>{horario(m.ocorrencia)} · {m.tipo === 'LEMBRETE' ? 'Lembrete' : 'Confirmação'} por {m.canal === 'WHATSAPP' ? 'WhatsApp' : m.canal}</p>
        <span className={'inline-flex rounded-full px-3 py-1 text-xs font-semibold ' + (m.estado === 'FALHA' ? 'bg-red-50 text-red-800' : m.estado === 'ENTREGUE' ? 'bg-emerald-50 text-emerald-800' : 'bg-secondary-light text-primary-dark')}>{rotulos[m.estado]}</span>
        <p className="text-sm">Tentativa {m.tentativa} em {new Date(m.criado_em).toLocaleString('pt-BR')}{m.provedor === 'simulado' ? ' · Simulação' : ''}</p>
        {m.erro && <p>{m.erro}</p>}
        {atendimento && m.tipo === 'CONFIRMACAO' && m.estado === 'FALHA' && m.ultima_tentativa === 1 && atendimento.ocorrencia === m.ocorrencia &&
          <button type="button" className="underline cursor-pointer" disabled={enviando || !provedor || !podeConfirmar} onClick={() => void enviar(atendimento, m.id)}>Tentar confirmação novamente</button>}
      </li>)}</ul>
      <nav aria-label="Páginas do histórico" className="flex gap-4">
        {pagina > 1 && <button type="button" className="underline cursor-pointer" onClick={() => aplicarFiltros({ pagina: pagina > 2 ? String(pagina - 1) : '' })}>Página anterior</button>}
        {consulta.proxima && <button type="button" className="underline cursor-pointer" onClick={() => aplicarFiltros({ pagina: String(pagina + 1) })}>Próxima página</button>}
      </nav>
    </section>}
  </div>;
}
