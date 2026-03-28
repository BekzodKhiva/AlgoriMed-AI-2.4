import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AlgoriMed — TBI Klinik Qaror Tizimi',
  description: 'Bosh miya jarohati uchun klinik qaror qo\'llab-quvvatlash tizimi (CCHR, GCS, BTF, NICE)',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uz">
      <body>{children}</body>
    </html>
  );
}
