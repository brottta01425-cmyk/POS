import React,{useEffect,useMemo,useState} from 'react';
import{createRoot}from'react-dom/client';
import{supabase}from'./supabase';
import * as XLSX from 'xlsx';
import { isNativeAndroid, listPairedBluetoothPrinters, nativePrintBluetooth, nativePrintWifi, nativeTestWifi, nativeTestBluetooth } from './nativePrinter';
import'./styles.css';

const ROLES={super_admin:'Super Admin',admin:'Admin',waiter:'Waiter',chef:'Chef',cashier:'Cashier'};
const NAV_BY_ROLE={
 waiter:[['pos','Take Order'],['ready','Ready Orders'],['orders','Table History']],
 chef:[['kitchen','Kitchen'],['orders','Orders']],
 cashier:[['billing','Bills'],['orders','Orders'],['analytics','Sales']],
 admin:[['dashboard','Dashboard'],['pos','Take Order'],['kitchen','Kitchen'],['billing','Bills'],['orders','Table History'],['menu','Food Items'],['employees','Employees'],['attendance','Attendance'],['expenses','Expenses'],['analytics','Analytics']],
 super_admin:[['dashboard','Dashboard'],['pos','Take Order'],['kitchen','Kitchen'],['billing','Bills'],['orders','Table History'],['menu','Food Items'],['employees','Employees'],['payroll','Payroll'],['attendance','Attendance'],['expenses','Expenses'],['analytics','Analytics']]
};
const getNavForRole=role=>NAV_BY_ROLE[role]||NAV_BY_ROLE.admin;
const TABLES=Array.from({length:20},(_,i)=>i+1);
const STATUS={NEW:'New',PREPARING:'Preparing',READY:'Ready',SERVED:'Served',BILL_REQUESTED:'Bill Ready',PAID:'Paid',CANCELLED:'Cancelled'};
const ITEM_STATUS={NEW:'Pending',PREPARING:'Preparing',READY:'Ready',SERVED:'Served',CANCELLED:'Cancelled'};
const ORDER_TYPES={DINE_IN:'🍽️ DINE IN',TAKEAWAY:'🥡 TAKEAWAY / PARCEL'};
const orderType=o=>o?.order_type==='TAKEAWAY'?'TAKEAWAY':'DINE_IN';
const orderTypeLabel=o=>ORDER_TYPES[orderType(o)];
const orderSource=o=>o?.order_source==='ZOMATO'?'ZOMATO':'DIRECT';
const sourceBadge=o=>orderSource(o)==='ZOMATO'?'🟠 ZOMATO ORDER':'DIRECT';


const PRINTER_MODE_KEY='brottta-printer-mode';
const WIFI_PRINTER_KEY='brottta-wifi-printer';
const getPrinterMode=()=>localStorage.getItem(PRINTER_MODE_KEY)||'SYSTEM';
const savePrinterMode=m=>localStorage.setItem(PRINTER_MODE_KEY,m);
const getWifiPrinter=()=>{try{return JSON.parse(localStorage.getItem(WIFI_PRINTER_KEY)||'{"ip":"","port":9100}')}catch{return {ip:'',port:9100}}};
const saveWifiPrinter=(ip,port)=>localStorage.setItem(WIFI_PRINTER_KEY,JSON.stringify({ip,port:Number(port)||9100}));
const BT_NATIVE_KEY='brottta-native-bt-address';
const getNativeBluetoothAddress=()=>localStorage.getItem(BT_NATIVE_KEY)||'';
const saveNativeBluetoothAddress=a=>localStorage.setItem(BT_NATIVE_KEY,a||'');


async function connectUsbPrinter(){
 if(!navigator.usb)throw new Error('WebUSB is unavailable. Use Chrome/Edge on Android or desktop over HTTPS.');
 const device=await navigator.usb.requestDevice({filters:[]});
 await device.open();
 if(!device.configuration)await device.selectConfiguration(1);
 let iface=null,endpoint=null;
 for(const intf of device.configuration.interfaces){
  for(const alt of intf.alternates){
   const ep=alt.endpoints.find(e=>e.direction==='out');
   if(ep){iface=intf;endpoint=ep;break}
  }
  if(endpoint)break;
 }
 if(!endpoint)throw new Error('No writable USB endpoint found on this printer.');
 await device.claimInterface(iface.interfaceNumber);
 window.__brotttaUsb={device,endpoint};
 return device.productName||'USB Printer';
}
async function writeUsbPrinter(data){
 const p=window.__brotttaUsb;
 if(!p?.device?.opened)throw new Error('Connect the USB printer first.');
 for(let i=0;i<data.length;i+=4096)await p.device.transferOut(p.endpoint.endpointNumber,data.slice(i,i+4096));
}
async function printUsbReceipt(orderList){
 const init=new Uint8Array([0x1b,0x40,0x1b,0x61,0x01]);
 let logo=new Uint8Array();try{logo=await logoEscPos()}catch{}
 const title=bytes('\n');
 const body=bytes(receiptText(orderList));
 const cut=new Uint8Array([0x1d,0x56,0x41,0x03]);
 await writeUsbPrinter(concatBytes(init,logo,title,new Uint8Array([0x1b,0x61,0x00]),body,cut));
}

async function buildEscPosReceipt(orderList){
 const init=new Uint8Array([0x1b,0x40,0x1b,0x61,0x01]);
 let logo=new Uint8Array();try{logo=await logoEscPos()}catch{}
 const title=bytes('\n');
 const body=bytes(receiptText(orderList));
 const cut=new Uint8Array([0x1d,0x56,0x41,0x03]);
 return concatBytes(init,logo,title,new Uint8Array([0x1b,0x61,0x00]),body,cut);
}
async function printWifiReceipt(orderList){
 const cfg=getWifiPrinter();
 if(!cfg.ip)throw new Error('Save the Wi-Fi printer IP first.');
 // Hosted browser apps cannot open raw TCP 9100. Use system print fallback.
 printBrowserReceipt(orderList);
}

const BT_PRINTER_SERVICES=[
 '000018f0-0000-1000-8000-00805f9b34fb',
 '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
 '49535343-fe7d-4ae5-8fa9-9fafd205e455'
];
let btPrinter={device:null,server:null,characteristic:null};

const bytes=s=>new TextEncoder().encode(s);
const concatBytes=(...parts)=>{
 const len=parts.reduce((n,p)=>n+p.length,0),out=new Uint8Array(len);let at=0;
 parts.forEach(p=>{out.set(p,at);at+=p.length});return out;
};
async function connectBluetoothPrinter(){
 if(!navigator.bluetooth)throw new Error('Web Bluetooth is not supported in this browser. Use Chrome/Edge on Android with a BLE-compatible printer.');
 const device=await navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices:BT_PRINTER_SERVICES});
 const server=await device.gatt.connect();
 let writable=null;
 for(const service of await server.getPrimaryServices()){
   for(const ch of await service.getCharacteristics()){
     if(ch.properties.write||ch.properties.writeWithoutResponse){writable=ch;break}
   }
   if(writable)break;
 }
 if(!writable)throw new Error('Printer connected, but no writable Bluetooth characteristic was found. This printer may use Bluetooth Classic instead of BLE.');
 btPrinter={device,server,characteristic:writable};
 device.addEventListener('gattserverdisconnected',()=>{btPrinter={device:null,server:null,characteristic:null}});
 return device.name||'Bluetooth Printer';
}
async function writePrinter(data){
 if(!btPrinter.characteristic)throw new Error('Connect the Bluetooth printer first.');
 const chunk=180;
 for(let i=0;i<data.length;i+=chunk){
   const part=data.slice(i,i+chunk);
   if(btPrinter.characteristic.properties.writeWithoutResponse)await btPrinter.characteristic.writeValueWithoutResponse(part);
   else await btPrinter.characteristic.writeValue(part);
   await new Promise(r=>setTimeout(r,12));
 }
}
async function logoEscPos(){
 const img=new Image();img.src='/brottta-logo.jpg';
 await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject});
 const maxW=360,scale=Math.min(1,maxW/img.width),w=Math.floor(img.width*scale),h=Math.floor(img.height*scale);
 const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
 const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);
 const d=ctx.getImageData(0,0,w,h).data,wb=Math.ceil(w/8),raster=new Uint8Array(wb*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const k=(y*w+x)*4,gray=.299*d[k]+.587*d[k+1]+.114*d[k+2];
   if(gray<145)raster[y*wb+(x>>3)]|=(0x80>>(x&7));
 }
 const xL=wb&255,xH=(wb>>8)&255,yL=h&255,yH=(h>>8)&255;
 return concatBytes(new Uint8Array([0x1b,0x61,0x01,0x1d,0x76,0x30,0x00,xL,xH,yL,yH]),raster,new Uint8Array([0x1b,0x61,0x00]));
}
const pad=(s,n)=>String(s??'').slice(0,n).padEnd(n,' ');
const right=(s,n)=>String(s??'').slice(0,n).padStart(n,' ');
function receiptText(orderList){
 const list=Array.isArray(orderList)?orderList:[orderList],first=list[0],isTake=orderType(first)==='TAKEAWAY';
 const allItems=list.flatMap(o=>o.order_items||[]),grand=list.reduce((s,o)=>s+total(o),0);
 const orderNo=isTake?`P-${String(first.id).slice(0,6).toUpperCase()}`:list.map(o=>String(o.id).slice(0,6).toUpperCase()).join('/');
 const when=first.paid_at||first.created_at||new Date().toISOString();
 const d=new Date(when),date=d.toLocaleDateString('en-IN'),time=d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
 let out='\n';
 out+='------------------------------------------\n';
 out+=`Date : ${date}        Time : ${time}\n`;
 out+=`Order No : ${orderNo}\n`;
 out+=`Type : ${isTake?'TAKEAWAY / PARCEL':'DINE IN'}\n`;
 if(isTake){
   out+=`Source : ${orderSource(first)==='ZOMATO'?'ZOMATO ORDER':'DIRECT'}\n`;
   out+=`Token No : ${first.token_number??'-'}\n`;
 }
 if(!isTake){out+=`Table : ${first.table_no}\n`;out+=`Chair : ${seatLabel(first)}\n`}
 else if(first.customer_name){out+=`Customer : ${first.customer_name}\n`}
 out+='------------------------------------------\n';
 out+=`${pad('Item',24)}${right('Qty',5)}${right('Amount',13)}\n`;
 out+='------------------------------------------\n';
 allItems.forEach(i=>{out+=`${pad(i.item_name,24)}${right(i.qty,5)}${right('Rs.'+Number(i.line_total||0).toFixed(2),13)}\n`});
 out+='------------------------------------------\n';
 out+=`${pad('TOTAL AMOUNT',27)}${right('Rs.'+grand.toFixed(2),15)}\n`;
 if(first.payment_method)out+=`${pad('Payment',27)}${right(first.payment_method==='ONLINE'?'ONLINE':'CASH',15)}\n`;
 out+='------------------------------------------\n';
 out+='\x1b\x61\x01';
 out+='\x1b\x45\x01';
 out+='\nPowered by Highloops\n';
 out+='\x1b\x45\x00';
 out+='www.highloops.in\n\n\n';
 out+='\x1b\x61\x00';
 return out;
}
function browserReceiptHtml(orderList){
 const list=Array.isArray(orderList)?orderList:[orderList],first=list[0],isTake=orderType(first)==='TAKEAWAY';
 const all=list.flatMap(o=>o.order_items||[]),grand=list.reduce((s,o)=>s+total(o),0);
 const rows=all.map(i=>`<tr><td>${i.item_name}</td><td>${i.qty}</td><td style="text-align:right">${money(i.line_total)}</td></tr>`).join('');
 return `<!doctype html><html><head><meta charset="utf-8"><title>Brottta Bill</title><style>
 @page{size:80mm auto;margin:3mm}body{font-family:monospace;width:72mm;margin:0 auto;color:#000;font-size:12px}
 img{display:block;max-width:58mm;filter:grayscale(1) contrast(1.6);margin:0 auto 6px}h2,p{margin:3px 0;text-align:center}
 .meta{border-top:1px dashed #000;border-bottom:1px dashed #000;padding:7px 0;margin:7px 0;line-height:1.55}
 table{width:100%;border-collapse:collapse}th,td{padding:4px 0;border-bottom:1px dashed #bbb}th{text-align:left}.total{font-size:16px;font-weight:bold;display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px dashed #000}
 .footer{text-align:center;margin-top:12px;font-size:11px}
 </style></head><body><img src="${location.origin}/brottta-logo.jpg"><div class="meta">
 Date & Time: ${fmtDateTime(first.paid_at||first.created_at)}<br>
 Order No: ${isTake?'P-'+String(first.id).slice(0,6).toUpperCase():list.map(o=>String(o.id).slice(0,6).toUpperCase()).join('/')}<br>
 Type: ${isTake?'TAKEAWAY / PARCEL':'DINE IN'}<br>
 ${isTake?`Source: ${orderSource(first)==='ZOMATO'?'ZOMATO ORDER':'DIRECT'}<br>Token No: ${first.token_number??'-'}<br>`:''}
 ${isTake?(first.customer_name?`Customer: ${first.customer_name}<br>`:''):`Table: ${first.table_no}<br>Chair: ${seatLabel(first)}<br>`}
 </div><table><thead><tr><th>Item</th><th>Qty</th><th style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table>
 <div class="total"><span>TOTAL</span><span>${money(grand)}</span></div>
 ${first.payment_method?`<p>Payment: ${first.payment_method==='ONLINE'?'ONLINE PAYMENT':'CASH'}</p>`:''}
 <div class="footer"><strong>Powered by Highloops</strong><br><span>www.highloops.in</span></div>
 <script>window.onload=()=>{setTimeout(()=>window.print(),250)}<\/script></body></html>`;
}
function printBrowserReceipt(orderList){
 const w=window.open('','_blank','width=420,height=700');
 if(!w)throw new Error('Popup blocked. Allow popups to use browser printing.');
 w.document.open();w.document.write(browserReceiptHtml(orderList));w.document.close();
}
async function printBluetoothReceipt(orderList){
 const init=new Uint8Array([0x1b,0x40,0x1b,0x61,0x01]);
 let logo=new Uint8Array();
 try{logo=await logoEscPos()}catch{}
 const title=bytes('\n');
 const body=bytes(receiptText(orderList));
 const cut=new Uint8Array([0x1d,0x56,0x41,0x03]);
 await writePrinter(concatBytes(init,logo,title,new Uint8Array([0x1b,0x61,0x00]),body,cut));
}

