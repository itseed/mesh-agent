import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '@/lib/auth';
import { AuthGuard } from '@/components/layout/AuthGuard';

const replaceMock = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), replace: replaceMock, back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe('AuthGuard', () => {
  beforeEach(() => {
    replaceMock.mockReset();
  });

  it('redirects to /login when /auth/me returns 401', async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ error: 'Unauthorized' }),
    });

    render(
      <AuthProvider>
        <AuthGuard>
          <div>secret</div>
        </AuthGuard>
      </AuthProvider>,
    );

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
  });

  it('renders children when /auth/me returns user', async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'u1', email: 'admin@example.com', role: 'admin' }),
    });

    render(
      <AuthProvider>
        <AuthGuard>
          <div>secret</div>
        </AuthGuard>
      </AuthProvider>,
    );

    await screen.findByText('secret');
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
