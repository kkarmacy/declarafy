import { router } from 'expo-router';
import { useEffect,useState } from 'react';
import { SafeAreaView,StyleSheet,Text,TouchableOpacity,View } from 'react-native';
import { clearSession,getUser } from '../src/auth/session';
import type { User } from '../src/api/auth';

export default function Profile(){
 const [user,setUser]=useState<User|null>(null);
 useEffect(()=>{getUser().then(setUser)},[]);
 async function logout(){await clearSession();router.replace('/login');}
 return <SafeAreaView style={s.page}><View style={s.content}>
  <Text style={s.title}>Mi perfil</Text>
  <View style={s.card}><Text style={s.label}>Correo</Text><Text style={s.value}>{user?.email??'Sesión local no iniciada'}</Text>
  <Text style={s.label}>Plan</Text><Text style={s.value}>{user?.plan??'Free'}</Text></View>
  <TouchableOpacity style={s.logout} onPress={logout}><Text style={s.logoutText}>Cerrar sesión</Text></TouchableOpacity>
 </View></SafeAreaView>
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:'#F5F8FC'},content:{padding:22},title:{fontSize:28,fontWeight:'900',color:'#0A2342',marginBottom:22},card:{backgroundColor:'#fff',borderRadius:16,padding:20},label:{fontSize:12,color:'#718096',marginTop:8},value:{fontSize:16,fontWeight:'700',color:'#0A2342',marginTop:4,marginBottom:12},logout:{borderWidth:1,borderColor:'#D92D20',padding:16,borderRadius:14,alignItems:'center',marginTop:20},logoutText:{color:'#D92D20',fontWeight:'800'}});
