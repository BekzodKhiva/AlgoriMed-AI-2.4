'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { AnalysisResult } from '@/lib/types';
import styles from './result.module.css';

interface UserData { id: string; name: string; role: string; hospital: string; }
interface PubMedArticle { pmid: string; title: string; authors: string; journal: string; year: string; url: string; }

const DECISION_UZ: Record<string, string> = {
  NO_CT_REQUIRED:      'KT TALAB ETILMAYDI',
  CT_RECOMMENDED:      'KT TAVSIYA ETILADI',
  CT_REQUIRED:         'KT TAVSIYA ETILADI',
  IMMEDIATE_CT:        'SHOSHILINCH KT TAVSIYA ETILADI',
  SURGICAL_EVALUATION: 'JARROHLIK BAHOLASH TAVSIYA ETILADI',
};

const DECISION_UZ_CT_DONE: Record<string, string> = {
  NO_CT_REQUIRED:      'KUZATISH YETARLI',
  CT_RECOMMENDED:      'DINAMIK KUZATISH',
  CT_REQUIRED:         'NEYROLOGIK MONITORING',
  SURGICAL_EVALUATION: 'JARROHLIK BAHOLASH TAVSIYA ETILADI',
};

const DECISION_DESC: Record<string, string> = {
  NO_CT_REQUIRED:      "Hozirgi klinik ko'rsatkichlar asosida KT skanini bajarish talab etilmaydi.",
  CT_RECOMMENDED:      'Ehtiyot chorasi sifatida KT bajarish tavsiya etiladi.',
  CT_REQUIRED:         "Klinik ko'rsatmalar asosida KT skanini bajarish tavsiya etiladi.",
  IMMEDIATE_CT:        'Shoshilinch KT bajarish tavsiya etiladi.',
  SURGICAL_EVALUATION: 'Neyrojarroh bilan maslahat va jarrohlik baholash tavsiya etiladi.',
};

const DECISION_DESC_CT_DONE: Record<string, string> = {
  NO_CT_REQUIRED:      'KT bajarildi va natija normal. Kuzatish yetarli.',
  CT_RECOMMENDED:      'KT bajarildi. Dinamik nevrologik kuzatish tavsiya etiladi.',
  CT_REQUIRED:         'KT bajarildi. Natijaga qarab nevrologik monitoring tavsiya etiladi.',
  SURGICAL_EVALUATION: 'KT bajarildi. Neyrojarroh bilan maslahat tavsiya etiladi.',
};

const URGENCY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  LOW:       { label: 'Past xavf',    color: '#27ae60', bg: 'rgba(39,174,96,0.08)' },
  MODERATE:  { label: "O'rtacha",    color: '#e67e22', bg: 'rgba(230,126,34,0.08)' },
  HIGH:      { label: 'Yuqori xavf', color: '#c0392b', bg: 'rgba(192,57,43,0.08)' },
  EMERGENCY: { label: 'FAVQULODDA', color: '#8e0000', bg: 'rgba(142,0,0,0.1)' },
};

const SEVERITY_UZ: Record<string, string> = {
  mild: 'Yengil', moderate: "O'rta", severe: "Og'ir", critical: 'Kritik',
};

const PROTOCOL_INFO: Record<string, { fullName: string; color: string }> = {
  cchr:    { fullName: 'Canadian CT Head Rule',  color: '#0f3460' },
  gcs:     { fullName: 'Glasgow Coma Scale',      color: '#16457a' },
  btf:     { fullName: 'Brain Trauma Foundation', color: '#1e5f9f' },
  nice:    { fullName: 'NICE CG176',              color: '#2eb8c2' },
  alcohol: { fullName: 'Alkogol Modifikatori',    color: '#6b7a99' },
  vital:   { fullName: 'Vital Signs / IMPACT',    color: '#8e0000' },
};

function ScoreBar({ score, color }: { score: number; color: string }) {
  return (
    <div className={styles.barTrack}>
      <div className={styles.barFill} style={{ width: `${score}%`, background: color }} />
    </div>
  );
}

