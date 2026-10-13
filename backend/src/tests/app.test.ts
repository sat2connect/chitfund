import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';

const app = createApp();

describe('API foundation', () => {
  it('health endpoint responds ok with request id', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('dashboard summary is labelled as demo data', async () => {
    const res = await request(app).get('/api/v1/dashboard/summary').set('x-dev-user', 'u-ops');
    expect(res.status).toBe(200);
    expect(res.body.dataSource).toBe('demo');
    expect(res.body.notice).toMatch(/sample/i);
  });

  it('unknown route returns consistent error envelope', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('malformed JSON returns 400 envelope', async () => {
    const res = await request(app).post('/api/v1/health').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});
