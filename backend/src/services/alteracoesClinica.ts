import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { RowDataPacket } from 'mysql2';
import pool, { executarTransacao } from '../config/database.js';
import { consultarSessao } from '../middleware/auth.js';
import { registrarErro } from '../middleware/security.js';
import { registrarCapacidadeHoje } from './capacidadeAgenda.js';

// O fluxo transporta somente avisos de mudança, nunca dados de pacientes.
const eventosClinica = new EventEmitter();
eventosClinica.setMaxListeners(0);
const instancia = randomUUID();
let revisao = 0;
const recursosSincronizados = new Set(['agendamentos', 'pacientes', 'servicos', 'categorias', 'profissionais', 'bloqueios', 'expediente-clinica', 'excecoes', 'comunicacoes']);

const revisoesConhecidas = new Map<string, bigint>();
const publicacoesEmAndamento = new Set<Promise<void>>();
let consultaRevisoes: ReturnType<typeof setInterval> | undefined;
let consultandoRevisoes = false;

function rastrearPublicacao(tarefa: Promise<void>): Promise<void> {
  publicacoesEmAndamento.add(tarefa);
  void tarefa.finally(() => publicacoesEmAndamento.delete(tarefa));
  return tarefa;
}

/** Aguarda todas as publicações de revisão em andamento (shutdown limpo e testes determinísticos). */
export async function aguardarPublicacoesPendentes(): Promise<void> {
  while (publicacoesEmAndamento.size > 0) {
    await Promise.allSettled([...publicacoesEmAndamento]);
  }
}

function invalidar(recursos: string[]) {
  eventosClinica.emit('alteracao', { versao: `${instancia}:${++revisao}`, recursos });
}

export function publicarAlteracao(recurso: string): Promise<void> {
  return rastrearPublicacao((async () => {
    try {
      const versao = await executarTransacao(async conexao => {
        await conexao.query(`INSERT INTO revisao_clinica(recurso, revisao) VALUES (?, 1)
          ON DUPLICATE KEY UPDATE revisao = revisao + 1`, [recurso]);
        const [[linha]] = await conexao.query<RowDataPacket[]>(
          'SELECT CAST(revisao AS CHAR) AS revisao FROM revisao_clinica WHERE recurso = ?', [recurso]);
        return BigInt(linha.revisao);
      });
      if (versao <= (revisoesConhecidas.get(recurso) ?? 0n)) return;
      revisoesConhecidas.set(recurso, versao);
    } catch (erro) {
      registrarErro('[Sincronização] Falha ao compartilhar alteração entre instâncias.', erro);
    }
    invalidar([recurso]);
  })());
}

async function consultarRevisoes() {
  if (consultandoRevisoes) return;
  consultandoRevisoes = true;
  try {
    const [linhas] = await pool.query<(RowDataPacket & { recurso: string; revisao: string })[]>(
      'SELECT recurso, CAST(revisao AS CHAR) AS revisao FROM revisao_clinica');
    const alterados: string[] = [];
    for (const linha of linhas) {
      const revisaoAtual = BigInt(linha.revisao);
      if (!recursosSincronizados.has(linha.recurso) || revisaoAtual <= (revisoesConhecidas.get(linha.recurso) ?? 0n)) continue;
      revisoesConhecidas.set(linha.recurso, revisaoAtual);
      alterados.push(linha.recurso);
    }
    if (alterados.length) invalidar(alterados);
  } catch (erro) {
    registrarErro('[Sincronização] Falha ao consultar revisões.', erro);
  } finally {
    consultandoRevisoes = false;
  }
}

export function notificarAlteracoes(req: Request, res: Response, next: NextFunction): void {
  const recurso = req.path.split('/').filter(Boolean)[0];
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && recursosSincronizados.has(recurso)) {
    res.once('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300 && !res.locals.semAlteracao) {
        const publicar = () => publicarAlteracao(recurso);
        if (['profissionais','servicos','categorias','expediente-clinica','excecoes','bloqueios'].includes(recurso)) {
          void rastrearPublicacao(
            registrarCapacidadeHoje()
              .catch(error => registrarErro('[Capacidade]', error))
              .then(() => publicar())
          );
        } else void publicar();
      }
    });
  }
  next();
}

const conexoesPorUsuario = new Map<number, Set<Response>>();
const CACHE_SESSAO_SSE_MS = 20_000;
let totalFluxos = 0;