const beep=(existingCtx=null)=>{
 try{
  const C=window.AudioContext||window.webkitAudioContext;
  if(!C)return;
  const c=existingCtx||new C();
  if(c.state==='suspended')c.resume();
  const o=c.createOscillator(),g=c.createGain();
  o.frequency.value=880;o.type='sine';
  g.gain.setValueAtTime(.0001,c.currentTime);
  g.gain.exponentialRampToValueAtTime(.18,c.currentTime+.01);
  g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+.28);
  o.connect(g);g.connect(c.destination);
  o.start();o.stop(c.currentTime+.3);
 }catch{}
};

function fmtDateTime(v){return v?new Date(v).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):''}
function fmtDate(v){return v?new Date(v).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):''}
function paymentBadge(m){return m==='CASH'?'💵 CASH':m==='ONLINE'?'📱 ONLINE':'—'}
const money=v=>'₹'+Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2});
const today=()=>{const d=new Date();const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`};
const dateKey=d=>{const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`};
function salaryPeriod(type, ref=new Date()){
  const d=new Date(ref.getFullYear(),ref.getMonth(),ref.getDate());
  if(String(type||'WEEKLY').toUpperCase()==='MONTHLY'){
    const start=new Date(d.getFullYear(),d.getMonth(),1), end=new Date(d.getFullYear(),d.getMonth()+1,0);
    return {start:dateKey(start),end:dateKey(end),label:`${fmtDate(start)} → ${fmtDate(end)}`};
  }
  const day=(d.getDay()+6)%7; // Monday = 0
  const start=new Date(d); start.setDate(d.getDate()-day);
  const end=new Date(start); end.setDate(start.getDate()+6);
  return {start:dateKey(start),end:dateKey(end),label:`${fmtDate(start)} → ${fmtDate(end)}`};
}
const dt=v=>v?new Date(v).toLocaleString('en-IN',{dateStyle:'short',timeStyle:'short'}):'-';
const total=o=>Number(o?.total||0);

