#!/usr/bin/env node
// src/index.js
// Entrypoint. `--once` = trigger manual satu kali (Fase 1). Tanpa flag = start scheduler
// dan tetap hidup, jalan sesuai jadwal di config.json (Fase 2) — lihat 05-IMPLEMENTATION-PLAN.md.

async function runOnce() {
  const logger = require('./logger');
  logger.info({ stage: 'pipeline', status: 'started' }, 'Manual run (--once) mulai');

  try {
    // Require di dalam fungsi (bukan di top-level file) supaya error konfigurasi
    // (mis. secret .env belum diisi) tertangkap dan dilog rapi, bukan raw stack trace.
    const { runPipeline } = require('./pipeline');
    const result = await runPipeline();
    logger.info({ stage: 'pipeline', status: result.status, ...result }, 'Manual run selesai');
    process.exit(result.status === 'published' || result.status === 'skipped' ? 0 : 2);
  } catch (err) {
    logger.error(
      {
        stage: 'pipeline',
        status: 'error',
        message: err.message,
        errorStage: err.stage,
        retryable: err.retryable,
        cause: err.cause instanceof Error
          ? { message: err.cause.message, name: err.cause.name, status: err.cause.status }
          : err.cause,
      },
      'Manual run gagal'
    );
    process.exit(1);
  }
}

function runScheduled() {
  const logger = require('./logger');
  const scheduler = require('./scheduler');
  const tasks = scheduler.start();
  logger.info({ stage: 'index', status: 'scheduler-started', taskCount: tasks.length }, 'Scheduler jalan, proses tetap hidup');

  // Proses harus tetap hidup menunggu jadwal berikutnya — jangan process.exit() di sini.
  // Kegagalan satu run ditangani di dalam scheduler.js, tidak mematikan proses ini.
  process.on('SIGINT', () => {
    logger.info({ stage: 'index', status: 'shutdown' }, 'Menerima SIGINT, mematikan scheduler');
    tasks.forEach((t) => t.stop());
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    logger.info({ stage: 'index', status: 'shutdown' }, 'Menerima SIGTERM, mematikan scheduler');
    tasks.forEach((t) => t.stop());
    process.exit(0);
  });
}

function main() {
  const once = process.argv.includes('--once');
  if (once) {
    runOnce();
  } else {
    runScheduled();
  }
}

main();
