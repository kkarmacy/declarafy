import { useState } from 'react';
import { SafeAreaView,StyleSheet,Text,TextInput,TouchableOpacity,View } from 'react-native';

export default function Installments(){
 const [debt,setDebt]=useState(''); const [months,setMonths]=useState('');
 return <SafeAreaView style={s.page}><View style={s.content}>
  <Text style={s.title}>Fraccionamiento</Text><Text style={s.sub}>Simula escenarios antes de solicitar un fraccionamiento.</Text>
  <View style={s.card}><TextInput value={debt} onChangeText={setDebt} keyboardType="decimal-pad" placeholder="Deuda (S/)" style={s.input}/>
   <TextInput value={months} onChangeText={setMonths} keyboardType="number-pad" placeholder="Número de cuotas" style={s.input}/>
   <TouchableOpacity style={s.button}><Text style={s.buttonText}>Simular</Text></TouchableOpacity>
  </View>
  <Text style={s.note}>La simulación final incorporará reglas, intereses, límites y elegibilidad vigentes desde el backend de Declarafy.</Text>
 </View></SafeAreaView>
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:'#F5F8FC'},content:{padding:22},title:{fontSize:28,fontWeight:'900',color:'#0A2342'},sub:{color:'#60748A',marginTop:6,marginBottom:22},card:{backgroundColor:'#fff',padding:18,borderRadius:16},input:{borderWidth:1,borderColor:'#D7E1EA',borderRadius:12,padding:15,marginBottom:12,fontSize:16},button:{backgroundColor:'#0877E8',padding:16,borderRadius:12,alignItems:'center'},buttonText:{color:'#fff',fontWeight:'800'},note:{fontSize:12,color:'#718096',lineHeight:18,marginTop:18}});
