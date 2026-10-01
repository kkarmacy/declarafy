import { router } from 'expo-router';
import { fetchSession } from '../api/auth';
import { clearSession, saveSession } from './session';
import { canUseFeature, type Feature } from './entitlements';

export async function requireFeature(feature: Feature): Promise<boolean> {
  try {
    const user = await fetchSession();
    if (!user) {
      await clearSession();
      router.replace('/login');
      return false;
    }
    await saveSession({ user });
    if (!canUseFeature(user.plan, feature, user.features)) {
      router.replace('/profile');
      return false;
    }
    return true;
  } catch {
    router.replace('/error');
    return false;
  }
}
