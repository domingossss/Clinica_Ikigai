import { lazy, Suspense, useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import { startClinicUpdates } from './services/clinicUpdates';
import { eventoSessao } from './api';
import { buscarSessao, encerrarSessao, trocarSenhaPrimeiroAcesso, type UsuarioSessao } from './services/auth';
import TelaLogin from './components/TelaLogin';
import CampoSenha from './components/CampoSenha';

const Agenda = lazy(() => import('./components/DashboardDemo'));

const titulos: Record<string, string> = {
  '/login': 'Login',
  '/inicio': 'Início',
  '/agendamentos': 'Agendamentos',
  '/pacientes': 'Pacientes',
  '/procedimentos': 'Meus Procedimentos',
  '/servicos': 'Serviços e Configurações',
  '/usuarios': 'Usuários',
  '/comunicacao': 'Comunicação',
  '/indicadores': 'Indicadores',
  '/dashboard': 'Indicadores',
  '/acesso': 'Acesso',
};
const rotasProtegidas = new Set([
  '/inicio', '/agendamentos', '/pacientes', '/procedimentos', '/servicos', '/usuarios', '/comunicacao', '/indicadores', '/dashboard',
]);
const rotaAtual = () => window.location.pathname.replace(/\/+$/, '') || '/';
const rotaPadrao = (usuario: UsuarioSessao) => usuario.perfil === 'ADMIN' ? '/inicio' : '/agendamentos';

function rotaPermitida(rota: string, usuario: UsuarioSessao) {
  if (rota === '/acesso') return false;
  if (['/inicio', '/servicos', '/usuarios', '/comunicacao'].includes(rota)) return usuario.perfil === 'ADMIN';
  if (rota === '/procedimentos') return usuario.perfil === 'PROFISSIONAL';
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
  if (usuario.primeiro_acesso || usuario.precisa_trocar_senha) {
    return (
      <TelaPrimeiroAcesso
        usuario={usuario}
        onSenhaAlterada={() => setUsuario({ ...usuario, primeiro_acesso: false, precisa_trocar_senha: false })}
        onLogout={sair}
      />
    );
  }
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

function TelaPrimeiroAcesso({
  usuario,
  onSenhaAlterada,
  onLogout,
}: {
  usuario: UsuarioSessao;
  onSenhaAlterada: () => void;
  onLogout: () => void;
}) {
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (novaSenha.length < 6) {
      setErro('A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (novaSenha !== confirmarSenha) {
      setErro('A confirmação da senha não confere.');
      return;
    }
    setSalvando(true);
    try {
      await trocarSenhaPrimeiroAcesso(novaSenha, confirmarSenha);
      onSenhaAlterada();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao definir nova senha.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <main className="min-h-screen bg-light-gray flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray/15 overflow-hidden">
        <div className="bg-primary text-white px-6 py-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Clínica Ikigai" className="w-10 h-10 rounded-xl object-cover bg-white/10" />
            <div>
              <h1 className="text-base font-bold leading-tight">Primeiro Acesso</h1>
              <p className="text-xs text-white/80">Olá, {usuario.nome}! Defina sua senha pessoal</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="text-xs font-bold px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
          >
            Sair
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
            Sua conta está utilizando a <strong>senha padrão inicial</strong>. Para sua segurança, escolha uma nova senha pessoal antes de acessar o sistema.
          </div>

          {erro && (
            <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-4 py-3 font-medium">
              {erro}
            </div>
          )}

          <div>
            <label htmlFor="primeiro-acesso-nova" className="block text-xs font-bold text-dark mb-1.5">
              Nova senha (mín. 6 caracteres)
            </label>
            <CampoSenha
              id="primeiro-acesso-nova"
              required
              minLength={6}
              autoComplete="new-password"
              value={novaSenha}
              onChange={e => setNovaSenha(e.target.value)}
              placeholder="Digite sua nova senha"
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray/25 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          <div>
            <label htmlFor="primeiro-acesso-confirmar" className="block text-xs font-bold text-dark mb-1.5">
              Confirmar nova senha
            </label>
            <CampoSenha
              id="primeiro-acesso-confirmar"
              required
              minLength={6}
              autoComplete="new-password"
              value={confirmarSenha}
              onChange={e => setConfirmarSenha(e.target.value)}
              placeholder="Repita sua nova senha"
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray/25 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          <button
            type="submit"
            disabled={salvando}
            className="w-full py-2.5 px-4 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary-dark transition-all disabled:opacity-50 cursor-pointer"
          >
            {salvando ? 'Salvando nova senha...' : 'Salvar Senha e Acessar Sistema'}
          </button>
        </form>
      </div>
    </main>
  );
}
