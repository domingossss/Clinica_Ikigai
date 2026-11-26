import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import { startClinicUpdates } from './services/clinicUpdates';
import { eventoSessao } from './api';
import { buscarSessao, encerrarSessao, type UsuarioSessao } from './services/auth';
import TelaLogin from './components/TelaLogin';
import TelaPrimeiroAcesso from './components/TelaPrimeiroAcesso';

const Agenda = lazy(() => import('./components/DashboardDemo'));

const ROTA_PRIMEIRO_ACESSO = '/primeiro-acesso';

const titulos: Record<string, string> = {
  '/login': 'Login',
  [ROTA_PRIMEIRO_ACESSO]: 'Primeiro Acesso',
  '/inicio': 'Início',
  '/agendamentos': 'Agendamentos',
  '/pacientes': 'Pacientes',
  '/procedimentos': 'Meus Procedimentos',
  '/configuracoes': 'Configurações',
  '/servicos': 'Configurações',
  '/usuarios': 'Usuários',
  '/comunicacao': 'Comunicação',
  '/indicadores': 'Indicadores',
  '/dashboard': 'Indicadores',
  '/acesso': 'Acesso',
};
const rotasProtegidas = new Set([
  '/inicio', '/agendamentos', '/pacientes', '/procedimentos', '/configuracoes', '/servicos', '/usuarios', '/comunicacao', '/indicadores', '/dashboard',
]);
const rotaAtual = () => window.location.pathname.replace(/\/+$/, '') || '/';
const rotaPadrao = (usuario: UsuarioSessao) => usuario.perfil === 'ADMIN' ? '/inicio' : '/agendamentos';
const precisaTrocarSenha = (usuario: UsuarioSessao | null | undefined) =>
  Boolean(usuario?.primeiro_acesso || usuario?.precisa_trocar_senha);

function rotaPermitida(rota: string, usuario: UsuarioSessao) {
  if (rota === '/acesso' || rota === ROTA_PRIMEIRO_ACESSO) return false;
  if (['/inicio', '/configuracoes', '/servicos', '/usuarios'].includes(rota)) return usuario.perfil === 'ADMIN';
  if (rota === '/procedimentos') return usuario.perfil === 'PROFISSIONAL';
  if (rota === '/dashboard' || rota === '/indicadores' || rota === '/comunicacao') return usuario.perfil !== 'PROFISSIONAL';
  return true;
}

function restaurarDestino(usuario: UsuarioSessao) {
  if (precisaTrocarSenha(usuario)) {
    if (rotaAtual() !== ROTA_PRIMEIRO_ACESSO) {
      window.history.replaceState(null, '', ROTA_PRIMEIRO_ACESSO);
      window.dispatchEvent(new Event('popstate'));
    }
    return;
  }
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
  if (precisaTrocarSenha(usuario)) return ROTA_PRIMEIRO_ACESSO;
  const rota = rotaAtual();
  return ['/', '/login', '/acesso', ROTA_PRIMEIRO_ACESSO].includes(rota) ? rotaPadrao(usuario) : rota;
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
            anterior?.login === sessao?.login &&
            (anterior?.primeiro_acesso ?? anterior?.precisa_trocar_senha) === (sessao?.primeiro_acesso ?? sessao?.precisa_trocar_senha) &&
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
  const pendenteTrocaSenha = precisaTrocarSenha(usuario);
  useEffect(() => {
    if (usuario && !pendenteTrocaSenha) return startClinicUpdates();
  }, [usuario, pendenteTrocaSenha]);
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
  if (usuario === undefined) {
    return (
      <main className="min-h-screen bg-light-gray flex flex-col items-center justify-center p-8 text-center gap-4">
        <p role="status" className="text-sm text-dark font-medium">{erro || 'Verificando sessão…'}</p>
        {erro && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-2 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary-dark transition-all cursor-pointer"
          >
            Tentar novamente
          </button>
        )}
      </main>
    );
  }
  if (!usuario) return <TelaLogin onLoginSuccess={sessao => {
    restaurarDestino(sessao);
    setUsuario(sessao);
  }} />;
  if (rota === ROTA_PRIMEIRO_ACESSO && pendenteTrocaSenha) {
    return (
      <TelaPrimeiroAcesso
        usuario={usuario}
        onSenhaAlterada={() => {
          const atualizado = { ...usuario, primeiro_acesso: false, precisa_trocar_senha: false };
          window.history.replaceState(null, '', rotaPadrao(atualizado));
          setUsuario(atualizado);
        }}
        onLogout={sair}
      />
    );
  }
  const restrito = !rotaPermitida(rota, usuario);
  return <div className="min-h-screen bg-light-gray font-sans text-dark">
    {erro && <p role="alert" className="p-3 bg-red-50 text-red-800">{erro}</p>}
    <Suspense fallback={<p role="status" className="p-8 text-center text-sm text-gray">Carregando página…</p>}>
      {restrito ? (
        <TelaEstadoRota
          titulo="Acesso restrito"
          descricao="Esta área requer permissão específica. Consulte a administração da clínica ou volte para a sua página inicial."
          rotuloAcao="Voltar para o início"
          onVoltar={() => navegar(rotaPadrao(usuario))}
          onSair={() => void sair()}
        />
      ) : rotasProtegidas.has(rota) ? (
        <Agenda key={usuario.id + ':' + usuario.perfil + ':' + (usuario.profissional_id ?? '')}
          usuario={usuario} onLogout={sair} rota={rota} buscaUrl={window.location.search} onNavegar={navegar} />
      ) : (
        <TelaEstadoRota
          titulo="Página não encontrada"
          descricao="O endereço acessado não existe na plataforma da Clínica Ikigai."
          rotuloAcao="Ir para a página inicial"
          onVoltar={() => navegar(rotaPadrao(usuario))}
          onSair={() => void sair()}
        />
      )}
    </Suspense>
  </div>;
}

function TelaEstadoRota({
  titulo,
  descricao,
  rotuloAcao,
  onVoltar,
  onSair,
}: {
  titulo: string;
  descricao: string;
  rotuloAcao: string;
  onVoltar: () => void;
  onSair: () => void;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray/15 p-6 text-center space-y-4">
        <h1 className="text-lg font-bold text-dark">{titulo}</h1>
        <p className="text-xs text-gray">{descricao}</p>
        <div className="flex items-center justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={onVoltar}
            className="px-4 py-2 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary-dark cursor-pointer"
          >
            {rotuloAcao}
          </button>
          <button
            type="button"
            onClick={onSair}
            className="px-4 py-2 rounded-xl border border-gray/25 text-xs font-bold text-dark hover:bg-light-gray cursor-pointer"
          >
            Sair
          </button>
        </div>
      </div>
    </main>
  );
}
