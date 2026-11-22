import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import pool from '../config/database.js';

export type PerfilUsuario = 'ADMIN' | 'RECEPCAO' | 'PROFISSIONAL';

export interface UsuarioAutenticado {
  id: number;
  nome: string;
  email: string;
  perfil: PerfilUsuario;
  profissional_id?: number | null;
  profissional_nome?: string | null;
  profissional_especialidade?: string | null;
}

declare global {
  namespace Express {
    interface Request {
      usuario?: UsuarioAutenticado;
    }
  }
}

export const COOKIE_TOKEN_NAME = 'ikigai_token';
const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12 horas
const SECRET_DEV_FALLBACK = crypto.randomBytes(32).toString('hex');

function obterJwtSecret(): string {
  return process.env.JWT_SECRET || process.env.SESSION_SECRET || SECRET_DEV_FALLBACK;
}

export function gerarHashSenha(senha: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivado = crypto.scryptSync(senha, salt, 64).toString('hex');
  return `${salt}:${derivado}`;
}

export function verificarSenha(senha: string, hashArmazenado: string): boolean {
  const partes = hashArmazenado.split(':');
  if (partes.length !== 2) return false;
  const [salt, hashHex] = partes;
  if (!salt || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const obtido = crypto.scryptSync(senha, salt, 64);
  if (esperado.length !== obtido.length) return false;
  return crypto.timingSafeEqual(esperado, obtido);
}

export function assinarToken(usuario: UsuarioAutenticado): string {
  const agora = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil,
      iat: agora,
      exp: agora + TOKEN_TTL_SECONDS,
    })
  ).toString('base64url');
  const dados = `${header}.${payload}`;
  const assinatura = crypto.createHmac('sha256', obterJwtSecret()).update(dados).digest('base64url');
  return `${dados}.${assinatura}`;
}

export function verificarToken(token: string): UsuarioAutenticado | null {
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  const [header, payload, assinatura] = partes;
  const dados = `${header}.${payload}`;
  const esperada = crypto.createHmac('sha256', obterJwtSecret()).update(dados).digest('base64url');
  const bufA = Buffer.from(assinatura);
  const bufB = Buffer.from(esperada);
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    if (!parsed.sub || !parsed.email || !parsed.perfil) return null;
    return {
      id: Number(parsed.sub),
      nome: String(parsed.nome || ''),
      email: String(parsed.email),
      perfil: parsed.perfil as PerfilUsuario,
    };
  } catch {
    return null;
  }
}

export function extrairToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  for (const parte of cookieHeader.split(';')) {
    const [chave, ...resto] = parte.trim().split('=');
    if (chave === COOKIE_TOKEN_NAME) {
      return decodeURIComponent(resto.join('='));
    }
  }
  return null;
}

export async function exigirAutenticacao(req: Request, res: Response, next: NextFunction): Promise<any> {
  const token = extrairToken(req);
  if (!token) {
    return res.status(401).json({ sucesso: false, erro: 'Autenticação necessária.' });
  }
  const decodificado = verificarToken(token);
  if (!decodificado) {
    return res.status(401).json({ sucesso: false, erro: 'Sessão inválida ou expirada.' });
  }
  try {
    const [rows] = await pool.query<any[]>(
      `SELECT u.id_usuario AS id,
              u.nome,
              u.email,
              u.perfil,
              u.ativo,
              u.id_profissional AS profissional_id,
              p.nome AS profissional_nome,
              p.especialidade_principal AS profissional_especialidade,
              p.ativo AS profissional_ativo
       FROM usuario u
       LEFT JOIN profissional p ON u.id_profissional = p.id_profissional
       WHERE u.id_usuario = ?
       LIMIT 1`,
      [decodificado.id]
    );
    if (!rows.length || !rows[0].ativo) {
      return res.status(401).json({ sucesso: false, erro: 'Usuário inativo ou não encontrado.' });
    }
    if (rows[0].perfil === 'PROFISSIONAL' && rows[0].profissional_id && (rows[0].profissional_ativo === 0 || rows[0].profissional_ativo === false)) {
      return res.status(401).json({ sucesso: false, erro: 'O cadastro deste profissional está inativo na clínica.' });
    }
    req.usuario = {
      id: Number(rows[0].id),
      nome: rows[0].nome,
      email: rows[0].email,
      perfil: rows[0].perfil,
      profissional_id: rows[0].profissional_id ? Number(rows[0].profissional_id) : null,
      profissional_nome: rows[0].profissional_nome || null,
      profissional_especialidade: rows[0].profissional_especialidade || null,
    };
    return next();
  } catch {
    return res.status(500).json({ sucesso: false, erro: 'Erro ao validar sessão.' });
  }
}

export function exigirPerfil(...perfisPermitidos: PerfilUsuario[]) {
  return (req: Request, res: Response, next: NextFunction): any => {
    if (!req.usuario) {
      return res.status(401).json({ sucesso: false, erro: 'Autenticação necessária.' });
    }
    if (!perfisPermitidos.includes(req.usuario.perfil)) {
      return res.status(403).json({
        sucesso: false,
        erro: 'Você não tem permissão para realizar esta operação.',
      });
    }
    return next();
  };
}

export async function garantirAdminInicial(): Promise<void> {
  const [rows] = await pool.query<any[]>('SELECT COUNT(*) AS total FROM usuario');
  if (Number(rows[0]?.total || 0) > 0) return;

  const email = (process.env.ADMIN_INITIAL_EMAIL || 'admin@clinicaikigai.com.br').trim().toLowerCase();
  const senha = process.env.ADMIN_INITIAL_PASSWORD || 'Ikigai@2026';
  const senhaHash = gerarHashSenha(senha);

  await pool.query(
    "INSERT INTO usuario (nome, email, senha_hash, perfil, ativo) VALUES (?, ?, ?, 'ADMIN', 1)",
    ['Administrador Ikigai', email, senhaHash]
  );
  console.log(`[Auth] Usuário administrador inicial criado: ${email}`);
}
