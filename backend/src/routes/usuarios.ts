import { randomBytes } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import pool, { ErroOperacao, executarTransacao } from '../config/database.js';
import { sanitizarTexto } from '../middleware/security.js';
import { gerarHashSenha, type PerfilUsuario } from '../middleware/auth.js';
import { encerrarConexoesUsuario } from '../services/alteracoesClinica.js';

const router = Router();

/** Gera uma credencial inicial forte e exclusiva (12+ caracteres) por conta/reset. */
function gerarCredencialTemporaria(): string {
  return `Ik-${randomBytes(9).toString('base64url')}`;
}

export function gerarLoginBase(nome: string): string {
  const ignorar = new Set(['dr', 'dra', 'dr.', 'dra.', 'terapeuta', 'prof', 'prof.', 'de', 'da', 'do', 'dos', 'das', 'e']);
  const partes = nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(p => p.length > 0 && !ignorar.has(p));

  if (partes.length === 0) return 'usuario.ikigai';
  if (partes.length === 1) return partes[0];
  return `${partes[0]}.${partes[partes.length - 1]}`;
}

async function resolverLoginUnico(
  conexao: PoolConnection,
  nome: string,
  usuarioIdIgnorar: number | null = null
): Promise<string> {
  const base = gerarLoginBase(nome).slice(0, 85);
  let candidato = base;
  let sufixo = 2;
  while (true) {
    const [existentes] = await conexao.query<RowDataPacket[]>(
      'SELECT id_usuario FROM usuario WHERE login = ? AND id_usuario <> ? LIMIT 1',
      [candidato, usuarioIdIgnorar ?? 0]
    );
    if (!existentes.length) return candidato;
    candidato = `${base}${sufixo}`;
    sufixo++;
  }
}

async function vincularProfissional(conexao: PoolConnection, req: Request, usuario: ReturnType<typeof lerUsuario>, id: number | null, profissionalAtual: number | null = null) {
  if (usuario.perfil !== 'PROFISSIONAL') return null;
  const alvo: unknown = req.body?.profissional_id ?? profissionalAtual;
  const especialidade = sanitizarTexto(typeof req.body?.especialidade === 'string' ? req.body.especialidade : '').trim();
  if (especialidade) {
    await conexao.query('INSERT IGNORE INTO especialidade (nome, ativo) VALUES (?, 1)', [especialidade]);
  }
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
  const senhaInformada = req.body?.senha ?? '';
  const usarSenhaTemporaria = (novo && (senhaInformada === '' || senhaInformada === undefined || req.body?.usar_senha_padrao === true)) ||
    (!novo && req.body?.resetar_senha_padrao === true);
  const credencialTemporaria = usarSenhaTemporaria ? gerarCredencialTemporaria() : null;
  const senha = credencialTemporaria ?? senhaInformada;
  const precisaTrocarSenha = usarSenhaTemporaria || Boolean(req.body?.primeiro_acesso || req.body?.precisa_trocar_senha);

  if (nome.length < 2 || nome.length > 150) throw new ErroOperacao(400, 'Nome deve ter entre 2 e 150 caracteres.');
  if (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErroOperacao(400, 'E-mail inválido.');
  if (!perfis.includes(perfil)) throw new ErroOperacao(400, 'Perfil inválido.');
  if (typeof senha !== 'string' || ((novo || senha) && (!senha.trim() || senha.length < 8 || senha.length > 128))) {
    throw new ErroOperacao(400, 'A senha deve ter entre 8 e 128 caracteres.');
  }
  return { nome, email, perfil, senha, precisaTrocarSenha, credencialTemporaria };
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
  return executarTransacao(async conexao => {
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
      `SELECT u.id_usuario AS id, u.nome, u.login, u.email, u.perfil, u.ativo,
              u.precisa_trocar_senha AS primeiro_acesso,
              u.id_profissional AS profissional_id, p.nome AS profissional_nome,
              p.especialidade_principal AS profissional_especialidade, p.ativo AS profissional_ativo,
              DATE_FORMAT(u.criado_em, '%Y-%m-%dT%H:%i:%s') AS criado_em
       FROM usuario u LEFT JOIN profissional p ON p.id_profissional = u.id_profissional ORDER BY u.nome ASC`
    );
    const dados = rows.map(row => ({
      ...row,
      login: row.login || gerarLoginBase(String(row.nome || '')),
      primeiro_acesso: Boolean(row.primeiro_acesso),
    }));
    res.json({ sucesso: true, dados });
  } catch (erro) { responderErro(res, erro); }
});

