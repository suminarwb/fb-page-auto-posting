// src/logger.js
// Satu-satunya tempat konfigurasi logger — modul lain cukup require('./logger') dan pakai
// logger.info({stage, status, ...}, pesan) / logger.error({...}, pesan).
const pino = require('pino');

const logger = pino({
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

module.exports = logger;
