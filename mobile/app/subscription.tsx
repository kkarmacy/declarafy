import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { fetchSession, type User } from '../src/api/auth';
import { clearSession, saveSession } from '../src/auth/session';
import { displayPlan } from '../src/auth/entitlements';

export default function Subscription() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const live = await fetchSession();
      if (!live) {
        await clearSession();
        router.replace('/login');
        return;
      }
      setUser(live);
      await saveSession({ user: live });
    } catch {
      setError('No pudimos consultar tu suscripción. Comprueba tu conexión e inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return <SafeAreaView style={s.page}><View style={s.content}>
    <Text style={s.title}>Mi suscripción</Text>
    <Text style={s.description}>El plan y los accesos se consultan directamente desde tu cuenta de Declarafy.</Text>
    {loading ? <ActivityIndicator style={s.loading} /> : user ? <View style={s.card}>
      <Text style={s.label}>Plan actual</Text><Text style={s.plan}>{displayPlan(user.plan)}</Text>
      <Text style={s.label}>Cuenta</Text><Text style={s.value}>{user.email}</Text>
      <Text style={s.label}>Accesos habilitados</Text>
      <Text style={s.value}>{Array.isArray(user.features) ? (user.features.length ? user.features.join(', ') : 'Ninguno') : 'Consulta tu plan en la web para conocer todos los accesos.'}</Text>
    </View> : null}
    {!!error && <Text style={s.error}>{error}</Text>}
    <TouchableOpacity style={s.button} disabled={loading} onPress={() => void refresh()}><Text style={s.buttonText}>Actualizar suscripción</Text></TouchableOpacity>
    <TouchableOpacity style={s.back} onPress={() => router.replace('/dashboard')}><Text style={s.backText}>Volver al inicio</Text></TouchableOpacity>
    <Text style={s.note}>Los cambios de plan realizados en la web aparecerán aquí después de actualizar. Las compras desde Google Play todavía no están habilitadas.</Text>
  </View></SafeAreaView>;
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F5F8FC' }, content: { padding: 22 },
  title: { fontSize: 28, fontWeight: '900', color: '#0A2342' },
  description: { color: '#60748A', marginTop: 10, lineHeight: 21 },
  loading: { marginTop: 32 }, card: { backgroundColor: '#fff', borderRadius: 16, padding: 20, marginTop: 24 },
  label: { fontSize: 13, color: '#718096', marginTop: 12 }, plan: { fontSize: 28, fontWeight: '900', color: '#0877E8', marginTop: 6 },
  value: { fontSize: 16, color: '#0A2342', marginTop: 6 },
  error: { color: '#B42318', marginTop: 18 }, button: { backgroundColor: '#0877E8', borderRadius: 12, padding: 17, alignItems: 'center', marginTop: 24 },
  buttonText: { color: '#fff', fontWeight: '800' }, back: { alignItems: 'center', marginTop: 20 },
  backText: { color: '#0877E8', fontWeight: '700' }, note: { color: '#718096', lineHeight: 19, marginTop: 28, fontSize: 12 }
});
