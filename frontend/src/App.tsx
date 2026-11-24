import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';
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
const rotasProtegidas = new Set([
  '/inicio', '/agendamentos', '/pacientes', '/servicos', '/usuarios', '/comunicacao', '/indicadores', '/dashboard',
]);
const rotaAtual = () => window.location.pathname.replace(/\/+$/, '') || '/';
const rotaPadrao = (usuario: UsuarioSessao) => usuario.perfil === 'ADMIN' ? '/inicio' : '/agendamentos';

function rotaPermitida(rota: string, usuario: UsuarioSessao) {
  if (rota === '/acesso') return false;
  if (['/inicio', '/servicos', '/usuarios', '/comunicacao'].includes(rota)) return usuario.perfil === 'ADMIN';
  if (rota === '/dashboard' || rota === '/indicadores') return usuario.perfil !== 'PROFISSIONAL';
  return true;
}

function restaurarDestino(usuario: UsuarioSessao) {
  if (rotaAtual() !== '/login') return;
  const pendente = window.history.state?.ikigaiDestino as { rota?: unknown; busca?: unknown } | undefined;
  const destinoPermitido = typeof pendente?.rota === 'string' && rotasProtegidas.has(pendente.rota) &&
    rotaPermitida(pendente.rota, usuario) && typeof pendente.busca === 'string' &&
    (!pendente.busca || pendente.busca.startsWith('?'));
  window.history.replaceState(null, '', destinoPermitido ? `${pendente.rota}${pendente.busca}` : rotaPadrao(usuario));
  window.dispatchEvent(new Event('popstate'));
}

function destino(usuario: UsuarioSessao | null) {
  if (!usuario) return '/login';
  const rota = rotaAtual();
  return ['/', '/login', '/acesso'].includes(rota) ? rotaPadrao(usuario) : rota;
}

function observarEndereco(atualizar: () => void) {
  window.addEventListener('popstate', atualizar);
  return () => window.removeEventListener('popstate', atualizar);
}

function enderecoAtual() {
  return window.location.pathname + window.location.search;
}

function navegar(endereco: string) {
  if (endereco === enderecoAtual()) return;
  window.history.pushState(null, '', endereco);
  window.dispatchEvent(new Event('popstate'));
}

export default function App() {
  const [usuario, setUsuario] = useState<UsuarioSessao | null | undefined>(undefined);
  const [erro, setErro] = useState('');
  const endereco = useSyncExternalStore(observarEndereco, enderecoAtual);
  useEffect(() => {
    let versao = 0;
    const consultar = async () => {
      const atual = ++versao;
      try {
        const sessao = await buscarSessao();
        if (atual === versao) {
          if (sessao) restaurarDestino(sessao);
          setUsuario(anterior => anterior?.id === sessao?.id && anterior?.perfil === sessao?.perfil &&
            anterior?.nome === sessao?.nome && anterior?.email === sessao?.email &&
            anterior?.profissional_id === sessao?.profissional_id && anterior?.profissional_nome === sessao?.profissional_nome &&
            anterior?.profissional_especialidade === sessao?.profissional_especialidade && anterior !== undefined ? anterior : sessao);
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
    if (rota === '/login' && rotaAtual() !== '/login') {
      const anterior = rotaAtual();
      const estado = rotasProtegidas.has(anterior) ? { ikigaiDestino: { rota: anterior, busca: window.location.search } } : null;
      window.history.replaceState(estado, '', '/login');
    } else if (window.location.pathname !== rota) {
      const busca = rotaAtual() === rota ? window.location.search : '';
      window.history.replaceState(null, '', rota + busca);
    }
    document.title = (titulos[rota] || 'Página não encontrada') + ' | Clínica Ikigai';
  }, [rota, endereco]);
  async function sair() {
    try {
      await encerrarSessao();
      window.history.replaceState(null, '', '/login');
      setUsuario(null);
      setErro('');
    } catch {
      setErro('Não foi possível confirmar a saída. Tente novamente.');
    }
  }
  if (usuario === undefined) return <main className="p-8 text-center"><p role="status">{erro || 'Verificando sessão…'}</p>{erro && <button onClick={() => window.location.reload()}>Tentar novamente</button>}</main>;
  if (!usuario) return <TelaLogin onLoginSuccess={sessao => {
    restaurarDestino(sessao);
    setUsuario(sessao);
  }} />;
  const restrito = !rotaPermitida(rota, usuario);
  return <div className="min-h-screen bg-light-gray font-sans text-dark">
    {erro && <p role="alert" className="p-3 bg-red-50 text-red-800">{erro}</p>}
    <Suspense fallback={<p role="status">Carregando página…</p>}>
      {restrito ? <main className="p-8"><h1>Acesso restrito</h1><p>Esta área requer permissão. Consulte a administração da clínica.</p></main>
        : rotasProtegidas.has(rota) ? <Agenda key={usuario.id + ':' + usuario.perfil + ':' + (usuario.profissional_id ?? '')}
          usuario={usuario} onLogout={sair} rota={rota} buscaUrl={window.location.search} onNavegar={navegar} />
        : <main className="p-8"><h1>Página não encontrada</h1></main>}
    </Suspense>
  </div>;
}
