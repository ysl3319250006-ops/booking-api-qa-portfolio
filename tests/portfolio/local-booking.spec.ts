import { test, expect, request as requestFactory } from '@playwright/test';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { BookingAPI } from '../../api/booking-api';
import { TestDataFactory } from '../../utils/test-data-factory';

// Isolated local practice service, not the live Restful Booker API.
test.describe('本地预约接口练习', () => {
  let server: ReturnType<typeof createServer>;
  let url: string;
  let records: Map<number, unknown>;
  let nextId: number;

  test.beforeEach(async () => {
    records = new Map();
    nextId = 1;
    server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const match = /^\/booking\/(\d+)$/.exec(req.url || '');
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const readBody = async () => {
        const parts: Buffer[] = [];
        for await (const part of req) parts.push(Buffer.from(part));
        return JSON.parse(Buffer.concat(parts).toString('utf8'));
      };
      if (req.method === 'POST' && req.url === '/booking') {
        const data = await readBody();
        const id = nextId++;
        records.set(id, data);
        return json(200, { bookingid: id, booking: data });
      }
      if (!match) return json(404, { error: 'not found' });
      const id = Number(match[1]);
      if (req.method === 'GET') {
        return records.has(id) ? json(200, records.get(id)) : json(404, { error: 'not found' });
      }
      if (req.headers.cookie !== 'token=local-test-token') return json(403, { error: 'forbidden' });
      if (!records.has(id)) return json(404, { error: 'not found' });
      if (req.method === 'PUT') {
        const data = await readBody();
        records.set(id, data);
        return json(200, data);
      }
      if (req.method === 'DELETE') {
        records.delete(id);
        return json(201, { message: 'deleted' });
      }
      return json(405, { error: 'method not allowed' });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  });

  test.afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  test('创建、读取、更新、删除后再次查询', async () => {
    const context = await requestFactory.newContext();
    try {
      const api = new BookingAPI(context, url);
      const original = TestDataFactory.generateBookingWithGuest('Demo', 'User', { totalprice: 120 });
      const created = await api.createBooking(original);
      expect(created.status()).toBe(200);
      const { bookingid } = await created.json();
      expect((await (await api.getBooking(bookingid)).json()).totalprice).toBe(120);
      const updated = { ...original, totalprice: 150 };
      expect((await api.updateBooking(bookingid, updated, 'local-test-token')).status()).toBe(200);
      expect((await (await api.getBooking(bookingid)).json()).totalprice).toBe(150);
      expect((await api.deleteBooking(bookingid, 'local-test-token')).status()).toBe(201);
      expect((await api.getBooking(bookingid)).status()).toBe(404);
    } finally {
      await context.dispose();
    }
  });

  test('未授权更新和删除应被拒绝，记录保持原值', async () => {
    const context = await requestFactory.newContext();
    try {
      const api = new BookingAPI(context, url);
      const original = TestDataFactory.generateBookingWithGuest('Safe', 'User', { totalprice: 120 });
      const { bookingid } = await (await api.createBooking(original)).json();
      expect((await api.updateBooking(bookingid, { ...original, totalprice: 999 })).status()).toBe(403);
      expect((await api.deleteBooking(bookingid)).status()).toBe(403);
      expect((await (await api.getBooking(bookingid)).json()).totalprice).toBe(120);
    } finally {
      await context.dispose();
    }
  });

  test('访问不存在的预约应返回 404', async () => {
    const context = await requestFactory.newContext();
    try {
      const api = new BookingAPI(context, url);
      expect((await api.getBooking(999)).status()).toBe(404);
    } finally {
      await context.dispose();
    }
  });
});
