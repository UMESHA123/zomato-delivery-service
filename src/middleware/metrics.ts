import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';
import type { Request, Response, NextFunction } from 'express';

export const register = new Registry();

collectDefaultMetrics({ register, prefix: 'delivery_service_' });

export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code', 'service'],
  registers: [register],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code', 'service'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const httpActiveRequests = new Gauge({
  name: 'http_active_requests',
  help: 'Number of active HTTP requests',
  labelNames: ['service'],
  registers: [register],
});

const SERVICE_NAME = 'delivery-service';

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/metrics') {
    return next();
  }

  httpActiveRequests.inc({ service: SERVICE_NAME });
  const end = httpRequestDuration.startTimer();

  res.on('finish', () => {
    const route = req.path.replace(/\/[0-9a-f]{24}/g, '/:id').replace(/\/\d+/g, '/:id');
    const labels = {
      method: req.method,
      route,
      status_code: String(res.statusCode),
      service: SERVICE_NAME,
    };
    httpRequestsTotal.inc(labels);
    end(labels);
    httpActiveRequests.dec({ service: SERVICE_NAME });
  });

  next();
}
