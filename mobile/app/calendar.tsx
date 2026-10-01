import { useEffect,useState } from 'react';
import { ActivityIndicator,SafeAreaView,ScrollView,StyleSheet,Text,View } from 'react-native';
import { CalendarItem,fetchCalendar } from '../src/api/modules';
export default function Calendar(){
 const [items,setItems]=useState<CalendarItem[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState('');
 useEffect(()=>{fetchCalendar().then(setItems).catch((e:any)=>setError(e?.message||'No se pudo cargar el calendario.')).finally(()=>setLoading(false));},[]);
 return <SafeAreaView style={s.page}><ScrollView contentContainerStyle={s.content}><Text style={s.title}>Calendario SUNAT</Text><Text style={s.sub}>Vencimientos y obligaciones tributarias.</Text>
 {loading?<ActivityIndicator/>:error?<Text style={s.error}>{error}</Text>:items.length===0?<View style={s.card}><Text style={s.empty}>No hay vencimientos disponibles.</Text></View>:items.map(x=><View key={String(x.id)} style={s.card}><Text style={s.date}>{x.date}</Text><Text style={s.cardTitle}>{x.title}</Text>{x.description?<Text style={s.empty}>{x.description}</Text>:null}</View>)}
 </ScrollView></SafeAreaView>
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:'#F5F8FC'},content:{padding:22,gap:12},title:{fontSize:28,fontWeight:'900',color:'#0A2342'},sub:{color:'#60748A',marginTop:-6,marginBottom:12},card:{backgroundColor:'#fff',padding:18,borderRadius:16},date:{color:'#0877E8',fontWeight:'800',marginBottom:5},cardTitle:{fontWeight:'800',fontSize:17,color:'#0A2342'},empty:{color:'#60748A',lineHeight:20,marginTop:8},error:{color:'#B42318'}});
