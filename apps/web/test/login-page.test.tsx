import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AuthProvider } from '@/lib/auth'
import LoginPage from '@/app/login/page'

const pushMock = vi.fn()

vi.mock('next/navigation', () => ({
  usePathname: () => '/login',
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

describe('LoginPage', () => {
  beforeEach(() => {
    pushMock.mockReset()
  })

  it('shows error message on failed login', async () => {
    ;(globalThis as any).fetch = vi
      .fn()
      // initial /auth/me call from AuthProvider
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'x' }) })
      // login attempt
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Invalid credentials' }),
      })

    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    )

    fireEvent.change(screen.getByPlaceholderText('Email'), {
      target: { value: 'wrong@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'badpassword' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }))

    await waitFor(() => expect(screen.getByText(/Invalid credentials/)).toBeInTheDocument())
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('navigates to /overview on successful login', async () => {
    ;(globalThis as any).fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'x' }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ user: { id: 'u1', email: 'a@b.c', role: 'admin' } }),
      })

    render(
      <AuthProvider>
        <LoginPage />
      </AuthProvider>,
    )

    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'a@b.c' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'goodpassword' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }))

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/overview'))
  })
})
