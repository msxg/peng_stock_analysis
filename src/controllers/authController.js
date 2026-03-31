import { env } from '../config/env.js';
import { authService } from '../services/authService.js';

export const authController = {
  status(req, res) {
    const token = req.cookies?.[env.AUTH_COOKIE_NAME];
    res.json(authService.getStatus(token));
  },

  login(req, res) {
    const result = authService.login(req.body || {});
    res.cookie(env.AUTH_COOKIE_NAME, result.session, authService.getCookieOptions());
    res.json({ success: true, user: result.user });
  },

  logout(_req, res) {
    res.clearCookie(env.AUTH_COOKIE_NAME, authService.getCookieOptions());
    res.json({ success: true });
  },

  updateSettings(req, res) {
    const result = authService.updateSettings(req.body || {});
    res.json({ success: true, settings: result });
  },

  changePassword(req, res) {
    const result = authService.changePassword(req.body || {});
    res.json(result);
  },
};
