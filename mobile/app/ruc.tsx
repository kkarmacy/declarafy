import { useState } from 'react';
import { ActivityIndicator,SafeAreaView,StyleSheet,Text,TextInput,TouchableOpacity,View } from 'react-native';
import { fetchRuc,RucResult } from '../src/api/modules';
import { isValidRuc } from '../src/utils/validation';

export default function Ruc(){
 const [ruc,setRuc]=useState('');const [loading,setLoading]=useState(false);const [error,setError]=useState('');const [result,setResult]=useState<RucResult|null>(null);
 async function search(){if(!isValidRuc(ruc)){setError('Ingresa un RUC válido de 11 dígitos.');return;}setLoading(true);setError('');setResult(null);try{setResult(await fetchRuc(ruc));}catch(e:any){setError(e?.message||'No se pudo consultar el RUC.');}finally{setLoading(false);}}
 return <SafeAreaView style={s.page}><View style={s.content}>
  <Text style={s.title}>Consulta RUC</Text><Text style={s.sub}>Consulta información de un contribuyente.</Text>
  <TextInput value={ruc} onChangeText={t=>setRuc(t.replace(/\D/g,'').slice(0,11))} keyboardType="number-pad" placeholder="Ingresa 11 dígitos" style={s.input}/>
  {!!error&&<Text style={s.error}>{error}</Text>}<TouchableOpacity style={[s.button,loading&&s.disabled]} onPress={search} disabled={loading}>{loading?<ActivityIndicator color="#fff"/>:<Text style={s.buttonText}>Consultar</Text>}</TouchableOpacity>
  {result&&<View style={s.card}><Text style={s.cardTitle}>{result.razonSocial||result.ruc}</Text><Text style={s.line}>RUC: {result.ruc}</Text><Text style={s.line}>Estado: {result.estado||'—'}</Text><Text style={s.line}>Condición: {result.condicion||'—'}</Text>{result.direccion?<Text style={s.line}>Dirección: {result.direccion}</Text>:null}</View>}
 </View></SafeAreaView>
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:'#F5F8FC'},content:{padding:22},title:{fontSize:28,fontWeight:'900',color:'#0A2342'},sub:{color:'#60748A',marginTop:6,marginBottom:26},input:{backgroundColor:'#fff',borderWidth:1,borderColor:'#D7E1EA',borderRadius:14,padding:17,fontSize:18},button:{backgroundColor:'#0877E8',padding:17,borderRadius:14,alignItems:'center',marginTop:14},disabled:{opacity:.6},buttonText:{color:'#fff',fontWeight:'800',fontSize:16},error:{color:'#B42318',marginTop:10},card:{backgroundColor:'#fff',borderRadius:16,padding:18,marginTop:18},cardTitle:{fontWeight:'900',fontSize:17,color:'#0A2342',marginBottom:10},line:{color:'#52677D',lineHeight:21}});
