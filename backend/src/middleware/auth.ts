import crypto from 'node:crypto';
import { promisify } from 'node:util';

import type { Request, Response, NextFunction } from 'express';
import type { RowDataPacket } from 'mysql2';
import pool from '../config/database.js';

const scrypt = promisify(crypto.scrypt);

export type PerfilUsuario = 'ADMIN' | 'RECEPCAO' | 'PROFISSIONAL';
export interface UsuarioAutenticado {
  id: number;
  nome: string;
  login?: string | null;
  email: string;
  perfil: PerfilUsuario;
  primeiro_acesso?: boolean;
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
export const DURACAO_SESSAO_SEGUNDOS = 12 * 60 * 60;
const segredoDesenvolvimento = crypto.randomBytes(32).toString('hex');

export function validarConfiguracaoSessao(): void {
  const segredo = process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production' && (!segredo || Buffer.byteLength(segredo.trim()) < 32)) {
    throw new Error('Configure SESSION_SECRET com pelo menos 32 bytes para publicar a API.');
  }
}

export function identificarSessao(token: string): Buffer {
  validarConfiguracaoSessao();
  const segredo = process.env.SESSION_SECRET || process.env.JWT_SECRET || segredoDesenvolvimento;
  return crypto.createHmac('sha256', segredo).update(token).digest();
}

export async function gerarHashSenha(senha: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + ((await scrypt(senha, salt, 64)) as Buffer).toString('hex');
}

export async function verificarSenha(senha: string, hashArmazenado: string): Promise<boolean> {
  const [salt, hashHex] = hashArmazenado.split(':');
  if (!salt || !/^[a-f0-9]{128}$/i.test(hashHex || '')) return false;
  return crypto.timingSafeEqual(Buffer.from(hashHex, 'hex'), (await scrypt(senha, salt, 64)) as Buffer);
}

export function extrairToken(req: Request): string | null {
  const cookie = req.headers.cookie?.split(';').map(item => item.trim())
    .find(item => item.startsWith(COOKIE_TOKEN_NAME + '='));
  const token = cookie?.slice(COOKIE_TOKEN_NAME.length + 1);
  return token && /^[a-zA-Z0-9_-]{43}$/.test(token) ? token : null;
}

export async function consultarSessao(req: Request): Promise<UsuarioAutenticado | null> {
  const token = extrairToken(req);
  if (!token) return null;
  const [rows] = await pool.query<(RowDataPacket & UsuarioAutenticado)[]>(
    `SELECT u.id_usuario AS id, u.nome, u.login, u.email, u.perfil,
       u.precisa_trocar_senha, u.id_profissional AS profissional_id,
       p.nome AS profissional_nome, p.especialidade_principal AS profissional_especialidade
     FROM sessao_usuario s JOIN usuario u ON u.id_usuario = s.id_usuario
     LEFT JOIN profissional p ON p.id_profissional = u.id_profissional
     WHERE s.identificador = ? AND s.expira_em > UTC_TIMESTAMP() AND u.ativo = 1
       AND (u.perfil <> 'PROFISSIONAL' OR p.ativo = 1)`,
    [identificarSessao(token)]
  );
  if (!rows[0]) return null;
  return {
    ...rows[0],
    primeiro_acesso: Boolean(rows[0].precisa_trocar_senha),
  };
}

export async function exigirAutenticacao(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const usuario = await consultarSessao(req);
    if (!usuario) {
      res.status(401).json({ sucesso: false, erro: 'Autenticação necessária ou sessão expirada.' });
      return;
    }
    req.usuario = usuario;
    next();
  } catch {
    res.status(503).json({ sucesso: false, erro: 'Serviço de autenticação indisponível.' });
  }
}

export function exigirPerfil(...perfisPermitidos: PerfilUsuario[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.usuario) {
      res.status(401).json({ sucesso: false, erro: 'Autenticação necessária.' });
      return;
    }
    if (!perfisPermitidos.includes(req.usuario.perfil)) {
      res.status(403).json({ sucesso: false, erro: 'Você não tem permissão para realizar esta operação.' });
      return;
    }
    next();
  };
}
