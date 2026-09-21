import { router } from 'expo-router';
import { getToken,getUser } from './session';
import { canUseFeature,type Feature } from './entitlements';
export async function requireFeature(feature:Feature):Promise<boolean>{
 const [token,user]=await Promise.all([getToken(),getUser()]);
 if(!token){router.replace('/login');return false;}
 if(!canUseFeature(user?.plan,feature)){router.replace('/profile');return false;}
 return true;
}