export default function ResultPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [articles, setArticles] = useState<PubMedArticle[]>([]);
  const [pubmedLoading, setPubmedLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'breakdown' | 'xai' | 'treatment' | 'pubmed'>('overview');

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, []);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, [activeTab]);

  useEffect(() => {
    const cookie = document.cookie.split(';').find(c => c.trim().startsWith('algorimed_user='));
    if (!cookie) { router.replace('/login'); return; }
    try { setUser(JSON.parse(decodeURIComponent(cookie.split('=').slice(1).join('=')))); }
    catch { router.replace('/login'); return; }

    const raw = sessionStorage.getItem('algorimed_result');
    if (!raw) { router.replace('/analyze'); return; }
    try {
      const r = JSON.parse(raw) as AnalysisResult;
      setResult(r);
      if (r.pubmedQuery) {
        setPubmedLoading(true);
        const qp = r.pubmedQueries && r.pubmedQueries.length > 1
          ? `&queries=${encodeURIComponent(JSON.stringify(r.pubmedQueries.slice(1, 5)))}`
          : '';
        fetch(`/api/pubmed?q=${encodeURIComponent(r.pubmedQuery)}${qp}`)
          .then(res => res.json())
          .then(d => { setArticles(d.articles ?? []); setPubmedLoading(false); })
          .catch(() => setPubmedLoading(false));
      }
    } catch { router.replace('/analyze'); }
  }, [router]);

  async function handlePDF() {
    if (!result || !user) return;
    setPdfLoading(true);
    try {
      const { generatePDF } = await import('@/lib/pdf');
      await generatePDF(result, user.name);
    } catch (e) { console.error(e); }
    setPdfLoading(false);
  }

  if (!user || !result) return null;

  const urgency    = URGENCY_CONFIG[result.urgency] ?? URGENCY_CONFIG.LOW;
  const isEmergency = result.urgency === 'EMERGENCY' || result.urgency === 'HIGH';
  const ctFindings  = result.patientInfo?.ctFindings ?? [];
  const ctDone      = ctFindings.length > 0 || (result.patientInfo as any)?.ctStatus === 'normal';
  const decisionLabel = ctDone
    ? (DECISION_UZ_CT_DONE[result.decision] ?? DECISION_UZ[result.decision])
    : (DECISION_UZ[result.decision] ?? result.decision);
  const decisionDesc = ctDone
    ? (DECISION_DESC_CT_DONE[result.decision] ?? DECISION_DESC[result.decision])
    : (DECISION_DESC[result.decision] ?? '');

  const hasXai = result.xaiEntries && result.xaiEntries.length > 0;

  return (
    <div className={styles.page}>
      <Navbar doctorName={user.name} doctorRole={user.role} />

      <main className={styles.main}>

        {/* ── Emergency banner ── */}
        {isEmergency && (
          <div className={styles.emergencyBanner} style={{ background: urgency.color }}>
            {result.urgency === 'EMERGENCY' ? '🚨' : '⚠️'} {urgency.label} — {decisionDesc}
          </div>
        )}

        {/* ── Hero decision card ── */}
        <div className={styles.heroCard} style={{ borderColor: urgency.color }}>
          <div className={styles.heroLeft}>
            <div className={styles.urgencyPill} style={{ background: urgency.bg, color: urgency.color }}>
              {urgency.label}
            </div>
            <h1 className={styles.decisionTitle} style={{ color: urgency.color }}>
              {decisionLabel}
            </h1>
            <p className={styles.decisionDesc}>{decisionDesc}</p>

            <div className={styles.metaRow}>
              {result.patientInfo && (
                <>
                  <div className={styles.metaChip}>👤 {result.patientInfo.age} yosh, {result.patientInfo.sex}</div>
                  <div className={styles.metaChip}>🚗 {result.patientInfo.traumaMechanism}</div>
                </>
              )}
              <div className={styles.metaChip}>🧠 GCS {result.gcsTotal}/15 — {SEVERITY_UZ[result.severity]}</div>
              {result.rtsScore !== undefined && (
                <div className={styles.metaChip} style={{
                  color: result.rtsScore >= 7 ? '#27ae60' : result.rtsScore >= 5 ? '#e67e22' : '#c0392b',
                  fontWeight: 600,
                }}>
                  📊 RTS {result.rtsScore}
                </div>
              )}
              {result.hasPolytrauma && result.polytravmaZones && result.polytravmaZones.length > 0 && (
                <div className={styles.metaChip} style={{ color: '#993C1D', fontWeight: 600 }}>
                  🏥 Qo'shimcha jarohatlar: {result.polytravmaZones.join(', ')}
                </div>
              )}
              {result.analyzedAt && (
                <div className={styles.metaChip}>
                  🕐 {new Date(result.analyzedAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}
                </div>
              )}
            </div>
          </div>

          <div className={styles.heroRight}>
            <div className={styles.scoreRing}>
              <svg viewBox="0 0 100 100" className={styles.ringsvg}>
                <circle cx="50" cy="50" r="42" fill="none" stroke="#eef1f7" strokeWidth="10" />
                <circle
                  cx="50" cy="50" r="42" fill="none"
                  stroke={urgency.color} strokeWidth="10"
                  strokeDasharray={`${result.score * 2.638} ${263.8}`}
                  strokeLinecap="round"
                  transform="rotate(-90 50 50)"
                />
              </svg>
              <div className={styles.scoreInner}>
                <span className={styles.scoreNum} style={{ color: urgency.color }}>{result.score}</span>
                <span className={styles.scoreLabel}>/ 100</span>
              </div>
            </div>

            {/* Ishonchlilik + penalty */}
            <div className={styles.confBox}>
              <span className={styles.confLabel}>Ishonchlilik</span>
              <span className={styles.confVal}>{Math.round(result.confidence * 100)}%</span>
            </div>
            {result.confidencePenalties && result.confidencePenalties.length > 0 && (
              <div style={{
                marginTop: 8, padding: '7px 10px', borderRadius: 6,
                background: 'rgba(230,126,34,0.09)', border: '1px solid #e67e22',
                fontSize: 11, color: '#b86a00', lineHeight: 1.7,
              }}>
                {result.confidencePenalties.map((p, i) => (
                  <div key={i}>⚠️ {p}</div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Action buttons ── */}
        <div className={styles.actions}>
          <button className={styles.actionPrimary} onClick={() => router.push('/analyze')}>
            + Yangi tahlil
          </button>
          <button className={styles.actionSecondary} onClick={handlePDF} disabled={pdfLoading}>
            {pdfLoading ? '⏳ Tayyorlanmoqda...' : '📄 PDF — TBI hisobot'}
          </button>
          <button className={styles.actionSecondary} onClick={() => router.push('/dashboard')}>
            ← Panelga qaytish
          </button>
        </div>

        {/* ── Tabs ── */}
        <div className={styles.tabs}>
          {(['overview', 'breakdown', 'xai', 'treatment', 'pubmed'] as const).map(tab => (
            <button key={tab} className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(tab)}>
              {{
                overview:  '📋 Umumiy',
                breakdown: '📊 Protokollar',
                xai:       '🔍 Nima uchun?',
                treatment: '💊 Davolash',
                pubmed:    '🔬 PubMed',
              }[tab]}
              {tab === 'pubmed' && articles.length > 0 && (
                <span className={styles.tabBadge}>{articles.length}</span>
              )}
              {tab === 'xai' && hasXai && (
                <span className={styles.tabBadge}>{result.xaiEntries.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* ════════════════════════════════════════════════════════════
            TAB: OVERVIEW
        ════════════════════════════════════════════════════════════ */}
        {activeTab === 'overview' && (
          <div className={styles.tabContent}>

            {/* Faollashgan qoidalar */}
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Faollashgan qoidalar</h2>
              <div className={styles.reasonsList}>
                {result.reasons.map((r, i) => (
                  <div key={i} className={styles.reasonItem}>
                    <div className={styles.reasonNum}>{i + 1}</div>
                    <span>{r}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Qo'shimcha jarohatlar + RTS */}
            {(result.hasPolytrauma || result.rtsScore !== undefined) && (
              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>Qo'shimcha jarohatlar va vital belgilar</h2>
                <div style={{ display: 'grid', gap: 10 }}>
                  {result.rtsScore !== undefined && (
                    <div style={{
                      padding: '12px 16px', borderRadius: 8,
                      background: result.rtsScore >= 7 ? 'rgba(39,174,96,0.08)' : result.rtsScore >= 5 ? 'rgba(230,126,34,0.08)' : 'rgba(192,57,43,0.08)',
                      border: `1px solid ${result.rtsScore >= 7 ? '#27ae60' : result.rtsScore >= 5 ? '#e67e22' : '#c0392b'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>📊 Revised Trauma Score (RTS)</div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Boyd et al. 1987 — GCS + SBP + Nafas tezligi</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{
                          fontSize: 24, fontWeight: 700,
                          color: result.rtsScore >= 7 ? '#27ae60' : result.rtsScore >= 5 ? '#e67e22' : '#c0392b',
                        }}>{result.rtsScore}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {result.rtsScore >= 7 ? 'Yaxshi prognoz' : result.rtsScore >= 5 ? "O'rta xavf" : 'Yuqori xavf (norma 7.84)'}
                        </div>
                      </div>
                    </div>
                  )}
                  {result.hasPolytrauma && result.polytravmaZones && (
                    <div style={{
                      padding: '12px 16px', borderRadius: 8,
                      background: 'rgba(154,60,29,0.06)', border: '1px solid #993C1D',
                    }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: '#993C1D', marginBottom: 6 }}>
                        🏥 Qo'shimcha jarohatlar aniqlandi — WSES 2019/2020 · CRASH model
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {result.polytravmaZones.map((z: string) => (
                          <span key={z} style={{
                            padding: '3px 10px', borderRadius: 20,
                            background: '#993C1D', color: 'white', fontSize: 12, fontWeight: 500,
                          }}>{z}</span>
                        ))}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
                        Primary Survey (cABCDE) to&apos;liq bajarish — davolash tartibini ko&apos;ring
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Protokol ballari */}
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Protokol ballari (qisqacha)</h2>
              <div className={styles.quickScores}>
                {Object.entries(result.breakdown).map(([key, val]) => {
                  const info = PROTOCOL_INFO[key];
                  if (key === 'vital' && val.score === 0) return null;
                  return (
                    <div key={key} className={styles.quickScore}>
                      <div className={styles.quickScoreHead}>
                        <span className={styles.quickScoreName}>{key.toUpperCase()}</span>
                        <span className={styles.quickScoreVal}>{val.score}</span>
                      </div>
                      <ScoreBar score={val.score} color={info?.color ?? '#0f3460'} />
                      <div className={styles.quickScoreSub}>{info?.fullName}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Manbalar */}
            <div className={styles.sourcesRow}>
              <span className={styles.sourcesLabel}>Manbalar:</span>
              {result.sources.map(s => (
                <span key={s} className={styles.sourceBadge}>{s}</span>
              ))}
            </div>

            {/* Jarrohlik holati */}
            {result.hematomaSurgery && (
              <div className={`${styles.surgicalBox} ${result.surgicalUrgency === 'emergency' ? styles.surgicalEmergency : ''}`}>
                <div className={styles.surgicalTitle}>
                  🏥 Jarrohlik holati:{' '}
                  {{
                    observe:          'Kuzatish yetarli',
                    repeat_ct:        'KT takrorlash tavsiya etiladi',
                    surgery_required: 'Jarrohlik talab etiladi',
                  }[result.hematomaSurgery] ?? result.hematomaSurgery}
                </div>
                <div className={styles.surgicalSub}>
                  Shoshqichlik:{' '}
                  {{
                    not_required: "Talab etilmaydi",
                    monitor:      'Kuzatish',
                    urgent:       'Shoshilinch',
                    emergency:    'FAVQULODDA',
                  }[result.surgicalUrgency] ?? result.surgicalUrgency}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════
            TAB: BREAKDOWN
        ════════════════════════════════════════════════════════════ */}
        {activeTab === 'breakdown' && (
          <div className={styles.tabContent}>
            {Object.entries(result.breakdown).map(([key, val]) => {
              const info = PROTOCOL_INFO[key];
              if (key === 'vital' && val.rules.length === 0) return null;
              return (
                <div key={key} className={styles.protocolCard}>
                  <div className={styles.protocolCardHead}>
                    <div>
                      <span className={styles.protocolBadge} style={{ background: info?.color }}>{key.toUpperCase()}</span>
                      <span className={styles.protocolFullName}>{info?.fullName}</span>
                    </div>
                    <div className={styles.protocolStats}>
                      <div className={styles.protocolStat}>
                        <span>Ball</span><strong style={{ color: info?.color }}>{val.score}</strong>
                      </div>
                      {key !== 'vital' && (
                        <>
                          <div className={styles.protocolStat}>
                            <span>Vazn</span><strong>{Math.round(val.weight * 100)}%</strong>
                          </div>
                          <div className={styles.protocolStat}>
                            <span>Hissa</span><strong>{val.contribution}</strong>
                          </div>
                        </>
                      )}
                      {key === 'vital' && (
                        <div className={styles.protocolStat}>
                          <span>Rol</span><strong style={{ fontSize: 11 }}>Override</strong>
                        </div>
                      )}
                    </div>
                  </div>
                  <ScoreBar score={val.score} color={info?.color ?? '#0f3460'} />

                  {val.rules.length > 0 ? (
                    <div className={styles.rulesList}>
                      {val.rules.map(rule => (
                        <div key={rule.id} className={`${styles.ruleItem} ${rule.riskLevel === 'high' ? styles.ruleHigh : styles.ruleMed}`}>
                          <div className={styles.ruleTop}>
                            <span className={styles.ruleId}>{rule.id}</span>
                            <span className={styles.ruleName}>{rule.name}</span>
                            <span className={`${styles.ruleLevel} ${rule.riskLevel === 'high' ? styles.ruleLevelHigh : styles.ruleLevelMed}`}>
                              {rule.riskLevel === 'high' ? 'Yuqori' : "O'rta"}
                            </span>
                          </div>
                          <p className={styles.ruleDesc}>{rule.description}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className={styles.noRules}>Bu protokol bo&apos;yicha qoidalar faollashmagan</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════
            TAB: XAI — NIMA UCHUN BU QAROR?
            Hujjat tavsiyasi: FACT + EFFECT + IMPACT + SOURCE
        ════════════════════════════════════════════════════════════ */}
        {activeTab === 'xai' && (
          <div className={styles.tabContent}>
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Nima uchun bu qaror? (XAI tushuntirish)</h2>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>
                Har bir klinik topilma uchun — holat, ta&apos;siri va xavf darajasi ilmiy manba bilan
              </p>

              {hasXai ? (
                <div style={{ display: 'grid', gap: 14 }}>
                  {result.xaiEntries.map((entry, i) => (
                    <div key={i} style={{
                      borderRadius: 10, overflow: 'hidden',
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                    }}>
                      {/* Sarlavha */}
                      <div style={{
                        padding: '8px 14px',
                        background: 'var(--bg)',
                        borderBottom: '1px solid var(--border)',
                        fontSize: 12, fontWeight: 700, color: 'var(--muted)',
                        letterSpacing: '0.04em', textTransform: 'uppercase',
                      }}>
                        {i + 1}. klinik topilma
                      </div>

                      <div style={{ padding: '12px 14px', display: 'grid', gap: 10 }}>
                        {/* HOLAT */}
                        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          <span style={{
                            minWidth: 58, fontSize: 11, fontWeight: 700, textAlign: 'center',
                            color: '#0f3460', padding: '2px 6px',
                            background: 'rgba(15,52,96,0.09)', borderRadius: 4,
                          }}>HOLAT</span>
                          <span style={{ fontSize: 13, fontWeight: 600, paddingTop: 1 }}>{entry.fact}</span>
                        </div>

                        {/* TA'SIR */}
                        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          <span style={{
                            minWidth: 58, fontSize: 11, fontWeight: 700, textAlign: 'center',
                            color: '#e67e22', padding: '2px 6px',
                            background: 'rgba(230,126,34,0.09)', borderRadius: 4,
                          }}>MEXANIZM</span>
                          <span style={{ fontSize: 13, color: 'var(--text)', paddingTop: 1 }}>{entry.effect}</span>
                        </div>

                        {/* XAVF */}
                        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          <span style={{
                            minWidth: 58, fontSize: 11, fontWeight: 700, textAlign: 'center',
                            color: '#c0392b', padding: '2px 6px',
                            background: 'rgba(192,57,43,0.09)', borderRadius: 4,
                          }}>MA&apos;NO</span>
                          <span style={{ fontSize: 13, color: 'var(--text)', paddingTop: 1 }}>{entry.impact}</span>
                        </div>

                        {/* Manba */}
                        <div style={{
                          fontSize: 11, color: 'var(--muted)',
                          paddingTop: 4, borderTop: '1px solid var(--border)',
                        }}>
                          📚 {entry.source}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{
                  padding: '24px', textAlign: 'center',
                  color: 'var(--muted)', fontSize: 14,
                  border: '1px dashed var(--border)', borderRadius: 10,
                }}>
                  Bu tahlil uchun maxsus tushuntirish mavjud emas — qarorlar standart protokollar asosida chiqarildi
                </div>
              )}
            </div>

            {/* Confidence penalty tushuntirishi */}
            {result.confidencePenalties && result.confidencePenalties.length > 0 && (
              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>Nima uchun ishonchlilik past?</h2>
                <div style={{
                  padding: '14px 16px', borderRadius: 8,
                  background: 'rgba(230,126,34,0.07)', border: '1px solid #e67e22',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#b86a00', marginBottom: 8 }}>
                    Quyidagi ma&apos;lumotlar kiritilmagan — ishonchlilik pasaytirildi:
                  </div>
                  {result.confidencePenalties.map((p, i) => (
                    <div key={i} style={{ fontSize: 13, color: '#b86a00', marginBottom: 4 }}>
                      ⚠️ {p}
                    </div>
                  ))}
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
                    SBP, SpO2 va KT natijasini kiritish — ishonchlilikni oshiradi va engine aniqroq ishlaydi
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════
            TAB: TREATMENT
        ════════════════════════════════════════════════════════════ */}
        {activeTab === 'treatment' && (
          <div className={styles.tabContent}>
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Davolash taktikasi</h2>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
                ⚠️ Barcha tavsiyalar klinik qaror qo&apos;llab-quvvatlash uchun — yakuniy qaror shifokorga tegishli
              </p>
              <div className={styles.treatmentList}>
                {result.treatmentTactics.map((t, i) => (
                  <div key={i} className={`${styles.treatItem} ${i === 0 && isEmergency ? styles.treatItemPrimary : ''}`}>
                    <div className={styles.treatNum}>{i + 1}</div>
                    <p className={styles.treatText}>{t}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.disclaimerBox}>
              <div className={styles.disclaimerIcon}>⚕️</div>
              <p className={styles.disclaimerText}>{result.disclaimer}</p>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════
            TAB: PUBMED
        ════════════════════════════════════════════════════════════ */}
        {activeTab === 'pubmed' && (
          <div className={styles.tabContent}>
            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>PubMed ilmiy maqolalari</h2>
              <div className={styles.pubmedQuery}>
                <span className={styles.pubmedQueryLabel}>So&apos;rov:</span>
                <code className={styles.pubmedQueryText}>{result.pubmedQuery}</code>
              </div>

              {pubmedLoading ? (
                <div className={styles.pubmedLoading}>
                  <div className={styles.spinner} /> PubMed ma&apos;lumotlari yuklanmoqda...
                </div>
              ) : articles.length > 0 ? (
                <div className={styles.articlesList}>
                  {articles.map(a => (
                    <a key={a.pmid} href={a.url} target="_blank" rel="noopener noreferrer" className={styles.articleCard}>
                      <div className={styles.articleYear}>{a.year}</div>
                      <div className={styles.articleBody}>
                        <div className={styles.articleTitle}>{a.title}</div>
                        <div className={styles.articleMeta}>
                          <span>{a.authors}</span>
                          {a.journal && <span className={styles.articleJournal}> · {a.journal}</span>}
                        </div>
                      </div>
                      <div className={styles.articleArrow}>→</div>
                    </a>
                  ))}
                </div>
              ) : (
                <div className={styles.pubmedEmpty}>
                  <p>PubMed dan maqolalar topilmadi</p>
                  <p style={{ fontSize: 12, marginTop: 6, opacity: 0.7 }}>
                    <a href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(result.pubmedQuery)}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ color: 'var(--primary)', textDecoration: 'underline' }}>
                      PubMed da to&apos;g&apos;ridan qidirish →
                    </a>
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
