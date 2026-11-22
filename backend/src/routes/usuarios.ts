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
      `SELECT u.id_usuario AS id,
              u.nome,
              u.email,
              u.perfil,
              u.id_profissional AS profissional_id,
              p.nome AS profissional_nome,
              p.especialidade_principal AS profissional_especialidade,
              p.ativo AS profissional_ativo,
              u.ativo,
              DATE_FORMAT(u.criado_em, '%Y-%m-%dT%H:%i:%s') AS criado_em
       FROM usuario u
       LEFT JOIN profissional p ON u.id_profissional = p.id_profissional
       ORDER BY u.nome ASC`
    );
    return res.json({ sucesso: true, dados: rows });
  } catch {
    return res.status(500).json({ sucesso: false, erro: 'Erro ao listar usuários.' });
  }
});

// POST /api/usuarios
router.post('/', async (req: Request, res: Response): Promise<any> => {
  const conn = await pool.getConnection();
  try {
    const nome = sanitizarTexto(String(req.body?.nome || ''));
    const email = sanitizarTexto(String(req.body?.email || '')).toLowerCase();
    const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';
    const perfil = String(req.body?.perfil || 'RECEPCAO').toUpperCase() as PerfilUsuario;
    const especialidade = sanitizarTexto(String(req.body?.especialidade || '')).trim() || 'Especialista';
    const rawProfId = req.body?.profissional_id;
    const profissionalIdInformado = rawProfId != null && rawProfId !== '' && Number(rawProfId) > 0
      ? Number(rawProfId)
      : null;

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

    await conn.beginTransaction();

    const [existente] = await conn.query<any[]>('SELECT id_usuario FROM usuario WHERE email = ? FOR UPDATE', [email]);
    if (existente.length) {
      await conn.rollback();
      return res.status(409).json({ sucesso: false, erro: 'Já existe um usuário com este e-mail.' });
    }

    let idProfissionalVinculado: number | null = null;
    let especialidadeFinal: string | null = null;

    if (perfil === 'PROFISSIONAL') {
      if (profissionalIdInformado) {
        if (!Number.isInteger(profissionalIdInformado) || profissionalIdInformado <= 0) {
          await conn.rollback();
          return res.status(400).json({ sucesso: false, erro: 'Profissional selecionado inválido.' });
        }
        const [profExiste] = await conn.query<any[]>(
          'SELECT id_profissional, especialidade_principal FROM profissional WHERE id_profissional = ? FOR UPDATE',
          [profissionalIdInformado]
        );
        if (!profExiste.length) {
          await conn.rollback();
          return res.status(404).json({ sucesso: false, erro: 'Profissional selecionado não encontrado na clínica.' });
        }
        const [vinculoExistente] = await conn.query<any[]>(
          'SELECT id_usuario, nome FROM usuario WHERE id_profissional = ? LIMIT 1',
          [profissionalIdInformado]
        );
        if (vinculoExistente.length) {
          await conn.rollback();
          return res.status(409).json({
            sucesso: false,
            erro: `Este profissional já possui login vinculado (${vinculoExistente[0].nome}).`,
          });
        }
        const espAtualizada = req.body?.especialidade ? especialidade : (profExiste[0].especialidade_principal || 'Especialista');
        await conn.query(
          'UPDATE profissional SET nome = ?, email = ?, especialidade_principal = ? WHERE id_profissional = ?',
          [nome, email, espAtualizada, profissionalIdInformado]
        );
        idProfissionalVinculado = profissionalIdInformado;
        especialidadeFinal = espAtualizada;
      } else {
        // Cadastra o novo profissional na tabela profissional e vincula 1:1 na mesma transação
        const [novoProf]: any = await conn.query(
          'INSERT INTO profissional (nome, especialidade_principal, email, ativo) VALUES (?, ?, ?, 1)',
          [nome, especialidade, email]
        );
        idProfissionalVinculado = Number(novoProf.insertId);
        especialidadeFinal = especialidade;
      }
    }

    const senhaHash = gerarHashSenha(senha);
    const [resultado]: any = await conn.query(
      'INSERT INTO usuario (nome, email, senha_hash, perfil, id_profissional, ativo) VALUES (?, ?, ?, ?, ?, 1)',
      [nome, email, senhaHash, perfil, idProfissionalVinculado]
    );

    await conn.commit();

    return res.status(201).json({
      sucesso: true,
      mensagem: 'Usuário criado com sucesso.',
      dados: {
        id: resultado.insertId,
        nome,
        email,
        perfil,
        profissional_id: idProfissionalVinculado,
        profissional_nome: idProfissionalVinculado ? nome : null,
        profissional_especialidade: especialidadeFinal,
        ativo: 1,
      },
    });
  } catch {
    try { await conn.rollback(); } catch {}
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao criar usuário.' });
  } finally {
    conn.release();
  }
});