function App(){
 const[session,setSession]=useState(null),[profile,setProfile]=useState(null),[loading,setLoading]=useState(true),[page,setPage]=useState('dashboard'),[msg,setMsg]=useState('');
 const[orders,setOrders]=useState([]),[menu,setMenu]=useState([]),[employees,setEmployees]=useState([]),[attendance,setAttendance]=useState([]),[expenses,setExpenses]=useState([]),[salaryPayments,setSalaryPayments]=useState([]),[advances,setAdvances]=useState([]);
 const[table,setTable]=useState(null),[chairs,setChairs]=useState([]),[cart,setCart]=useState([]),[takeawayCart,setTakeawayCart]=useState([]),[loginRole,setLoginRole]=useState('waiter'),[tableResetNotice,setTableResetNotice]=useState('');
 const previousOrderIds=React.useRef(null),previousItemStates=React.useRef(null),liveReady=React.useRef(false);
 const audioCtx=React.useRef(null);
 const[soundEnabled,setSoundEnabled]=useState(false);
 const[printerName,setPrinterName]=useState(''),[printerMode,setPrinterMode]=useState(getPrinterMode());
 const[dark,setDark]=useState(()=>localStorage.getItem('brottta-theme')!=='light');
 const role=profile?.role;
 const nav=useMemo(()=>getNavForRole(role),[role]);
 useEffect(()=>{document.documentElement.dataset.theme=dark?'dark':'light';localStorage.setItem('brottta-theme',dark?'dark':'light')},[dark]);
 useEffect(()=>{if(role&&page)localStorage.setItem(`brottta-last-page-${role}`,page)},[role,page]);
 useEffect(()=>{
   if(!session || !(role==='chef'||role==='waiter')) return;
   const arm=()=>{
     try{
       const C=window.AudioContext||window.webkitAudioContext;
       if(!C)return;
       if(!audioCtx.current) audioCtx.current=new C();
       audioCtx.current.resume();
     }catch{}
     window.removeEventListener('pointerdown',arm);
   };
   window.addEventListener('pointerdown',arm,{once:true});
   return()=>window.removeEventListener('pointerdown',arm);
 },[session,role]);


 useEffect(()=>{let live=true;
   supabase.auth.getSession().then(async({data})=>{if(!live)return;if(data.session){setSession(data.session);await getProfile(data.session.user.id)}setLoading(false)});
   const{data:l}=supabase.auth.onAuthStateChange(async(_,s)=>{setSession(s);if(s)await getProfile(s.user.id);else setProfile(null)});
   return()=>{live=false;l.subscription.unsubscribe()}
 },[]);

 useEffect(()=>{if(session&&profile)loadAll()},[session,profile]);
 useEffect(()=>{if(!session)return;
   const handle=payload=>{ loadOrders(); };
   const c=supabase.channel('brottta-live')
    .on('postgres_changes',{event:'*',schema:'public',table:'orders'},handle)
    .on('postgres_changes',{event:'*',schema:'public',table:'order_items'},handle)
    .on('postgres_changes',{event:'*',schema:'public',table:'table_sessions'},handle)
    .subscribe();

   // Realtime is used for instant refresh, while polling detects notifications
   // reliably even when a browser misses a realtime event.
   const checkNotifications=async()=>{
     const{data,error}=await supabase.from('orders').select('id,created_at,status,order_items(id,status)').order('created_at',{ascending:false});
     if(error)return;
     const list=data||[];
     const orderIds=new Set(list.map(o=>o.id));
     const itemStates=new Map();
     list.forEach(o=>(o.order_items||[]).forEach(i=>itemStates.set(i.id,i.status)));

     if(previousOrderIds.current===null){
       previousOrderIds.current=orderIds;
       previousItemStates.current=itemStates;
       liveReady.current=true;
       return;
     }

     if(soundEnabled){
       if(role==='chef'){
         const newOrders=list.filter(o=>!previousOrderIds.current.has(o.id) && o.status!=='PAID' && o.status!=='CANCELLED');
         if(newOrders.length) beep(audioCtx.current);
       }
       if(role==='waiter'){
         let readyChanged=false;
         itemStates.forEach((status,id)=>{
           if(status==='READY' && previousItemStates.current.get(id)!=='READY') readyChanged=true;
         });
         if(readyChanged) beep(audioCtx.current);
       }
     }

     previousOrderIds.current=orderIds;
     previousItemStates.current=itemStates;
     loadOrders();
   };

   checkNotifications();
   const timer=setInterval(checkNotifications,3000);
   return()=>{clearInterval(timer);supabase.removeChannel(c)}
 },[session,role,soundEnabled]);


 function enableSound(){
   try{
     const C=window.AudioContext||window.webkitAudioContext;
     if(!C){setMsg('This browser does not support sound notifications.');return}
     const ctx=audioCtx.current||new C();
     audioCtx.current=ctx;
     const resume=ctx.resume?ctx.resume():Promise.resolve();
     Promise.resolve(resume).then(()=>{
       setSoundEnabled(true);
       localStorage.setItem('brottta-sound-enabled','1');
       beep(ctx);
       setMsg('🔔 Sound enabled. You heard the test beep.');
     }).catch(()=>setMsg('Click Enable Sound again and allow browser audio.'));
   }catch(e){setMsg('Unable to enable sound notifications.')}
 }

 async function connectPrinter(){
   try{
    let name='';
    if(printerMode==='BLUETOOTH'){
      if(isNativeAndroid()){
        const address=getNativeBluetoothAddress();
        if(!address)throw new Error('Select a paired Bluetooth printer in Billing first.');
        await nativeTestBluetooth(address);name=`Bluetooth ${address}`;
      }else name=await connectBluetoothPrinter();
    }else if(printerMode==='USB')name=await connectUsbPrinter();
    else if(printerMode==='WIFI'){
      const c=getWifiPrinter();if(!c.ip)throw new Error('Configure the Wi-Fi printer IP in Billing first.');
      if(!isNativeAndroid())throw new Error('Direct Wi-Fi connection status is available in the Android app. The website uses system print.');
      await nativeTestWifi(c.ip,c.port);
      name=`Wi-Fi ${c.ip}:${c.port}`;
    }else name='System Printer';
    setPrinterName(name);setMsg(`🟢 Printer connected: ${name}`);
   }catch(e){setPrinterName('');setMsg(e.message||'Unable to connect printer.')}
 }
 function changePrinterMode(mode){savePrinterMode(mode);setPrinterMode(mode);setPrinterName('');}

 async function getProfile(id){
   const{data,error}=await supabase.from('profiles').select('*').eq('id',id).single();
   if(error||!data){setMsg('No staff profile found for this login.');await supabase.auth.signOut();return}
   if(data.active===false){setMsg('This staff account is inactive.');await supabase.auth.signOut();return}
   setProfile(data);
   const allowed=getNavForRole(data.role).map(x=>x[0]);
   const fallback=data.role==='waiter'?'pos':data.role==='chef'?'kitchen':data.role==='cashier'?'billing':'dashboard';
   const saved=localStorage.getItem(`brottta-last-page-${data.role}`);
   setPage(saved&&allowed.includes(saved)?saved:fallback)
 }
 async function loadAll(){await Promise.all([loadOrders(),loadMenu(),loadEmployees(),loadAttendance(),loadExpenses(),loadSalaryPayments(),loadAdvances()])}
 async function loadOrders(){
   const{data,error}=await supabase.from('orders').select('*,order_items(*)').order('created_at',{ascending:false});
   if(error)setMsg(error.message);else setOrders(data||[])
 }
 async function loadMenu(){const{data,error}=await supabase.from('menu_items').select('*').order('category').order('name');if(error)setMsg(error.message);else setMenu(data||[])}
 async function loadEmployees(){const{data,error}=await supabase.from('employees').select('*').order('name');if(error)setMsg(error.message);else setEmployees(data||[])}
 async function loadAttendance(){const{data,error}=await supabase.from('attendance').select('*').order('attendance_date',{ascending:false});if(error)setMsg(error.message);else setAttendance(data||[])}
 async function loadSalaryPayments(){const{data,error}=await supabase.from('salary_payments').select('*').order('period_end',{ascending:false});if(error&&error.code!=='42P01')setMsg(error.message);else setSalaryPayments(data||[])}
 async function loadAdvances(){const{data,error}=await supabase.from('employee_advances').select('*').order('created_at',{ascending:false});if(error&&error.code!=='42P01')setMsg(error.message);else setAdvances(data||[])}
 async function loadExpenses(){const{data,error}=await supabase.from('expenses').select('*').order('expense_date',{ascending:false});if(error)setMsg(error.message);else setExpenses(data||[])}
 async function login(email,password,wanted){
   const{data,error}=await supabase.auth.signInWithPassword({email,password});
   if(error){setMsg(error.message);return}
   const{data:p,error:e}=await supabase.from('profiles').select('*').eq('id',data.user.id).single();
   if(e||!p||p.role!==wanted){setMsg(e?'No profile found':`This account is ${ROLES[p?.role]||'unassigned'}, not ${ROLES[wanted]}.`);await supabase.auth.signOut()}
 }
 async function ensureSession(tableNo){
   const{data,error}=await supabase.from('table_sessions').select('*').eq('table_no',tableNo).eq('status','OPEN').maybeSingle();
   if(error){setMsg(error.message);return null}
   if(data)return data;
   const{data:s,error:e}=await supabase.from('table_sessions').insert({table_no:tableNo,status:'OPEN',opened_by:session.user.id}).select().single();
   if(e){setMsg(e.message);return null} return s;
 }
 async function createOrder(){
   if(!table)return setMsg('Select a table first.');
   if(!cart.length)return setMsg('Add food items.');
   if(!chairs.length)return setMsg('Select Entire Table or at least one chair.');
   const sessionRow=await ensureSession(table); if(!sessionRow)return;
   const ttotal=cart.reduce((s,x)=>s+Number(x.price)*x.qty,0);
   const seatLabel=chairs.length===4?'ENTIRE TABLE':`CH-${chairs.join('&')}`;
   const{data:o,error}=await supabase.from('orders').insert({table_no:table,session_id:sessionRow.id,status:'NEW',total:ttotal,created_by:session.user.id,seat_label:seatLabel,chairs}).select().single();
   if(error)return setMsg(error.message);
   const{error:e}=await supabase.from('order_items').insert(cart.map(x=>({order_id:o.id,menu_item_id:x.id,item_name:x.name,unit_price:Number(x.price),qty:x.qty,line_total:Number(x.price)*x.qty,status:'NEW'})));
   if(e){await supabase.from('orders').delete().eq('id',o.id);return setMsg(e.message)}
   setCart([]);await loadOrders();setMsg(`Table ${table} ${seatLabel}: order sent to kitchen.`)
 }
 async function createTakeawayOrder(customerName='',customerPhone='',orderSourceValue='DIRECT'){
   if(!takeawayCart.length){setMsg('Add food items to the takeaway order.');return null}
   const ttotal=takeawayCart.reduce((s,x)=>s+Number(x.price)*x.qty,0);
   const{data:o,error}=await supabase.from('orders').insert({
     order_type:'TAKEAWAY',
     table_no:null,
     session_id:null,
     status:'NEW',
     total:ttotal,
     created_by:session.user.id,
     seat_label:'TAKEAWAY',
     chairs:[],
     customer_name:customerName||null,
     customer_phone:customerPhone||null,
     order_source:orderSourceValue==='ZOMATO'?'ZOMATO':'DIRECT'
   }).select().single();
   if(error){setMsg(error.message);return null}
   const{error:e}=await supabase.from('order_items').insert(takeawayCart.map(x=>({
     order_id:o.id,menu_item_id:x.id,item_name:x.name,unit_price:Number(x.price),qty:x.qty,
     line_total:Number(x.price)*x.qty,status:'NEW'
   })));
   if(e){await supabase.from('orders').delete().eq('id',o.id);setMsg(e.message);return null}
   setTakeawayCart([]);await loadOrders();setMsg(`Takeaway ${o.id.slice(0,6).toUpperCase()} sent to kitchen.`);return o;
 }
 async function cancelTakeawayOrder(orderId){
   const o=orders.find(x=>x.id===orderId);
   if(!o||orderType(o)!=='TAKEAWAY'||['PAID','CANCELLED'].includes(o.status))return;
   if(!confirm(`Cancel this takeaway order for ${money(total(o))}?`))return;
   const{error}=await supabase.from('orders').update({status:'CANCELLED'}).eq('id',orderId);
   if(error){setMsg(error.message);return}
   await supabase.from('order_items').update({status:'CANCELLED'}).eq('order_id',orderId);
   await loadOrders();setMsg('Takeaway order cancelled.');
 }
 async function sendTakeawayToBilling(orderId){
   const o=orders.find(x=>x.id===orderId);
   if(!o||orderType(o)!=='TAKEAWAY')return;
   if(o.status==='PAID'||o.status==='CANCELLED')return;
   const{error}=await supabase.from('orders').update({status:'BILL_REQUESTED'}).eq('id',orderId);
   if(error)setMsg(error.message);else{await loadOrders();setMsg(`Takeaway bill ${money(total(o))} is ready for collection.`)}
 }
 async function paySingleOrder(orderId,paymentMethod){
   if(!['CASH','ONLINE'].includes(paymentMethod)){setMsg('Select Cash or Online Payment.');return false}
   const o=orders.find(x=>x.id===orderId);
   if(!o)return false;
   const paidAt=new Date().toISOString();
   const{error}=await supabase.from('orders').update({status:'PAID',paid_at:paidAt,payment_method:paymentMethod}).eq('id',orderId);
   if(error){setMsg(error.message);return false}
   if(orderType(o)==='DINE_IN'&&o.session_id){
     const remaining=orders.filter(x=>x.session_id===o.session_id&&x.id!==o.id&&!['PAID','CANCELLED'].includes(x.status));
     if(!remaining.length){
       await supabase.from('table_sessions').update({status:'PAID',paid_at:paidAt}).eq('id',o.session_id);
       setTableResetNotice(`Table ${o.table_no} is now reset and available for a new order.`);
     }
   }
   await loadOrders();setMsg(`Bill ${money(total(o))} paid by ${paymentMethod==='CASH'?'Cash':'Online Payment'}. Printing receipt...`);
   return true;
 }
 async function closeUnpaidBill(orderId){
   const o=orders.find(x=>x.id===orderId);
   if(!o)return false;
   if(o.status==='PAID'){setMsg('Paid bills cannot be deleted.');return false}
   if(o.status==='CANCELLED')return true;

   const label=orderType(o)==='TAKEAWAY'
     ? `Takeaway / Parcel #${o.id.slice(0,6).toUpperCase()}`
     : `Table ${o.table_no} — ${seatLabel(o)}`;

   const ok=confirm(`Are you sure you want to delete this unpaid bill?\n\n${label}\nAmount: ${money(total(o))}\n\nThis will remove it from active billing.`);
   if(!ok)return false;

   const{error}=await supabase.from('orders').update({status:'CANCELLED'}).eq('id',orderId);
   if(error){setMsg(error.message);return false}

   await supabase.from('order_items').update({status:'CANCELLED'}).eq('order_id',orderId);

   if(orderType(o)==='DINE_IN'&&o.session_id){
     const remaining=orders.filter(x=>x.session_id===o.session_id&&x.id!==o.id&&!['PAID','CANCELLED'].includes(x.status));
     if(!remaining.length){
       await supabase.from('table_sessions').update({status:'CANCELLED'}).eq('id',o.session_id);
       setTableResetNotice(`Table ${o.table_no} is now reset and available.`);
     }
   }

   await loadOrders();
   setMsg('Unpaid bill deleted.');
   return true;
 }
 async function billSelectedOrders(orderIds){
   if(!orderIds?.length)return setMsg('Select at least one order to send for billing.');
   const selected=orders.filter(o=>orderIds.includes(o.id)&&!['PAID','CANCELLED','BILL_REQUESTED'].includes(o.status));
   if(!selected.length)return setMsg('Selected orders are already billed or closed.');
   const sessionId=selected[0].session_id;
   const{error}=await supabase.from('orders').update({status:'BILL_REQUESTED'}).in('id',selected.map(o=>o.id));
   if(error){setMsg(error.message);return}
   await loadOrders();
   setMsg(`${selected.length} selected order${selected.length>1?'s':''} sent to cashier for ${money(selected.reduce((s,o)=>s+total(o),0))}.`);
 }
 async function closeTable(tableNo,selectedIds=null){
   const open=orders.filter(o=>Number(o.table_no)===Number(tableNo)&&!['PAID','CANCELLED','BILL_REQUESTED'].includes(o.status));
   if(!open.length)return setMsg('No unbilled orders for this table.');
   await billSelectedOrders(selectedIds?.length?selectedIds:open.map(o=>o.id));
 }
 async function syncOrderStatus(orderId){
   const{data:items}=await supabase.from('order_items').select('status').eq('order_id',orderId);
   if(!items?.length)return;
   const s=items.map(x=>x.status||'NEW'), active=s.filter(x=>x!=='CANCELLED');
   let next='NEW';
   if(!active.length)next='CANCELLED';
   else if(active.every(x=>x==='SERVED'))next='SERVED';
   else if(active.every(x=>x==='READY'||x==='SERVED'))next='READY';
   else if(active.some(x=>['PREPARING','READY','SERVED'].includes(x)))next='PREPARING';
   await supabase.from('orders').update({status:next}).eq('id',orderId);
 }
 async function updateItemStatus(itemId,status){
   const{data:item,error}=await supabase.from('order_items').update({status,served_at:status==='SERVED'?new Date().toISOString():null}).eq('id',itemId).select('order_id').single();
   if(error){setMsg(error.message);return}
   const parent=orders.find(o=>o.id===item.order_id);
   // For takeaway, payment/billing status and kitchen preparation status must stay independent.
   // Do not replace BILL_REQUESTED/PAID when the chef updates an individual food item.
   if(!(parent&&orderType(parent)==='TAKEAWAY'&&['BILL_REQUESTED','PAID'].includes(parent.status))){
     await syncOrderStatus(item.order_id);
   }
   await loadOrders();
 }
 async function deleteOrderItem(item){
   const order=orders.find(o=>o.id===item.order_id);
   if(!order||['BILL_REQUESTED','PAID','CANCELLED'].includes(order.status))return setMsg('This order can no longer be changed.');
   const{error}=await supabase.from('order_items').delete().eq('id',item.id);
   if(error){setMsg(error.message);return}
   const{data:left}=await supabase.from('order_items').select('line_total').eq('order_id',item.order_id);
   if(!left?.length)await supabase.from('orders').delete().eq('id',item.order_id);
   else {await supabase.from('orders').update({total:left.reduce((s,x)=>s+Number(x.line_total||0),0)}).eq('id',item.order_id);await syncOrderStatus(item.order_id)}
   await loadOrders();setMsg(`${item.item_name} removed from the order.`);
 }
 async function updateStatus(id,status){await supabase.from('orders').update({status}).eq('id',id);await loadOrders()}
 async function payTable(sessionId,paymentMethod){
   if(!['CASH','ONLINE'].includes(paymentMethod)){setMsg('Select Cash or Online Payment.');return false}
   const group=orders.filter(o=>o.session_id===sessionId&&o.status==='BILL_REQUESTED');
   if(!group.length){setMsg('No bill-ready orders for this table.');return false}
   const amount=group.reduce((s,o)=>s+total(o),0);
   const paidAt=new Date().toISOString();
   const{error}=await supabase.from('orders').update({status:'PAID',paid_at:paidAt,payment_method:paymentMethod}).in('id',group.map(o=>o.id));
   if(error){setMsg(error.message);return false}
   const remaining=orders.filter(o=>o.session_id===sessionId&&!['PAID','CANCELLED'].includes(o.status)&&!group.some(g=>g.id===o.id));
   if(!remaining.length){
     const{error:e}=await supabase.from('table_sessions').update({status:'PAID',paid_at:paidAt}).eq('id',sessionId);
     if(e){setMsg(e.message);return false}
     setTableResetNotice(`Table ${group[0].table_no} is now reset and available for a new order.`);
   }
   await loadOrders();
   setMsg(`Bill ${money(amount)} paid by ${paymentMethod==='CASH'?'Cash':'Online Payment'}. Printing receipt...`);
   return true;
 }
 function addItem(i){setCart(c=>{const x=c.find(a=>a.id===i.id);return x?c.map(a=>a.id===i.id?{...a,qty:a.qty+1}:a):[...c,{...i,qty:1}]})}
 function qty(id,n){setCart(c=>c.map(x=>x.id===id?{...x,qty:x.qty+n}:x).filter(x=>x.qty>0))}
 function addTakeawayItem(i){setTakeawayCart(c=>{const x=c.find(a=>a.id===i.id);return x?c.map(a=>a.id===i.id?{...a,qty:a.qty+1}:a):[...c,{...i,qty:1}]})}
 function takeawayQty(id,n){setTakeawayCart(c=>c.map(x=>x.id===id?{...x,qty:x.qty+n}:x).filter(x=>x.qty>0))}
 async function saveMenu(item){
   const payload={name:item.name.trim(),price:Number(item.price),category:item.category.trim()||'Other',cost_price:Number(item.cost_price||0),available:item.available!==false};
   if(!payload.name||payload.price<=0)return setMsg('Food name and selling price are required.');
   const q=item.id?supabase.from('menu_items').update(payload).eq('id',item.id):supabase.from('menu_items').insert(payload);
   const{error}=await q;if(error)setMsg(error.message);else{await loadMenu();setMsg(item.id?'Food item updated.':'Food item added.')}
 }
 async function deleteMenu(id){
   const used=orders.some(o=>(o.order_items||[]).some(x=>x.menu_item_id===id));
   if(used)return setMsg('This food item is already used in orders. Disable it instead of deleting it.');
   const{error}=await supabase.from('menu_items').delete().eq('id',id);
   if(error)setMsg(error.message);else{await loadMenu();setMsg('Food item deleted.')}
 }
 async function addEmployee(){
   const name=prompt('Employee name');if(!name)return;
   const r=prompt('Role: Waiter / Chef / Cashier')||'Waiter';
   const payment_type=(prompt('Payment type: Weekly / Monthly')||'Weekly').toUpperCase()==='MONTHLY'?'MONTHLY':'WEEKLY';
   const per_day_salary=Number(prompt('Per-day salary')||0);
   const{error}=await supabase.from('employees').insert({name,role:r,active:true,payment_type,per_day_salary,advance_balance:0});
   if(error)setMsg(error.message);else loadEmployees()
 }
 async function markAttendance(e,s,dateValue){const d=dateValue||today();const{error}=await supabase.from('attendance').upsert({employee_id:e.id,attendance_date:d,status:s},{onConflict:'employee_id,attendance_date'});if(error)setMsg(error.message);else loadAttendance()}
 async function updateEmployeePay(e,patch){const{error}=await supabase.from('employees').update(patch).eq('id',e.id);if(error)setMsg(error.message);else{await loadEmployees();setMsg('Employee payment settings updated.')}}
 async function addAdvance(e,amount,note=''){
   amount=Number(amount||0);if(amount<=0)return setMsg('Enter a valid lending amount.');
   const{error}=await supabase.from('employee_advances').insert({employee_id:e.id,amount,remaining_amount:amount,note});
   if(error){setMsg(error.message);return}
   await supabase.from('employees').update({advance_balance:Number(e.advance_balance||0)+amount}).eq('id',e.id);
   await Promise.all([loadEmployees(),loadAdvances()]);setMsg(`${e.name}: lending amount ${money(amount)} added.`);
 }
 async function deleteAdvance(advance,e){
   if(!advance||!e)return;
   const original=Number(advance.amount||0),remaining=Number(advance.remaining_amount||0);
   if(remaining<original)return setMsg('This lending entry has already been partly deducted from salary and cannot be deleted.');
   if(!confirm(`Delete lending ${money(original)}${advance.note?` — ${advance.note}`:''}?`))return;
   const{error}=await supabase.from('employee_advances').delete().eq('id',advance.id);
   if(error){setMsg(error.message);return}
   await supabase.from('employees').update({advance_balance:Math.max(Number(e.advance_balance||0)-remaining,0)}).eq('id',e.id);
   await Promise.all([loadEmployees(),loadAdvances()]);setMsg('Lending entry deleted.');
 }
 async function paySalary(e,periodStart,periodEnd,allowance,incentive,personalExpense,advanceDeduction){
   const alreadyPaid=salaryPayments.some(p=>p.employee_id===e.id&&p.payment_type===(e.payment_type||'WEEKLY')&&p.period_start===periodStart&&p.period_end===periodEnd&&p.status==='PAID');
   if(alreadyPaid){setMsg(`${e.name}: salary for this period is already marked as paid.`);return}
   const rows=attendance.filter(a=>a.employee_id===e.id&&a.attendance_date>=periodStart&&a.attendance_date<=periodEnd);
   const days=rows.reduce((sum,a)=>sum+(a.status==='PRESENT'?1:a.status==='HALF_DAY'?0.5:0),0);
   const base=days*Number(e.per_day_salary||0);
   const gross=base+Number(allowance||0)+Number(incentive||0)-Number(personalExpense||0);
   const maxAdvance=Number(e.advance_balance||0);
   const deduction=Math.min(Math.max(Number(advanceDeduction||0),0),maxAdvance);
   const net=Math.max(gross-deduction,0);
   const{error}=await supabase.from('salary_payments').insert({employee_id:e.id,payment_type:e.payment_type||'WEEKLY',period_start:periodStart,period_end:periodEnd,present_days:days,base_salary:base,allowance:Number(allowance||0),incentive:Number(incentive||0),personal_expense:Number(personalExpense||0),advance_deduction:deduction,gross_salary:gross,net_salary:net,status:'PAID',paid_at:new Date().toISOString()});
   if(error){setMsg(error.message);return}
   if(deduction>0){
     let remaining=deduction;
     const advRows=advances.filter(a=>a.employee_id===e.id&&Number(a.remaining_amount)>0).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
     for(const a of advRows){const d=Math.min(remaining,Number(a.remaining_amount));await supabase.from('employee_advances').update({remaining_amount:Number(a.remaining_amount)-d}).eq('id',a.id);remaining-=d;if(remaining<=0)break}
     await supabase.from('employees').update({advance_balance:Math.max(maxAdvance-deduction,0)}).eq('id',e.id);
   }
   await Promise.all([loadEmployees(),loadSalaryPayments(),loadAdvances()]);
   setMsg(`${e.name}: ${e.payment_type==='MONTHLY'?'Monthly':'Weekly'} salary ${money(net)} marked as paid.`);
 }

 async function addExpense(){const description=prompt('Expense description');if(!description)return;const amount=Number(prompt('Amount'));if(!amount)return;const{error}=await supabase.from('expenses').insert({description,amount});if(error)setMsg(error.message);else loadExpenses()}

 if(loading)return <div className="splash">Loading Brottta POS...</div>;
 if(!session||!profile)return <Login role={loginRole} setRole={setLoginRole} login={login} msg={msg}/>;
 return <div className="app">
   <header><div className="brandWrap"><img src="/brottta-logo.jpg" className="brandLogo"/><div className="poweredBy">Powered by <b>highloops</b></div></div><div>{(role==='chef'||role==='waiter')&&<button className={soundEnabled?'soundBtn enabled':'soundBtn'} onClick={enableSound}>{soundEnabled?'🔔 Sound On':'🔕 Enable Sound'}</button>}<button className={printerName?'printerBtn connected':'printerBtn'} onClick={connectPrinter}>{printerName?'🖨️ '+printerName:'🔵 Connect Printer'}</button><button className="themeBtn" onClick={()=>setDark(x=>!x)}>{dark?'☀️ Light':'🌙 Dark'}</button><span className="pill">{ROLES[role]}</span> {profile.full_name||session.user.email} <button className="ghost" onClick={()=>supabase.auth.signOut()}>Logout</button></div></header>
   <div className="layout"><aside>{nav.map(([id,n])=><button key={id} className={page===id?'active':''} onClick={()=>setPage(id)}>{n}</button>)}</aside>
   <main>{msg&&<div className="toast">{msg}<button onClick={()=>setMsg('')}>×</button></div>}
     {page==='dashboard'&&<Dashboard orders={orders} menu={menu} employees={employees}/>}
     {page==='pos'&&<POS menu={menu} table={table} setTable={setTable} chairs={chairs} setChairs={setChairs} cart={cart} addItem={addItem} qty={qty} createOrder={createOrder} orders={orders} closeTable={closeTable} resetNotice={tableResetNotice} deleteItem={deleteOrderItem} updateItem={updateItemStatus}/>}
     {page==='ready'&&<Ready orders={orders} update={updateStatus} updateItem={updateItemStatus}/>}
     {page==='kitchen'&&<Kitchen orders={orders} update={updateStatus} updateItem={updateItemStatus}/>}
     {page==='billing'&&<Billing orders={orders} menu={menu} pay={payTable} paySingle={paySingleOrder} takeawayCart={takeawayCart} setTakeawayCart={setTakeawayCart} addItem={addItem} qty={qty} createTakeaway={createTakeawayOrder} sendTakeawayToBilling={sendTakeawayToBilling} cancelTakeaway={cancelTakeawayOrder} addTakeawayItem={addTakeawayItem} takeawayQty={takeawayQty} printerName={printerName} connectPrinter={connectPrinter} printerMode={printerMode} changePrinterMode={changePrinterMode} closeUnpaidBill={closeUnpaidBill}/>} 
     {page==='orders'&&<TableHistory orders={orders} update={updateStatus} pay={payTable} role={role} updateItem={updateItemStatus} deleteItem={deleteOrderItem}/>}
     {page==='menu'&&<Menu menu={menu} save={saveMenu} del={deleteMenu}/>}
     {page==='employees'&&<Employees data={employees} add={addEmployee} addAdvance={addAdvance} advances={advances} deleteAdvance={deleteAdvance}/>}
     {page==='payroll'&&role==='super_admin'&&<Payroll data={employees} add={addEmployee} update={updateEmployeePay} addAdvance={addAdvance} advances={advances} payments={salaryPayments} attendance={attendance} paySalary={paySalary} deleteAdvance={deleteAdvance}/>} 
     {page==='attendance'&&<Attendance data={employees} records={attendance} mark={markAttendance}/>}
     {page==='expenses'&&<Expenses data={expenses} add={addExpense}/>}
     {page==='analytics'&&<Analytics orders={orders} expenses={expenses}/>}
   </main></div></div>
}