router.post('/', async (req, res) => {
  try {
    const usuarioLido = lerUsuario(req, true);
    const { nome, email, senha, perfil, precisaTrocarSenha, credencialTemporaria } = usuarioLido;
    const hash = await gerarHashSenha(senha);
    const dados = await editarComoAdmin(req, null, async conexao => {
      const profissional_id = await vincularProfissional(conexao, req, usuarioLido, null);
      const login = await resolverLoginUnico(conexao, nome, null);
      const [resultado] = await conexao.query<ResultSetHeader>(
        'INSERT INTO usuario (nome, login, email, senha_hash, precisa_trocar_senha, perfil, id_profissional, ativo) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
        [nome, login, email, hash, precisaTrocarSenha ? 1 : 0, perfil, profissional_id]
      );
      return { id: resultado.insertId, profissional_id, login };
    });
    res.status(201).json({
      sucesso: true,
      mensagem: 'Usuário criado com sucesso.',
      dados: {
        ...dados,
        nome,
        email,
        perfil,
        primeiro_acesso: precisaTrocarSenha,
        ativo: 1,
        ...(credencialTemporaria ? { credencial_temporaria: credencialTemporaria } : {}),
      },
    });
  } catch (erro) { responderErro(res, erro); }
});

router.put('/:id', async (req, res) => {
  try {
    const id = lerId(req);
    const usuarioLido = lerUsuario(req, false);
    const { nome, email, senha, perfil, credencialTemporaria } = usuarioLido;
    if (req.usuario?.id === id && perfil !== 'ADMIN') throw new ErroOperacao(409, 'Não é possível remover seu próprio perfil de administrador.');
    const hash = senha ? await gerarHashSenha(senha) : null;
    const resultado = await editarComoAdmin(req, id, async conexao => {
      const [[anterior]] = await conexao.query<RowDataPacket[]>(
        'SELECT nome, login, perfil, id_profissional, precisa_trocar_senha FROM usuario WHERE id_usuario = ?', [id]);
      const vinculo = await vincularProfissional(conexao, req, usuarioLido, id, anterior.id_profissional);
      const login = (!anterior.login || anterior.nome !== nome)
        ? await resolverLoginUnico(conexao, nome, id)
        : String(anterior.login);
      const novoPrecisaTrocar = req.body?.resetar_senha_padrao === true
        ? 1
        : (hash ? 0 : Number(anterior.precisa_trocar_senha || 0));
      const rebaixouAdmin = anterior.perfil === 'ADMIN' && perfil !== 'ADMIN';
      const revogarSessao = rebaixouAdmin || (anterior.perfil === 'PROFISSIONAL' &&
        (anterior.id_profissional === null || anterior.id_profissional !== vinculo));
      await conexao.query(
        'UPDATE usuario SET nome = ?, login = ?, email = ?, perfil = ?, id_profissional = ?, precisa_trocar_senha = ?, senha_hash = COALESCE(?, senha_hash) WHERE id_usuario = ?',
        [nome, login, email, perfil, vinculo, novoPrecisaTrocar, hash, id]
      );
      if (hash || revogarSessao) await conexao.query('DELETE FROM sessao_usuario WHERE id_usuario = ?', [id]);
      return {
        profissional_id: vinculo,
        login,
        primeiro_acesso: Boolean(novoPrecisaTrocar),
        revogou: Boolean(hash || revogarSessao),
      };
    });
    if (resultado.revogou) encerrarConexoesUsuario(id);
    res.json({
      sucesso: true,
      mensagem: 'Usuário atualizado com sucesso.',
      dados: {
        id,
        nome,
        email,
        perfil,
        profissional_id: resultado.profissional_id,
        login: resultado.login,
        primeiro_acesso: resultado.primeiro_acesso,
        ...(credencialTemporaria ? { credencial_temporaria: credencialTemporaria } : {}),
      },
    });
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
    if (!ativo) encerrarConexoesUsuario(id);
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
    encerrarConexoesUsuario(id);
    res.json({ sucesso: true, mensagem: 'Usuário excluído.' });
  } catch (erro) { responderErro(res, erro); }
});

export default router;
