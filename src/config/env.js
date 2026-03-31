import fs from 'fs';
import path from 'path';

const rootDir = process.cwd();

function loadEnvFile(filename) {
  const fullPath = path.join(rootDir, filename);
  if (!fs.existsSync(fullPath)) return;

  const lines = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/);
  lines.forEach((line) => {
    const text = String(line || '').trim();
    if (!text || text.startsWith('#')) return;

    const equalIndex = text.indexOf('=');
    if (equalIndex <= 0) return;

    const key = text.slice(0, equalIndex).trim();
    if (!key || process.env[key] !== undefined) return;

    let value = text.slice(equalIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

loadEnvFile('.env.local');
loadEnvFile('.env');

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT || 8888),
  HOST: process.env.HOST || '0.0.0.0',
  DB_PATH: process.env.DB_PATH || path.join(rootDir, 'data', 'stock_analysis.db'),
  JWT_SECRET: process.env.JWT_SECRET || 'replace-this-with-strong-secret',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  AUTH_COOKIE_NAME: process.env.AUTH_COOKIE_NAME || 'dsa_session',
  CORS_ORIGINS: (process.env.CORS_ORIGINS || 'http://localhost:8888,http://127.0.0.1:8888,http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  XTICK_TOKEN: process.env.XTICK_TOKEN || '',
  XTICK_BASE_URL: process.env.XTICK_BASE_URL || 'http://api.xtick.top/',
  TUSHARE_TOKEN: process.env.TUSHARE_TOKEN || '',
  TUSHARE_BASE_URL: process.env.TUSHARE_BASE_URL || 'https://api.tushare.pro',
  TUSHARE_WEB_COOKIE: process.env.TUSHARE_WEB_COOKIE || '',
  XUEQIU_BASE_URL: process.env.XUEQIU_BASE_URL || 'https://xueqiu.com',
  XUEQIU_WEB_COOKIE: process.env.XUEQIU_WEB_COOKIE || '',
  XUEQIU_REFERER: process.env.XUEQIU_REFERER || 'https://xueqiu.com/',
  XUEQIU_USER_AGENT: process.env.XUEQIU_USER_AGENT || '',
  XUEQIU_BROWSER_FALLBACK_ENABLED: process.env.XUEQIU_BROWSER_FALLBACK_ENABLED || 'true',
  XUEQIU_BROWSER_HEADLESS: process.env.XUEQIU_BROWSER_HEADLESS || 'true',
};

export const isProd = env.NODE_ENV === 'production';
