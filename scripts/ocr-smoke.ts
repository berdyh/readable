import path from 'node:path';
import fs from 'node:fs/promises';
import process from 'node:process';

import dotenv from 'dotenv';

import { runDeepSeekOcr } from '../src/server/ingest/ocr';

async function loadEnv(): Promise<void> {
  const envPath = path.resolve(process.cwd(), '.env.local');
  dotenv.config({ path: envPath });
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
}

async function main(): Promise<void> {
  await loadEnv();

  const pdfPath = process.argv[2];
  if (!pdfPath) {
    throw new Error('Usage: pnpm tsx scripts/ocr-smoke.ts <pdf-path>');
  }

  const absolutePath = path.resolve(process.cwd(), pdfPath);
  const pdfBuffer = await fs.readFile(absolutePath);

  console.log(`Running DeepSeek OCR via RunPod for ${absolutePath}...`);
  const result = await runDeepSeekOcr(bufferToArrayBuffer(pdfBuffer));

  if (!result) {
    console.log('No OCR result returned.');
    return;
  }

  const { analysis, pages, figures, tables } = result;
  console.log('--- OCR Analysis ---');
  console.log(JSON.stringify(analysis, null, 2));
  console.log(`Pages extracted: ${pages.length}`);
  console.log(`Figures detected: ${figures.length}`);
  console.log(`Tables detected: ${tables.length}`);

  const sample = pages[0]?.text.slice(0, 300) ?? '';
  if (sample) {
    console.log('--- Page 1 Sample ---');
    console.log(sample);
  }
}

main().catch((error) => {
  console.error('OCR smoke check failed:', error);
  process.exitCode = 1;
});