function Login({role,setRole,login,msg}){const[e,setE]=useState(''),[p,setP]=useState('');return <div className="login"><div className="loginbox"><img src="/brottta-logo.jpg" className="loginBrandLogo"/><h1>Brottta POS</h1><p>Restaurant Management System</p><div className="roles">{Object.entries(ROLES).map(([k,v])=><button className={role===k?'sel':''} onClick={()=>setRole(k)} key={k}>{v}</button>)}</div><label>Email</label><input value={e} onChange={x=>setE(x.target.value)}/><label>Password</label><input type="password" value={p} onChange={x=>setP(x.target.value)}/><button className="primary full" onClick={()=>login(e,p,role)}>Login as {ROLES[role]}</button>{msg&&<div className="error">{msg}</div>}</div></div>}

function Title({t,s,children}){return <div className="title"><div><h1>{t}</h1><p>{s}</p></div>{children}</div>}
function Panel({t,children}){return <section className="panel">{t&&<h2>{t}</h2>}{children}</section>}
function Stat({n,v}){return <div className="stat"><span>{n}</span><b>{v}</b></div>}

function rangeFilterOrders(orders,from,to){
 const f=from||'0000-01-01', t=to||'9999-12-31';
 return orders.filter(o=>{const d=(o.paid_at||o.created_at||'').slice(0,10);return d>=f&&d<=t});
}
function DateRange({from,to,setFrom,setTo}){
 return <div className="filterRow dateRange"><label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><button className="small" onClick={()=>{setFrom(today());setTo(today())}}>Today</button><button className="small" onClick={()=>{setFrom('');setTo('')}}>Clear</button></div>
}
function Dashboard({orders,menu,employees}){
 const [from,setFrom]=useState(today()),[to,setTo]=useState(today());
 const paid=rangeFilterOrders(orders.filter(o=>o.status==='PAID'),from,to);
 const dine=paid.filter(o=>orderType(o)==='DINE_IN'),take=paid.filter(o=>orderType(o)==='TAKEAWAY');
 const sales=paid.reduce((s,o)=>s+total(o),0),cash=paid.filter(o=>o.payment_method==='CASH').reduce((s,o)=>s+total(o),0),online=paid.filter(o=>o.payment_method==='ONLINE').reduce((s,o)=>s+total(o),0);
 const top={};paid.forEach(o=>(o.order_items||[]).forEach(i=>{top[i.item_name]=(top[i.item_name]||0)+Number(i.qty||0)}));
 return <><div className="dashboardBrand"><img src="/brottta-logo.jpg"/><div><h2>BROTTTA</h2><span>Specialised in Parotta</span></div></div><Title t="Dashboard" s="Select a date or date range to track restaurant performance"/><DateRange from={from} to={to} setFrom={setFrom} setTo={setTo}/>
  <div className="stats"><Stat n="Total Sales" v={money(sales)}/><Stat n="Total Orders" v={paid.length}/><Stat n="Cash" v={money(cash)}/><Stat n="Online" v={money(online)}/></div>
  <div className="splitStats">
   <div className="statGroup dine"><h2>🍽️ Dine-In</h2><div className="stats"><Stat n="Sales" v={money(dine.reduce((s,o)=>s+total(o),0))}/><Stat n="Orders" v={dine.length}/></div></div>
   <div className="statGroup takeaway"><h2>🥡 Takeaway / Parcel</h2><div className="stats"><Stat n="Sales" v={money(take.reduce((s,o)=>s+total(o),0))}/><Stat n="Orders" v={take.length}/></div></div>
  </div>
  <Panel t="Top Selling Items">{Object.entries(top).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([n,q],i)=><div className="rank" key={n}><span>#{i+1}</span><b>{n}</b><strong>{q} sold</strong></div>)}</Panel></>
}

function seatLabel(o){return o.seat_label||'ENTIRE TABLE'}
function ItemRow({item,showStatus=true,canDelete=false,onDelete,canServe=false,onServe}){
 const st=item.status||'NEW';
 return <div className="line itemLine"><span><b>{item.item_name}</b> <small>× {item.qty}</small></span><span className={`itemBadge ${st==='SERVED'?'served':st==='READY'?'ready':'pending'}`}>{ITEM_STATUS[st]||st}</span><strong>{money(item.line_total)}</strong>{canServe&&st==='READY'&&<button className="small" onClick={()=>onServe(item.id)}>Serve</button>}{canDelete&&<button className="small dangerText" onClick={()=>onDelete(item)}>Delete</button>}</div>
}

function POS({menu,table,setTable,chairs,setChairs,cart,addItem,qty,createOrder,orders,closeTable,resetNotice,deleteItem,updateItem}){
 const[c,setC]=useState('All');const cats=['All',...new Set(menu.map(x=>x.category||'Other'))];
 const list=menu.filter(x=>x.available!==false&&(c==='All'||x.category===c));
 const sum=cart.reduce((s,x)=>s+Number(x.price)*x.qty,0);
 const tableOrders=table?orders.filter(o=>Number(o.table_no)===Number(table)&&!['PAID','CANCELLED','BILL_REQUESTED'].includes(o.status)).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)):[];
 const tableTotal=tableOrders.reduce((s,o)=>s+total(o),0);
 const toggleChair=n=>setChairs(x=>x.includes(n)?x.filter(v=>v!==n):[...x,n].sort((a,b)=>a-b));
 return <><Title t="Take Order" s="Select a table → choose seats → add food → send each ticket to kitchen"/>
 {resetNotice&&<div className="resetNotice">✓ {resetNotice}</div>}
 <div className="tables">{TABLES.map(tn=>{const active=orders.some(o=>Number(o.table_no)===tn&&!['PAID','CANCELLED'].includes(o.status));return <button className={table===tn?'selected':''} onClick={()=>{setTable(tn);setChairs([])}} key={tn}><b>Table {tn}</b><small>{active?'OPEN':'Available'}</small></button>})}</div>
 {table&&<Panel t={`TABLE ${table} — SEATING`}><div className="seatChooser"><button className={chairs.length===4?'selectedSeat':''} onClick={()=>setChairs([1,2,3,4])}>🪑 Entire Table</button>{[1,2,3,4].map(n=><button key={n} className={chairs.includes(n)?'selectedSeat':''} onClick={()=>toggleChair(n)}>Chair {n}</button>)}</div><small className="hint">Select one or more chairs. Example: CH-1&2. Select Entire Table for all four chairs.</small></Panel>}
 <div className="pos">
  <Panel t="Food Menu"><div className="chips">{cats.map(x=><button className={c===x?'on':''} onClick={()=>setC(x)} key={x}>{x}</button>)}</div><div className="foods">{list.map(i=><button className="food" onClick={()=>addItem(i)} key={i.id}><b>{i.name}</b><small>{i.category}</small><strong>{money(i.price)}</strong></button>)}</div></Panel>
  <div>
   <Panel t={table?`NEW ORDER — TABLE ${table} ${chairs.length?`• ${chairs.length===4?'ENTIRE TABLE':`CH-${chairs.join('&')}`}`:''}`:'Current Order'}>
    {!table&&<div className="empty">Select a table first.</div>}
    {table&&!chairs.length&&<div className="empty">Select Entire Table or one/more chairs.</div>}
    {table&&chairs.length>0&&cart.length===0&&<div className="empty">Tap food items to add a new order ticket.</div>}
    {cart.map(i=><div className="cart" key={i.id}><div><b>{i.name}</b><small>{money(i.price)} each</small></div><div className="counter"><button onClick={()=>qty(i.id,-1)}>−</button><b>{i.qty}</b><button onClick={()=>qty(i.id,1)}>+</button></div><strong>{money(i.price*i.qty)}</strong></div>)}
    <div className="total"><b>NEW ORDER TOTAL</b><strong>{money(sum)}</strong></div>
    <button className="kitchen fullBtn" disabled={!table||!chairs.length||!cart.length} onClick={createOrder}>👨‍🍳 SEND TO KITCHEN</button>
   </Panel>
   {table&&<TableOpenHistory orders={tableOrders} table={table} total={tableTotal} closeTable={closeTable} deleteItem={deleteItem} updateItem={updateItem}/>}
  </div>
 </div></>
}

