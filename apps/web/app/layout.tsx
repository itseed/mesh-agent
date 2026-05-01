import type { Metadata } from 'next';
import { IBM_Plex_Mono, Noto_Sans_Thai, Noto_Sans } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { CommandBar } from '@/components/layout/CommandBar';

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-mono',
  display: 'swap',
});

const notoSansThai = Noto_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-thai',
  display: 'swap',
});

const notoSans = Noto_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'MeshAgent',
  description: 'AI Dev Team Orchestration Platform',
  manifest: '/manifest.json',
  themeColor: '#06090f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="th"
      className={`${ibmPlexMono.variable} ${notoSansThai.variable} ${notoSans.variable}`}
    >
      <body>
        <AuthProvider>
          {children}
          <CommandBar />
        </AuthProvider>
      </body>
    </html>
  );
}
