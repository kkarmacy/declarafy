import { router } from 'expo-router';
import { SafeAreaView,StyleSheet,Text,TouchableOpacity,View } from 'react-native';
export default function ErrorScreen(){
 return <SafeAreaView style={s.page}><View style={s.box}><Text style={s.code}>!</Text><Text style={s.title}>Algo salió mal</Text><Text style={s.text}>No pudimos completar la operación. Revisa tu conexión e inténtalo nuevamente.</Text><TouchableOpacity style={s.button} onPress={()=>router.replace('/dashboard')}><Text style={s.bt}>Volver al inicio</Text></TouchableOpacity></View></SafeAreaView>
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:'#F5F8FC',justifyContent:'center',padding:28},box:{backgroundColor:'#fff',padding:28,borderRadius:18,alignItems:'center'},code:{fontSize:42,fontWeight:'900',color:'#D92D20'},title:{fontSize:22,fontWeight:'900',color:'#0A2342',marginTop:10},text:{color:'#60748A',textAlign:'center',lineHeight:20,marginTop:10},button:{backgroundColor:'#0877E8',paddingVertical:15,paddingHorizontal:28,borderRadius:12,marginTop:24},bt:{color:'#fff',fontWeight:'800'}});
