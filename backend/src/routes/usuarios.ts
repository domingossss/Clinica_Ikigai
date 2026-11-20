import { Router, type Request, type Response } from 'express';
import pool from '../config/database.js';
import { sanitizarTexto } from '../middleware/security.js';
import {
  exigirAutenticacao,
  exigirPerfil,
  gerarHashSenha,
  type PerfilUsuario,
} from '../middleware/auth.js';

const router = Router();
const PERFIS_VALIDOS: PerfilUsuario[] = ['ADMIN', 'RECEPCAO', 'PROFISSIONAL'];

function validarEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Todas as rotas de gerenciamento de usuários exigem ADMIN (IK-92, IK-93)
router.use(exigirAutenticacao, exigirPerfil('ADMIN'));

// GET /api/usuarios
router.get('/', async (_req: Request, res: Response): Promise<any> => {
  try {
    const [rows] = await pool.query<any[]>(
      `SELECT id_usuario AS id,
              nome,
              email,
              perfil,
              ativo,
              DATE_FORMAT(criado_em, '%Y-%m-%dT%H:%i:%s') AS criado_em
       FROM usuario
       ORDER BY nome ASC`
    );
    return res.json({ sucesso: true, dados: rows });
  } catch {
    return res.status(500).json({ sucesso: false, erro: 'Erro ao listar usuários.' });
  }
});

// POST /api/usuarios
router.post('/', async (req: Request, res: Response): Promise<any> => {
  try {
    const nome = sanitizarTexto(String(req.body?.nome || ''));
    const email = sanitizarTexto(String(req.body?.email || '')).toLowerCase();
    const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';
    const perfil = String(req.body?.perfil || 'RECEPCAO').toUpperCase() as PerfilUsuario;

    if (!nome || nome.length < 2) {
      return res.status(400).json({ sucesso: false, erro: 'Nome deve ter pelo menos 2 caracteres.' });
    }
    if (!validarEmail(email)) {
      return res.status(400).json({ sucesso: false, erro: 'E-mail inválido.' });
    }
    if (senha.length < 6) {
      return res.status(400).json({ sucesso: false, erro: 'A senha deve ter pelo menos 6 caracteres.' });
    }
    if (!PERFIS_VALIDOS.includes(perfil)) {
      return res.status(400).json({ sucesso: false, erro: 'Perfil inválido.' });
    }

    const [existente] = await pool.query<any[]>('SELECT id_usuario FROM usuario WHERE email = ?', [email]);
    if (existente.length) {
      return res.status(409).json({ sucesso: false, erro: 'Já existe um usuário com este e-mail.' });
    }

    const senhaHash = gerarHashSenha(senha);
    const [resultado]: any = await pool.query(
      'INSERT INTO usuario (nome, email, senha_hash, perfil, ativo) VALUES (?, ?, ?, ?, 1)',
      [nome, email, senhaHash, perfil]
    );

    return res.status(201).json({
      sucesso: true,
      mensagem: 'Usuário criado com sucesso.',
      dados: { id: resultado.insertId, nome, email, perfil, ativo: 1 },
    });
  } catch {
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao criar usuário.' });
  }
});

// PUT /api/usuarios/:id
router.put('/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ sucesso: false, erro: 'ID de usuário inválido.' });
    }

    const nome = sanitizarTexto(String(req.body?.nome || ''));
    const email = sanitizarTexto(String(req.body?.email || '')).toLowerCase();
    const perfil = String(req.body?.perfil || '').toUpperCase() as PerfilUsuario;
    const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';

    if (!nome || nome.length < 2) {
      return res.status(400).json({ sucesso: false, erro: 'Nome deve ter pelo menos 2 caracteres.' });
    }
    if (!validarEmail(email)) {
      return res.status(400).json({ sucesso: false, erro: 'E-mail inválido.' });
    }
    if (!PERFIS_VALIDOS.includes(perfil)) {
      return res.status(400).json({ sucesso: false, erro: 'Perfil inválido.' });
    }
    if (senha && senha.length < 6) {
      return res.status(400).json({ sucesso: false, erro: 'A nova senha deve ter pelo menos 6 caracteres.' });
    }

    const [atual] = await pool.query<any[]>('SELECT id_usuario FROM usuario WHERE id_usuario = ?', [id]);
    if (!atual.length) {
      return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado.' });
    }

    const [duplicado] = await pool.query<any[]>(
      'SELECT id_usuario FROM usuario WHERE email = ? AND id_usuario <> ?',
      [email, id]
    );
    if (duplicado.length) {
      return res.status(409).json({ sucesso: false, erro: 'E-mail já utilizado por outro usuário.' });
    }

    if (req.usuario?.id === id && perfil !== 'ADMIN') {
      return res.status(409).json({ sucesso: false, erro: 'Não é possível remover seu próprio perfil de administrador.' });
    }

    if (senha) {
      const senhaHash = gerarHashSenha(senha);
      await pool.query(
        'UPDATE usuario SET nome = ?, email = ?, perfil = ?, senha_hash = ? WHERE id_usuario = ?',
        [nome, email, perfil, senhaHash, id]
      );
    } else {
      await pool.query(
        'UPDATE usuario SET nome = ?, email = ?, perfil = ? WHERE id_usuario = ?',
        [nome, email, perfil, id]
      );
    }

    return res.json({
      sucesso: true,
      mensagem: 'Usuário atualizado com sucesso.',
      dados: { id, nome, email, perfil },
    });
  } catch {
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao atualizar usuário.' });
  }
});

// PATCH /api/usuarios/:id/status
router.patch('/:id/status', async (req: Request, res: Response): Promise<any> => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ sucesso: false, erro: 'ID de usuário inválido.' });
    }
    const ativo = Boolean(req.body?.ativo);

    if (req.usuario?.id === id && !ativo) {
      return res.status(409).json({ sucesso: false, erro: 'Não é possível inativar o próprio usuário.' });
    }

    const [resultado]: any = await pool.query('UPDATE usuario SET ativo = ? WHERE id_usuario = ?', [ativo ? 1 : 0, id]);
    if (!resultado.affectedRows) {
      return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado.' });
    }

    return res.json({ sucesso: true, mensagem: ativo ? 'Usuário ativado.' : 'Usuário inativado.', dados: { id, ativo } });
  } catch {
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao alterar status do usuário.' });
  }
});

export default router;
