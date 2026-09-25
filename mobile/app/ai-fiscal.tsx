import { useEffect,useState } from 'react';
import { ActivityIndicator,SafeAreaView,ScrollView,StyleSheet,Text,TextInput,TouchableOpacity,View } from 'react-native';
import { askFiscalAI } from '../src/api/modules';
import { requireFeature } from '../src/auth/guard';
type Msg={role:'user'|'assistant';text:string};
export default function AiFiscal(){
 useEffect(()=>{requireFeature('ai-fiscal');},[]);
 const [message,setMessage]=useState('');const [loading,setLoading]=useState(false);const [error,setError]=useState('');
 const [messages,setMessages]=useState<Msg[]>([{role:'assistant',text:'Hola. Soy tu IA Fiscal. Puedo ayudarte con consultas tributarias, SUNAT, comprobantes, regímenes y obligaciones.'}]);
 async function send(){const q=message.trim();if(!q||loading)return;setMessage('');setError('');setMessages(m=>[...m,{role:'user',text:q}]);setLoading(true);try{const r=await askFiscalAI(q);setMessages(m=>[...m,{role:'assistant',text:r.answer}]);}catch(e:any){setError(e?.message||'No se pudo obtener una respuesta.');}finally{setLoading(false);}}
 return <SafeAreaView style={s.page}><View style={s.header}><Text style={s.title}>IA Fiscal</Text><Text style={s.sub}>Tu asistente tributario</Text></View>
 <ScrollView contentContainerStyle={s.chat}>{messages.map((m,i)=><View key={i} style={m.role==='user'?s.user:s.bot}><Text style={m.role==='user'?s.userText:s.botText}>{m.text}</Text></View>)}{loading&&<ActivityIndicator/>}{!!error&&<Text style={s.error}>{error}</Text>}<View style={s.notice}><Text style={s.noticeText}>Información orientativa. Verifica decisiones tributarias relevantes con normativa vigente o un especialista.</Text></View></ScrollView>
 <View style={s.composer}><TextInput value={message} onChangeText={setMessage} placeholder="Escribe tu consulta..." style={s.input} multiline/><TouchableOpacity style={s.send} onPress={send}><Text style={s.sendText}>Enviar</Text></TouchableOpacity></View></SafeAreaView>
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:'#F5F8FC'},header:{backgroundColor:'#fff',padding:20,borderBottomWidth:1,borderBottomColor:'#E7EDF3'},title:{fontSize:24,fontWeight:'900',color:'#0A2342'},sub:{color:'#60748A',marginTop:3},chat:{padding:18,gap:12},bot:{backgroundColor:'#fff',padding:16,borderRadius:16,maxWidth:'88%'},user:{backgroundColor:'#0877E8',padding:16,borderRadius:16,maxWidth:'88%',alignSelf:'flex-end'},botText:{color:'#243B53',lineHeight:21},userText:{color:'#fff',lineHeight:21},notice:{backgroundColor:'#EAF4FF',padding:14,borderRadius:14},noticeText:{color:'#315B7D',fontSize:12,lineHeight:18},error:{color:'#B42318'},composer:{backgroundColor:'#fff',padding:12,flexDirection:'row',gap:10,alignItems:'flex-end'},input:{flex:1,borderWidth:1,borderColor:'#D7E1EA',borderRadius:14,padding:12,maxHeight:100},send:{backgroundColor:'#0877E8',borderRadius:12,paddingVertical:12,paddingHorizontal:16},sendText:{color:'#fff',fontWeight:'800'}});