function TableOpenHistory({orders,table,total:grand,closeTable,deleteItem,updateItem}){
 const [selected,setSelected]=useState([]);
 const available=orders.filter(o=>!['BILL_REQUESTED','PAID','CANCELLED'].includes(o.status));
 const toggle=id=>setSelected(x=>x.includes(id)?x.filter(v=>v!==id):[...x,id]);
 const selectedTotal=orders.filter(o=>selected.includes(o.id)).reduce((s,o)=>s+total(o),0);
 useEffect(()=>{setSelected(x=>x.filter(id=>available.some(o=>o.id===id)))},[orders.length]);
 return <Panel t={`TABLE ${table} — OPEN HISTORY`}>
   {orders.length===0?<div className="empty">No previous orders for this table.</div>:orders.map((o,i)=><div className={`ticket ${selected.includes(o.id)?'selectedTicket':''}`} key={o.id}>
     <div className="ticketHead">
       {available.some(x=>x.id===o.id)&&<label className="billCheck"><input type="checkbox" checked={selected.includes(o.id)} onChange={()=>toggle(o.id)}/><b>Send this order to bill</b></label>}
       <b>Order #{i+1}</b><span>{seatLabel(o)}</span><span className={`status ${String(o.status).toLowerCase()}`}>{STATUS[o.status]}</span><small>{dt(o.created_at)}</small>
     </div>
     {(o.order_items||[]).map(it=><ItemRow key={it.id} item={it} canDelete={!['BILL_REQUESTED','PAID','CANCELLED'].includes(o.status)} onDelete={deleteItem}/>)}
     <div className="ticketTotal">{money(total(o))}</div>
   </div>)}
   <div className="grand"><span>TABLE TOTAL</span><b>{money(grand)}</b></div>
   {available.length>0&&<button className="bill fullBtn" disabled={!selected.length} onClick={async()=>{await closeTable(table,selected);setSelected([])}}>🧾 SEND SELECTED TO BILL {selected.length?`— ${money(selectedTotal)}`:''}</button>}
   {selected.length===0&&available.length>0&&<small className="hint">Tick only the chair/group order you want to bill. Other orders remain open.</small>}
 </Panel>
}
function Ready({orders,update,updateItem}){const x=orders.filter(o=>o.status==='READY'||(o.order_items||[]).some(i=>i.status==='READY'));return <><Title t="🔔 Ready to Serve" s="Green = served/ready, red = not yet served"/><div className="cards">{x.length===0&&<div className="empty panel">No ready items.</div>}{x.map(o=><div className="card" key={o.id}><div className="cardhead"><h2>TABLE {o.table_no}</h2><span>{seatLabel(o)}</span></div>{(o.order_items||[]).map(i=><ItemRow key={i.id} item={i} canServe={i.status==='READY'} onServe={updateItem}/>)}</div>)}</div></>}

