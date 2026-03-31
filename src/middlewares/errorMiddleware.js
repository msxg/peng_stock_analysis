import { HttpError } from '../utils/httpError.js';

export function notFoundHandler(req, res) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      error: 'not_found',
      message: `接口不存在: ${req.path}`,
    });
  }

  return res.status(404).send('Not Found');
}

export function errorHandler(err, req, res, _next) {
  const status = err instanceof HttpError ? err.status : 500;
  const payload = {
    error: err instanceof HttpError ? 'business_error' : 'internal_error',
    message: err.message || '服务异常',
  };

  if (err instanceof HttpError && err.details) {
    payload.details = err.details;
  }

  if (status >= 500) {
    console.error('[ERROR]', err);
  }

  res.status(status).json(payload);
}
