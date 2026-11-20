import { lazy, Suspense, useEffect, useState } from 'react';
import { startClinicUpdates } from './services/clinicUpdates';
import { buscarSessao, encerrarSessao, type UsuarioSessao } from './services/auth';
import TelaLogin from './components/TelaLogin';

const Agendamentos = lazy(() => import('./components/DashboardDemo'));
const Dashboard = lazy(() => import('./indicadores/main'));

function App() {
  const [usuario, setUsuario] = useState<UsuarioSessao | null>(null);
  const [verificandoSessao, setVerificandoSessao] = useState(true);
  const route = window.location.pathname.replace(/\/+$/, '') || '/';

  useEffect(() => {
    buscarSessao().then(sessao => {
      setUsuario(sessao);
      setVerificandoSessao(false);
    });
  }, []);

  useEffect(() => {
    if (!usuario) return;
    return startClinicUpdates();
  }, [usuario]);

  useEffect(() => {
    if (route === '/') {
      window.history.replaceState(window.history.state, '', '/agendamentos' + window.location.search + window.location.hash);
    }
    document.title = !usuario
      ? 'Login | Clínica Ikigai'
      : route === '/dashboard'
        ? 'Dashboard | Clínica Ikigai'
        : route === '/' || route === '/agendamentos'
          ? 'Agendamentos | Clínica Ikigai'
          : 'Página não encontrada | Clínica Ikigai';
  }, [route, usuario]);

  async function handleLogout() {
    await encerrarSessao();
    setUsuario(null);
  }

  if (verificandoSessao) {
    return <main className="min-h-screen flex items-center justify-center"><p role="status" className="text-sm text-gray">Verificando sessão...</p></main>;
  }

  if (!usuario) {
    return <TelaLogin onLoginSuccess={setUsuario} />;
  }

  if (route !== '/' && route !== '/agendamentos' && route !== '/dashboard') {
    return <main className="max-w-7xl mx-auto p-8"><h1>Página não encontrada</h1></main>;
  }

  if (route === '/dashboard' && usuario.perfil !== 'ADMIN') {
    return (
      <main className="max-w-xl mx-auto p-8 text-center space-y-3">
        <h1 className="text-lg font-bold text-dark">Acesso restrito</h1>
        <p className="text-sm text-gray">O painel de indicadores está disponível apenas para Administradores.</p>
        <a href="/agendamentos" className="inline-block px-4 py-2 rounded-xl bg-dark text-white text-xs font-bold">
          Voltar para Agendamentos
        </a>
      </main>
    );
  }

  return (
    <Suspense fallback={<p role="status">Carregando página...</p>}>
      {route === '/dashboard' ? (
        <Dashboard />
      ) : (
        <Agendamentos usuario={usuario} onLogout={handleLogout} />
      )}
    </Suspense>
  );
}

export default App;