/** Encerra imediatamente todos os fluxos SSE abertos por um usuário (logout, inativação, troca de senha/perfil). */
export function encerrarConexoesUsuario(idUsuario: number): void {
  const conexoes = conexoesPorUsuario.get(idUsuario);
  if (!conexoes) return;
  for (const res of [...conexoes]) {
    if (!res.destroyed && !res.writableEnded) {
      res.end();
    }
  }
  conexoesPorUsuario.delete(idUsuario);
}

/** Encerra todos os fluxos SSE e timers de sincronização no graceful shutdown. */
export function encerrarTodasConexoesSse(): void {
  if (consultaRevisoes) {
    clearInterval(consultaRevisoes);
    consultaRevisoes = undefined;
  }
  for (const conexoes of conexoesPorUsuario.values()) {
    for (const res of [...conexoes]) {
      if (!res.destroyed && !res.writableEnded) res.end();
    }
  }
  conexoesPorUsuario.clear();
}

export function acompanharAlteracoes(req: Request, res: Response): void {
  if (!req.usuario) {
    res.status(401).json({ erro: 'Autenticação necessária.' });
    return;
  }
  const idUsuario = req.usuario.id;
  const conexoesUsuario = conexoesPorUsuario.get(idUsuario) ?? new Set<Response>();
  if (conexoesUsuario.size >= 8 || totalFluxos >= 200) {
    res.status(429).set('Retry-After', '20').json({ erro: 'Limite de conexões de atualização atingido.' });
    return;
  }
  conexoesUsuario.add(res);
  conexoesPorUsuario.set(idUsuario, conexoesUsuario);
  totalFluxos++;
  if (!consultaRevisoes) {
    consultaRevisoes = setInterval(() => void consultarRevisoes(), 3000);
    consultaRevisoes.unref();
  }
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  // Reconexões sempre pedem uma leitura completa: não dependemos de um histórico em memória.
  res.write('event: pronto\ndata: ' + JSON.stringify({ versao: instancia + ':' + revisao, recursos: [] }) + '\n\n');

  // Evita Thundering Herd no MySQL: revalida sessão no máximo 1x a cada 20s por conexão
  // (e logout/inativação/troca de senha encerram a conexão ativamente via encerrarConexoesUsuario).
  let ultimaValidacaoMs = Date.now();
  let validandoSessao: Promise<boolean> | null = null;

  async function sessaoContinuaValida(): Promise<boolean> {
    if (Date.now() - ultimaValidacaoMs < CACHE_SESSAO_SSE_MS) return true;
    if (!validandoSessao) {
      validandoSessao = consultarSessao(req)
        .then(usuario => {
          const ok = Boolean(usuario && usuario.id === idUsuario && usuario.perfil === req.usuario?.perfil && !usuario.primeiro_acesso);
          if (ok) ultimaValidacaoMs = Date.now();
          return ok;
        })
        .catch(() => false)
        .finally(() => { validandoSessao = null; });
    }
    return validandoSessao;
  }

  async function enviarSeAutorizado(mensagem: string) {
    if (res.destroyed || res.writableEnded) return;
    const ok = await sessaoContinuaValida();
    if (!ok) {
      if (!res.destroyed && !res.writableEnded) res.end();
      return;
    }
    if (!res.destroyed && !res.writableEnded) res.write(mensagem);
  }
  const enviar = (mudanca: { versao: string; recursos: string[] }) => {
    void enviarSeAutorizado('id: ' + mudanca.versao + '\nevent: alteracao\ndata: ' + JSON.stringify(mudanca) + '\n\n');
  };
  eventosClinica.on('alteracao', enviar);
  const manterConexao = setInterval(() => { void enviarSeAutorizado(': conectado\n\n'); }, 20000);
  manterConexao.unref();
  res.once('close', () => {
    clearInterval(manterConexao);
    eventosClinica.off('alteracao', enviar);
    totalFluxos = Math.max(0, totalFluxos - 1);
    if (totalFluxos === 0 && consultaRevisoes) {
      clearInterval(consultaRevisoes);
      consultaRevisoes = undefined;
    }
    const conjunto = conexoesPorUsuario.get(idUsuario);
    if (conjunto) {
      conjunto.delete(res);
      if (conjunto.size === 0) conexoesPorUsuario.delete(idUsuario);
    }
  });
}
