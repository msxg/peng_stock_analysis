import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { getDb } from './db/database.js';
import { authMiddleware } from './middlewares/authMiddleware.js';
import { errorHandler, notFoundHandler } from './middlewares/errorMiddleware.js';
import { stockBasicsService } from './services/stockBasicsService.js';
import { focusNewsScheduler } from './services/focusNewsScheduler.js';

const app = express();

function ensureDirs() {
  ['tmp/uploads', 'data'].forEach((relative) => {
    const full = path.join(process.cwd(), relative);
    if (!fs.existsSync(full)) {
      fs.mkdirSync(full, { recursive: true });
    }
  });
}

ensureDirs();
getDb();
stockBasicsService.ensureInitialSync()
  .then((payload) => {
    if (payload?.skipped) {
      console.log(`[stock-basics] initial sync skipped: ${payload.reason}, existing=${payload.existing}`);
      return;
    }
    console.log(`[stock-basics] initial sync done: total=${payload?.total || 0}`);
  })
  .catch((error) => {
    console.error(`[stock-basics] initial sync failed: ${error.message}`);
  });
focusNewsScheduler.start();

app.use(cors({
  origin: env.CORS_ORIGINS,
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

app.use(authMiddleware);
app.use(routes);

const publicDir = path.join(process.cwd(), 'public');
app.use(express.static(publicDir));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  return res.sendFile(path.join(publicDir, 'index.html'));
});

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(env.PORT, env.HOST, () => {
  console.log(`Server running at http://${env.HOST}:${env.PORT}`);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  focusNewsScheduler.stop();
  server.close(() => {
    process.exit(0);
  });
  const timer = setTimeout(() => {
    process.exit(0);
  }, 3000);
  if (typeof timer.unref === 'function') timer.unref();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
