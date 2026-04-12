import express from 'express';
import helmet from 'helmet';
import { config } from './config/index.js';
import { connectDatabase } from './config/database.js';
import { connectRabbitMQ, getRabbitMQChannel } from './config/rabbitmq.js';
import { errorHandler } from './middleware/errorHandler.js';
import { metricsMiddleware, register } from './middleware/metrics.js';
import healthRouter from './routes/health.js';
import deliveriesRouter from './routes/deliveries.js';
import { Delivery } from './models/Delivery.js';

const app = express();

// Prometheus metrics endpoint
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.use(helmet());
app.use(express.json());

// Metrics middleware
app.use(metricsMiddleware);

// Routes
app.use('/api/delivery', healthRouter);
app.use('/api/delivery', deliveriesRouter);

// Error handler
app.use(errorHandler);

// Consume order.created events from RabbitMQ to auto-create delivery records
function startOrderConsumer(): void {
  const channel = getRabbitMQChannel();
  if (!channel) {
    console.warn('RabbitMQ channel not available, skipping order consumer');
    return;
  }

  channel.consume('delivery.order.created', async (msg) => {
    if (!msg) return;
    try {
      const order = JSON.parse(msg.content.toString());
      // Calculate earning as 15% of order total (driver commission)
      const earning = Math.round((order.total || 0) * 0.15);

      await Delivery.create({
        orderId: order.id || order.orderId,
        orderNumber: order.orderNumber || `ORD-${Date.now()}`,
        restaurantName: order.restaurantName || 'Unknown Restaurant',
        restaurantAddress: order.restaurantAddress || '',
        restaurantLocation: order.restaurantLocation || { lat: 0, lng: 0 },
        customerName: order.customerName || 'Customer',
        customerAddress: order.deliveryAddress || order.customerAddress || '',
        customerLocation: {
          lat: order.deliveryLatitude || 0,
          lng: order.deliveryLongitude || 0,
        },
        items: order.items || [],
        total: order.total || 0,
        earning,
        distance: order.distance || 'N/A',
        estimatedTime: order.estimatedTime || '30-35 min',
        status: 'PENDING',
      });

      console.log(`Delivery created for order ${order.id || order.orderId}`);
      channel.ack(msg);
    } catch (error) {
      console.error('Error processing order.created:', error);
      channel.nack(msg, false, false);
    }
  });

  console.log('Listening for order.created events');
}

async function start(): Promise<void> {
  await connectDatabase();
  await connectRabbitMQ();
  startOrderConsumer();

  app.listen(config.port, () => {
    console.log(`Delivery Service running on port ${config.port}`);
  });
}

start().catch(console.error);

export default app;
