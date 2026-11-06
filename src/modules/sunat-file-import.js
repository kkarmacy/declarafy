// SUNAT file import: API-independent ingestion layer for Declarafy.
(function(global){
'use strict';
const STORE='declarafy_sunat_imports_v1';
const fields=['fecha','tipo','serie','numero','ruc','razon_social','moneda','base_imponible','igv','total'];
const aliases={
 fecha:['fecha','fecha emision','fecha de emision','fec_emision','fecEmision','fechaEmision'],tipo:['tipo','tipo comprobante','tipo de comprobante','cod tipo doc','codTipoCDP','tipoCP'],
 serie:['serie','numSerieCDP','numSerie','serieComprobante'],numero:['numero','número','correlativo','numero comprobante','numCDP','numComprobante'],ruc:['ruc','ruc proveedor','ruc cliente','num doc identidad','numDocIdentidad','numRuc','numDocAdquiriente'],
 razon_social:['razon social','razón social','proveedor','cliente','apellidos nombres razon social','nomRazonSocial','desRazonSocial'],
 moneda:['moneda','cod moneda','codMoneda'],base_imponible:['base imponible','base','valor venta','valor de venta','bi','mtoBaseImponible','mtoBase'],
 igv:['igv','impuesto general a las ventas','mtoIGV','mtoIgv'],total:['total','importe total','monto total','mtoTotal','mtoImporteTotal']
};
const norm=s=>String(s??'').replace(/^\uFEFF/,'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase().replace(/[_-]+/g,' ');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function splitLine(line,sep){let out=[],cur='',q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(ch===sep&&!q){out.push(cur);cur='';}else cur+=ch;}out.push(cur);return out;}
function delimiter(text){const l=(text.split(/\r?\n/).find(Boolean)||'');return [';','\t',',','|'].sort((a,b)=>l.split(b).length-l.split(a).length)[0];}
function mapHeaders(headers){const map={};headers.forEach((h,i)=>{const n=norm(h);for(const [key,opts] of Object.entries(aliases)){if(opts.some(x=>norm(x)===n)){map[key]=i;break;}}});return map;}
function num(v){let s=String(v??'').trim().replace(/S\/|\$/g,'').replace(/\s/g,'');if(s.includes(',')&&s.includes('.'))s=s.lastIndexOf(',')>s.lastIndexOf('.')?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');else if(s.includes(','))s=s.replace(',','.');const n=Number(s);return Number.isFinite(n)?n:0;}
function normalizeRow(row,map){const o={};fields.forEach(k=>o[k]=row[map[k]]??'');['base_imponible','igv','total'].forEach(k=>o[k]=num(o[k]));o.ruc=String(o.ruc).replace(/\D/g,'');return o;}
function parseDelimited(text){const sep=delimiter(text),lines=text.split(/\r?\n/).filter(x=>x.trim());if(lines.length<2)throw Error('El archivo no contiene filas de datos.');const rows=lines.map(l=>splitLine(l,sep));const map=mapHeaders(rows[0]);if(!Object.keys(map).length)throw Error('No se reconocieron columnas SUNAT. Revisa los encabezados.');return rows.slice(1).map(r=>normalizeRow(r,map)).filter(r=>Object.values(r).some(Boolean));}
function xmlVal(node,names){for(const name of names){const all=node.getElementsByTagName('*');for(const el of all){if(norm(el.localName||el.nodeName)===norm(name))return el.textContent.trim();}}return '';}
function parseXml(text){const doc=new DOMParser().parseFromString(text,'application/xml');if(doc.querySelector('parsererror'))throw Error('XML inválido.');return [{fecha:xmlVal(doc,['IssueDate','FechaEmision']),tipo:xmlVal(doc,['InvoiceTypeCode','DocumentTypeCode']),serie:'',numero:xmlVal(doc,['ID']),ruc:xmlVal(doc,['CompanyID']),razon_social:xmlVal(doc,['RegistrationName']),moneda:xmlVal(doc,['DocumentCurrencyCode']),base_imponible:num(xmlVal(doc,['TaxExclusiveAmount','LineExtensionAmount'])),igv:num(xmlVal(doc,['TaxAmount'])),total:num(xmlVal(doc,['PayableAmount','TaxInclusiveAmount']))}];}

async function inflateZipEntry(compressed,expectedSize){
 if(typeof DecompressionStream==='undefined')throw Error('Este navegador no puede descomprimir ZIP. Extrae el archivo y carga el TXT/CSV manualmente.');
 const reader=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
 const chunks=[];let total=0;
 try{
  while(true){
   const part=await reader.read();if(part.done)break;
   total+=part.value.byteLength;
   if(total>50*1024*1024||total>expectedSize){await reader.cancel();throw Error('El contenido descomprimido supera el tamaño declarado o el límite seguro de 50 MB por archivo.');}
   chunks.push(part.value);
  }
 }catch(error){try{await reader.cancel();}catch{};throw error;}
 const output=new Uint8Array(total);let offset=0;
 for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.byteLength;}
 return output.buffer;
}
async function parseZip(file){
 const buffer=await file.arrayBuffer(),view=new DataView(buffer),bytes=new Uint8Array(buffer);
 if(buffer.byteLength>100*1024*1024)throw Error('El ZIP supera el límite de 100 MB.');
 let eocd=-1;for(let i=Math.max(0,bytes.length-65557);i<=bytes.length-22;i++){if(view.getUint32(i,true)===0x06054b50)eocd=i;}
 if(eocd<0)throw Error('El ZIP SIRE no tiene una tabla de archivos válida.');
 if(view.getUint16(eocd+4,true)!==0||view.getUint16(eocd+6,true)!==0)throw Error('No se admiten ZIP divididos en varios discos.');
 const count=view.getUint16(eocd+10,true),centralOffset=view.getUint32(eocd+16,true);
 if(count>1000||centralOffset>=bytes.length)throw Error('El ZIP contiene demasiados archivos o una estructura no válida.');
 let offset=centralOffset,totalSize=0;const files=[];
 for(let i=0;i<count;i++){
  if(offset+46>bytes.length||view.getUint32(offset,true)!==0x02014b50)throw Error('La estructura interna del ZIP no es válida.');
  const flags=view.getUint16(offset+8,true),method=view.getUint16(offset+10,true),compressedSize=view.getUint32(offset+20,true),uncompressedSize=view.getUint32(offset+24,true);
  const nameLength=view.getUint16(offset+28,true),extraLength=view.getUint16(offset+30,true),commentLength=view.getUint16(offset+32,true),localOffset=view.getUint32(offset+42,true);
  const name=new TextDecoder('utf-8').decode(bytes.slice(offset+46,offset+46+nameLength));
  offset+=46+nameLength+extraLength+commentLength;
  if(!name||name.endsWith('/'))continue;
  if(name.includes('..')||name.startsWith('/')||name.includes('\\'))throw Error('El ZIP contiene una ruta de archivo no permitida.');
  const ext=name.split('.').pop().toLowerCase();
  if(!['csv','txt','xml'].includes(ext))continue;
  if(flags&1)throw Error('El ZIP está protegido con contraseña y no puede procesarse.');
  if(compressedSize===0xffffffff||uncompressedSize===0xffffffff)throw Error('El formato ZIP64 aún no está admitido.');
  totalSize+=uncompressedSize;if(uncompressedSize>50*1024*1024||totalSize>100*1024*1024)throw Error('El contenido descomprimido supera el límite seguro de 100 MB.');
  if(localOffset+30>bytes.length||view.getUint32(localOffset,true)!==0x04034b50)throw Error('No se encontró el archivo local del ZIP.');
  const localNameLength=view.getUint16(localOffset+26,true),localExtraLength=view.getUint16(localOffset+28,true);
  const dataOffset=localOffset+30+localNameLength+localExtraLength;
  if(dataOffset+compressedSize>bytes.length)throw Error('El contenido de un archivo ZIP está incompleto.');
  const compressed=buffer.slice(dataOffset,dataOffset+compressedSize);let raw;
  if(method===0)raw=compressed;
  else if(method===8)raw=await inflateZipEntry(compressed,uncompressedSize);
  else continue;
  if(raw.byteLength!==uncompressedSize)throw Error('El tamaño descomprimido no coincide con el contenido del ZIP.');
  files.push({name,text:new TextDecoder('utf-8').decode(raw)});
 }
 if(!files.length)throw Error('El ZIP no contiene archivos TXT, CSV o XML compatibles.');
 return files;
}
async function handleFile(file){
 if(!file)throw Error('Selecciona un archivo.');
 pendingName=file.name;pending=[];const previewBox=document.getElementById('sunatImportPreview');if(previewBox){previewBox.style.display='none';previewBox.replaceChildren();}const ext=file.name.split('.').pop().toLowerCase();let rows=[];
 if(ext==='zip'){
  const entries=await parseZip(file);
  for(const entry of entries){
   const entryExt=entry.name.split('.').pop().toLowerCase();
   const parsed=entryExt==='xml'?parseXml(entry.text):parseDelimited(entry.text);
   rows.push(...parsed);
  }
 }else if(ext==='xlsx'||ext==='xls'){
  throw Error('Excel .xlsx/.xls estará disponible al incorporar el lector de hojas. Exporta como CSV UTF-8 o descarga el formato TXT/CSV de SIRE.');
 }else{
  const text=await file.text();
  rows=ext==='xml'?parseXml(text):parseDelimited(text);
 }
 pending=validate(rows);render(pending);return {rows:pending.length,filename:pendingName};
}
function validate(rows){const seen=new Set();return rows.map((r,i)=>{const errors=[];if(r.ruc&&r.ruc.length!==11)errors.push('RUC no tiene 11 dígitos');if(!r.fecha)errors.push('Sin fecha');if(!r.total&&r.total!==0)errors.push('Sin total');const key=[r.ruc,r.tipo,r.serie,r.numero,r.fecha,r.total].join('|');const duplicate=seen.has(key);seen.add(key);return {...r,_row:i+1,_errors:errors,_duplicate:duplicate};});}
function stored(){try{return JSON.parse(localStorage.getItem(STORE)||'[]')}catch{return []}}
function save(rows,filename){const old=stored(),keys=new Set(old.map(r=>r._key));let added=0;for(const r of rows){const key=[r.ruc,r.tipo,r.serie,r.numero,r.fecha,r.total].join('|');if(!keys.has(key)){old.push({...r,_key:key,_source:filename,_importedAt:new Date().toISOString()});keys.add(key);added++;}}localStorage.setItem(STORE,JSON.stringify(old));global.dispatchEvent(new CustomEvent('declarafy:sunat-imported',{detail:{added,total:old.length}}));return {added,total:old.length};}
let pending=[],pendingName='';
function summary(rows){return rows.reduce((a,r)=>{a.base+=num(r.base_imponible);a.igv+=num(r.igv);a.total+=num(r.total);return a},{base:0,igv:0,total:0});}
function render(rows){const box=document.getElementById('sunatImportPreview');if(!box)return;const s=summary(rows),bad=rows.filter(r=>r._errors.length).length,dup=rows.filter(r=>r._duplicate).length;box.style.display='block';box.innerHTML='<div class="xml-summary"><div class="xml-stat"><div class="xml-stat-v">'+rows.length+'</div><div class="xml-stat-l">Registros</div></div><div class="xml-stat"><div class="xml-stat-v">S/ '+s.igv.toFixed(2)+'</div><div class="xml-stat-l">IGV</div></div><div class="xml-stat"><div class="xml-stat-v">S/ '+s.total.toFixed(2)+'</div><div class="xml-stat-l">Total</div></div></div><p style="font-size:13px;color:var(--muted)">'+bad+' con observaciones · '+dup+' duplicados dentro del archivo</p><div style="overflow:auto;max-height:330px"><table class="res-table" style="width:100%;font-size:12px"><thead><tr><th>Fecha</th><th>RUC</th><th>Razón social</th><th>Comprobante</th><th>Base</th><th>IGV</th><th>Total</th><th>Estado</th></tr></thead><tbody>'+rows.slice(0,100).map(r=>'<tr><td>'+esc(r.fecha)+'</td><td>'+esc(r.ruc)+'</td><td>'+esc(r.razon_social)+'</td><td>'+esc([r.tipo,r.serie,r.numero].filter(Boolean).join('-'))+'</td><td>'+num(r.base_imponible).toFixed(2)+'</td><td>'+num(r.igv).toFixed(2)+'</td><td>'+num(r.total).toFixed(2)+'</td><td>'+(r._errors.length?'⚠️ '+esc(r._errors.join(', ')):(r._duplicate?'Duplicado':'✅ Válido'))+'</td></tr>').join('')+'</tbody></table></div><div style="display:flex;gap:8px;margin-top:12px"><button class="bp" onclick="confirmSunatImport()">✅ Importar registros válidos</button><button class="bg" onclick="clearSunatImport()">Cancelar</button></div>';}
async function handle(input){const file=input.files&&input.files[0];if(!file)return;try{await handleFile(file);}catch(e){const box=document.getElementById('sunatImportPreview');if(box){box.style.display='block';box.innerHTML='<div class="sunat-api-result">⚠️ '+esc(e.message)+'</div>';}}}
function confirm(){const valid=pending.filter(r=>!r._errors.length&&!r._duplicate);const result=save(valid,pendingName);const box=document.getElementById('sunatImportPreview');if(box)box.innerHTML='<div class="sunat-api-result">✅ '+result.added+' registros importados. Base local acumulada: '+result.total+'. Ya están disponibles para el dashboard y análisis.</div>';pending=[];}
function clear(){pending=[];pendingName='';const b=document.getElementById('sunatImportPreview');if(b)b.style.display='none';const i=document.getElementById('sunatImportFile');if(i)i.value='';}
global.DeclarafySunatImport={parseDelimited,parseXml,parseZip,inflateZipEntry,validate,stored,summary,save};
global.DeclarafySunatImportUI={handle,handleFile,confirm,clear};
})(window);