function Kitchen({orders,updateItem}){
 const dine=orders.filter(o=>orderType(o)==='DINE_IN'&&!['SERVED','PAID','CANCELLED','BILL_REQUESTED'].includes(o.status));
 // Takeaway billing/payment is independent from kitchen preparation.
 // Keep a takeaway ticket visible until every non-cancelled item is READY/SERVED.
 const take=orders.filter(o=>{
   if(orderType(o)!=='TAKEAWAY'||o.status==='CANCELLED')return false;
   const items=(o.order_items||[]).filter(i=>i.status!=='CANCELLED');
   return items.length>0 && items.some(i=>!['READY','SERVED'].includes(i.status||'NEW'));
 });
 const card=o=><div className="card" key={o.id}>
   <div className="cardhead"><h2>{orderType(o)==='TAKEAWAY'?`🥡 PARCEL #${o.id.slice(0,6).toUpperCase()}`:`TABLE ${o.table_no}`}</h2><div className="badgeRow"><span className="orderTypeBadge">{orderTypeLabel(o)}</span>{orderType(o)==='TAKEAWAY'&&<span className={orderSource(o)==='ZOMATO'?'sourceBadge zomato':'sourceBadge'}>{sourceBadge(o)}</span>}{orderType(o)==='TAKEAWAY'&&o.token_number!=null&&<span className="tokenBadge">TOKEN #{o.token_number}</span>}{orderType(o)==='TAKEAWAY'&&o.status==='BILL_REQUESTED'&&<span className="kitchenPaymentBadge billed">BILLED</span>}{orderType(o)==='TAKEAWAY'&&o.status==='PAID'&&<span className="kitchenPaymentBadge paid">PAID</span>}</div></div>
   {orderType(o)==='DINE_IN'&&<span>{seatLabel(o)}</span>}
   {o.customer_name&&<small>Customer: {o.customer_name}{o.customer_phone?` • ${o.customer_phone}`:''}</small>}
   <small>{dt(o.created_at)}</small>
   {(o.order_items||[]).map(i=><div className="kitchenItem" key={i.id}>
    <div><b>{i.qty} × {i.item_name}</b><small>{ITEM_STATUS[i.status||'NEW']}</small></div>
    <div className="actions mini">
     {(i.status||'NEW')==='NEW'&&<><button className="primary" onClick={()=>updateItem(i.id,'PREPARING')}>Preparing</button><button className="success" onClick={()=>updateItem(i.id,'READY')}>✓ Ready Now</button></>}
     {i.status==='PREPARING'&&<button className="success" onClick={()=>updateItem(i.id,'READY')}>✓ Ready</button>}
     {i.status==='READY'&&(orderType(o)==='TAKEAWAY'?<span className="badge green">✓ READY</span>:<button className="success" onClick={()=>updateItem(i.id,'SERVED')}>✓ Served</button>)}
     {i.status==='SERVED'&&<span className="badge green">SERVED</span>}
    </div>
   </div>)}
  </div>;
 return <div><Title t="Kitchen" s="Dine-in and takeaway orders are separated for the chef."/>
  <div className="kitchenSplit">
   <section><div className="sectionTitle"><h2>🍽️ DINE-IN</h2><span>{dine.length} orders</span></div>{dine.length?dine.map(card):<div className="empty panel">No dine-in orders.</div>}</section>
   <section><div className="sectionTitle"><h2>🥡 TAKEAWAY / PARCEL</h2><span>{take.length} orders</span></div>{take.length?take.map(card):<div className="empty panel">No takeaway orders.</div>}</section>
  </div>
 </div>
}


function NativeBluetoothSettings(){
 const [devices,setDevices]=useState([]),[address,setAddress]=useState(getNativeBluetoothAddress()),[loading,setLoading]=useState(false);
 const load=async()=>{setLoading(true);try{const list=await listPairedBluetoothPrinters();setDevices(list);if(!list.length)alert('No paired Bluetooth devices were returned. Confirm Android Nearby devices permission is allowed and the printer is paired in Android Settings.')}catch(e){alert(e.message||'Unable to read paired Bluetooth devices.');setDevices([])}finally{setLoading(false)}};
 useEffect(()=>{if(isNativeAndroid())load()},[]);
 if(!isNativeAndroid())return null;
 return <div className="nativeBtSettings">
  <select value={address} onChange={e=>{setAddress(e.target.value);saveNativeBluetoothAddress(e.target.value)}}>
   <option value="">Select paired Bluetooth printer</option>
   {devices.map(d=><option key={d.address} value={d.address}>{d.name||'Bluetooth Device'} — {d.address}</option>)}
  </select>
  <button className="small" onClick={load}>{loading?'Loading...':'Refresh Paired Devices'}</button>
  <small>Pair the printer in Android Settings first. On Android 12+, allow Brottta POS → Nearby devices permission when prompted.</small>
 </div>
}

function WifiPrinterSettings(){
 const initial=getWifiPrinter(),[ip,setIp]=useState(initial.ip),[port,setPort]=useState(initial.port||9100),[saved,setSaved]=useState(false);
 return <div className="wifiSettings">
  <input value={ip} onChange={e=>setIp(e.target.value)} placeholder="Printer IP e.g. 192.168.1.87"/>
  <input type="number" value={port} onChange={e=>setPort(e.target.value)} placeholder="9100"/>
  <button onClick={()=>{saveWifiPrinter(ip,port);setSaved(true);setTimeout(()=>setSaved(false),1200)}}>{saved?'✓ Saved':'Save IP'}</button>
  {isNativeAndroid()&&<button className="small" onClick={async()=>{try{await nativeTestWifi(ip,port);alert('Printer reachable on Wi-Fi.')}catch(e){alert(e.message||'Printer not reachable.')}}}>Test Wi-Fi</button>}
  <small>{isNativeAndroid()?'Android app uses direct TCP/ESC-POS Wi-Fi printing.':'Website mode stores the IP but uses system print because browsers cannot open raw TCP 9100.'}</small>
 </div>
}

function Billing({orders,menu,pay,paySingle,takeawayCart,setTakeawayCart,addTakeawayItem,takeawayQty,createTakeaway,sendTakeawayToBilling,cancelTakeaway,printerName,connectPrinter,printerMode,changePrinterMode,closeUnpaidBill}){
 const [openPay,setOpenPay]=useState(null),[expandedHistory,setExpandedHistory]=useState({});
 const [customerName,setCustomerName]=useState(''),[customerPhone,setCustomerPhone]=useState('');
 const [source,setSource]=useState('DIRECT'),[cat,setCat]=useState('All');
 const menuItems=menu||[];
 const dineBills=orders.filter(o=>orderType(o)==='DINE_IN'&&o.status==='BILL_REQUESTED').sort((a,b)=>Number(a.table_no)-Number(b.table_no)||new Date(a.created_at)-new Date(b.created_at));
 const takeawayBills=orders.filter(o=>orderType(o)==='TAKEAWAY'&&o.status==='BILL_REQUESTED');
 const takeawayOpen=orders.filter(o=>orderType(o)==='TAKEAWAY'&&!['PAID','CANCELLED','BILL_REQUESTED'].includes(o.status));
 const history=orders.filter(o=>o.status==='PAID').sort((a,b)=>new Date(b.paid_at||b.created_at)-new Date(a.paid_at||a.created_at));
 const cats=['All',...new Set(menuItems.map(x=>x.category||'Other'))];
 const list=menuItems.filter(x=>x.available!==false&&(cat==='All'||x.category===cat));
 const takeawayTotal=takeawayCart.reduce((s,x)=>s+Number(x.price)*x.qty,0);

 const printBill=async bill=>{
  try{
   if(isNativeAndroid()&&printerMode==='WIFI'){const cfg=getWifiPrinter();if(!cfg.ip)throw new Error('Save the Wi-Fi printer IP first.');await nativePrintWifi(cfg.ip,cfg.port,await buildEscPosReceipt(bill));return}
   if(isNativeAndroid()&&printerMode==='BLUETOOTH'){const address=getNativeBluetoothAddress();if(!address)throw new Error('Select a paired Bluetooth printer first.');await nativePrintBluetooth(address,await buildEscPosReceipt(bill));return}
   if(printerMode==='BLUETOOTH'){if(!btPrinter.characteristic)await connectBluetoothPrinter();await printBluetoothReceipt(bill)}
   else if(printerMode==='USB'){if(!window.__brotttaUsb?.device?.opened)await connectUsbPrinter();await printUsbReceipt(bill)}
   else if(printerMode==='WIFI')await printWifiReceipt(bill);
   else printBrowserReceipt(bill);
  }catch(e){if(confirm(`${e.message||'Direct print failed.'}\n\nUse browser/system print instead?`))printBrowserReceipt(bill)}
 };
 const testPrint=async()=>{
   const sample={id:'TEST01',order_type:'TAKEAWAY',order_source:'DIRECT',created_at:new Date().toISOString(),total:40,payment_method:'CASH',order_items:[{id:'t1',item_name:'TEST PRINT',qty:1,line_total:40}]};
   await printBill(sample);
 };

 const payButtons=(key,fn,bill)=><>{openPay===key?<div className="paymentChooser"><div className="paymentTitle">Select payment method</div><div className="paymentButtons"><button className="success paymentBtn" onClick={async()=>{const ok=await fn('CASH');setOpenPay(null);if(ok){const stamped=Array.isArray(bill)?bill.map(o=>({...o,payment_method:'CASH',paid_at:new Date().toISOString()})):{...bill,payment_method:'CASH',paid_at:new Date().toISOString()};await printBill(stamped)}}}>💵 CASH + PRINT</button><button className="primary paymentBtn" onClick={async()=>{const ok=await fn('ONLINE');setOpenPay(null);if(ok){const stamped=Array.isArray(bill)?bill.map(o=>({...o,payment_method:'ONLINE',paid_at:new Date().toISOString()})):{...bill,payment_method:'ONLINE',paid_at:new Date().toISOString()};await printBill(stamped)}}}>📱 ONLINE + PRINT</button></div><button className="ghost compactBtn" onClick={()=>setOpenPay(null)}>Cancel</button></div>:<button className="success compactAction" onClick={()=>setOpenPay(key)}>✓ COLLECT PAYMENT</button>}</>;

 return <div>
  <Title t="Billing & Takeaway" s="Dine-in bills and takeaway orders are handled by the cashier."/>
  <div className="printerPanel printerConfig">
   <div><b>🖨️ Receipt Printer</b><div className={`connectionBadge ${printerName?'connected':'offline'}`}>{printerName?`● Connected — ${printerName}`:'● Not connected'}</div></div>
   <div className="printerModes">{['SYSTEM','USB','BLUETOOTH','WIFI'].map(m=><button key={m} className={printerMode===m?'on':''} onClick={()=>changePrinterMode(m)}>{m==='SYSTEM'?'🖥️ System':m==='USB'?'🔌 USB':m==='BLUETOOTH'?'🔵 Bluetooth':'📶 Wi-Fi'}</button>)}</div>
   {printerMode==='WIFI'&&<WifiPrinterSettings/>}
   {printerMode==='BLUETOOTH'&&<NativeBluetoothSettings/>}
   <div className="rowActions"><button className="primary compactBtn" onClick={connectPrinter}>Test / Connect</button><button className="printBtn compactBtn" disabled={!printerName} onClick={testPrint}>🧾 Test Print</button></div>
  </div>

  <div className="billingSplit">
   <section><div className="sectionTitle"><h2>🍽️ DINE-IN BILLS</h2><span>{dineBills.length}</span></div>
    {dineBills.length===0?<div className="empty panel">No active dine-in bills.</div>:<div className="cards dineBillCards">{dineBills.map(o=><div className="card individualBillCard" key={o.id}>
      <div className="cardhead"><div><h2>TABLE {o.table_no}</h2><div className="billSeatLabel">{seatLabel(o)}</div></div><span className="orderTypeBadge">🍽️ DINE IN</span></div>
      <div className="billOrderMeta"><span>Bill #{o.id.slice(0,6).toUpperCase()}</span><small>{dt(o.created_at)}</small></div>
      {(o.order_items||[]).map(it=><div className="line" key={it.id}><span>{it.item_name} × {it.qty}</span><b>{money(it.line_total)}</b></div>)}
      <div className="grand"><span>THIS BILL TOTAL</span><b>{money(total(o))}</b></div>
      <div className="billActionRow"><button className="printBtn compactAction" onClick={()=>printBill(o)}>🖨️ PRINT THIS BILL</button>{payButtons(`dine-${o.id}`,m=>paySingle(o.id,m),o)}<button className="danger compactBtn" onClick={()=>closeUnpaidBill(o.id)}>✕ DELETE UNPAID BILL</button></div>
    </div>)}</div>}
   </section>

   <section><div className="sectionTitle"><h2>🥡 TAKEAWAY / PARCEL</h2><span>{takeawayOpen.length+takeawayBills.length}</span></div>
    <div className="card takeawayCreator">
     <div className="cardhead"><h3>New Takeaway Order</h3><span className={source==='ZOMATO'?'sourceBadge zomato':'sourceBadge'}>{source==='ZOMATO'?'ZOMATO ORDER':'DIRECT'}</span></div>
     <div className="sourceSelector"><label><input type="radio" name="takeSource" checked={source==='DIRECT'} onChange={()=>setSource('DIRECT')}/> Direct</label><label><input type="radio" name="takeSource" checked={source==='ZOMATO'} onChange={()=>setSource('ZOMATO')}/> Zomato</label></div>
     <div className="formGrid"><input placeholder="Customer name (optional)" value={customerName} onChange={e=>setCustomerName(e.target.value)}/><input placeholder="Phone (optional)" value={customerPhone} onChange={e=>setCustomerPhone(e.target.value)}/></div>
     <div className="chips">{cats.map(x=><button className={cat===x?'on':''} onClick={()=>setCat(x)} key={x}>{x}</button>)}</div>
     <div className="foods">{list.map(i=><button className="food" onClick={()=>addTakeawayItem(i)} key={i.id}><b>{i.name}</b><small>{i.category}</small><strong>{money(i.price)}</strong></button>)}</div>
     {takeawayCart.map(i=><div className="cart" key={i.id}><div><b>{i.name}</b><small>{money(i.price)} each</small></div><div className="counter"><button onClick={()=>takeawayQty(i.id,-1)}>−</button><b>{i.qty}</b><button onClick={()=>takeawayQty(i.id,1)}>+</button></div><strong>{money(i.price*i.qty)}</strong></div>)}
     <div className="grand"><span>PARCEL TOTAL</span><b>{money(takeawayTotal)}</b></div>
     <button className="kitchen compactAction" disabled={!takeawayCart.length} onClick={async()=>{await createTakeaway(customerName,customerPhone,source);setCustomerName('');setCustomerPhone('');setSource('DIRECT')}}>👨‍🍳 SEND TO KITCHEN</button>
    </div>

    {takeawayOpen.length>0&&<Panel t="Takeaway Orders in Kitchen"><div className="cards">{takeawayOpen.map(o=><div className="ticket relativeTicket" key={o.id}>
      <button className="iconCancel" title="Cancel order" onClick={()=>cancelTakeaway(o.id)}>×</button>
      <div className="ticketHead"><b>🥡 PARCEL #{o.id.slice(0,6).toUpperCase()}</b><span className={orderSource(o)==='ZOMATO'?'sourceBadge zomato':'sourceBadge'}>{sourceBadge(o)}</span>{o.token_number!=null&&<span className="tokenBadge">TOKEN #{o.token_number}</span>}<span>{STATUS[o.status]}</span><small>{dt(o.created_at)}</small></div>
      {(o.order_items||[]).map(it=><ItemRow key={it.id} item={it}/>)}
      <div className="grand"><b>{money(total(o))}</b></div><button className="bill compactAction" onClick={()=>sendTakeawayToBilling(o.id)}>🧾 SEND TO BILL — {money(total(o))}</button>
    </div>)}</div></Panel>}

    {takeawayBills.length>0&&<Panel t="Takeaway Bills Ready"><div className="cards">{takeawayBills.map(o=><div className="ticket relativeTicket" key={o.id}>
      <button className="iconCancel" title="Cancel order" onClick={()=>cancelTakeaway(o.id)}>×</button>
      <div className="ticketHead"><b>🥡 PARCEL #{o.id.slice(0,6).toUpperCase()}</b><span className={orderSource(o)==='ZOMATO'?'sourceBadge zomato':'sourceBadge'}>{sourceBadge(o)}</span>{o.token_number!=null&&<span className="tokenBadge">TOKEN #{o.token_number}</span>}<small>{dt(o.created_at)}</small></div>
      {o.customer_name&&<small>{o.customer_name}{o.customer_phone?` • ${o.customer_phone}`:''}</small>}
      {(o.order_items||[]).map(it=><div className="line" key={it.id}><span>{it.item_name} × {it.qty}</span><b>{money(it.line_total)}</b></div>)}
      <div className="grand"><span>TOTAL</span><b>{money(total(o))}</b></div><div className="billActionRow"><button className="printBtn compactAction" onClick={()=>printBill(o)}>🖨️ PRINT</button>{payButtons(`take-${o.id}`,m=>paySingle(o.id,m),o)}<button className="danger compactBtn" onClick={()=>closeUnpaidBill(o.id)}>✕ DELETE UNPAID BILL</button></div>
    </div>)}</div></Panel>}
   </section>
  </div>

  <div className="sectionTitle" style={{marginTop:24}}><div><h2>Billing History</h2><p className="muted">Expand a paid bill to see every item, order source and payment mode.</p></div></div>
  <Panel>{history.length===0?<div className="empty">No paid bills yet.</div>:<div className="tablewrap"><table><thead><tr><th>Date & Time</th><th>Type</th><th>Source</th><th>Table / Parcel</th><th>Amount</th><th>Payment</th><th>Status</th></tr></thead><tbody>
   {history.map(o=><React.Fragment key={o.id}><tr className="historyRow" onClick={()=>setExpandedHistory(x=>({...x,[o.id]:!x[o.id]}))}>
    <td>{expandedHistory[o.id]?'▼':'▶'} {fmtDateTime(o.paid_at||o.created_at)}</td><td>{orderTypeLabel(o)}</td><td>{orderType(o)==='TAKEAWAY'?sourceBadge(o):'—'}</td><td>{orderType(o)==='TAKEAWAY'?`Parcel #${o.id.slice(0,6).toUpperCase()}`:`Table ${o.table_no} • ${seatLabel(o)}`}</td><td><b>{money(total(o))}</b></td><td><span className="status">{paymentBadge(o.payment_method)}</span></td><td><span className="badge green">PAID</span></td>
   </tr>{expandedHistory[o.id]&&<tr className="historyDetails"><td colSpan="7"><div className="historyItems"><div className="historyItemsTitle">Bill Items</div>{(o.order_items||[]).map(it=><div className="historyItem" key={it.id}><span>{it.item_name} × {it.qty}</span><span>{money(it.line_total)}</span></div>)}<div className="historyTotal"><span>Total</span><b>{money(total(o))}</b></div><div className="historyMeta"><span>Order: <b>{orderTypeLabel(o)}</b></span>{orderType(o)==='TAKEAWAY'&&<span>Source: <b>{sourceBadge(o)}</b></span>}{orderType(o)==='TAKEAWAY'&&o.token_number!=null&&<span>Token: <b>#{o.token_number}</b></span>}<span>Payment: <b>{paymentBadge(o.payment_method)}</b></span><span>Paid: {fmtDateTime(o.paid_at||o.created_at)}</span><button className="printBtn small" onClick={e=>{e.stopPropagation();printBill(o)}}>🖨️ REPRINT</button></div></div></td></tr>}</React.Fragment>)}
  </tbody></table></div>}</Panel>
 </div>
}

function TableHistory({orders,pay,role,updateItem,deleteItem}){
 const [openPay,setOpenPay]=useState(null);
 const active=orders.filter(o=>!['PAID','CANCELLED'].includes(o.status));
 const groups=Object.values(active.reduce((a,o)=>{const k=o.session_id||`single-${o.id}`;(a[k]??=[]).push(o);return a},{}));
 return <><Title t="Table History" s="Open tables stay visible until billed. Green items are served; red items are pending."/><div className="cards">
 {groups.length===0&&<div className="empty panel">No open table orders.</div>}
 {groups.map(g=>{const grand=g.reduce((s,o)=>s+total(o),0);const sid=g[0].session_id;return <div className="card" key={sid||g[0].id}>
  <div className="cardhead"><h2>TABLE {g[0].table_no}</h2><span className="status">{g.every(o=>o.status==='SERVED')?'ALL SERVED':'OPEN'}</span></div>
  {g.map((o,i)=><div className="ticket" key={o.id}><div className="ticketHead"><b>Order #{i+1}</b><span>{seatLabel(o)}</span><small>{dt(o.created_at)}</small></div>{(o.order_items||[]).map(it=><ItemRow key={it.id} item={it} canServe={role==='waiter'&&it.status==='READY'} onServe={updateItem} canDelete={role==='waiter'&&!['BILL_REQUESTED','PAID','CANCELLED'].includes(o.status)} onDelete={deleteItem}/>)}</div>)}
  <div className="grand"><span>OPEN TABLE TOTAL</span><b>{money(grand)}</b></div>
  {role==='waiter'&&<small className="hint">Add another ticket anytime. Close the table only when the customer is done.</small>}
  {role==='cashier'&&g.every(o=>o.status==='BILL_REQUESTED')&&(openPay===sid?
    <div className="paymentChooser"><div className="paymentTitle">Select payment method</div><div className="paymentButtons"><button className="success paymentBtn" onClick={()=>{pay(sid,'CASH');setOpenPay(null)}}>💵 CASH</button><button className="primary paymentBtn" onClick={()=>{pay(sid,'ONLINE');setOpenPay(null)}}>📱 ONLINE PAYMENT</button></div><button className="ghost full" onClick={()=>setOpenPay(null)}>Cancel</button></div>
    :<button className="success full" onClick={()=>setOpenPay(sid)}>COLLECT {money(grand)}</button>)}
 </div>})}</div></>
}

function SimpleOrders({orders}){return <div className="tablewrap"><table><thead><tr><th>Table</th><th>Items</th><th>Total</th><th>Status</th><th>Time</th></tr></thead><tbody>{orders.map(o=><tr key={o.id}><td>Table {o.table_no}</td><td>{(o.order_items||[]).map(i=>`${i.item_name} ×${i.qty}`).join(', ')}</td><td>{money(total(o))}</td><td><span className="status">{STATUS[o.status]}</span></td><td>{dt(o.created_at)}</td></tr>)}</tbody></table></div>}

function Menu({menu,save,del}){
 const [open,setOpen]=useState(false),[editing,setEditing]=useState(null);
 const blank={name:'',category:'Other',price:'',cost_price:'',available:true};
 const startEdit=(item=null)=>{setEditing(item?{...item}:{...blank});setOpen(true)};
 const submit=async()=>{if(!editing)return;await save(editing);setOpen(false);setEditing(null)};
 return <><Title t="Food Items" s="Add, edit, enable/disable or delete menu items"><button className="primary compactBtn" onClick={()=>startEdit()}>+ Add Food</button></Title>
  <Panel><div className="tablewrap"><table><thead><tr><th>Food</th><th>Category</th><th>Price</th><th>Cost</th><th>Available</th><th>Actions</th></tr></thead><tbody>{menu.map(i=><tr key={i.id}><td>{i.name}</td><td>{i.category}</td><td>{money(i.price)}</td><td>{money(i.cost_price)}</td><td><span className={i.available?'availabilityBadge available':'availabilityBadge'}>{i.available?'Available':'Out of stock'}</span></td><td><div className="rowActions"><button className="small" onClick={()=>startEdit(i)}>Edit</button><button className="small" onClick={()=>save({...i,available:!i.available})}>{i.available?'Out of Stock':'Make Available'}</button><button className="small dangerText" onClick={()=>del(i.id)}>Delete</button></div></td></tr>)}</tbody></table></div></Panel>
  {open&&<div className="modalBackdrop" onClick={()=>setOpen(false)}><div className="modalCard foodModal" onClick={e=>e.stopPropagation()}><div className="modalHead"><h2>{editing?.id?'Edit Food Item':'Add Food Item'}</h2><button className="modalClose" onClick={()=>setOpen(false)}>×</button></div><div className="modalGrid"><label>Food name<input value={editing?.name||''} onChange={e=>setEditing({...editing,name:e.target.value})}/></label><label>Category<input value={editing?.category||''} onChange={e=>setEditing({...editing,category:e.target.value})}/></label><label>Selling price<input type="number" value={editing?.price??''} onChange={e=>setEditing({...editing,price:e.target.value})}/></label><label>Cost price<input type="number" value={editing?.cost_price??''} onChange={e=>setEditing({...editing,cost_price:e.target.value})}/></label></div><label className="check"><input type="checkbox" checked={editing?.available!==false} onChange={e=>setEditing({...editing,available:e.target.checked})}/> Available for ordering</label><div className="modalActions"><button className="primary compactAction" onClick={submit}>{editing?.id?'Save Changes':'Add Food Item'}</button>{editing?.id&&<button className="danger compactBtn" onClick={async()=>{await del(editing.id);setOpen(false);setEditing(null)}}>Delete</button>}</div></div></div>}
 </>;
}


function Employees({data,add,addAdvance,advances,deleteAdvance}){
 const [selected,setSelected]=useState(null),[amount,setAmount]=useState(''),[note,setNote]=useState('');
 const currentEmployee=selected?(data.find(x=>x.id===selected.id)||selected):null;
 const lendingFor=e=>advances.filter(a=>a.employee_id===e.id&&Number(a.remaining_amount||0)>0).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
 return <><Title t="Employees" s="Employee directory and lending review"><button className="primary compactBtn" onClick={add}>+ Add Employee</button></Title>
  <div className="employeeDirectory">
   {data.filter(e=>e.active!==false).map(e=><div className="card employeeDirectoryCard" key={e.id}>
    <div><h3>{e.name}</h3></div>
    <div className="employeeLendingMini"><span>Pending Lending</span><b>{money(e.advance_balance||0)}</b></div>
    <button className="primary compactBtn" onClick={()=>{setSelected(e);setAmount('');setNote('')}}>Review Lending</button>
   </div>)}
  </div>
  {currentEmployee&&<div className="modalBackdrop" onClick={()=>setSelected(null)}><div className="modalCard compactModal" onClick={e=>e.stopPropagation()}>
   <div className="modalHead"><div><h2>{currentEmployee.name}</h2><small>Lending review · Pending {money(currentEmployee.advance_balance||0)}</small></div><button className="modalClose" onClick={()=>setSelected(null)}>×</button></div>
   <div className="modalGrid"><label>New lending amount<input type="number" min="0" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0"/></label><label>Note / Comment<input value={note} onChange={e=>setNote(e.target.value)} placeholder="Reason for lending"/></label></div>
   <button className="primary compactAction" disabled={!Number(amount)} onClick={async()=>{await addAdvance(currentEmployee,Number(amount||0),note);setAmount('');setNote('')}}>+ Add Lending</button>
   <div className="advanceReview"><div className="sectionTitle"><h3>Lending History</h3><b>{money(currentEmployee.advance_balance||0)}</b></div>
    {lendingFor(currentEmployee).length===0?<div className="empty">No pending lending.</div>:lendingFor(currentEmployee).map(a=><div className="advanceRow" key={a.id}><div><b>{money(a.amount)}</b><small>{a.note||'No note'} · Remaining {money(a.remaining_amount)}</small></div><button className="iconDelete" title="Delete lending" onClick={()=>deleteAdvance(a,currentEmployee)}>🗑</button></div>)}
   </div>
  </div></div>}
 </>;
}

function Payroll({data,add,update,addAdvance,advances,payments,attendance,paySalary,deleteAdvance}){
 const [openPay,setOpenPay]=useState(null),[openAdv,setOpenAdv]=useState(null);
 const [allowance,setAllowance]=useState(0),[incentive,setIncentive]=useState(0),[personalExpense,setPersonalExpense]=useState(0),[deduction,setDeduction]=useState(0);
 const [advanceAmount,setAdvanceAmount]=useState(''),[advanceNote,setAdvanceNote]=useState(''),[payPeriod,setPayPeriod]=useState(null);
 const reviewEmployee=openPay?(data.find(x=>x.id===openPay.id)||openPay):null;
 const openSalary=e=>{const p=salaryPeriod(e.payment_type||'WEEKLY');setOpenPay(e);setPayPeriod(p);setAllowance(0);setIncentive(0);setPersonalExpense(0);setDeduction(0)};
 const calcDays=e=>!payPeriod?0:attendance.filter(a=>a.employee_id===e.id&&a.attendance_date>=payPeriod.start&&a.attendance_date<=payPeriod.end).reduce((sum,a)=>sum+(a.status==='PRESENT'?1:a.status==='HALF_DAY'?0.5:0),0);
 const isPaid=e=>payPeriod?payments.some(p=>p.employee_id===e.id&&p.payment_type===(e.payment_type||'WEEKLY')&&p.period_start===payPeriod.start&&p.period_end===payPeriod.end&&p.status==='PAID'):false;
 const payDays=openPay?calcDays(openPay):0,payBase=openPay?payDays*Number(openPay.per_day_salary||0):0;
 const payGross=payBase+Number(allowance||0)+Number(incentive||0)-Number(personalExpense||0);
 const payAdvance=Math.min(Math.max(Number(deduction||0),0),Number(reviewEmployee?.advance_balance||0)),payNet=Math.max(payGross-payAdvance,0),payRemaining=Math.max(Number(reviewEmployee?.advance_balance||0)-payAdvance,0);
 const employeeAdvances=e=>advances.filter(a=>a.employee_id===e.id&&Number(a.remaining_amount||0)>0).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
 return <><Title t="Payroll" s="Weekly/monthly salary calculation, attendance-based pay and salary payment history"/>
  <Panel t="Employee Salary Dashboard"><div className="employeeSummaryGrid">{data.filter(e=>e.active!==false).map(e=>{const p=payments.filter(x=>x.employee_id===e.id),week=p.filter(x=>x.payment_type==='WEEKLY').reduce((s,x)=>s+Number(x.net_salary||0),0),month=p.filter(x=>x.payment_type==='MONTHLY').reduce((s,x)=>s+Number(x.net_salary||0),0);return <div className="card" key={e.id}><div><b>{e.name}</b> <span className="roleSpace">{e.role}</span></div><small>{e.payment_type||'WEEKLY'} · {money(e.per_day_salary||0)}/day</small><div className="salaryMini"><span>Weekly paid <b>{money(week)}</b></span><span>Monthly paid <b>{money(month)}</b></span><span>Pending lending <b>{money(e.advance_balance)}</b></span></div></div>})}</div></Panel>
  <Panel t="Employee Payment Settings"><div className="tablewrap"><table><thead><tr><th>Name</th><th>Role</th><th>Payment Type</th><th>Per Day</th><th>Current Period</th><th>Lending</th><th>Actions</th></tr></thead><tbody>{data.map(e=>{const current=salaryPeriod(e.payment_type||'WEEKLY'),paid=payments.some(p=>p.employee_id===e.id&&p.payment_type===(e.payment_type||'WEEKLY')&&p.period_start===current.start&&p.period_end===current.end&&p.status==='PAID');return <tr key={e.id}><td><b>{e.name}</b></td><td>{e.role}</td><td><div className="payToggle"><button className={(e.payment_type||'WEEKLY')==='WEEKLY'?'on':''} onClick={()=>update(e,{payment_type:'WEEKLY'})}>Weekly</button><button className={(e.payment_type||'WEEKLY')==='MONTHLY'?'on':''} onClick={()=>update(e,{payment_type:'MONTHLY'})}>Monthly</button></div></td><td><input className="inlineInput" type="number" min="0" defaultValue={e.per_day_salary||0} onBlur={x=>update(e,{per_day_salary:Number(x.target.value||0)})}/></td><td><small>{current.label}</small></td><td>{money(e.advance_balance||0)}</td><td><div className="rowActions"><button className="small primary" onClick={()=>openSalary(e)}>Review Salary</button>{paid&&<span className="paidBadge">✓ PAID</span>}</div></td></tr>})}</tbody></table></div></Panel>
  <Panel t="Salary Payment History"><div className="tablewrap"><table><thead><tr><th>Employee</th><th>Type</th><th>Period</th><th>Days</th><th>Gross</th><th>Advance</th><th>Net</th><th>Status</th></tr></thead><tbody>{payments.map(p=>{const e=data.find(x=>x.id===p.employee_id);return <tr key={p.id}><td>{e?.name||'—'}</td><td>{p.payment_type}</td><td>{fmtDate(p.period_start)} → {fmtDate(p.period_end)}</td><td>{p.present_days}</td><td>{money(p.gross_salary)}</td><td>{money(p.advance_deduction)}</td><td><b>{money(p.net_salary)}</b></td><td><span className="paidBadge">✓ PAID</span></td></tr>})}</tbody></table></div></Panel>

  {openAdv&&<div className="modalBackdrop" onClick={()=>setOpenAdv(null)}><div className="modalCard compactModal" onClick={e=>e.stopPropagation()}><div className="modalHead"><div><h2>Add Lending</h2><small>{openAdv.name} · Pending {money(openAdv.advance_balance||0)}</small></div><button className="modalClose" onClick={()=>setOpenAdv(null)}>×</button></div><label>Amount<input type="number" min="0" value={advanceAmount} onChange={e=>setAdvanceAmount(e.target.value)}/></label><label>Note / Comment<input value={advanceNote} onChange={e=>setAdvanceNote(e.target.value)} placeholder="e.g. Festival advance"/></label><button className="primary compactAction" onClick={async()=>{await addAdvance(openAdv,Number(advanceAmount||0),advanceNote);setOpenAdv(null)}}>Add Lending</button></div></div>}

  {openPay&&payPeriod&&<div className="modalBackdrop" onClick={()=>setOpenPay(null)}><div className="modalCard salaryReviewModal" onClick={e=>e.stopPropagation()}><div className="modalHead"><div><h2>Salary Review — {openPay.name}</h2><small>{openPay.payment_type==='MONTHLY'?'Monthly':'Weekly'} · {payPeriod.label}</small></div><button className="modalClose" onClick={()=>setOpenPay(null)}>×</button></div>
   <div className="salarySummary"><span>Present days <b>{payDays}</b></span><span>Per day <b>{money(openPay.per_day_salary||0)}</b></span><span>Base <b>{money(payBase)}</b></span></div>
   <div className="modalGrid"><label>Allowance<input type="number" min="0" value={allowance} onChange={e=>setAllowance(e.target.value)}/></label><label>Incentive<input type="number" min="0" value={incentive} onChange={e=>setIncentive(e.target.value)}/></label><label>Expense Deduction<input type="number" min="0" value={personalExpense} onChange={e=>setPersonalExpense(e.target.value)}/></label><label>Advance Deduction <small>Pending {money(reviewEmployee?.advance_balance||0)}</small><input type="number" min="0" max={reviewEmployee?.advance_balance||0} value={deduction} onChange={e=>setDeduction(e.target.value)}/></label></div>
   <div className="advanceReview"><div className="sectionTitle"><h3>Pending Lending</h3><b>{money(reviewEmployee?.advance_balance||0)}</b></div>{employeeAdvances(openPay).length===0?<div className="empty">No pending lending.</div>:employeeAdvances(openPay).map(a=><div className="advanceRow" key={a.id}><div><b>{money(a.amount)}</b><small>{a.note||'No note'} · Remaining {money(a.remaining_amount)}</small></div><button className="iconDelete" title="Delete lending" onClick={()=>deleteAdvance(a,openPay)}>🗑</button></div>)}</div>
   <div className="salaryCalc"><div>Gross salary <b>{money(payGross)}</b></div><div>Remaining lending <b>{money(payRemaining)}</b></div><div className="netSalary">Net salary <b>{money(payNet)}</b></div></div>
   {isPaid(openPay)?<div className="paidBox">✓ SALARY PAID FOR THIS PERIOD</div>:<button className="success compactAction" onClick={async()=>{await paySalary(openPay,payPeriod.start,payPeriod.end,allowance,incentive,personalExpense,deduction);setOpenPay(null)}}>✓ MARK SALARY PAID — {money(payNet)}</button>}
  </div></div>}
 </>;
}

function Attendance({data,records,mark}){
 const [date,setDate]=useState(today());
 const rows=records.filter(r=>r.attendance_date===date);
 return <><Title t="Attendance" s="Select a date and mark each employee's attendance"/>
  <div className="singleDatePicker"><label>Date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><button className="small" onClick={()=>setDate(today())}>Today</button></div>
  <Panel t={`Attendance — ${fmtDate(date)}`}><div className="attendanceGrid">{data.filter(x=>x.active!==false).map(e=>{const day=rows.find(x=>x.employee_id===e.id);return <div className="card employeeAttend" key={e.id}><div><b>{e.name}</b> <span className="roleSpace">{e.role}</span></div><small>Status: {day?.status||'Not marked'}</small><div className="actions compactActions"><button className={day?.status==='PRESENT'?'success':'small'} onClick={()=>mark(e,'PRESENT',date)}>Present</button><button className={day?.status==='HALF_DAY'?'primary':'small'} onClick={()=>mark(e,'HALF_DAY',date)}>Half Day</button><button className={day?.status==='ABSENT'?'danger':'small'} onClick={()=>mark(e,'ABSENT',date)}>Absent</button><button className={day?.status==='LEAVE'?'primary':'small'} onClick={()=>mark(e,'LEAVE',date)}>Leave</button></div></div>})}</div></Panel>
 </>;
}

function Expenses({data,add}){return <><Title t="Expenses" s="Track costs"><button className="primary" onClick={add}>+ Add Expense</button></Title><Panel><TableSimple heads={['Date','Description','Amount']} rows={data.map(x=>[x.expense_date,x.description,money(x.amount)])}/></Panel></>}
function exportSales(rows,type){
 const data=rows.map(o=>({Date:fmtDate(o.paid_at||o.created_at),Time:new Date(o.paid_at||o.created_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}),Type:orderType(o),Source:orderType(o)==='TAKEAWAY'?orderSource(o):'',Table:o.table_no??'',Group:orderType(o)==='DINE_IN'?seatLabel(o):'',Total:Number(o.total||0),Payment:paymentBadge(o.payment_method).replace(/^[^ ]+ /,'')}));
 if(type==='CSV'){const keys=Object.keys(data[0]||{Date:'',Time:'',Table:'',Total:0,Payment:''});const esc=v=>`"${String(v??'').replace(/"/g,'""')}"`;const csv=[keys.join(','),...data.map(r=>keys.map(k=>esc(r[k])).join(','))].join('\\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=`brottta-sales-${today()}.csv`;a.click();return}
 const ws=XLSX.utils.json_to_sheet(data);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Sales');XLSX.writeFile(wb,`brottta-sales-${today()}.xlsx`);
}
function Analytics({orders,expenses}){
 const [from,setFrom]=useState(today()),[to,setTo]=useState(today());
 const paid=rangeFilterOrders(orders.filter(o=>o.status==='PAID'),from,to);
 const sales=paid.reduce((s,o)=>s+total(o),0),cost=expenses.filter(e=>e.expense_date>=from&&e.expense_date<=to).reduce((s,e)=>s+Number(e.amount||0),0),cash=paid.filter(o=>o.payment_method==='CASH').reduce((s,o)=>s+total(o),0),online=paid.filter(o=>o.payment_method==='ONLINE').reduce((s,o)=>s+total(o),0);
 const top={};paid.forEach(o=>(o.order_items||[]).forEach(i=>top[i.item_name]=(top[i.item_name]||0)+Number(i.qty||0)));

 const hourly=Array.from({length:24},(_,h)=>({hour:h,label:`${String(h).padStart(2,'0')}:00`,sales:0,orders:0}));
 paid.forEach(o=>{const d=new Date(o.paid_at||o.created_at),h=d.getHours();hourly[h].sales+=total(o);hourly[h].orders++});
 const activeHours=hourly.filter(x=>x.sales>0),maxHour=Math.max(1,...activeHours.map(x=>x.sales));
 const bestHour=activeHours.slice().sort((a,b)=>b.sales-a.sales)[0];

 const endDate=new Date(`${to||today()}T12:00:00`),week=[];
 for(let i=6;i>=0;i--){const d=new Date(endDate);d.setDate(endDate.getDate()-i);const key=dateKey(d);const rows=orders.filter(o=>o.status==='PAID'&&(o.paid_at||o.created_at||'').slice(0,10)===key);week.push({date:key,sales:rows.reduce((s,o)=>s+total(o),0),orders:rows.length})}
 const maxDay=Math.max(1,...week.map(x=>x.sales)),bestDay=week.slice().sort((a,b)=>b.sales-a.sales)[0];

 return <><Title t="Sales Analytics" s="Sales trends by date, time of day and last 7 days"/><DateRange from={from} to={to} setFrom={setFrom} setTo={setTo}/><div className="exportBar"><button className="primary compactBtn" onClick={()=>exportSales(paid,'CSV')}>⬇ CSV</button><button className="primary compactBtn" onClick={()=>exportSales(paid,'XLSX')}>⬇ Excel</button></div>
  <div className="stats"><Stat n="Sales" v={money(sales)}/><Stat n="Cash" v={money(cash)}/><Stat n="Online" v={money(online)}/><Stat n="Expenses" v={money(cost)}/><Stat n="Net" v={money(sales-cost)}/><Stat n="Paid Bills" v={paid.length}/></div>
  <div className="insightGrid"><div className="insightCard"><span>Best sales time</span><b>{bestHour?bestHour.label:'—'}</b><small>{bestHour?`${money(bestHour.sales)} from ${bestHour.orders} orders`:'No sales in selected range'}</small></div><div className="insightCard"><span>Best day — last 7 days</span><b>{bestDay&&bestDay.sales?fmtDate(bestDay.date):'—'}</b><small>{bestDay&&bestDay.sales?`${money(bestDay.sales)} from ${bestDay.orders} orders`:'No paid sales in last 7 days'}</small></div></div>
  <Panel t="Sales by Time of Day">{activeHours.length===0?<div className="empty">No paid sales for this range.</div>:<div className="trendBars">{activeHours.map(x=><div className="trendRow" key={x.hour}><span>{x.label}</span><div className="trendTrack"><i style={{width:`${Math.max(3,x.sales/maxHour*100)}%`}}/></div><b>{money(x.sales)}</b><small>{x.orders} orders</small></div>)}</div>}</Panel>
  <Panel t="Last 7 Days Performance"><div className="trendBars">{week.map(x=><div className={`trendRow ${bestDay?.date===x.date&&x.sales>0?'best':''}`} key={x.date}><span>{fmtDate(x.date)}</span><div className="trendTrack"><i style={{width:`${x.sales?Math.max(3,x.sales/maxDay*100):0}%`}}/></div><b>{money(x.sales)}</b><small>{x.orders} orders</small></div>)}</div></Panel>
  <Panel t="Sales by Date">{Object.entries(paid.reduce((a,o)=>{const d=(o.paid_at||o.created_at).slice(0,10);a[d]=(a[d]||0)+total(o);return a},{})).sort().reverse().map(([d,v])=><div className="rank" key={d}><b>{fmtDate(d)}</b><strong>{money(v)}</strong></div>)}</Panel>
  <Panel t="Top Selling Items">{Object.entries(top).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([n,q],i)=><div className="rank" key={n}><span>#{i+1}</span><b>{n}</b><strong>{q} sold</strong></div>)}</Panel>
 </>;
}

function TableSimple({heads,rows}){return <div className="tablewrap"><table><thead><tr>{heads.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((x,j)=><td key={j}>{x}</td>)}</tr>)}</tbody></table></div>}

createRoot(document.getElementById('root')).render(<App/>);


function SalesAnalytics({orders}){
 const [from,setFrom]=useState('');
 const [to,setTo]=useState('');
 const paid=orders.filter(o=>o.status==='PAID');
 const filtered=paid.filter(o=>{
   const d=o.paid_at||o.created_at;
   const day=d?d.slice(0,10):'';
   return (!from||day>=from)&&(!to||day<=to);
 });
 const cash=filtered.filter(o=>o.payment_method==='CASH').reduce((s,o)=>s+Number(o.total||0),0);
 const online=filtered.filter(o=>o.payment_method==='ONLINE').reduce((s,o)=>s+Number(o.total||0),0);
 const total=cash+online;
 return <div>
   <Title t="Sales Analytics" s="Track sales by date and payment method"/>
   <div className="filterRow">
    <label>From <input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
    <label>To <input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
   </div>
   <div className="statsGrid">
    <div className="stat"><b>{money(total)}</b><span>Total Sales</span></div>
    <div className="stat"><b>{money(cash)}</b><span>💵 Cash</span></div>
    <div className="stat"><b>{money(online)}</b><span>📱 Online</span></div>
    <div className="stat"><b>{filtered.length}</b><span>Paid Bills</span></div>
   </div>
   <div className="card">
    <h3>Paid Bills</h3>
    {filtered.sort((a,b)=>new Date(b.paid_at||b.created_at)-new Date(a.paid_at||a.created_at)).map(o=>
      <div className="listRow" key={o.id}>
       <span>Table {o.table_no}<small>{fmtDateTime(o.paid_at||o.created_at)}</small></span>
       <span>{paymentBadge(o.payment_method)} · <b>{money(o.total)}</b></span>
      </div>
    )}
   </div>
 </div>
}
