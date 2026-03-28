'use client';
import { useRouter } from 'next/navigation';
import styles from './Navbar.module.css';

interface NavbarProps {
  doctorName?: string;
  doctorRole?: string;
  active?: 'dashboard' | 'analyze';
}

export default function Navbar({ doctorName, doctorRole, active }: NavbarProps) {
  const router = useRouter();

  function logout() {
    document.cookie = 'algorimed_user=; max-age=0; path=/';
    router.push('/login');
  }

  return (
    <header className={styles.nav}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <svg width="28" height="28" viewBox="0 0 40 40" fill="none">
            <rect width="40" height="40" rx="10" fill="#0f3460"/>
            <path d="M20 8v24M8 20h24" stroke="white" strokeWidth="3" strokeLinecap="round"/>
            <circle cx="20" cy="20" r="7" stroke="white" strokeWidth="2.5" fill="none"/>
          </svg>
          <span className={styles.brandName}>AlgoriMed</span>
          <span className={styles.version}>v2.0</span>
        </div>

        <nav className={styles.links}>
          <button
            className={`${styles.link} ${active === 'dashboard' ? styles.linkActive : ''}`}
            onClick={() => router.push('/dashboard')}
          >Panel</button>
          <button
            className={`${styles.link} ${active === 'analyze' ? styles.linkActive : ''}`}
            onClick={() => router.push('/analyze')}
          >Yangi tahlil</button>
        </nav>

        <div className={styles.user}>
          {doctorName && (
            <div className={styles.userInfo}>
              <span className={styles.userName}>{doctorName}</span>
              {doctorRole && <span className={styles.userRole}>{doctorRole}</span>}
            </div>
          )}
          <button className={styles.logoutBtn} onClick={logout}>Chiqish</button>
        </div>
      </div>
    </header>
  );
}
