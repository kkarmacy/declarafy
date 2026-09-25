import { router } from 'expo-router';
import { useEffect,useState } from 'react';
import { ActivityIndicator,SafeAreaView,StyleSheet,Text,TouchableOpacity,View } from 'react-native';
import { getToken } from '../src/auth/session';
export default function Welcome(){
 const [checking,setChecking]=useState(true);
 useEffect(()=>{getToken().then(token=>{if(token) router.replace('/dashboard');}).finally(()=>setChecking(false));},[]);
 if(checking)return <SafeAreaView style={styles.page}><ActivityIndicator color="#fff" size="large"/></SafeAreaView>;
 return <SafeAreaView style={styles.page}><View style={styles.logo}><Text style={styles.logoBars}>▮▮▮</Text></View><Text style={styles.brand}>Declarafy</Text><Text style={styles.tagline}>Tu aliado tributario siempre</Text><Text style={styles.hero}>Tributación clara,{String.fromCharCode(10)}decisiones más grandes.</Text><TouchableOpacity style={styles.button} onPress={()=>router.push('/login')}><Text style={styles.buttonText}>Comenzar</Text></TouchableOpacity><Text style={styles.footer}>Hecho para emprendedores, contadores y empresas del Perú.</Text></SafeAreaView>;
}
const styles=StyleSheet.create({page:{flex:1,backgroundColor:'#073B77',alignItems:'center',justifyContent:'center',padding:28},logo:{width:82,height:82,borderRadius:20,backgroundColor:'#087BD1',alignItems:'center',justifyContent:'center'},logoBars:{color:'#fff',fontSize:28,fontWeight:'900'},brand:{color:'#fff',fontSize:42,fontWeight:'800',marginTop:18},tagline:{color:'#DCEBFA',fontSize:16,marginTop:4},hero:{color:'#fff',fontSize:24,fontWeight:'700',textAlign:'center',marginTop:64,lineHeight:32},button:{backgroundColor:'#fff',borderRadius:14,paddingVertical:16,width:'100%',alignItems:'center',marginTop:72},buttonText:{color:'#073B77',fontWeight:'800',fontSize:17},footer:{color:'#DCEBFA',textAlign:'center',marginTop:20,fontSize:12}});
