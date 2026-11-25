import { randomBytes } from 'node:crypto';
import { Router, type CookieOptions, type Request, type Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import rateLimit from 'express-rate-limit';
import pool, { executarTransacao } from '../config/database.js';
import { COOKIE_TOKEN_NAME, DURACAO_SESSAO_SEGUNDOS, exigirAutenticacao, extrairToken,
  gerarHashSenha, identificarSessao, verificarSenha, type UsuarioAutenticado } from '../middleware/auth.js';
import { encerrarConexoesUsuario } from '../services/alteracoesClinica.js';

const router = Router();
const hashSimulado = `${randomBytes(16).toString('hex')}:${randomBytes(64).toString('hex')}`;
const MIN_SENHA_CHARS = 8;
const MAX_SENHA_CHARS = 128;
const JANELA_BLOQUEIO_CONTA_MS = 15 * 60_000;
const MAX_FALHAS_POR_CONTA = 10;
const falhasPorConta = new Map<string, { tentativas: number; bloqueadoAte: number; ultimaTentativa: number }>();

function verificarBloqueioConta(chave: string): boolean {
  const registro = falhasPorConta.get(chave);
  if (!registro) return false;
  const agora = Date.now();
  if (registro.bloqueadoAte > agora) return true;
  if (agora - registro.ultimaTentativa > JANELA_BLOQUEIO_CONTA_MS) {
    falhasPorConta.delete(chave);
  }
  return false;
}

function registrarFalhaConta(chave: string): void {
  const agora = Date.now();
  // Limita tamanho do mapa em memória (evita crescimento ilimitado)
  if (falhasPorConta.size >= 2000) {
    for (const [k, v] of falhasPorConta.entries()) {
      if (agora - v.ultimaTentativa > JANELA_BLOQUEIO_CONTA_MS) falhasPorConta.delete(k);
    }
    if (falhasPorConta.size >= 2000) {
      const maisAntiga = falhasPorConta.keys().next().value;
      if (maisAntiga) falhasPorConta.delete(maisAntiga);
    }
  }
  const atual = falhasPorConta.get(chave);
  const tentativas = atual && (agora - atual.ultimaTentativa <= JANELA_BLOQUEIO_CONTA_MS)
    ? atual.tentativas + 1
    : 1;
  falhasPorConta.set(chave, {
    tentativas,
    ultimaTentativa: agora,
    bloqueadoAte: tentativas >= MAX_FALHAS_POR_CONTA ? agora + JANELA_BLOQUEIO_CONTA_MS : 0,
  });
}
const limitarLogin = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { sucesso: false, erro: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
});
const limitarTrocaSenha = rateLimit({
  windowMs: 15 * 60_000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { sucesso: false, erro: 'Muitas tentativas de alteração de senha. Aguarde alguns minutos.' },
});
const opcoesCookie = (): CookieOptions => ({
  httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production',
});

router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

