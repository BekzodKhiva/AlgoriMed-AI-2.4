'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import styles from './dashboard.module.css';

interface UserData {
  id: string;
  name: string;
  role: string;
  hospital: string;
}

interface SavedResult {
  id: string;
  score: number;
  decision: string;
  urgency: string;
  severity: string;
  gcsTotal: number;
  patientInfo?: { age: number; sex: string; traumaMechanism: string };
  analyzedAt: string;
}

const DECISION_UZ: Record<string, string> = {
  NO_CT_REQUIRED: 'KT talab etilmaydi',
  CT_RECOMMENDED: 'KT tavsiya etiladi',
  CT_REQUIRED: 'KT zarur',
  IMMEDIATE_CT: 'Shoshilinch KT',
  SURGICAL_EVALUATION: 'Jarrohlik baholash',
};

const URGENCY_COLOR: Record<string, string> = {
  LOW: '#27ae60', MODERATE: '#e67e22', HIGH: '#c0392b', EMERGENCY: '#8e0000',
};

const SEVERITY_UZ: Record<string, string> = {
  mild: 'Yengil', moderate: "O'rta", severe: "Og'ir", critical: 'Kritik',
};

const PROTOCOLS = [
  { key: 'cchr', name: 'CCHR', desc: 'Canadian CT Head Rule', weight: '35%', ref: 'Stiell et al, Lancet 2001' },
  { key: 'gcs',  name: 'GCS',  desc: 'Glasgow Coma Scale',    weight: '30%', ref: 'Teasdale & Jennett, 1974' },
  { key: 'btf',  name: 'BTF',  desc: 'Brain Trauma Foundation',weight: '20%', ref: 'BTF Guidelines 2016' },
  { key: 'nice', name: 'NICE', desc: "NICE CG176",            weight: '10%', ref: 'NICE, 2014' },
];

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [history, setHistory] = useState<SavedResult[]>([]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  useEffect(() => {
    const cookie = document.cookie.split(';').find(c => c.trim().startsWith('algorimed_user='));
    if (!cookie) { router.replace('/login'); return; }
    try {
      const u = JSON.parse(decodeURIComponent(cookie.split('=').slice(1).join('=')));
      setUser(u);
    } catch { router.replace('/login'); }

    const raw = sessionStorage.getItem('algorimed_history');
    if (raw) {
      try { setHistory(JSON.parse(raw)); } catch { /* ignore */ }
    }
  }, [router]);

  if (!user) return null;

  return (
    <div className={styles.page}>
      <Navbar doctorName={user.name} doctorRole={user.role} active="dashboard" />

      <main className={styles.main}>
        {/* Welcome */}
        <div className={styles.welcome}>
          <div>
            <h1 className={styles.welcomeTitle}>Xush kelibsiz, {user.name.split(' ')[0]} 👋</h1>
            <p className={styles.welcomeSub}>{user.role} · {user.hospital}</p>
          </div>
          <button className={styles.newBtn} onClick={() => router.push('/analyze')}>
            + Yangi tahlil
          </button>
        </div>

        {/* Stats */}
        <div className={styles.statsRow}>
          <div className={styles.statCard}>
            <div className={styles.statIcon} style={{ background: 'rgba(15,52,96,0.08)' }}>🧠</div>
            <div>
              <div className={styles.statVal}>{history.length}</div>
              <div className={styles.statLabel}>Bugungi tahlillar</div>
            </div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statIcon} style={{ background: 'rgba(192,57,43,0.08)' }}>🚨</div>
            <div>
              <div className={styles.statVal} style={{ color: 'var(--danger)' }}>
                {history.filter(h => h.urgency === 'EMERGENCY' || h.urgency === 'HIGH').length}
              </div>
              <div className={styles.statLabel}>Yuqori xavf</div>
            </div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statIcon} style={{ background: 'rgba(39,174,96,0.08)' }}>✅</div>
            <div>
              <div className={styles.statVal} style={{ color: 'var(--ok)' }}>
                {history.filter(h => h.urgency === 'LOW').length}
              </div>
              <div className={styles.statLabel}>Past xavf</div>
            </div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statIcon} style={{ background: 'rgba(46,184,194,0.1)' }}>📊</div>
            <div>
              <div className={styles.statVal} style={{ color: 'var(--accent)' }}>
                {history.length > 0
                  ? Math.round(history.reduce((a, h) => a + h.score, 0) / history.length)
                  : '—'}
              </div>
              <div className={styles.statLabel}>O&apos;rtacha xavf bali</div>
            </div>
          </div>
        </div>

        <div className={styles.grid}>
          {/* History */}
          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Tahlillar tarixi</h2>
            </div>
            {history.length === 0 ? (
              <div className={styles.empty}>
                <div className={styles.emptyIcon}>🩺</div>
                <p className={styles.emptyText}>Hali tahlil amalga oshirilmagan</p>
                <button className={styles.emptyBtn} onClick={() => router.push('/analyze')}>
                  Birinchi tahlilni boshlang
                </button>
              </div>
            ) : (
              <div className={styles.historyList}>
                {[...history].reverse().map((h, idx) => (
                  <div key={h.id} className={styles.historyRow} onClick={() => {
                    sessionStorage.setItem('algorimed_result', JSON.stringify(h));
                    router.push('/result');
                  }}>
                    <div className={styles.historyLeft}>
                      <div
                        className={styles.urgencyDot}
                        style={{ background: URGENCY_COLOR[h.urgency] ?? '#999' }}
                      />
                      <div>
                        <div className={styles.historyIndex}>TBI-{new Date(h.analyzedAt).toLocaleDateString('uz-UZ', {day:'2-digit',month:'2-digit',year:'numeric'}).replace(/\./g,'')}-{String(history.length - idx).padStart(3,'0')}</div>
                        <div className={styles.historyDecision}>{DECISION_UZ[h.decision] ?? h.decision}</div>
                        <div className={styles.historyMeta}>
                          {h.patientInfo ? `${h.patientInfo.age} yosh · ${h.patientInfo.sex}` : ''}
                          {' · '}GCS {h.gcsTotal} · {SEVERITY_UZ[h.severity] ?? h.severity}
                        </div>
                      </div>
                    </div>
                    <div className={styles.historyRight}>
                      <div className={styles.historyScore}>{h.score}<span>/100</span></div>
                      <div className={styles.historyTime}>
                        {new Date(h.analyzedAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div className={styles.historyArrow}>→</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Protocols info */}
          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Protokollar</h2>
            </div>
            <div className={styles.protocolList}>
              {PROTOCOLS.map(p => (
                <div key={p.key} className={styles.protocolCard}>
                  <div className={styles.protocolBadge}>{p.name}</div>
                  <div className={styles.protocolInfo}>
                    <div className={styles.protocolName}>{p.desc}</div>
                    <div className={styles.protocolRef}>{p.ref}</div>
                  </div>
                  <div className={styles.protocolWeight}>{p.weight}</div>
                </div>
              ))}
            </div>

            <div className={styles.infoBox}>
              <div className={styles.infoTitle}>⚕️ Tizim haqida</div>
              <p className={styles.infoText}>
                <strong>AlgoriMed</strong> — bosh miya jarohati (TBI) uchun
                ko&apos;p protokolli, vazn asosidagi klinik qaror
                qo&apos;llab-quvvatlash tizimi. Natijalar ilmiy adabiyotga asoslangan.
              </p>
              <div className={styles.infoWarning}>
                ⚠️ Yakuniy klinik qaror <strong>doimo shifokorda</strong> qoladi!
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
