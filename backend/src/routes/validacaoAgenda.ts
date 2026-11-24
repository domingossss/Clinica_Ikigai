import type { Response } from 'express';
import { ErroOperacao } from '../config/database.js';
import { registrarErro, validarFormatoData } from '../middleware/security.js';

export function idPositivo(valor: unknown): number {
  if (!['string', 'number'].includes(typeof valor)) throw new ErroOperacao(400, 'Identificador inválido.');
  const id = Number(valor);
  if (!Number.isSafeInteger(id) || id < 1) throw new ErroOperacao(400, 'Identificador inválido.');
  return id;
}
export function validarDataHora(data: unknown, inicio: unknown) {
  if (typeof data !== 'string' || !validarFormatoData(data)) throw new ErroOperacao(400, 'Data inválida. Use YYYY-MM-DD.');
  if (typeof inicio !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(inicio)) throw new ErroOperacao(400, 'Horário inválido. Use HH:MM.');
}
export function responderFalha(res: Response, erro: unknown) {
  if (erro instanceof ErroOperacao) return res.status(erro.status).json({ sucesso: false, erro: erro.message });
  registrarErro('[Agenda]', erro);
  const codigo = (erro as { code?: string })?.code;
  const temporario = ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', 'ECONNREFUSED', 'ER_ACCESS_DENIED_ERROR', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST'].includes(codigo || '');
  return res.status(temporario ? 503 : 500).json({ sucesso: false, erro: temporario ? 'Serviço temporariamente indisponível. Tente novamente.' : 'Não foi possível concluir a operação.' });
}
