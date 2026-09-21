import { useEffect,useState } from 'react';
import { SafeAreaView,StyleSheet,Text,TextInput,TouchableOpacity,View } from 'react-native';
import { simulateInstallments,InstallmentResult } from '../src/utils/finance';
import { requireFeature } from '../src/auth/guard';
const num=(v:string)=>Number(v.replace(',','.'))||0;
export default function Installments(){
 useEffect(()=>{requireFeature('installments');},[]);
 const [debt,setDebt]=useState('');const [months,setMonths]=useState('');const [rate,setRate]=useState('');const [result,setResult]=useState<InstallmentResult|null>(null);const [error,setError]=useState('');
 function simulate(){try{setResult(simulateInstallments(num(debt),num(months),num(rate)));setError('');}catch(e:any){setError(e.message);setResult(null);}}
 return <SafeAreaView style={s.page}><View style={s.content}><Text style={s.title}>Fraccionamiento</Text><Text style={s.sub}>Simula cuotas con los parámetros que ingreses.</Text><View style={s.card}>
 <TextInput value={debt} onChangeText={setDebt} keyboardType="decimal-pad" placeholder="Deuda (S/)" style={s.input}/><TextInput value={months} onChangeText={setMonths} keyboardType="number-pad" placeholder="Número de cuotas" style={s.input}/><TextInput value={rate} onChangeText={setRate} keyboardType="decimal-pad" placeholder="Tasa mensual (%)" style={s.input}/><TouchableOpacity style={s.button} onPress={simulate}><Text style={s.buttonText}>Simular</Text></TouchableOpacity></View>
 {!!error&&<Text style={s.error}>{error}</Text>}{result&&<View style={s.result}><Text style={s.line}>Cuota estimada: S/ {result.payment.toFixed(2)}</Text><Text style={s.line}>Intereses estimados: S/ {result.interest.toFixed(2)}</Text><Text style={s.total}>Total: S/ {result.total.toFixed(2)}</Text></View>}<Text style={s.note}>Simulación financiera, no aprobación ni cálculo oficial de SUNAT. Las reglas de elegibilidad se integrarán desde el backend.</Text></View></SafeAreaView>
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:'#F5F8FC'},content:{padding:22},title:{fontSize:28,fontWeight:'900',color:'#0A2342'},sub:{color:'#60748A',marginTop:6,marginBottom:22},card:{backgroundColor:'#fff',padding:18,borderRadius:16},input:{borderWidth:1,borderColor:'#D7E1EA',borderRadius:12,padding:15,marginBottom:12,fontSize:16},button:{backgroundColor:'#0877E8',padding:16,borderRadius:12,alignItems:'center'},buttonText:{color:'#fff',fontWeight:'800'},error:{color:'#B42318',marginTop:12},result:{backgroundColor:'#fff',padding:18,borderRadius:16,marginTop:14},line:{color:'#52677D',marginBottom:7},total:{fontWeight:'900',fontSize:18,color:'#0A2342'},note:{fontSize:12,color:'#718096',lineHeight:18,marginTop:18}});
