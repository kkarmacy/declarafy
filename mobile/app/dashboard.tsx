import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ModuleCard } from '../src/components/ModuleCard';
import { clearSession, getUser, saveSession } from '../src/auth/session';
import { fetchSession, type User } from '../src/api/auth';
import { canUseFeature, displayPlan, type Feature } from '../src/auth/entitlements';

type Tool = { title: string; desc: string; route: string; feature: Feature };
const tools: Tool[] = [
  { title: 'IA Fiscal', desc: 'Consulta tus dudas con IA especializada', route: '/ai-fiscal', feature: 'ai-fiscal' },
  { title: 'Calendario SUNAT', desc: 'Vencimientos y obligaciones', route: '/calendar', feature: 'calendar' },
  { title: 'Consulta RUC', desc: 'Información de cualquier RUC', route: '/ruc', feature: 'ruc' },
  { title: 'Calculadoras', desc: 'IGV y cálculos tributarios', route: '/calculators', feature: 'calculators' },
  { title: 'Multas y TIM', desc: 'Consulta y calcula', route: '/tim', feature: 'tim' },
  { title: 'Fraccionamiento', desc: 'Simula y conoce tus opciones', route: '/installments', feature: 'installments' },
];

export default function Dashboard() {
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const live = await fetchSession();
        if (!active) return;
        if (!live) {
          await clearSession();
          router.replace('/login');
          return;
        }
        setUser(live);
        await saveSession({ user: live });
      } catch {
        if (!active) return;
        // Never treat a cached local marker as proof of an active PHP session.
        setError('No se pudo verificar tu sesión. Revisa tu conexión e inténtalo nuevamente.');
      } finally {
        if (active) setChecking(false);
      }
    })();
    return () => { active = false; };
  }, []);
  if (checking) return <SafeAreaView style={s.page}><ActivityIndicator style={{ marginTop: 80 }} /></SafeAreaView>;
  if (error) return <SafeAreaView style={s.page}><View style={s.content}><Text style={s.subtitle}>{error}</Text><TouchableOpacity onPress={() => router.replace('/')}><Text style={s.profile}>Volver a intentar</Text></TouchableOpacity></View></SafeAreaView>;
  if (!user) return <SafeAreaView style={s.page}><ActivityIndicator /></SafeAreaView>;
  const plan = displayPlan(user.plan);
  const first = user.name?.trim().split(/\s+/)[0];
  return <SafeAreaView style={s.page}><ScrollView contentContainerStyle={s.content}><View style={s.top}><View><Text style={s.hello}>Hola{first ? ', ' + first : ''} 👋</Text><Text style={s.subtitle}>Tu aliado tributario siempre</Text></View><TouchableOpacity onPress={() => router.push('/profile')}><Text style={s.profile}>Mi perfil</Text></TouchableOpacity></View><View style={s.plan}><View><Text style={s.planTitle}>Plan {plan}</Text><Text style={s.planSub}>Declarafy</Text></View><Text style={s.link}>Cuenta activa</Text></View><Text style={s.section}>Herramientas</Text><View style={s.grid}>{tools.map(item => { const allowed = canUseFeature(user.plan, item.feature, user.features); return <ModuleCard key={item.title} title={item.title} description={item.desc} locked={!allowed} onPress={() => allowed ? router.push(item.route as any) : router.push('/profile')} />; })}</View></ScrollView></SafeAreaView>;
}
const s = StyleSheet.create({ page: { flex: 1, backgroundColor: '#F5F8FC' }, content: { padding: 20, paddingBottom: 40 }, top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, hello: { fontSize: 28, fontWeight: '900', color: '#0A2342' }, subtitle: { color: '#60748A', marginTop: 4 }, profile: { color: '#0877E8', fontWeight: '800' }, plan: { backgroundColor: '#fff', borderRadius: 16, padding: 18, marginTop: 22, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, planTitle: { fontWeight: '800', fontSize: 17, color: '#0A2342' }, planSub: { color: '#718096', marginTop: 4 }, link: { color: '#0877E8', fontWeight: '700' }, section: { fontSize: 20, fontWeight: '800', color: '#0A2342', marginTop: 26, marginBottom: 12 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 } });