router.post('/login', limitarLogin, async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production' && !req.secure) {
      res.status(403).json({ sucesso: false, erro: 'O login exige conexão HTTPS.' });
      return;
    }
    const identificadorBruto = typeof req.body?.login === 'string' && req.body.login.trim()
      ? req.body.login
      : (typeof req.body?.email === 'string' ? req.body.email : '');
    const identificador = identificadorBruto.trim().toLowerCase();
    const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';
    if (!identificador || !senha) {
      res.status(400).json({ sucesso: false, erro: 'Usuário e senha são obrigatórios.' });
      return;
    }
    if (senha.length > MAX_SENHA_CHARS) {
      res.status(401).json({ sucesso: false, erro: 'E-mail ou senha inválidos.' });
      return;
    }
    if (verificarBloqueioConta(identificador)) {
      res.status(429).json({ sucesso: false, erro: 'Conta temporariamente bloqueada por excesso de tentativas. Aguarde alguns minutos.' });
      return;
    }
    const [[credencial]] = await pool.query<RowDataPacket[]>(
      'SELECT id_usuario, senha_hash FROM usuario WHERE email = ? OR login = ? LIMIT 1',
      [identificador, identificador]
    );
    const senhaValida = await verificarSenha(senha, credencial?.senha_hash ?? hashSimulado);
    if (!senhaValida || !credencial) {
      registrarFalhaConta(identificador);
      res.status(401).json({ sucesso: false, erro: 'E-mail ou senha inválidos.' });
      return;
    }
    falhasPorConta.delete(identificador);
    const token = randomBytes(32).toString('base64url');
    const usuario = await executarTransacao(async conexao => {
      const [rows] = await conexao.query<(RowDataPacket & UsuarioAutenticado & { senha_hash: string, ativo: number, profissional_ativo: number | null })[]>(
        `SELECT u.id_usuario AS id, u.nome, u.login, u.email, u.perfil, u.senha_hash,
           u.precisa_trocar_senha, u.ativo,
           u.id_profissional AS profissional_id, p.nome AS profissional_nome,
           p.especialidade_principal AS profissional_especialidade, p.ativo AS profissional_ativo
         FROM usuario u LEFT JOIN profissional p ON p.id_profissional = u.id_profissional
         WHERE u.id_usuario = ? FOR UPDATE`,
        [credencial.id_usuario]
      );
      const atual = rows[0];
      if (!atual?.ativo || atual.id !== credencial.id_usuario || atual.senha_hash !== credencial.senha_hash ||
        (atual.perfil === 'PROFISSIONAL' && atual.profissional_ativo !== 1)) return null;
      const anterior = extrairToken(req);
      if (anterior) await conexao.query('DELETE FROM sessao_usuario WHERE identificador = ?', [identificarSessao(anterior)]);
      await conexao.query('DELETE FROM sessao_usuario WHERE id_usuario = ? AND expira_em <= UTC_TIMESTAMP()', [atual.id]);
      await conexao.query(
        'INSERT INTO sessao_usuario (identificador, id_usuario, expira_em) VALUES (?, ?, TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP()))',
        [identificarSessao(token), atual.id, DURACAO_SESSAO_SEGUNDOS]
      );
      return {
        id: atual.id,
        nome: atual.nome,
        login: atual.login,
        email: atual.email,
        perfil: atual.perfil,
        primeiro_acesso: Boolean(atual.precisa_trocar_senha),
        profissional_id: atual.profissional_id,
        profissional_nome: atual.profissional_nome,
        profissional_especialidade: atual.profissional_especialidade,
      };
    });
    if (!usuario) {
      res.status(401).json({ sucesso: false, erro: 'E-mail ou senha inválidos.' });
      return;
    }
    res.cookie(COOKIE_TOKEN_NAME, token, { ...opcoesCookie(), maxAge: DURACAO_SESSAO_SEGUNDOS * 1000 });
    res.json({ sucesso: true, dados: { usuario } });
  } catch {
    res.status(503).json({ sucesso: false, erro: 'Serviço de autenticação indisponível.' });
  }
});

