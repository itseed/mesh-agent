import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import './setup.js';
import { buildServer } from '../server.js';

describe('Auth routes', () => {
  let server: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    server = await buildServer();
  });

  afterAll(async () => {
    await server.close();
  });

  describe('POST /auth/login', () => {
    it('returns user + token and sets HttpOnly cookie on success', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@example.com', password: 'changeme123' },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.token).toBeTruthy();
      expect(body.user).toMatchObject({ email: 'admin@example.com', role: 'admin' });
      const setCookie = response.headers['set-cookie'];
      expect(setCookie).toBeTruthy();
      expect(String(setCookie)).toMatch(/mesh_token=/);
      expect(String(setCookie)).toMatch(/HttpOnly/);
    });

    it('returns 401 with wrong password', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@example.com', password: 'wrong' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 401 with unknown email', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'other@example.com', password: 'changeme123' },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /auth/me', () => {
    it('returns current user with bearer token', async () => {
      const login = await server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@example.com', password: 'changeme123' },
      });
      const { token } = login.json();

      const response = await server.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      const me = response.json();
      expect(me.email).toBe('admin@example.com');
      expect(me.role).toBe('admin');
      expect(me.id).toBeTruthy();
    });

    it('returns current user via cookie', async () => {
      const login = await server.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'admin@example.com', password: 'changeme123' },
      });
      const cookies = login.cookies as Array<{ name: string; value: string }>;
      const cookie = cookies.find((c) => c.name === 'mesh_token')!;

      const response = await server.inject({
        method: 'GET',
        url: '/auth/me',
        cookies: { mesh_token: cookie.value },
      });
      expect(response.statusCode).toBe(200);
    });

    it('returns 401 without token', async () => {
      const response = await server.inject({ method: 'GET', url: '/auth/me' });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('clears the auth cookie', async () => {
      const response = await server.inject({ method: 'POST', url: '/auth/logout' });
      expect(response.statusCode).toBe(200);
      const setCookie = String(response.headers['set-cookie'] ?? '');
      expect(setCookie).toMatch(/mesh_token=/);
    });
  });
});
