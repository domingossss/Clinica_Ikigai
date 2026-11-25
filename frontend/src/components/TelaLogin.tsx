import { useRef, useState, type FormEvent } from 'react';
import { efetuarLogin, type UsuarioSessao } from '../services/auth';
import CampoSenha from './CampoSenha';

interface TelaLoginProps {
  onLoginSuccess: (usuario: UsuarioSessao) => void;
}

export default function TelaLogin({ onLoginSuccess }: TelaLoginProps) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const envioRef = useRef(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (envioRef.current) return;
    const identificador = email.trim();
    if (!identificador || !senha) {
      setErro('Informe seu usuário ou e-mail e sua senha.');
      return;
    }
    envioRef.current = true;
    setErro(null);
    setCarregando(true);
    try {
      const usuario = await efetuarLogin(identificador, senha);
      onLoginSuccess(usuario);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível conectar ao servidor.');
    } finally {
      envioRef.current = false;
      setCarregando(false);
    }
  }

  return (
    <main className="min-h-screen bg-light-gray flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray/15 overflow-hidden">
        <div className="bg-dark text-white px-6 py-5 flex items-center gap-3">
          <img src="/logo.png" alt="Clínica Ikigai" className="w-10 h-10 rounded-xl object-cover bg-white/10" />
          <div>
            <h1 className="text-lg font-bold leading-tight">Clínica Ikigai</h1>
            <p className="text-xs text-white/70">Acesso ao Sistema de Gestão</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {erro && (
            <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-4 py-3 font-medium">
              {erro}
            </div>
          )}

          <div>
            <label htmlFor="login-email" className="block text-xs font-bold text-dark mb-1.5">
              Usuário (nome.ultimonome) ou e-mail
            </label>
            <input
              id="login-email"
              type="text"
              required
              autoComplete="username"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Ex.: ulisses.higo"
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray/25 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          <div>
            <label htmlFor="login-senha" className="block text-xs font-bold text-dark mb-1.5">
              Senha
            </label>
            <CampoSenha
              id="login-senha"
              required
              autoComplete="current-password"
              value={senha}
              onChange={e => setSenha(e.target.value)}
              placeholder="Digite sua senha"
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray/25 text-sm text-dark focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          <button
            type="submit"
            disabled={carregando}
            className="w-full py-2.5 px-4 rounded-xl bg-dark text-white text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
          >
            {carregando ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </main>
  );
}
