import { randomBytes } from 'node:crypto';
import { Router, type CookieOptions } from 'express';
import type { RowDataPacket } from 'mysql2';
import rateLimit from 'express-rate-limit';
import pool, { executarTransacao } from '../config/database.js';
import { COOKIE_TOKEN_NAME, DURACAO_SESSAO_SEGUNDOS, exigirAutenticacao, extrairToken,
  identificarSessao, verificarSenha, type UsuarioAutenticado } from '../middleware/auth.js';

const router = Router();
const hashSimulado = `${randomBytes(16).toString('hex')}:${randomBytes(64).toString('hex')}`;
const limitarLogin = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { sucesso: false, erro: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
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
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';
    if (!email || !senha) {
      res.status(400).json({ sucesso: false, erro: 'E-mail e senha são obrigatórios.' });
      return;
    }
    const [[credencial]] = await pool.query<RowDataPacket[]>('SELECT id_usuario, senha_hash FROM usuario WHERE email = ?', [email]);
    const senhaValida = await verificarSenha(senha, credencial?.senha_hash ?? hashSimulado);
    if (!senhaValida || !credencial) {
      res.status(401).json({ sucesso: false, erro: 'E-mail ou senha inválidos.' });
      return;
    }
    const token = randomBytes(32).toString('base64url');
    const usuario = await executarTransacao(async conexao => {
      const [rows] = await conexao.query<(RowDataPacket & UsuarioAutenticado & { senha_hash: string, ativo: number, profissional_ativo: number | null })[]>(
        `SELECT u.id_usuario AS id, u.nome, u.email, u.perfil, u.senha_hash, u.ativo,
           u.id_profissional AS profissional_id, p.nome AS profissional_nome,
           p.especialidade_principal AS profissional_especialidade, p.ativo AS profissional_ativo
         FROM usuario u LEFT JOIN profissional p ON p.id_profissional = u.id_profissional
         WHERE u.email = ? FOR UPDATE`,
        [email]
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
      return { id: atual.id, nome: atual.nome, email: atual.email, perfil: atual.perfil,
        profissional_id: atual.profissional_id, profissional_nome: atual.profissional_nome,
        profissional_especialidade: atual.profissional_especialidade };
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

router.post('/logout', async (req, res) => {
  try {
    const token = extrairToken(req);
    if (token) await pool.query('DELETE FROM sessao_usuario WHERE identificador = ?', [identificarSessao(token)]);
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
