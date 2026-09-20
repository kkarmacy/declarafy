import { useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function AiFiscal(){
 const [message,setMessage]=useState('');
 return <SafeAreaView style={s.page}>
   <View style={s.header}><Text style={s.title}>IA Fiscal</Text><Text style={s.sub}>Tu asistente tributario</Text></View>
   <ScrollView contentContainerStyle={s.chat}>
     <View style={s.bot}><Text style={s.botText}>Hola. Soy tu IA Fiscal. Puedo ayudarte con consultas tributarias, SUNAT, comprobantes, regímenes y obligaciones.</Text></View>
     <View style={s.notice}><Text style={s.noticeText}>Las respuestas de IA son informativas. Verifica decisiones tributarias relevantes con la normativa vigente o un especialista.</Text></View>
   </ScrollView>
   <View style={s.composer}><TextInput value={message} onChangeText={setMessage} placeholder="Escribe tu consulta..." style={s.input} multiline/><TouchableOpacity style={s.send}><Text style={s.sendText}>Enviar</Text></TouchableOpacity></View>
 </SafeAreaView>
}
const s=StyleSheet.create({
 page:{flex:1,backgroundColor:'#F5F8FC'},header:{backgroundColor:'#fff',padding:20,borderBottomWidth:1,borderBottomColor:'#E7EDF3'},
 title:{fontSize:24,fontWeight:'900',color:'#0A2342'},sub:{color:'#60748A',marginTop:3},chat:{padding:18,gap:14},
 bot:{backgroundColor:'#fff',padding:16,borderRadius:16,maxWidth:'88%'},botText:{color:'#243B53',lineHeight:21},
 notice:{backgroundColor:'#EAF4FF',padding:14,borderRadius:14},noticeText:{color:'#315B7D',fontSize:12,lineHeight:18},
 composer:{backgroundColor:'#fff',padding:12,flexDirection:'row',gap:10,alignItems:'flex-end'},input:{flex:1,borderWidth:1,borderColor:'#D7E1EA',borderRadius:14,padding:12,maxHeight:100},
 send:{backgroundColor:'#0877E8',borderRadius:12,paddingVertical:12,paddingHorizontal:16},sendText:{color:'#fff',fontWeight:'800'}
});
