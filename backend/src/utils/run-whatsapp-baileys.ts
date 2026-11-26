import '../config/webcrypto.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import zlib from 'node:zlib';
import dotenv from 'dotenv';
import qrcode from 'qrcode-terminal';
import { testarConexao } from '../config/database.js';
import { iniciarLembretes } from '../services/comunicacoes.js';
import { WhatsAppBaileysConnector, loadWhatsAppBaileysConfigFromEnv } from '../services/whatsappBaileys.js';
import { createWhatsAppClinicRepository } from '../services/whatsappClinicRepository.js';
import { registrarConectorWhatsApp } from '../services/whatsappRuntime.js';

dotenv.config();

const require = createRequire(import.meta.url);
const QRCode = require('qrcode-terminal/vendor/QRCode');
const QRErrorCorrectLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function writeQrPng(qrText: string, outputPath: string): void {
  const qr = new QRCode(-1, QRErrorCorrectLevel.L);
  qr.addData(qrText);
  qr.make();
  const count: number = qr.getModuleCount();
  const modules: boolean[][] = qr.modules;
  const margin = 4;
  const scale = 8;
  const size = (count + margin * 2) * scale;

  const rawRows: Buffer[] = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size, 255);
    row[0] = 0; // filtro PNG None
    const moduleY = Math.floor(y / scale) - margin;
    if (moduleY >= 0 && moduleY < count) {
      for (let x = 0; x < size; x++) {
        const moduleX = Math.floor(x / scale) - margin;
        if (moduleX >= 0 && moduleX < count && modules[moduleY][moduleX]) {
          row[1 + x] = 0; // preto
        }
      }
    }
    rawRows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8-bit grayscale
  ihdr[9] = 0; // colorType 0 (grayscale)
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(Buffer.concat(rawRows));
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const png = Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(outputPath, png);
}

async function main() {
  const config = loadWhatsAppBaileysConfigFromEnv();
  const qrImagePath = process.env.WHATSAPP_QR_IMAGE_PATH?.trim();
  const dbModeEnv = (process.env.WHATSAPP_DB_MODE || 'auto').trim().toLowerCase();

  let repositoryMode: 'memory' | 'mysql' = 'memory';
  if (dbModeEnv === 'mysql') {
    repositoryMode = 'mysql';
  } else if (dbModeEnv === 'auto') {
    const dbOk = await testarConexao();
    repositoryMode = dbOk ? 'mysql' : 'memory';
  }

  console.info(
    `[WhatsApp Baileys Runner] mode=${config.mode} enabled=${config.enabled} sendEnabled=${config.sendEnabled} allowedNumbers=${config.allowedNumbers.length} repository=${repositoryMode}`
  );

  const repository = createWhatsAppClinicRepository(repositoryMode);

  const connector = new WhatsAppBaileysConnector(config, {
    repository,
    renderQr: (qr: string) => {
      console.info('[WhatsApp Baileys] QR Code gerado para pareamento manual do numero de laboratorio:');
      qrcode.generate(qr, { small: true });
      if (qrImagePath) {
        try {
          writeQrPng(qr, qrImagePath);
          console.info('[WhatsApp Baileys] Imagem PNG do QR Code atualizada com sucesso.');
        } catch {
          console.warn('[WhatsApp Baileys] Nao foi possivel gravar imagem PNG do QR Code.');
        }
      }
    }
  });
  registrarConectorWhatsApp(connector);
  await connector.start();
  if (repositoryMode === 'mysql') {
    iniciarLembretes();
  }

  const shutdown = async () => {
    console.info('[WhatsApp Baileys Runner] Encerrando conector com seguranca...');
    registrarConectorWhatsApp(null);
    await connector.stop();
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
}

void main();
