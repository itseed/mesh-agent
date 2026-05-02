'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email, password, remember);
      router.push('/overview');
    } catch (err: any) {
      setError(err?.message ?? 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    'w-full bg-canvas/60 border border-border-hi text-text text-[15px] rounded px-4 py-2.5 placeholder-dim transition-all focus:border-accent/60 focus:bg-canvas';

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      {/* Background mesh icon (decorative) */}
      <Image
        src="/icon.svg"
        alt=""
        aria-hidden
        width={480}
        height={480}
        className="absolute pointer-events-none select-none"
        style={{
          opacity: 0.025,
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      />

      <div className="relative z-10 w-full max-w-[340px] px-4 fade-up">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <Image src="/icon.svg" alt="MeshAgent" width={64} height={64} className="w-16 h-16 mb-3" />
          <div className="text-[17px] font-semibold text-text tracking-tight">MeshAgent</div>
          <div className="text-[13px] text-muted mt-1">AI Dev Team Orchestration</div>
        </div>

        {/* Form */}
        <div className="bg-surface/80 border border-border rounded-xl p-6 backdrop-blur-sm">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
              required
              autoComplete="email"
            />
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputCls} pr-10`}
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-dim hover:text-muted transition-colors p-2"
                tabIndex={-1}
                aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
              >
                {showPassword ? (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="w-3.5 h-3.5 accent-accent"
              />
              <span className="text-[13px] text-muted">จำการเข้าสู่ระบบ (30 วัน)</span>
            </label>
            {error && (
              <p className="text-danger text-[14px] flex items-center gap-1.5">
                <span>✕</span> {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="mt-1 bg-accent/90 hover:bg-accent text-canvas text-[15px] font-semibold py-2.5 rounded transition-colors disabled:opacity-50"
            >
              {loading ? '…' : 'Sign in →'}
            </button>
          </form>
        </div>

        <p className="text-center text-[12px] text-dim mt-6">MeshAgent · Single-user mode</p>
      </div>
    </div>
  );
}
