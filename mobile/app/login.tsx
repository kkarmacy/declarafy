import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import { login } from '../src/api/auth';
import { saveSession } from '../src/auth/session';

export default function Login() {
 const [email,setEmail]=useState(''); const [password,setPassword]=useState('');
 const [loading,setLoading]=useState(false); const [error,setError]=useState('');
 async function submit(){
  if(!email.trim()||!password){setError('Ingresa tu correo y contraseña.');return;}
  setLoading(true);setError('');
  try{const result=await login(email.trim(),password);await saveSession(result);router.replace('/dashboard');}
  catch(e:any){setError(e?.message||'No se pudo iniciar sesión.');}
  finally{setLoading(false);}
 }
 return <SafeAreaView style={styles.page}>
  <Text style={styles.brand}>Declarafy</Text><Text style={styles.title}>Inicia sesión</Text>
  <Text style={styles.sub}>Ingresa a tu cuenta y sigue creciendo.</Text>
  <TextInput value={email} onChangeText={setEmail} style={styles.input} placeholder="Correo electrónico" autoCapitalize="none" keyboardType="email-address" editable={!loading}/>
  <TextInput value={password} onChangeText={setPassword} style={styles.input} placeholder="Contraseña" secureTextEntry editable={!loading}/>
  {!!error&&<Text style={styles.error}>{error}</Text>}
  <TouchableOpacity style={[styles.button,loading&&styles.disabled]} onPress={submit} disabled={loading}>
   {loading?<ActivityIndicator color="#fff"/>:<Text style={styles.buttonText}>Iniciar sesión</Text>}
  </TouchableOpacity>
  <Text style={styles.note}>La app utilizará la misma cuenta de Declarafy. La autenticación quedará operativa cuando el endpoint PHP de producción esté disponible en el repositorio/configuración.</Text>
 </SafeAreaView>
}
const styles=StyleSheet.create({
 page:{flex:1,backgroundColor:'#fff',padding:28,justifyContent:'center'},brand:{color:'#073B77',fontSize:34,fontWeight:'900',marginBottom:48},
 title:{fontSize:30,fontWeight:'800',color:'#0A2342'},sub:{fontSize:15,color:'#61738A',marginTop:8,marginBottom:28},
 input:{borderWidth:1,borderColor:'#D8E1EA',borderRadius:12,padding:16,marginBottom:14,fontSize:16},
 button:{backgroundColor:'#0877E8',borderRadius:12,padding:17,alignItems:'center',marginTop:8},disabled:{opacity:.65},
 buttonText:{color:'#fff',fontSize:16,fontWeight:'800'},error:{color:'#B42318',marginBottom:8},note:{fontSize:12,color:'#7B8794',marginTop:24,lineHeight:18}
});
