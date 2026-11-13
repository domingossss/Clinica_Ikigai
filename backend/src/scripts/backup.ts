import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path:path.join(root,'backend/.env') });
const directory = path.join(root,'backend/backups');
fs.mkdirSync(directory,{recursive:true});
const target = path.join(directory, 'ikigai-' + new Date().toISOString().replace(/[:.]/g,'-') + '.sql');
const output = fs.createWriteStream(target + '.partial', {flags:'wx',mode:0o600});
const args = ['--single-transaction','--routines','--triggers','--events','--hex-blob','--no-tablespaces','--host='+ (process.env.DB_HOST || '127.0.0.1'),'--port='+ (process.env.DB_PORT || '3306'),'--user='+ (process.env.DB_ADMIN_USER || process.env.DB_USER || ''),process.env.DB_NAME || 'clinica_ikigai_db'];
const child = spawn(process.env.MYSQLDUMP_PATH || 'mysqldump',args,{env:{...process.env,MYSQL_PWD:process.env.DB_ADMIN_PASS || process.env.DB_PASS || process.env.DB_PASSWORD},windowsHide:true,stdio:['ignore','pipe','pipe']});
child.stderr.resume();
try {
  await Promise.all([
    pipeline(child.stdout, output),
    new Promise<void>((resolve,reject) => {
      child.once('error',reject);
      child.once('close',code => code === 0 ? resolve() : reject(new Error('Backup não concluído. Verifique a configuração do MySQL.')));
    })
  ]);
  fs.renameSync(target+'.partial', target);
  console.log('Backup concluído em backend/backups. Proteja e copie para armazenamento seguro.');
} catch (error) { child.kill(); output.destroy(); throw error; }
