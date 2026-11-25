import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(raiz, 'backend/.env') });
const dbName = process.env.DB_NAME || 'clinica_ikigai_db';
const dbHost = process.env.DB_HOST || '127.0.0.1';
const dbPort = process.env.DB_PORT || '3306';
const dbUser = process.env.DB_ADMIN_USER || process.env.DB_USER || '';
const dbPass = process.env.DB_ADMIN_PASS || process.env.DB_PASS || process.env.DB_PASSWORD || '';

if (!/^[a-zA-Z0-9_]+$/.test(dbName)) throw new Error('DB_NAME inválido.');
if (!/^[a-zA-Z0-9._:-]+$/.test(dbHost)) throw new Error('DB_HOST inválido.');
if (!/^\d{1,5}$/.test(dbPort)) throw new Error('DB_PORT inválido.');
if (!dbUser) throw new Error('Usuário de banco não configurado para backup.');

const diretorio = process.env.BACKUP_DIR ? path.resolve(process.env.BACKUP_DIR) : path.join(raiz, 'backend/backups');
const data = new Date().toISOString().replace(/[:.]/g, '-');
const destino = path.join(diretorio, `ikigai-${data}.sql`);
const arquivoParcial = `${destino}.partial`;
const arquivoCredenciais = path.join(os.tmpdir(), `ikigai-cnf-${randomBytes(12).toString('hex')}.cnf`);

await writeFile(
  arquivoCredenciais,
  `[client]\nuser=${dbUser}\npassword="${dbPass.replace(/["\\]/g, '\\$&')}"\nhost=${dbHost}\nport=${dbPort}\n`,
  { mode: 0o600 }
);

const argumentos = [
  `--defaults-extra-file=${arquivoCredenciais}`,
  '--single-transaction', '--routines', '--triggers', '--events', '--hex-blob', '--no-tablespaces',
  '--',
  dbName,
];

await mkdir(diretorio, { recursive: true });
const arquivo = await open(arquivoParcial, 'wx', 0o600);
try {
  const processo = spawn(process.env.MYSQLDUMP_PATH || 'mysqldump', argumentos, {
    env: { ...process.env },
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
  console.log('Backup concluído. Proteja, criptografe e mova para armazenamento externo seguro.');
} catch (erro) {
  await arquivo.close().catch(() => {});
  await unlink(arquivoParcial).catch(() => {
    console.error('Não foi possível remover o arquivo de backup incompleto.');
  });
  throw erro;
} finally {
  await unlink(arquivoCredenciais).catch(() => {});
}
