import { lazy, Suspense, useEffect, useState } from 'react';
import { startClinicUpdates } from './services/clinicUpdates';
import { eventoSessao } from './api';
import { buscarSessao, encerrarSessao, type UsuarioSessao } from './services/auth';
import TelaLogin from './components/TelaLogin';

const Agenda = lazy(() => import('./components/DashboardDemo'));

const titulos: Record<string, string> = {
  '/login': 'Login',
  '/inicio': 'Início',
  '/agendamentos': 'Agendamentos',
  '/pacientes': 'Pacientes',
  '/servicos': 'Serviços e Configurações',
  '/usuarios': 'Usuários',
  '/comunicacao': 'Comunicação',
  '/indicadores': 'Indicadores',
  '/dashboard': 'Indicadores',
  '/acesso': 'Acesso',
};
const rotasSistema = ['/agendamentos', '/inicio', '/pacientes', '/servicos', '/usuarios', '/comunicacao', '/indicadores', '/dashboard'];

function destino(usuario: UsuarioSessao | null) {
  if (!usuario) return '/login';
  const rota = window.location.pathname.replace(/\/+$/, '') || '/';
  if (['/', '/login', '/acesso'].includes(rota)) return '/agendamentos';
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
  const restrito =
    rota === '/acesso' ||
    (!admin && ['/inicio', '/comunicacao', '/servicos', '/usuarios'].includes(rota)) ||
    (usuario.perfil === 'PROFISSIONAL' && ['/indicadores', '/dashboard'].includes(rota));
  const isRotaSistema = rotasSistema.includes(rota) && !restrito;
  return <div className="min-h-screen bg-light-gray font-sans text-dark">
    {erro && <p role="alert" className="p-3 bg-red-50 text-red-800">{erro}</p>}
    <Suspense fallback={<p role="status">Carregando página…</p>}>
      {restrito ? <main className="p-8"><h1>Acesso restrito</h1><p>Esta área requer permissão. Consulte a administração da clínica.</p></main>
        : isRotaSistema ? <Agenda key={usuario.id + ':' + usuario.perfil + ':' + (usuario.profissional_id ?? '')} usuario={usuario} onLogout={sair} />
        : <main className="p-8"><h1>Página não encontrada</h1></main>}
    </Suspense>
  </div>;
}
