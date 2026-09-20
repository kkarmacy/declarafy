import { router } from 'expo-router';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ModuleCard } from '../src/components/ModuleCard';

const tools = [
  {title:'IA Fiscal',desc:'Consulta tus dudas con IA especializada',route:'/ai-fiscal'},
  {title:'Calendario SUNAT',desc:'Vencimientos y obligaciones',route:'/calendar'},
  {title:'Consulta RUC',desc:'Información de cualquier RUC',route:'/ruc'},
  {title:'Calculadoras',desc:'IGV, renta, multas e intereses'},
  {title:'Multas y TIM',desc:'Consulta y calcula'},
  {title:'Fraccionamiento',desc:'Simula y conoce tus opciones'},
];

export default function Dashboard(){
 return <SafeAreaView style={s.page}><ScrollView contentContainerStyle={s.content}>
   <Text style={s.hello}>Hola 👋</Text><Text style={s.subtitle}>Tu aliado tributario siempre</Text>
   <View style={s.plan}><View><Text style={s.planTitle}>Plan Free</Text><Text style={s.planSub}>Declarafy</Text></View><Text style={s.link}>Ver plan ›</Text></View>
   <Text style={s.section}>Herramientas</Text>
   <View style={s.grid}>{tools.map(item=><ModuleCard key={item.title} title={item.title} description={item.desc} onPress={item.route ? ()=>router.push(item.route as any) : undefined}/>)}</View>
 </ScrollView></SafeAreaView>
}
const s=StyleSheet.create({
 page:{flex:1,backgroundColor:'#F5F8FC'},content:{padding:20,paddingBottom:40},hello:{fontSize:28,fontWeight:'900',color:'#0A2342'},
 subtitle:{color:'#60748A',marginTop:4},plan:{backgroundColor:'#fff',borderRadius:16,padding:18,marginTop:22,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
 planTitle:{fontWeight:'800',fontSize:17,color:'#0A2342'},planSub:{color:'#718096',marginTop:4},link:{color:'#0877E8',fontWeight:'700'},
 section:{fontSize:20,fontWeight:'800',color:'#0A2342',marginTop:26,marginBottom:12},grid:{flexDirection:'row',flexWrap:'wrap',gap:12}
});
