import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const tools = [
  ['IA Fiscal','Consulta tus dudas con IA especializada'],
  ['Calendario SUNAT','Vencimientos y obligaciones'],
  ['Consulta RUC','Información de cualquier RUC'],
  ['Calculadoras','IGV, renta, multas e intereses'],
  ['Multas y TIM','Consulta y calcula'],
  ['Fraccionamiento','Simula y conoce tus opciones'],
];

export default function Dashboard(){
 return <SafeAreaView style={s.page}><ScrollView contentContainerStyle={s.content}>
   <Text style={s.hello}>Hola 👋</Text><Text style={s.subtitle}>Tu aliado tributario siempre</Text>
   <View style={s.plan}><View><Text style={s.planTitle}>Plan Free</Text><Text style={s.planSub}>Declarafy</Text></View><Text style={s.link}>Ver plan ›</Text></View>
   <Text style={s.section}>Herramientas</Text>
   <View style={s.grid}>{tools.map(([title,desc])=><TouchableOpacity key={title} style={s.card}><View style={s.icon}/><Text style={s.cardTitle}>{title}</Text><Text style={s.cardText}>{desc}</Text></TouchableOpacity>)}</View>
 </ScrollView></SafeAreaView>
}
const s=StyleSheet.create({
 page:{flex:1,backgroundColor:'#F5F8FC'},content:{padding:20,paddingBottom:40},hello:{fontSize:28,fontWeight:'900',color:'#0A2342'},
 subtitle:{color:'#60748A',marginTop:4},plan:{backgroundColor:'#fff',borderRadius:16,padding:18,marginTop:22,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
 planTitle:{fontWeight:'800',fontSize:17,color:'#0A2342'},planSub:{color:'#718096',marginTop:4},link:{color:'#0877E8',fontWeight:'700'},
 section:{fontSize:20,fontWeight:'800',color:'#0A2342',marginTop:26,marginBottom:12},grid:{flexDirection:'row',flexWrap:'wrap',gap:12},
 card:{backgroundColor:'#fff',borderRadius:16,padding:16,width:'48%',minHeight:160},icon:{width:42,height:42,borderRadius:12,backgroundColor:'#0A91C7',marginBottom:16},
 cardTitle:{fontWeight:'800',fontSize:16,color:'#0A2342'},cardText:{color:'#61738A',fontSize:13,lineHeight:18,marginTop:6}
});
