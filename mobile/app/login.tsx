import { router } from 'expo-router';
import { SafeAreaView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

export default function Login() {
  return (
    <SafeAreaView style={styles.page}>
      <Text style={styles.brand}>Declarafy</Text>
      <Text style={styles.title}>Inicia sesión</Text>
      <Text style={styles.sub}>Ingresa a tu cuenta y sigue creciendo.</Text>
      <TextInput style={styles.input} placeholder="Correo electrónico" autoCapitalize="none" keyboardType="email-address" />
      <TextInput style={styles.input} placeholder="Contraseña" secureTextEntry />
      <TouchableOpacity style={styles.button} onPress={() => router.replace('/dashboard')}>
        <Text style={styles.buttonText}>Iniciar sesión</Text>
      </TouchableOpacity>
      <Text style={styles.note}>La conexión segura con el backend de Declarafy se habilitará al confirmar los endpoints de autenticación.</Text>
    </SafeAreaView>
  );
}
const styles=StyleSheet.create({
 page:{flex:1,backgroundColor:'#fff',padding:28,justifyContent:'center'},
 brand:{color:'#073B77',fontSize:34,fontWeight:'900',marginBottom:48},
 title:{fontSize:30,fontWeight:'800',color:'#0A2342'},sub:{fontSize:15,color:'#61738A',marginTop:8,marginBottom:28},
 input:{borderWidth:1,borderColor:'#D8E1EA',borderRadius:12,padding:16,marginBottom:14,fontSize:16},
 button:{backgroundColor:'#0877E8',borderRadius:12,padding:17,alignItems:'center',marginTop:8},
 buttonText:{color:'#fff',fontSize:16,fontWeight:'800'},note:{fontSize:12,color:'#7B8794',marginTop:24,lineHeight:18}
});
