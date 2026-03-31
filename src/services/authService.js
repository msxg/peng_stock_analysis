import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env, isProd } from '../config/env.js';
import { systemRepository } from '../repositories/systemRepository.js';
import { HttpError } from '../utils/httpError.js';

function signSession(payload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}

function verifySessionToken(token) {
  try {
    return jwt.verify(token, env.JWT_SECRET);
  } catch {
    return null;
  }
}

export const authService = {
  getCookieOptions() {
    return {
      httpOnly: true,
      sameSite: isProd ? 'strict' : 'lax',
      secure: isProd,
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    };
  },

  getStatus(token) {
    const settings = systemRepository.getAuthSettings();
    const user = token ? verifySessionToken(token) : null;

    return {
      authEnabled: settings.authEnabled,
      passwordSet: Boolean(systemRepository.findUserByUsername('admin')),
      passwordChangeable: settings.passwordChangeable,
      loggedIn: Boolean(user),
      user: user ? { username: user.username } : null,
    };
  },

  verifyCookie(token) {
    if (!token) return null;
    return verifySessionToken(token);
  },

  login({ username = 'admin', password }) {
    const user = systemRepository.findUserByUsername(username);
    if (!user) throw new HttpError(401, '用户名或密码错误');

    const ok = bcrypt.compareSync(password || '', user.password_hash);
    if (!ok) throw new HttpError(401, '用户名或密码错误');

    const session = signSession({ id: user.id, username: user.username });
    return {
      session,
      user: {
        id: user.id,
        username: user.username,
      },
    };
  },

  updateSettings({ authEnabled, currentPassword }) {
    const current = systemRepository.getAuthSettings();

    if (typeof authEnabled !== 'boolean') {
      throw new HttpError(400, 'authEnabled 必须为布尔值');
    }

    if (authEnabled && !current.authEnabled) {
      const user = systemRepository.findUserByUsername('admin');
      if (user && !bcrypt.compareSync(currentPassword || '', user.password_hash)) {
        throw new HttpError(400, '启用认证前请提供当前管理员密码');
      }
    }

    return systemRepository.updateAuthSettings({ authEnabled, passwordChangeable: true });
  },

  changePassword({ username = 'admin', currentPassword, newPassword }) {
    const user = systemRepository.findUserByUsername(username);
    if (!user) throw new HttpError(404, '用户不存在');

    if (!newPassword || newPassword.length < 8) {
      throw new HttpError(400, '新密码长度至少 8 位');
    }

    const ok = bcrypt.compareSync(currentPassword || '', user.password_hash);
    if (!ok) throw new HttpError(400, '当前密码错误');

    const hash = bcrypt.hashSync(newPassword, 10);
    systemRepository.updateUserPassword(username, hash);

    return { success: true };
  },
};
