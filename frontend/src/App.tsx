import { lazy, Suspense, useEffect, useState } from 'react';
import { startClinicUpdates } from './services/clinicUpdates';
import { eventoSessao } from './api';
import { buscarSessao, encerrarSessao, type UsuarioSessao } from './services/auth';
import TelaLogin from './components/TelaLogin';

const Agenda = lazy(() => import('./components/DashboardDemo'));
const Dashboard = lazy(() => import('./indicadores/main'));
const Comunicacoes = lazy(() => import('./components/Comunicacoes'));
const Inicio = lazy(() => import('./components/Inicio'));

const titulos: Record<string, string> = {
  '/login': 'Login', '/inicio': 'Início', '/dashboard': 'Indicadores',
  '/agendamentos': 'Agendamentos', '/comunicacao': 'Comunicação', '/acesso': 'Acesso',
};
function destino(usuario: UsuarioSessao | null) {
  if (!usuario) return '/login';
  const rota = window.location.pathname.replace(/\/+$/, '') || '/';
  if (['/', '/login', '/acesso'].includes(rota)) return usuario.perfil === 'ADMIN' ? '/inicio' : '/agendamentos';
  return rota;
}

export default function App() {
  const [usuario, setUsuario] = useState<UsuarioSessao | null | undefined>(undefined);
  const [erro, setErro] = useState('');
  useEffect(() => {
    let versao = 0;
    const consultar = async () => {
      const atual = ++versao;
      try {
        const sessao = await buscarSessao();
        if (atual === versao) {
          setUsuario(anterior => anterior?.id === sessao?.id && anterior?.perfil === sessao?.perfil &&
            anterior?.nome === sessao?.nome && anterior?.email === sessao?.email && anterior !== undefined ? anterior : sessao);
          setErro('');
        }
      } catch {
        if (atual === versao) setErro('Não foi possível verificar sua sessão. Verifique a conexão e tente novamente.');
      }
    };
    void consultar();
    window.addEventListener(eventoSessao, consultar);
    window.addEventListener('focus', consultar);
    return () => {
      ++versao;
      window.removeEventListener(eventoSessao, consultar);
      window.removeEventListener('focus', consultar);
    };
  }, []);
  useEffect(() => {
    if (usuario) return startClinicUpdates();
  }, [usuario]);
  const rota = usuario === undefined ? '' : destino(usuario);
  useEffect(() => {
    if (!rota) return;
    if (window.location.pathname !== rota) window.history.replaceState(null, '', rota);
    document.title = (titulos[rota] || 'Página não encontrada') + ' | Clínica Ikigai';
  }, [rota]);
  async function sair() {
    try {
      await encerrarSessao();
      setUsuario(null);
      setErro('');
    } catch {
      setErro('Não foi possível confirmar a saída. Tente novamente.');
    }
  }
  if (usuario === undefined) return <main className="p-8 text-center"><p role="status">{erro || 'Verificando sessão…'}</p>{erro && <button onClick={() => window.location.reload()}>Tentar novamente</button>}</main>;
  if (!usuario) return <TelaLogin onLoginSuccess={setUsuario} />;
  const admin = usuario.perfil === 'ADMIN';
  const restrito = rota === '/acesso' || (!admin && ['/inicio', '/comunicacao'].includes(rota)) || (usuario.perfil === 'PROFISSIONAL' && rota === '/dashboard');
  return <div className="min-h-screen bg-light-gray font-sans text-dark">
    {erro && <p role="alert" className="p-3 bg-red-50 text-red-800">{erro}</p>}
    {rota !== '/agendamentos' && <header className="border-b border-gray/10 bg-white shadow-sm"><div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
      <a href={admin ? '/inicio' : '/agendamentos'} className="flex items-center gap-3 font-bold text-primary"><img src="/logo.png" alt="" className="h-11 w-11 rounded-full border border-secondary/30 object-cover" />Clínica Ikigai</a>
      <nav aria-label="Navegação principal" className="flex flex-wrap items-center gap-2 text-sm font-semibold [&>a]:rounded-xl [&>a]:px-3 [&>a]:py-2 [&>a:hover]:bg-light-gray [&>a[aria-current=page]]:bg-primary/10 [&>a[aria-current=page]]:text-primary">
      {admin && <a href="/inicio" aria-current={rota === '/inicio' ? 'page' : undefined}>Início</a>}
      <a href="/agendamentos">Agenda</a>{admin && <a href="/comunicacao" aria-current={rota === '/comunicacao' ? 'page' : undefined}>Comunicação</a>}
      {usuario.perfil !== 'PROFISSIONAL' && <a href="/dashboard" aria-current={rota === '/dashboard' ? 'page' : undefined}>Indicadores</a>}
      <button className="rounded-xl border border-gray/20 px-3 py-2 hover:bg-light-gray" onClick={sair}>Sair</button>
    </nav></div></header>}
    <Suspense fallback={<p role="status">Carregando página…</p>}>
      {restrito ? <main className="p-8"><h1>Acesso restrito</h1><p>Esta área requer permissão. Consulte a administração da clínica.</p></main>
        : rota === '/dashboard' ? <Dashboard />
        : rota === '/comunicacao' ? <Comunicacoes />
        : rota === '/inicio' ? <Inicio />
        : rota === '/agendamentos' ? <Agenda key={usuario.id + ':' + usuario.perfil + ':' + (usuario.profissional_id ?? '')} usuario={usuario} onLogout={sair} />
        : <main className="p-8"><h1>Página não encontrada</h1></main>}
    </Suspense>
  </div>;
}
