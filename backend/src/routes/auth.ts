import { randomBytes } from 'node:crypto';
import { Router, type CookieOptions } from 'express';
import type { RowDataPacket } from 'mysql2';
import rateLimit from 'express-rate-limit';
import pool, { executarTransacao } from '../config/database.js';
import { COOKIE_TOKEN_NAME, DURACAO_SESSAO_SEGUNDOS, exigirAutenticacao, extrairToken,
  gerarHashSenha, identificarSessao, verificarSenha, type UsuarioAutenticado } from '../middleware/auth.js';

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
    const identificadorBruto = typeof req.body?.login === 'string' && req.body.login.trim()
      ? req.body.login
      : (typeof req.body?.email === 'string' ? req.body.email : '');
    const identificador = identificadorBruto.trim().toLowerCase();
    const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';
    if (!identificador || !senha) {
      res.status(400).json({ sucesso: false, erro: 'Usuário e senha são obrigatórios.' });
      return;
    }
    const [[credencial]] = await pool.query<RowDataPacket[]>(
      'SELECT id_usuario, senha_hash FROM usuario WHERE email = ? OR login = ? LIMIT 1',
      [identificador, identificador]
    );
    const senhaValida = await verificarSenha(senha, credencial?.senha_hash ?? hashSimulado);
    if (!senhaValida || !credencial) {
      res.status(401).json({ sucesso: false, erro: 'E-mail ou senha inválidos.' });
      return;
    }
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

router.post('/trocar-senha', exigirAutenticacao, async (req, res) => {
  try {
    const novaSenha = typeof req.body?.nova_senha === 'string' ? req.body.nova_senha : '';
    const confirmarSenha = typeof req.body?.confirmar_senha === 'string' ? req.body.confirmar_senha : novaSenha;
    if (!novaSenha || novaSenha.length < 6) {
      res.status(400).json({ sucesso: false, erro: 'A nova senha deve ter pelo menos 6 caracteres.' });
      return;
    }
    if (novaSenha !== confirmarSenha) {
      res.status(400).json({ sucesso: false, erro: 'A confirmação da senha não confere.' });
      return;
    }
    if (novaSenha === 'Ikigai@123') {
      res.status(400).json({ sucesso: false, erro: 'Escolha uma senha diferente da senha padrão inicial.' });
      return;
    }
    const hash = await gerarHashSenha(novaSenha);
    await pool.query(
      'UPDATE usuario SET senha_hash = ?, precisa_trocar_senha = 0 WHERE id_usuario = ?',
      [hash, req.usuario!.id]
    );
    res.json({
      sucesso: true,
      mensagem: 'Senha definida com sucesso!',
      dados: { primeiro_acesso: false },
    });
  } catch {
    res.status(500).json({ sucesso: false, erro: 'Não foi possível atualizar a senha.' });
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
