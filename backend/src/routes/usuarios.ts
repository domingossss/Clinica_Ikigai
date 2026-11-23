import { Router, type Request, type Response } from 'express';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import pool, { ErroOperacao } from '../config/database.js';
import { sanitizarTexto } from '../middleware/security.js';
import { gerarHashSenha, type PerfilUsuario } from '../middleware/auth.js';
import { transacaoUsuarios } from '../services/transacaoUsuarios.js';

const router = Router();
async function vincularProfissional(conexao: PoolConnection, req: Request, usuario: ReturnType<typeof lerUsuario>, id: number | null, profissionalAtual: number | null = null) {
  if (usuario.perfil !== 'PROFISSIONAL') return null;
  const alvo: unknown = req.body?.profissional_id ?? profissionalAtual;
  const especialidade = sanitizarTexto(typeof req.body?.especialidade === 'string' ? req.body.especialidade : '').trim();
  if (alvo === null) {
    const [novo] = await conexao.query<ResultSetHeader>(
      'INSERT INTO profissional (nome, email, especialidade_principal, ativo) VALUES (?, ?, ?, 1)',
      [usuario.nome, usuario.email, especialidade || 'Especialista']);
    return novo.insertId;
  }
  if (!Number.isSafeInteger(alvo) || Number(alvo) < 1) throw new ErroOperacao(400, 'Profissional inválido.');
  const [profissionais] = await conexao.query<RowDataPacket[]>(
    'SELECT id_profissional FROM profissional WHERE id_profissional = ? FOR UPDATE', [alvo]);
  if (!profissionais.length) throw new ErroOperacao(404, 'Profissional não encontrado.');
  const [vinculos] = await conexao.query<RowDataPacket[]>(
    'SELECT id_usuario FROM usuario WHERE id_profissional = ? AND id_usuario <> ?', [alvo, id ?? 0]);
  if (vinculos.length) throw new ErroOperacao(409, 'Este profissional já possui usuário vinculado.');
  await conexao.query(
    'UPDATE profissional SET nome = ?, email = ?, especialidade_principal = COALESCE(?, especialidade_principal) WHERE id_profissional = ?',
    [usuario.nome, usuario.email, especialidade || null, alvo]);
  return Number(alvo);
}

const perfis: PerfilUsuario[] = ['ADMIN', 'RECEPCAO', 'PROFISSIONAL'];

function lerUsuario(req: Request, novo: boolean) {
  const nome = sanitizarTexto(req.body?.nome);
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const perfil = String(req.body?.perfil ?? (novo ? 'RECEPCAO' : '')).toUpperCase() as PerfilUsuario;
  const senha = req.body?.senha ?? '';
  if (nome.length < 2 || nome.length > 150) throw new ErroOperacao(400, 'Nome deve ter entre 2 e 150 caracteres.');
  if (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErroOperacao(400, 'E-mail inválido.');
  if (!perfis.includes(perfil)) throw new ErroOperacao(400, 'Perfil inválido.');
  if (typeof senha !== 'string' || ((novo || senha) && senha.length < 6)) {
    throw new ErroOperacao(400, 'A senha deve ter pelo menos 6 caracteres.');
  }
  return { nome, email, perfil, senha };
}

function responderErro(res: Response, erro: unknown) {
  if (erro instanceof ErroOperacao) {
    res.status(erro.status).json({ sucesso: false, erro: erro.message });
  } else if ((erro as { code?: string })?.code === 'ER_DUP_ENTRY') {
    res.status(409).json({ sucesso: false, erro: 'Já existe um usuário com este e-mail.' });
  } else {
    res.status(500).json({ sucesso: false, erro: 'Não foi possível concluir a operação com usuários.' });
  }
}

function lerId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new ErroOperacao(400, 'ID de usuário inválido.');
  return id;
}

async function editarComoAdmin<T>(req: Request, id: number | null, operacao: (conexao: PoolConnection) => Promise<T>) {
  const autor = req.usuario?.id;
  if (!autor) throw new ErroOperacao(401, 'Autenticação necessária.');
  return transacaoUsuarios(async conexao => {
    // Bloquear autor e destino na mesma ordem impede que dois administradores removam o acesso um do outro.
    const ids = [...new Set(id === null ? [autor] : [autor, id])].sort((a, b) => a - b);
    for (const atual of ids) {
      const [rows] = await conexao.query<RowDataPacket[]>('SELECT perfil, ativo FROM usuario WHERE id_usuario = ? FOR UPDATE', [atual]);
      if (atual === autor && (!rows[0]?.ativo || rows[0].perfil !== 'ADMIN')) {
        throw new ErroOperacao(403, 'A operação exige um administrador ativo.');
      }
      if (!rows.length) throw new ErroOperacao(404, 'Usuário não encontrado.');
    }
    return operacao(conexao);
  });
}

