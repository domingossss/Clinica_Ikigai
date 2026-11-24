import { spawn } from 'node:child_process';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(raiz, 'backend/.env') });
const diretorio = path.join(raiz, 'backend/backups');
const data = new Date().toISOString().replace(/[:.]/g, '-');
const destino = path.join(diretorio, `ikigai-${data}.sql`);
const arquivoParcial = `${destino}.partial`;
const argumentos = [
  '--single-transaction', '--routines', '--triggers', '--events', '--hex-blob', '--no-tablespaces',
  '--host=' + (process.env.DB_HOST || '127.0.0.1'),
  '--port=' + (process.env.DB_PORT || '3306'),
  '--user=' + (process.env.DB_ADMIN_USER || process.env.DB_USER || ''),
  process.env.DB_NAME || 'clinica_ikigai_db',
];

await mkdir(diretorio, { recursive: true });
const arquivo = await open(arquivoParcial, 'wx', 0o600);
try {
  const processo = spawn(process.env.MYSQLDUMP_PATH || 'mysqldump', argumentos, {
    env: {
      ...process.env,
      MYSQL_PWD: process.env.DB_ADMIN_PASS || process.env.DB_PASS || process.env.DB_PASSWORD,
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  processo.stderr.resume();
  const terminou = new Promise<void>((resolve, reject) => {
    processo.once('error', reject);
    processo.once('close', codigo => {
      if (codigo === 0) resolve();
      else reject(new Error('Backup não concluído. Verifique a configuração do MySQL.'));
    });
  });
  const gravou = pipeline(processo.stdout, arquivo.createWriteStream());
  try {
    await Promise.all([terminou, gravou]);
  } catch (erro) {
    processo.kill();
    await Promise.allSettled([terminou, gravou]);
    throw erro;
  }
  await rename(arquivoParcial, destino);
  console.log('Backup concluído em backend/backups. Proteja e copie para armazenamento seguro.');
} catch (erro) {
  await arquivo.close().catch(() => {});
  await unlink(arquivoParcial).catch(() => {
    console.error('Não foi possível remover o arquivo de backup incompleto de backend/backups.');
  });
  throw erro;
}