// PUT /api/usuarios/:id
router.put('/:id', async (req: Request, res: Response): Promise<any> => {
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ sucesso: false, erro: 'ID de usuário inválido.' });
    }

    const nome = sanitizarTexto(String(req.body?.nome || ''));
    const email = sanitizarTexto(String(req.body?.email || '')).toLowerCase();
    const perfil = String(req.body?.perfil || '').toUpperCase() as PerfilUsuario;
    const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';
    const especialidade = sanitizarTexto(String(req.body?.especialidade || '')).trim();
    const rawProfId = req.body?.profissional_id;
    const profissionalIdInformado = rawProfId != null && rawProfId !== '' && Number(rawProfId) > 0
      ? Number(rawProfId)
      : null;

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

    await conn.beginTransaction();

    const [atual] = await conn.query<any[]>(
      'SELECT id_usuario, id_profissional FROM usuario WHERE id_usuario = ? FOR UPDATE',
      [id]
    );
    if (!atual.length) {
      await conn.rollback();
      return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado.' });
    }

    const [duplicado] = await conn.query<any[]>(
      'SELECT id_usuario FROM usuario WHERE email = ? AND id_usuario <> ?',
      [email, id]
    );
    if (duplicado.length) {
      await conn.rollback();
      return res.status(409).json({ sucesso: false, erro: 'E-mail já utilizado por outro usuário.' });
    }

    if (req.usuario?.id === id && perfil !== 'ADMIN') {
      await conn.rollback();
      return res.status(409).json({ sucesso: false, erro: 'Não é possível remover seu próprio perfil de administrador.' });
    }

    let idProfissionalVinculado: number | null = null;

    if (perfil === 'PROFISSIONAL') {
      const targetProfId = profissionalIdInformado ?? (atual[0].id_profissional ? Number(atual[0].id_profissional) : null);

      if (targetProfId) {
        const [profExiste] = await conn.query<any[]>(
          'SELECT id_profissional, especialidade_principal FROM profissional WHERE id_profissional = ? FOR UPDATE',
          [targetProfId]
        );
        if (!profExiste.length) {
          await conn.rollback();
          return res.status(404).json({ sucesso: false, erro: 'Profissional selecionado não encontrado na clínica.' });
        }
        const [outroUsuario] = await conn.query<any[]>(
          'SELECT id_usuario, nome FROM usuario WHERE id_profissional = ? AND id_usuario <> ? LIMIT 1',
          [targetProfId, id]
        );
        if (outroUsuario.length) {
          await conn.rollback();
          return res.status(409).json({
            sucesso: false,
            erro: `Este profissional já está vinculado ao usuário "${outroUsuario[0].nome}".`,
          });
        }
        const espFinal = especialidade || profExiste[0].especialidade_principal || 'Especialista';
        await conn.query(
          'UPDATE profissional SET nome = ?, email = ?, especialidade_principal = ? WHERE id_profissional = ?',
          [nome, email, espFinal, targetProfId]
        );
        idProfissionalVinculado = targetProfId;
      } else {
        const [novoProf]: any = await conn.query(
          'INSERT INTO profissional (nome, especialidade_principal, email, ativo) VALUES (?, ?, ?, 1)',
          [nome, especialidade || 'Especialista', email]
        );
        idProfissionalVinculado = Number(novoProf.insertId);
      }
    }

    if (senha) {
      const senhaHash = gerarHashSenha(senha);
      await conn.query(
        'UPDATE usuario SET nome = ?, email = ?, perfil = ?, id_profissional = ?, senha_hash = ? WHERE id_usuario = ?',
        [nome, email, perfil, idProfissionalVinculado, senhaHash, id]
      );
    } else {
      await conn.query(
        'UPDATE usuario SET nome = ?, email = ?, perfil = ?, id_profissional = ? WHERE id_usuario = ?',
        [nome, email, perfil, idProfissionalVinculado, id]
      );
    }

    await conn.commit();

    return res.json({
      sucesso: true,
      mensagem: 'Usuário atualizado com sucesso.',
      dados: { id, nome, email, perfil, profissional_id: idProfissionalVinculado },
    });
  } catch {
    try { await conn.rollback(); } catch {}
    return res.status(500).json({ sucesso: false, erro: 'Erro interno ao atualizar usuário.' });
  } finally {
    conn.release();
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
