import { type FormEvent, useEffect, useState } from 'react';
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
const botao = 'rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-primary-dark disabled:opacity-50';
const params = new URLSearchParams(window.location.search);
const numeroAtendimento = params.get('agendamento') || '';
const numeroInvalido = numeroAtendimento !== '' &&
  (!/^[1-9]\d*$/.test(numeroAtendimento) || Number(numeroAtendimento) > 2147483647);

function horario(ocorrencia: string) {
  const [data, hora] = ocorrencia.split(' ');
  return data.split('-').reverse().join('/') + ' às ' + hora.slice(0, 5);
}

function linkPagina(pagina: number) {
  const busca = new URLSearchParams(window.location.search);
  busca.set('pagina', String(pagina));
  return '?' + busca;
}

export default function Comunicacoes() {
  const [consulta, setConsulta] = useState<Consulta | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [revisao, setRevisao] = useState(0);
  const [busca, setBusca] = useState<Busca | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [erroBusca, setErroBusca] = useState('');
  const pagina = Number(params.get('pagina') || 1);

  useEffect(() => {
    if (numeroInvalido) return;
    const controller = new AbortController();
    async function carregar() {
      const filtros = new URLSearchParams();
      for (const nome of ['agendamento', 'estado', 'pagina']) {
        const valor = params.get(nome);
        if (valor) filtros.set(nome, valor);
      }
      try {
        const resposta = await apiFetch('/api/comunicacoes?' + filtros, { signal: controller.signal });
        const json = await resposta.json();
        if (!resposta.ok) throw new Error(json.erro || 'Falha ao consultar mensagens.');
        if (!controller.signal.aborted) { setConsulta(json); setErro(''); }
      } catch (e) {
        if (!controller.signal.aborted) { setConsulta(null); setErro(e instanceof Error ? e.message : 'Consulta indisponível.'); }
      }
    }
    void carregar();
    return () => controller.abort();
  }, [revisao]);

  async function buscar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const termo = String(new FormData(evento.currentTarget).get('termo') || '').trim();
    if (!termo || buscando) return;
    setBuscando(true);
    setBusca(null);
    setErroBusca('');
    try {
      const resposta = await apiFetch('/api/comunicacoes/buscar-atendimentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ termo }),
      });
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.erro || 'Falha ao buscar agendamentos.');
      setBusca(json);
    } catch (erro) {
      setErroBusca(erro instanceof Error ? erro.message : 'Falha ao buscar agendamentos.');
    } finally {
      setBuscando(false);
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
      const json = await resposta.json();
      if (!resposta.ok) throw new Error(json.erro || 'Não foi possível solicitar a confirmação.');
      setAviso(rotulos[json.dados.estado as Estado] + (json.dados.erro ? ' · ' + json.dados.erro : ''));
    } catch (e) { setAviso(e instanceof Error ? e.message : 'Não foi possível obter o resultado do envio.'); }
    finally { setEnviando(false); setRevisao(v => v + 1); }
  }

  const atendimento = consulta?.atendimento;
  const podeConfirmar = !!consulta?.provedor && !!atendimento?.contatoFinal &&
    ['Agendado', 'Confirmado', 'Reagendado'].includes(atendimento.status);
  return <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
    <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border-t-4 border-secondary bg-primary px-6 py-7 text-white shadow-premium sm:px-8">
      <h1 className="text-3xl font-bold tracking-tight">Comunicação com pacientes</h1>
      <a href="/agendamentos" className="rounded-xl border border-white/30 px-4 py-2.5 text-sm font-bold hover:bg-white/10">Voltar à agenda</a>
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
            <a href={'?agendamento=' + item.id} className="block rounded-lg py-3 hover:bg-light-gray">
              <strong className="text-primary">{item.paciente} · #{item.id}</strong>
              <p className="text-sm">{horario(item.ocorrencia)} · {item.status}</p>
              <p className="text-sm text-gray">{item.procedimento} · {item.profissional}</p>
            </a>
          </li>)}
        </ul>
        {busca.temMais && <p className="text-sm text-gray">Mostrando os primeiros 20 resultados. Refine a busca para encontrar outro atendimento.</p>}
      </div>}
    </section>
    <form className="flex flex-wrap items-end gap-3 rounded-2xl border border-gray/10 bg-white p-5 shadow-premium sm:p-6" method="get">
      {numeroAtendimento && !numeroInvalido && <input type="hidden" name="agendamento" value={numeroAtendimento} />}
      <label className="grid min-w-0 gap-1.5 text-sm font-semibold">Estado da mensagem
        <select name="estado" className={campo} defaultValue={params.get('estado') || ''}>
          <option value="">Todos</option>
          {Object.entries(rotulos).map(([id, titulo]) => <option key={id} value={id}>{titulo}</option>)}
        </select>
      </label>
      <button className={botao}>Filtrar histórico</button>
    </form>
    {erro && <p role="alert">{erro} <button className="underline" onClick={() => setRevisao(v => v + 1)}>Tentar novamente</button></p>}
    {numeroInvalido && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">Informe um número de agendamento válido. O telefone fica no cadastro do paciente.</p>}
    {!numeroInvalido && !erro && !consulta && <p role="status">Consultando mensagens…</p>}
    {consulta && <p className="rounded-xl border border-secondary/30 bg-secondary-light px-4 py-3 text-sm font-semibold text-primary-dark">{consulta.provedor === 'simulado' ? 'Ambiente simulado. As mensagens são registradas apenas para teste.' : 'Canal de envio desabilitado.'}</p>}
    {atendimento && <section className="space-y-3 rounded-2xl border border-gray/10 bg-white p-5 shadow-premium sm:p-6">
      <h2 className="font-bold">{atendimento.paciente} · Atendimento #{atendimento.id}</h2>
      <p>{horario(atendimento.ocorrencia)} · {atendimento.status}</p>
      <p>{atendimento.contatoFinal ? 'WhatsApp cadastrado com final ' + atendimento.contatoFinal : 'Atualize o WhatsApp no cadastro do paciente.'}</p>
      <button className={botao} disabled={enviando || !podeConfirmar}
        onClick={() => void enviar(atendimento)}>Solicitar confirmação</button>
    </section>}
    {aviso && <p role="status">{aviso}</p>}
    {consulta && <section className="space-y-4 rounded-2xl border border-gray/10 bg-white p-5 shadow-premium sm:p-6">
      <div className="flex items-center justify-between"><h2 className="text-xl font-bold text-primary">Histórico de mensagens</h2>
        <button className="text-sm underline" onClick={() => setRevisao(v => v + 1)}>Atualizar</button>
      </div>
      {!consulta.dados.length && <p className="rounded-xl bg-light-gray p-5 text-sm text-gray">Nenhuma mensagem para os filtros selecionados.</p>}
      <ul className="divide-y divide-gray/10">{consulta.dados.map(m => <li className="space-y-2 py-4" key={m.id}>
        <a className="font-semibold text-primary hover:underline" href={'?agendamento=' + m.id_agendamento}>{m.paciente} · Atendimento #{m.id_agendamento}</a>
        <p>{horario(m.ocorrencia)} · {m.tipo === 'LEMBRETE' ? 'Lembrete' : 'Confirmação'} por {m.canal === 'WHATSAPP' ? 'WhatsApp' : m.canal}</p>
        <span className={'inline-flex rounded-full px-3 py-1 text-xs font-semibold ' + (m.estado === 'FALHA' ? 'bg-red-50 text-red-800' : m.estado === 'ENTREGUE' ? 'bg-emerald-50 text-emerald-800' : 'bg-secondary-light text-primary-dark')}>{rotulos[m.estado]}</span>
        <p className="text-sm">Tentativa {m.tentativa} em {new Date(m.criado_em).toLocaleString('pt-BR')}{m.provedor === 'simulado' ? ' · Simulação' : ''}</p>
        {m.erro && <p>{m.erro}</p>}
        {atendimento && m.tipo === 'CONFIRMACAO' && m.estado === 'FALHA' && m.ultima_tentativa === 1 && atendimento.ocorrencia === m.ocorrencia &&
          <button className="underline" disabled={enviando || !podeConfirmar} onClick={() => void enviar(atendimento, m.id)}>Tentar confirmação novamente</button>}
      </li>)}</ul>
      <nav aria-label="Páginas do histórico" className="flex gap-4">
        {pagina > 1 && <a className="underline" href={linkPagina(pagina - 1)}>Página anterior</a>}
        {consulta.proxima && <a className="underline" href={linkPagina(pagina + 1)}>Próxima página</a>}
      </nav>
    </section>}
  </main>;
}
