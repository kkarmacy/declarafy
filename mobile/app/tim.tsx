import { useState } from 'react';
import { SafeAreaView,StyleSheet,Text,TextInput,TouchableOpacity,View } from 'react-native';

export default function Tim(){
 const [amount,setAmount]=useState(''); const [days,setDays]=useState('');
 return <SafeAreaView style={s.page}><View style={s.content}>
  <Text style={s.title}>Multas y TIM</Text><Text style={s.sub}>Calcula intereses usando parámetros vigentes obtenidos desde el backend.</Text>
  <View style={s.card}><TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="Deuda tributaria (S/)" style={s.input}/>
   <TextInput value={days} onChangeText={setDays} keyboardType="number-pad" placeholder="Días" style={s.input}/>
   <TouchableOpacity style={s.button}><Text style={s.buttonText}>Calcular con TIM vigente</Text></TouchableOpacity>
  </View>
  <Text style={s.note}>La tasa no está codificada en la app: se obtendrá de Declarafy para evitar usar una TIM desactualizada.</Text>
 </View></SafeAreaView>
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:'#F5F8FC'},content:{padding:22},title:{fontSize:28,fontWeight:'900',color:'#0A2342'},sub:{color:'#60748A',marginTop:6,marginBottom:22},card:{backgroundColor:'#fff',padding:18,borderRadius:16},input:{borderWidth:1,borderColor:'#D7E1EA',borderRadius:12,padding:15,marginBottom:12,fontSize:16},button:{backgroundColor:'#0877E8',padding:16,borderRadius:12,alignItems:'center'},buttonText:{color:'#fff',fontWeight:'800'},note:{fontSize:12,color:'#718096',lineHeight:18,marginTop:18}});
