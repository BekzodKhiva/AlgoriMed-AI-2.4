// auth.ts — Demo login (hardcoded users)

export interface User {
  id: string;
  name: string;
  role: string;
  hospital: string;
}

const DEMO_USERS: Record<string, { password: string; user: User }> = {
  'shifokor@algorimed.uz': {
    password: 'Demo1234',
    user: { id: '1', name: 'Dr. Bekzod Xolmatov', role: 'Neyrojarroh', hospital: 'Respublika Ixtisoslashtirilgan Shifoxonasi' },
  },
  'admin@algorimed.uz': {
    password: 'Admin5678',
    user: { id: '2', name: 'Dr. Nilufar Rashidova', role: 'Nevropatolog', hospital: 'Toshkent Shahri 1-Shifoxonasi' },
  },
  'demo@algorimed.uz': {
    password: 'demo',
    user: { id: '3', name: 'Dr. Demo Foydalanuvchi', role: 'Shoshilinch tibbiyot shifokor', hospital: 'Demo Shifoxona' },
  },
};

export function loginUser(email: string, password: string): User | null {
  const entry = DEMO_USERS[email.toLowerCase()];
  if (!entry) return null;
  if (entry.password !== password) return null;
  return entry.user;
}
