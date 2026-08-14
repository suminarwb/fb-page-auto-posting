// ecosystem.config.js — konfigurasi pm2 untuk deploy Fase 2 (05-IMPLEMENTATION-PLAN.md).
// Jalankan: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'stik-satu-agent',
      script: './src/index.js',
      // TIDAK pakai --once di sini — proses harus tetap hidup menjalankan scheduler.
      args: [],
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
