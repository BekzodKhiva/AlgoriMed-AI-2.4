'use client';
import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import styles from './login.module.css';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); setLoading(false); return; }
      router.push('/dashboard');
    } catch {
      setError('Tarmoq xatosi. Iltimos qayta urinib ko\'ring.');
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.left}>
        <div className={styles.brand}>
          <div className={styles.logo}>
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <rect width="40" height="40" rx="10" fill="white" fillOpacity="0.15"/>
              <path d="M20 8v24M8 20h24" stroke="white" strokeWidth="3" strokeLinecap="round"/>
              <circle cx="20" cy="20" r="7" stroke="white" strokeWidth="2.5" fill="none"/>
            </svg>
          </div>
          <span className={styles.brandName}>AlgoriMed</span>
        </div>
        <h1 className={styles.headline}>Klinik Qaror<br/>Qo&apos;llab-Quvvatlash<br/>Tizimi</h1>
        <p className={styles.sub}>Bosh miya jarohatini (TBI) baholash uchun ilmiy asoslangan protokollar: CCHR · GCS · BTF · NICE</p>
        <div className={styles.badges}>
          {['CCHR', 'GCS', 'BTF', 'NICE', 'PubMed'].map(b => (
            <span key={b} className={styles.badge}>{b}</span>
          ))}
        </div>
        <div className={styles.demoBox}>
          <p className={styles.demoTitle}>Demo kirish</p>
          <p className={styles.demoItem}>📧 demo@algorimed.uz</p>
          <p className={styles.demoItem}>🔑 demo</p>
        </div>
      </div>

      <div className={styles.right}>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Tizimga kirish</h2>
          <p className={styles.cardSub}>Shifokor hisobingiz bilan kirish</p>

          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.field}>
              <label className={styles.label}>Email manzil</label>
              <input
                type="email" className={styles.input} placeholder="shifokor@shifoxona.uz"
                value={email} onChange={e => setEmail(e.target.value)} required autoFocus
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Parol</label>
              <input
                type="password" className={styles.input} placeholder="••••••••"
                value={password} onChange={e => setPassword(e.target.value)} required
              />
            </div>
            {error && <div className={styles.error}>{error}</div>}
            <button type="submit" className={styles.btn} disabled={loading}>
              {loading ? 'Kirilmoqda...' : 'Kirish →'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
