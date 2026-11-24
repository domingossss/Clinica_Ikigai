import type { Connection } from 'mysql2/promise';

/** Executa os arquivos SQL do projeto, incluindo os delimitadores usados pelos gatilhos. */
export async function executarScriptSql(conexao: Pick<Connection, 'query'>, sql: string): Promise<void> {
  let separador = ';';
  let buffer = '';
  for (const linha of sql.split(/\r?\n/)) {
    const delimitador = linha.trim().match(/^DELIMITER\s+(\S+)/i);
    if (delimitador) {
      separador = delimitador[1];
      continue;
    }
    buffer += linha + '\n';
    if (linha.trimEnd().endsWith(separador)) {
      const comando = buffer.trimEnd().slice(0, -separador.length);
      if (comando.trim()) await conexao.query(comando);
      buffer = '';
    }
  }
  if (buffer.replace(/--[^\n]*/g, '').trim()) await conexao.query(buffer);
}
