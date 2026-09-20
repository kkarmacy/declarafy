import { useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function Ruc(){
 const [ruc,setRuc]=useState('');
 return <SafeAreaView style={s.page}><View style={s.content}>
   <Text style={s.title}>Consulta RUC</Text><Text style={s.sub}>Consulta información pública de un contribuyente.</Text>
   <TextInput value={ruc} onChangeText={t=>setRuc(t.replace(/\D/g,'').slice(0,11))} keyboardType="number-pad" placeholder="Ingresa 11 dígitos" style={s.input}/>
   <TouchableOpacity style={[s.button,ruc.length!==11&&s.disabled]} disabled={ruc.length!==11}><Text style={s.buttonText}>Consultar</Text></TouchableOpacity>
   <Text style={s.note}>La consulta se conectará al servicio RUC existente de Declarafy cuando confirmemos su endpoint de producción.</Text>
 </View></SafeAreaView>
}
const s=StyleSheet.create({
 page:{flex:1,backgroundColor:'#F5F8FC'},content:{padding:22},title:{fontSize:28,fontWeight:'900',color:'#0A2342'},sub:{color:'#60748A',marginTop:6,marginBottom:26},
 input:{backgroundColor:'#fff',borderWidth:1,borderColor:'#D7E1EA',borderRadius:14,padding:17,fontSize:18},button:{backgroundColor:'#0877E8',padding:17,borderRadius:14,alignItems:'center',marginTop:14},
 disabled:{opacity:.45},buttonText:{color:'#fff',fontWeight:'800',fontSize:16},note:{color:'#718096',fontSize:12,lineHeight:18,marginTop:20}
});