async function executarTrocaSenha(
  req: Request,
  res: Response,
  apenasPrimeiroAcesso: boolean
): Promise<void> {
  try {
    const novaSenha = typeof req.body?.nova_senha === 'string' ? req.body.nova_senha : '';
    const confirmarSenha = typeof req.body?.confirmar_senha === 'string' ? req.body.confirmar_senha : '';
    const senhaAtual = typeof req.body?.senha_atual === 'string' ? req.body.senha_atual : '';

    if (!novaSenha || !novaSenha.trim() || novaSenha.length < MIN_SENHA_CHARS || novaSenha.length > MAX_SENHA_CHARS) {
      res.status(400).json({ sucesso: false, erro: `A nova senha deve ter entre ${MIN_SENHA_CHARS} e ${MAX_SENHA_CHARS} caracteres.` });
      return;
    }
    if (!confirmarSenha || novaSenha !== confirmarSenha) {
      res.status(400).json({ sucesso: false, erro: 'A confirmação da senha não confere.' });
      return;
    }

    const [[usuarioDb]] = await pool.query<RowDataPacket[]>(
      'SELECT senha_hash, precisa_trocar_senha FROM usuario WHERE id_usuario = ? LIMIT 1',
      [req.usuario!.id]
    );
    if (!usuarioDb) {
      res.status(401).json({ sucesso: false, erro: 'Sessão inválida.' });
      return;
    }

    if (apenasPrimeiroAcesso && !usuarioDb.precisa_trocar_senha) {
      res.status(403).json({
        sucesso: false,
        erro: 'Esta rota é exclusiva para a definição de senha no primeiro acesso.',
      });
      return;
    }

    // Fora do primeiro acesso, exige confirmação da senha atual
    if (!usuarioDb.precisa_trocar_senha) {
      if (!senhaAtual || !(await verificarSenha(senhaAtual, String(usuarioDb.senha_hash)))) {
        res.status(400).json({ sucesso: false, erro: 'A senha atual informada está incorreta.' });
        return;
      }
    }

    // Impede reutilizar a mesma senha anterior/temporária
    if (await verificarSenha(novaSenha, String(usuarioDb.senha_hash))) {
      res.status(400).json({ sucesso: false, erro: 'Escolha uma senha diferente da senha atual.' });
      return;
    }

    const hash = await gerarHashSenha(novaSenha);
    const novoToken = randomBytes(32).toString('base64url');
    await executarTransacao(async conexao => {
      await conexao.query(
        'UPDATE usuario SET senha_hash = ?, precisa_trocar_senha = 0 WHERE id_usuario = ?',
        [hash, req.usuario!.id]
      );
      // Revoga todas as sessões anteriores e rotaciona o token da sessão atual
      await conexao.query('DELETE FROM sessao_usuario WHERE id_usuario = ?', [req.usuario!.id]);
      await conexao.query(
        'INSERT INTO sessao_usuario (identificador, id_usuario, expira_em) VALUES (?, ?, TIMESTAMPADD(SECOND, ?, UTC_TIMESTAMP()))',
        [identificarSessao(novoToken), req.usuario!.id, DURACAO_SESSAO_SEGUNDOS]
      );
    });
    encerrarConexoesUsuario(req.usuario!.id);
    res.cookie(COOKIE_TOKEN_NAME, novoToken, { ...opcoesCookie(), maxAge: DURACAO_SESSAO_SEGUNDOS * 1000 });
    res.json({
      sucesso: true,
      mensagem: 'Senha definida com sucesso!',
      dados: { primeiro_acesso: false },
    });
  } catch {
    res.status(500).json({ sucesso: false, erro: 'Não foi possível atualizar a senha.' });
  }
}

router.post('/primeiro-acesso/senha', limitarTrocaSenha, exigirAutenticacao, (req, res) =>
  executarTrocaSenha(req, res, true)
);

router.post('/trocar-senha', limitarTrocaSenha, exigirAutenticacao, (req, res) =>
  executarTrocaSenha(req, res, false)
);

router.post('/logout', async (req, res) => {
  try {
    const token = extrairToken(req);
    if (token) {
      const identificador = identificarSessao(token);
      const [rows] = await pool.query<RowDataPacket[]>('SELECT id_usuario FROM sessao_usuario WHERE identificador = ? LIMIT 1', [identificador]);
      await pool.query('DELETE FROM sessao_usuario WHERE identificador = ?', [identificador]);
      if (rows[0]?.id_usuario) encerrarConexoesUsuario(Number(rows[0].id_usuario));
    }
    res.clearCookie(COOKIE_TOKEN_NAME, opcoesCookie());
    res.json({ sucesso: true, mensagem: 'Sessão encerrada.' });
  } catch {
    res.status(503).json({ sucesso: false, erro: 'Não foi possível encerrar a sessão.' });
  }
});

router.get('/me', exigirAutenticacao, (req, res) => {
  res.json({ sucesso: true, dados: req.usuario });
});

export default router;