router.get('/', async (_req, res) => {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.id_usuario AS id, u.nome, u.email, u.perfil, u.ativo,
              u.id_profissional AS profissional_id, p.nome AS profissional_nome,
              p.especialidade_principal AS profissional_especialidade, p.ativo AS profissional_ativo,
              DATE_FORMAT(u.criado_em, '%Y-%m-%dT%H:%i:%s') AS criado_em
       FROM usuario u LEFT JOIN profissional p ON p.id_profissional = u.id_profissional ORDER BY u.nome ASC`
    );
    res.json({ sucesso: true, dados: rows });
  } catch (erro) { responderErro(res, erro); }
});

router.post('/', async (req, res) => {
  try {
    const { nome, email, senha, perfil } = lerUsuario(req, true);
    const hash = gerarHashSenha(senha);
    const dados = await editarComoAdmin(req, null, async conexao => {
      const profissional_id = await vincularProfissional(conexao, req, { nome, email, senha, perfil }, null);
      const [resultado] = await conexao.query<ResultSetHeader>(
        'INSERT INTO usuario (nome, email, senha_hash, perfil, id_profissional, ativo) VALUES (?, ?, ?, ?, ?, 1)', [nome, email, hash, perfil, profissional_id]
      );
      return { id: resultado.insertId, profissional_id };
    });
    res.status(201).json({ sucesso: true, mensagem: 'Usuário criado com sucesso.', dados: { ...dados, nome, email, perfil, ativo: 1 } });
  } catch (erro) { responderErro(res, erro); }
});

router.put('/:id', async (req, res) => {
  try {
    const id = lerId(req);
    const { nome, email, senha, perfil } = lerUsuario(req, false);
    if (req.usuario?.id === id && perfil !== 'ADMIN') throw new ErroOperacao(409, 'Não é possível remover seu próprio perfil de administrador.');
    const hash = senha ? gerarHashSenha(senha) : null;
    const profissional_id = await editarComoAdmin(req, id, async conexao => {
      const [[anterior]] = await conexao.query<RowDataPacket[]>(
        'SELECT perfil, id_profissional FROM usuario WHERE id_usuario = ?', [id]);
      const vinculo = await vincularProfissional(conexao, req, { nome, email, senha, perfil }, id, anterior.id_profissional);
      const revogarSessao = anterior.perfil === 'PROFISSIONAL' &&
        (anterior.id_profissional === null || anterior.id_profissional !== vinculo);
      await conexao.query('UPDATE usuario SET nome = ?, email = ?, perfil = ?, id_profissional = ?, senha_hash = COALESCE(?, senha_hash) WHERE id_usuario = ?',
        [nome, email, perfil, vinculo, hash, id]);
      if (hash || revogarSessao) await conexao.query('DELETE FROM sessao_usuario WHERE id_usuario = ?', [id]);
      return vinculo;
    });
    res.json({ sucesso: true, mensagem: 'Usuário atualizado com sucesso.', dados: { id, nome, email, perfil, profissional_id } });
  } catch (erro) { responderErro(res, erro); }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const id = lerId(req);
    const ativo = req.body?.ativo;
    if (typeof ativo !== 'boolean') throw new ErroOperacao(400, 'O campo ativo deve ser booleano.');
    if (req.usuario?.id === id && !ativo) throw new ErroOperacao(409, 'Não é possível inativar o próprio usuário.');
    await editarComoAdmin(req, id, async conexao => {
      await conexao.query('UPDATE usuario SET ativo = ? WHERE id_usuario = ?', [ativo, id]);
      if (!ativo) await conexao.query('DELETE FROM sessao_usuario WHERE id_usuario = ?', [id]);
    });
    res.json({ sucesso: true, mensagem: ativo ? 'Usuário ativado.' : 'Usuário inativado.', dados: { id, ativo } });
  } catch (erro) { responderErro(res, erro); }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = lerId(req);
    if (req.usuario?.id === id) throw new ErroOperacao(409, 'Não é possível excluir o próprio usuário.');
    await editarComoAdmin(req, id, async conexao => {
      await conexao.query('DELETE FROM usuario WHERE id_usuario = ?', [id]);
    });
    res.json({ sucesso: true, mensagem: 'Usuário excluído.' });
  } catch (erro) { responderErro(res, erro); }
});

export default router;
