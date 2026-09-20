import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export function ModuleCard({ title, description, onPress }:{title:string;description:string;onPress?:()=>void}) {
  return <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.75}>
    <View style={s.icon}/><Text style={s.title}>{title}</Text><Text style={s.text}>{description}</Text>
  </TouchableOpacity>;
}
const s=StyleSheet.create({
 card:{backgroundColor:'#fff',borderRadius:16,padding:16,width:'48%',minHeight:160},
 icon:{width:42,height:42,borderRadius:12,backgroundColor:'#0A91C7',marginBottom:16},
 title:{fontWeight:'800',fontSize:16,color:'#0A2342'},text:{color:'#61738A',fontSize:13,lineHeight:18,marginTop:6}
});
