import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
export default function Calendar(){
 return <SafeAreaView style={s.page}><View style={s.content}><Text style={s.title}>Calendario SUNAT</Text><Text style={s.sub}>Vencimientos y obligaciones tributarias.</Text>
   <View style={s.card}><Text style={s.cardTitle}>Próximos vencimientos</Text><Text style={s.empty}>La app mostrará aquí el calendario vigente obtenido desde Declarafy, sin fechas tributarias codificadas manualmente.</Text></View>
 </View></SafeAreaView>
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:'#F5F8FC'},content:{padding:22},title:{fontSize:28,fontWeight:'900',color:'#0A2342'},sub:{color:'#60748A',marginTop:6,marginBottom:24},card:{backgroundColor:'#fff',padding:20,borderRadius:16},cardTitle:{fontWeight:'800',fontSize:17,color:'#0A2342'},empty:{color:'#60748A',lineHeight:20,marginTop:12}});
