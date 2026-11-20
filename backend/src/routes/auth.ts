import { Router, type Request, type Response } from 'express';
import pool from '../config/database.js';
import { sanitizarTexto } from '../middleware/security.js';
import {
  COOKIE_TOKEN_NAME,
  assinarToken,
  exigirAutenticacao,
  verificarSenha,
} from '../middleware/auth.js';

const router = Router();

// POST /api/auth/login (IK-91)
router.post('/login', async (req: Request, res: Response): Promise<any> => {
  try {
    const email = sanitizarTexto(String(req.body?.email || '')).toLowerCase();
    const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';

    if (!email || !senha) {
      return res.status(400).json({ sucesso: false, erro: 'E-mail e senha são obrigatórios.' });
    }

    const [rows] = await pool.query<any[]>(
      'SELECT id_usuario AS id, nome, email, senha_hash, perfil, ativo FROM usuario WHERE email = ? LIMIT 1',
      [email]
    );

    if (!rows.length) {
      return res.status(401).json({ sucesso: false, erro: 'E-mail ou senha inválidos.' });
    }

    const user = rows[0];
    if (!user.ativo) {
      return res.status(403).json({ sucesso: false, erro: 'Usuário inativo. Contate o administrador.' });
    }

    if (!verificarSenha(senha, user.senha_hash)) {
      return res.status(401).json({ sucesso: false, erro: 'E-mail ou senha inválidos.' });
    }

    const usuario = {
      id: Number(user.id),
      nome: user.nome,
      email: user.email,
      perfil: user.perfil,
    };

    const token = assinarToken(usuario);
    res.cookie(COOKIE_TOKEN_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 12 * 60 * 60 * 1000,
      path: '/',
    });

    return res.json({
      sucesso: true,
      dados: { usuario, token },
    });
  } catch {
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao autenticar usuário.' });
  }
});

// POST /api/auth/logout (IK-91)
router.post('/logout', (_req: Request, res: Response): any => {
  res.clearCookie(COOKIE_TOKEN_NAME, { path: '/' });
  return res.json({ sucesso: true, mensagem: 'Sessão encerrada.' });
});

// GET /api/auth/me (IK-91)
router.get('/me', exigirAutenticacao, (req: Request, res: Response): any => {
  return res.json({ sucesso: true, dados: req.usuario });
});

export default router;
