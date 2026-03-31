import { env } from '../config/env.js';
import { authService } from '../services/authService.js';
import { systemRepository } from '../repositories/systemRepository.js';

const PUBLIC_API_PATHS = [
  '/api/health',
  '/api/v1/health',
  '/api/v1/auth/status',
  '/api/v1/auth/login',
];

export function authMiddleware(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  if (PUBLIC_API_PATHS.includes(req.path)) return next();

  const authSettings = systemRepository.getAuthSettings();
  if (!authSettings.authEnabled) return next();

  const token = req.cookies?.[env.AUTH_COOKIE_NAME];
  const user = authService.verifyCookie(token);
  if (!user) {
    return res.status(401).json({
      error: 'unauthorized',
      message: '请先登录后再访问',
    });
  }

  req.user = user;
  return next();
}
