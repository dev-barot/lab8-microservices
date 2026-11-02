const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Enable CORS for frontend / browser clients
app.use(cors());

// Service Discovery (Configuration-Based via Environment Variables)
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:3001';
const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost:3002';
const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://localhost:3003';

// -------------------------------------------------------------
// Prometheus Metrics Setup (Standard prom-client with graceful fallback)
// -------------------------------------------------------------
let promRegister = null;
let httpRequestsTotal = null;
let httpRequestDurationSeconds = null;

try {
  const client = require('prom-client');
  promRegister = new client.Registry();
  client.collectDefaultMetrics({ register: promRegister, prefix: 'app_' });

  httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests made to the API Gateway',
    labelNames: ['method', 'route', 'status_code'],
    registers: [promRegister],
  });

  httpRequestDurationSeconds = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Histogram of HTTP request durations in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
    registers: [promRegister],
  });
} catch (e) {
  // prom-client not installed locally yet; in-memory fallback will be used
}

// Fallback in-memory metrics store
const fallbackMetrics = {
  requestCount: 0,
  byRoute: {},
  byStatus: {},
  startTime: Date.now(),
};

// Request Logging & Prometheus Metrics Tracking Middleware
app.use((req, res, next) => {
  const start = Date.now();
  let targetService = 'Gateway Internal';
  let routeCategory = 'other';

  if (req.originalUrl.startsWith('/users')) {
    targetService = `User Service (${USER_SERVICE_URL})`;
    routeCategory = '/users';
  } else if (req.originalUrl.startsWith('/products')) {
    targetService = `Product Service (${PRODUCT_SERVICE_URL})`;
    routeCategory = '/products';
  } else if (req.originalUrl.startsWith('/orders')) {
    targetService = `Order Service (${ORDER_SERVICE_URL})`;
    routeCategory = '/orders';
  } else if (req.originalUrl.startsWith('/health')) {
    targetService = 'Health Check';
    routeCategory = '/health';
  } else if (req.originalUrl.startsWith('/metrics')) {
    targetService = 'Prometheus Metrics';
    routeCategory = '/metrics';
  }

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const durationSeconds = durationMs / 1000;
    const statusCode = String(res.statusCode);

    // Track in prom-client if available
    if (httpRequestsTotal && httpRequestDurationSeconds) {
      httpRequestsTotal.inc({
        method: req.method,
        route: routeCategory,
        status_code: statusCode,
      });
      httpRequestDurationSeconds.observe(
        {
          method: req.method,
          route: routeCategory,
          status_code: statusCode,
        },
        durationSeconds
      );
    }

    // Always update fallback metrics
    fallbackMetrics.requestCount++;
    fallbackMetrics.byRoute[routeCategory] = (fallbackMetrics.byRoute[routeCategory] || 0) + 1;
    fallbackMetrics.byStatus[statusCode] = (fallbackMetrics.byStatus[statusCode] || 0) + 1;

    console.log(
      `[GATEWAY LOG] ${req.method} ${req.originalUrl} -> ${targetService} | Status: ${res.statusCode} (${durationMs}ms)`
    );
  });
  next();
});

// Standard HTTP dev logging
app.use(morgan('dev'));

// Centralized Error Handler Factory for Unreachable Target Services (503 Service Unavailable)
const createServiceErrorHandler = (serviceName) => (err, req, res) => {
  console.error(`[GATEWAY ERROR] ${serviceName} unreachable: ${err.message}`);
  if (!res.headersSent) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: `${serviceName} unavailable`,
        message: `The requested backend service (${serviceName}) is currently unreachable.`,
        statusCode: 503,
      })
    );
  }
};

// Route: User Service (/users/* -> User Service)
app.use(
  '/users',
  createProxyMiddleware({
    target: USER_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: (path, req) => req.originalUrl,
    on: {
      error: createServiceErrorHandler('User Service'),
    },
    onError: createServiceErrorHandler('User Service'),
  })
);

// Route: Product Service (/products/* -> Product Service)
app.use(
  '/products',
  createProxyMiddleware({
    target: PRODUCT_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: (path, req) => req.originalUrl,
    on: {
      error: createServiceErrorHandler('Product Service'),
    },
    onError: createServiceErrorHandler('Product Service'),
  })
);

// Route: Order Service (/orders/* -> Order Service)
app.use(
  '/orders',
  createProxyMiddleware({
    target: ORDER_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: (path, req) => req.originalUrl,
    on: {
      error: createServiceErrorHandler('Order Service'),
    },
    onError: createServiceErrorHandler('Order Service'),
  })
);

// Health Check Endpoint (No Proxying - used for K8s Liveness & Readiness Probes)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    service: 'API Gateway',
    timestamp: new Date().toISOString(),
    routes: {
      users: USER_SERVICE_URL,
      products: PRODUCT_SERVICE_URL,
      orders: ORDER_SERVICE_URL,
    },
  });
});

// Prometheus Metrics Scrape Endpoint
app.get('/metrics', async (req, res) => {
  if (promRegister) {
    try {
      res.set('Content-Type', promRegister.contentType);
      return res.end(await promRegister.metrics());
    } catch (err) {
      return res.status(500).end(err.message);
    }
  }

  // Fallback Prometheus text exposition format (answers queries: up, http_requests_total, rate)
  const uptimeSeconds = (Date.now() - fallbackMetrics.startTime) / 1000;
  let text = [
    '# HELP process_uptime_seconds Process uptime in seconds',
    '# TYPE process_uptime_seconds gauge',
    `process_uptime_seconds ${uptimeSeconds.toFixed(2)}`,
    '# HELP http_requests_total Total number of HTTP requests processed by API Gateway',
    '# TYPE http_requests_total counter',
    `http_requests_total ${fallbackMetrics.requestCount}`,
  ];

  for (const [route, count] of Object.entries(fallbackMetrics.byRoute)) {
    text.push(`http_requests_total{route="${route}"} ${count}`);
  }
  for (const [code, count] of Object.entries(fallbackMetrics.byStatus)) {
    text.push(`http_requests_total{status_code="${code}"} ${count}`);
  }

  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.end(text.join('\n') + '\n');
});

app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(` API Gateway is running on port ${PORT}`);
  console.log(` Configured User Service:    ${USER_SERVICE_URL}`);
  console.log(` Configured Product Service: ${PRODUCT_SERVICE_URL}`);
  console.log(` Configured Order Service:   ${ORDER_SERVICE_URL}`);
  console.log(` Health Endpoint:            http://localhost:${PORT}/health`);
  console.log(` Prometheus Metrics:         http://localhost:${PORT}/metrics`);
  console.log(`===============================================`);
});