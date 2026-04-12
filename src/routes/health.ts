import { Router } from 'express';
import { getMongoStatus } from '../config/database.js';
import { getRabbitMQStatus } from '../config/rabbitmq.js';

const router = Router();

router.get('/health', (req, res) => {
  const mongoStatus = getMongoStatus();
  const rabbitmqStatus = getRabbitMQStatus();
  const isHealthy = mongoStatus === 'connected' && rabbitmqStatus === 'connected';

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'UP' : 'DEGRADED',
    service: 'delivery-service',
    timestamp: new Date().toISOString(),
    dependencies: {
      mongodb: mongoStatus,
      rabbitmq: rabbitmqStatus,
    },
  });
});

export default router;
