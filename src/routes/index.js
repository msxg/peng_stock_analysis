import { Router } from 'express';
import healthRoutes from './healthRoutes.js';
import v1Router from './v1Router.js';

const router = Router();

router.use('/api', healthRoutes);
router.use('/api/v1', v1Router);

export default router;
