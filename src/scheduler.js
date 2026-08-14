// src/scheduler.js
const cron = require('node-cron');
const config = require('./config');
const { runPipeline } = require('./pipeline');
const logger = require('./logger');

const TIMEZONE = 'Asia/Jakarta'; // jam-jam ramai audiens Indonesia (01-PRD.md §3)

async function runOnce(triggerLabel) {
  logger.info({ stage: 'scheduler', status: 'triggered', trigger: triggerLabel }, 'Cron trigger jalan');
  try {
    const result = await runPipeline();
    logger.info({ stage: 'scheduler', status: result.status, trigger: triggerLabel }, 'Pipeline run selesai');
  } catch (err) {
    // pipeline.js sudah log kegagalan ke store — di sini cukup log supaya kelihatan di
    // stdout/pm2 logs. Sengaja tidak di-rethrow: satu run gagal tidak boleh mematikan
    // proses scheduler (02-TECH-DESIGN.md §NFR Reliability).
    logger.error(
      { stage: 'scheduler', status: 'error', trigger: triggerLabel, err: err.message },
      'Pipeline run gagal, scheduler tetap jalan untuk jadwal berikutnya'
    );
  }
}

/**
 * Daftarkan semua cron expression dari config.json dan mulai scheduler.
 * @returns {import('node-cron').ScheduledTask[]}
 */
function start() {
  const expressions = config.schedule?.cronExpressions ?? [];
  if (expressions.length === 0) {
    logger.warn({ stage: 'scheduler', status: 'no-schedule' }, 'Tidak ada cronExpressions di config.json — scheduler idle');
    return [];
  }

  const tasks = expressions.map((expr, index) => {
    const name = `stik-satu-schedule-${index}`;
    logger.info({ stage: 'scheduler', status: 'registered', cron: expr, timezone: TIMEZONE, name }, 'Jadwal terdaftar');
    return cron.schedule(expr, () => runOnce(name), {
      name,
      timezone: TIMEZONE,
      noOverlap: true,
    });
  });

  return tasks;
}

module.exports = { start };
