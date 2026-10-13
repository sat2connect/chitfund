import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError } from '../errors/AppError.js';

export const requestId: RequestHandler = (req, res, next) => {
  const id = req.header('x-request-id') ?? randomUUID();
  res.locals.requestId = id;
  res.setHeader('x-request-id', id);
  next();
};

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`));
};

// Consistent error envelope: { error: { code, message, details?, requestId } }
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const requestId = res.locals.requestId as string | undefined;
  if (err instanceof AppError) {
    res.locals.errorCode = err.code;
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details, requestId },
    });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON body', requestId } });
    return;
  }
  console.error(`[${requestId}]`, err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error', requestId } });
};
