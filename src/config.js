// src/config.js
require('dotenv').config({ quiet: true });
const config = require('../config.json');

function getSecret(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

module.exports = { ...config, getSecret };
