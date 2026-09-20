import { useMemo,useState } from 'react';
import { SafeAreaView,ScrollView,StyleSheet,Text,TextInput,View } from 'react-native';

const n=(v:string)=>Number(v.replace(',','.'))||0;
const money=(v:number)=>new Intl.NumberFormat('es-PE',{minimumFractionDigits:2,maximumFractionDigits:2}).format(v);

export default function Calculators(){
 const [total,setTotal]=useState('');
 const result=useMemo(()=>{const t=n(total);const base=t/1.18;return {base,igv:t-base};},[total]);
 return <SafeAreaView style={s.page}><ScrollView contentContainerStyle={s.content}>
  <Text style={s.title}>Calculadoras</Text><Text style={s.sub}>Herramientas rápidas para cálculos tributarios frecuentes.</Text>
  <View style={s.card}><Text style={s.cardTitle}>Separar IGV (18%)</Text>
   <Text style={s.label}>Importe total incluido IGV</Text><TextInput value={total} onChangeText={setTotal} keyboardType="decimal-pad" placeholder="0.00" style={s.input}/>
   <View style={s.row}><Text style={s.muted}>Valor de venta</Text><Text style={s.value}>S/ {money(result.base)}</Text></View>
   <View style={s.row}><Text style={s.muted}>IGV</Text><Text style={s.value}>S/ {money(result.igv)}</Text></View>
  </View>
  <Text style={s.note}>El cálculo usa la tasa general de IGV de 18%. Confirma el tratamiento aplicable a tu operación antes de declarar.</Text>
 </ScrollView></SafeAreaView>
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:'#F5F8FC'},content:{padding:22},title:{fontSize:28,fontWeight:'900',color:'#0A2342'},sub:{color:'#60748A',marginTop:6,marginBottom:22},card:{backgroundColor:'#fff',padding:20,borderRadius:16},cardTitle:{fontSize:18,fontWeight:'800',color:'#0A2342',marginBottom:18},label:{fontSize:13,color:'#60748A',marginBottom:8},input:{borderWidth:1,borderColor:'#D7E1EA',borderRadius:12,padding:15,fontSize:18,marginBottom:18},row:{flexDirection:'row',justifyContent:'space-between',paddingVertical:9},muted:{color:'#60748A'},value:{fontWeight:'800',color:'#0A2342'},note:{fontSize:12,color:'#718096',lineHeight:18,marginTop:18}});
