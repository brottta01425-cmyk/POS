import React,{useEffect,useMemo,useState} from 'react';
import{createRoot}from'react-dom/client';
import{supabase}from'./supabase';
import * as XLSX from 'xlsx';
import'./styles.css';

const ROLES={admin:'Admin',waiter:'Waiter',chef:'Chef',cashier:'Cashier'};
const TABLES=Array.from({length:20},(_,i)=>i+1);
const STATUS={NEW:'New',PREPARING:'Preparing',READY:'Ready',SERVED:'Served',BILL_REQUESTED:'Bill Ready',PAID:'Paid',CANCELLED:'Cancelled'};
const ITEM_STATUS={NEW:'Pending',PREPARING:'Preparing',READY:'Ready',SERVED:'Served',CANCELLED:'Cancelled'};
const beep=()=>{try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;const c=new C(),o=c.createOscillator(),g=c.createGain();o.frequency.value=880;o.type='sine';g.gain.setValueAtTime(.0001,c.currentTime);g.gain.exponentialRampToValueAtTime(.18,c.currentTime+.01);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+.28);o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+.3)}catch{}};

function fmtDateTime(v){return v?new Date(v).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):''}
function fmtDate(v){return v?new Date(v).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):''}
function paymentBadge(m){return m==='CASH'?'💵 CASH':m==='ONLINE'?'📱 ONLINE':'—'}
const money=v=>'₹'+Number(v||0).toLocaleString('en-IN',{maximumFractionDigits:2});
const today=()=>new Date().toISOString().slice(0,10);
const dt=v=>v?new Date(v).toLocaleString('en-IN',{dateStyle:'short',timeStyle:'short'}):'-';
const total=o=>Number(o?.total||0);

function App(){
 const[session,setSession]=useState(null),[profile,setProfile]=useState(null),[loading,setLoading]=useState(true),[page,setPage]=useState('dashboard'),[msg,setMsg]=useState('');
 const[orders,setOrders]=useState([]),[menu,setMenu]=useState([]),[employees,setEmployees]=useState([]),[attendance,setAttendance]=useState([]),[expenses,setExpenses]=useState([]),[salaryPayments,setSalaryPayments]=useState([]),[advances,setAdvances]=useState([]);
 const[table,setTable]=useState(null),[chairs,setChairs]=useState([]),[cart,setCart]=useState([]),[loginRole,setLoginRole]=useState('waiter'),[tableResetNotice,setTableResetNotice]=useState('');
 const previousOrderIds=React.useRef(new Set()),previousItemStates=React.useRef(new Map()),liveReady=React.useRef(false);
 const[dark,setDark]=useState(()=>localStorage.getItem('brottta-theme')==='dark');
 const role=profile?.role;
 const nav=useMemo(()=>role==='waiter'?[['pos','Take Order'],['ready','Ready Orders'],['orders','Table History']]:role==='chef'?[['kitchen','Kitchen'],['orders','Orders']]:role==='cashier'?[['billing','Bills'],['orders','Orders'],['analytics','Sales']]:[['dashboard','Dashboard'],['pos','Take Order'],['kitchen','Kitchen'],['billing','Bills'],['orders','Table History'],['menu','Food Items'],['employees','Employees'],['attendance','Attendance'],['expenses','Expenses'],['analytics','Analytics']],[role]);
 useEffect(()=>{document.documentElement.dataset.theme=dark?'dark':'light';localStorage.setItem('brottta-theme',dark?'dark':'light')},[dark]);

 useEffect(()=>{let live=true;
   supabase.auth.getSession().then(async({data})=>{if(!live)return;if(data.session){setSession(data.session);await getProfile(data.session.user.id)}setLoading(false)});
   const{data:l}=supabase.auth.onAuthStateChange(async(_,s)=>{setSession(s);if(s)await getProfile(s.user.id);else setProfile(null)});
   return()=>{live=false;l.subscription.unsubscribe()}
 },[]);

 useEffect(()=>{if(session&&profile)loadAll()},[session,profile]);
 useEffect(()=>{if(!session)return;
   const handle=payload=>{
     const isInsert=payload.eventType==='INSERT';
     const n=payload.new||{};
     if(role==='chef'&&isInsert&&payload.table==='orders')beep();
     if(role==='waiter'&&payload.table==='order_items'&&payload.eventType==='UPDATE'&&n.status==='READY')beep();
     loadOrders();
   };
   const c=supabase.channel('brottta-live')
    .on('postgres_changes',{event:'*',schema:'public',table:'orders'},handle)
    .on('postgres_changes',{event:'*',schema:'public',table:'order_items'},handle)
    .on('postgres_changes',{event:'*',schema:'public',table:'table_sessions'},handle)
    .subscribe();
   const timer=setInterval(loadOrders,5000);
   return()=>{clearInterval(timer);supabase.removeChannel(c)}
 },[session,role]);

 async function getProfile(id){
   const{data,error}=await supabase.from('profiles').select('*').eq('id',id).single();
   if(error||!data){setMsg('No staff profile found for this login.');await supabase.auth.signOut();return}
   if(data.active===false){setMsg('This staff account is inactive.');await supabase.auth.signOut();return}
   setProfile(data);setPage(data.role==='waiter'?'pos':data.role==='chef'?'kitchen':data.role==='cashier'?'billing':'dashboard')
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
 async function closeTable(tableNo){
   const open=orders.filter(o=>Number(o.table_no)===Number(tableNo)&&o.status!=='PAID'&&o.status!=='CANCELLED');
   if(!open.length)return setMsg('No open orders for this table.');
   const sessionId=open[0].session_id;
   const combined=open.reduce((s,o)=>s+total(o),0);
   const{error}=await supabase.from('table_sessions').update({status:'CLOSED',closed_at:new Date().toISOString(),closed_by:session.user.id,total:combined}).eq('id',sessionId);
   if(error){setMsg(error.message);return}
   const{error:e}=await supabase.from('orders').update({status:'BILL_REQUESTED'}).eq('session_id',sessionId).neq('status','PAID');
   if(e){setMsg(e.message);return}
   await loadOrders();
   setMsg(`Table ${tableNo} closed. Bill ${money(combined)} sent to cashier.`)
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
   await syncOrderStatus(item.order_id);await loadOrders();
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
 async function payTable(sessionId){
   const group=orders.filter(o=>o.session_id===sessionId&&o.status!=='PAID'&&o.status!=='CANCELLED');
   if(!group.length)return;
   const amount=group.reduce((s,o)=>s+total(o),0);
   const{error}=await supabase.from('orders').update({status:'PAID',paid_at:new Date().toISOString()}).eq('session_id',sessionId).neq('status','PAID');
   if(error){setMsg(error.message);return}
   const{error:e}=await supabase.from('table_sessions').update({status:'PAID',paid_at:new Date().toISOString()}).eq('id',sessionId);
   if(e){setMsg(e.message);return}
   await loadOrders();
   setTableResetNotice(`Table ${group[0].table_no} is now reset and available for a new order.`);
   setMsg(`Table ${group[0].table_no} paid. Bill total ${money(amount)}. The table is now available again.`)
 }
 function addItem(i){setCart(c=>{const x=c.find(a=>a.id===i.id);return x?c.map(a=>a.id===i.id?{...a,qty:a.qty+1}:a):[...c,{...i,qty:1}]})}
 function qty(id,n){setCart(c=>c.map(x=>x.id===id?{...x,qty:x.qty+n}:x).filter(x=>x.qty>0))}
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
 async function paySalary(e,periodStart,periodEnd,allowance,incentive,personalExpense,advanceDeduction){
   const days=attendance.filter(a=>a.employee_id===e.id&&a.status==='PRESENT'&&a.attendance_date>=periodStart&&a.attendance_date<=periodEnd).length;
   const base=days*Number(e.per_day_salary||0);
   const gross=base+Number(allowance||0)+Number(incentive||0)-Number(personalExpense||0);
   const maxAdvance=Number(e.advance_balance||0);
   const deduction=Math.min(Math.max(Number(advanceDeduction||0),0),maxAdvance);
   const net=Math.max(gross-deduction,0);
   const{error}=await supabase.from('salary_payments').insert({employee_id:e.id,payment_type:e.payment_type||'WEEKLY',period_start:periodStart,period_end:periodEnd,present_days:days,base_salary:base,allowance:Number(allowance||0),incentive:Number(incentive||0),personal_expense:Number(personalExpense||0),advance_deduction:deduction,gross_salary:gross,net_salary:net,status:'PAID',paid_at:new Date().toISOString()});
   if(error){setMsg(error.message);return}
   if(deduction>0){
     let remaining=deduction;
     const rows=advances.filter(a=>a.employee_id===e.id&&Number(a.remaining_amount)>0).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
     for(const a of rows){const d=Math.min(remaining,Number(a.remaining_amount));await supabase.from('employee_advances').update({remaining_amount:Number(a.remaining_amount)-d}).eq('id',a.id);remaining-=d;if(remaining<=0)break}
     await supabase.from('employees').update({advance_balance:maxAdvance-deduction}).eq('id',e.id);
   }
   await Promise.all([loadEmployees(),loadSalaryPayments(),loadAdvances()]);
   setMsg(`${e.name}: salary ${money(net)} marked as paid.`);
 }
 async function addExpense(){const description=prompt('Expense description');if(!description)return;const amount=Number(prompt('Amount'));if(!amount)return;const{error}=await supabase.from('expenses').insert({description,amount});if(error)setMsg(error.message);else loadExpenses()}

 if(loading)return <div className="splash">Loading Brottta POS...</div>;
 if(!session||!profile)return <Login role={loginRole} setRole={setLoginRole} login={login} msg={msg}/>;
 return <div className="app">
   <header><b>🍽️ BROTTTA <small>Restaurant POS</small></b><div><button className="themeBtn" onClick={()=>setDark(x=>!x)}>{dark?'☀️ Light':'🌙 Dark'}</button><span className="pill">{ROLES[role]}</span> {profile.full_name||session.user.email} <button className="ghost" onClick={()=>supabase.auth.signOut()}>Logout</button></div></header>
   <div className="layout"><aside>{nav.map(([id,n])=><button key={id} className={page===id?'active':''} onClick={()=>setPage(id)}>{n}</button>)}</aside>
   <main>{msg&&<div className="toast">{msg}<button onClick={()=>setMsg('')}>×</button></div>}
     {page==='dashboard'&&<Dashboard orders={orders} menu={menu} employees={employees}/>}
     {page==='pos'&&<POS menu={menu} table={table} setTable={setTable} chairs={chairs} setChairs={setChairs} cart={cart} addItem={addItem} qty={qty} createOrder={createOrder} orders={orders} closeTable={closeTable} resetNotice={tableResetNotice} deleteItem={deleteOrderItem} updateItem={updateItemStatus}/>}
     {page==='ready'&&<Ready orders={orders} update={updateStatus} updateItem={updateItemStatus}/>}
     {page==='kitchen'&&<Kitchen orders={orders} update={updateStatus} updateItem={updateItemStatus}/>}
     {page==='billing'&&<Billing orders={orders} pay={payTable}/>}
     {page==='orders'&&<TableHistory orders={orders} update={updateStatus} pay={payTable} role={role} updateItem={updateItemStatus} deleteItem={deleteOrderItem}/>}
     {page==='menu'&&<Menu menu={menu} save={saveMenu} del={deleteMenu}/>}
     {page==='employees'&&<Employees data={employees} add={addEmployee} update={updateEmployeePay} addAdvance={addAdvance} advances={advances} payments={salaryPayments} attendance={attendance} paySalary={paySalary}/>}
     {page==='attendance'&&<Attendance data={employees} records={attendance} mark={markAttendance}/>}
     {page==='expenses'&&<Expenses data={expenses} add={addExpense}/>}
     {page==='analytics'&&<Analytics orders={orders} expenses={expenses}/>}
   </main></div></div>
}

function Login({role,setRole,login,msg}){const[e,setE]=useState(''),[p,setP]=useState('');return <div className="login"><div className="loginbox"><div className="logo">🍽️</div><h1>Brottta POS</h1><p>Restaurant Management System</p><div className="roles">{Object.entries(ROLES).map(([k,v])=><button className={role===k?'sel':''} onClick={()=>setRole(k)} key={k}>{v}</button>)}</div><label>Email</label><input value={e} onChange={x=>setE(x.target.value)}/><label>Password</label><input type="password" value={p} onChange={x=>setP(x.target.value)}/><button className="primary full" onClick={()=>login(e,p,role)}>Login as {ROLES[role]}</button>{msg&&<div className="error">{msg}</div>}</div></div>}

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
 const sales=paid.reduce((s,o)=>s+total(o),0),cash=paid.filter(o=>o.payment_method==='CASH').reduce((s,o)=>s+total(o),0),online=paid.filter(o=>o.payment_method==='ONLINE').reduce((s,o)=>s+total(o),0);
 const top={};paid.forEach(o=>(o.order_items||[]).forEach(i=>{top[i.item_name]=(top[i.item_name]||0)+Number(i.qty||0)}));
 return <><Title t="Dashboard" s="Select a date or date range to track restaurant performance"/><DateRange from={from} to={to} setFrom={setFrom} setTo={setTo}/><div className="stats"><Stat n="Sales" v={money(sales)}/><Stat n="Cash" v={money(cash)}/><Stat n="Online" v={money(online)}/><Stat n="Paid Bills" v={paid.length}/><Stat n="Food Items" v={menu.length}/><Stat n="Employees" v={employees.length}/></div><Panel t="Top Selling Items">{Object.entries(top).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([n,q],i)=><div className="rank" key={n}><span>#{i+1}</span><b>{n}</b><strong>{q} sold</strong></div>)}</Panel></>
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
 return <Panel t={`TABLE ${table} — OPEN HISTORY`}>
   {orders.length===0?<div className="empty">No previous orders for this table.</div>:orders.map((o,i)=><div className="ticket" key={o.id}><div className="ticketHead"><b>Order #{i+1}</b><span>{seatLabel(o)}</span><span className={`status ${String(o.status).toLowerCase()}`}>{STATUS[o.status]}</span><small>{dt(o.created_at)}</small></div>{(o.order_items||[]).map(it=><ItemRow key={it.id} item={it} canDelete={!['BILL_REQUESTED','PAID','CANCELLED'].includes(o.status)} onDelete={deleteItem}/>) }<div className="ticketTotal">{money(total(o))}</div></div>)}
   <div className="grand"><span>TABLE TOTAL</span><b>{money(grand)}</b></div>
   {orders.length>0&&<button className="bill fullBtn" onClick={()=>closeTable(table)}>🧾 CLOSE TABLE & SEND BILL TO CASHIER</button>}
 </Panel>
}

function Ready({orders,update,updateItem}){const x=orders.filter(o=>o.status==='READY'||(o.order_items||[]).some(i=>i.status==='READY'));return <><Title t="🔔 Ready to Serve" s="Green = served/ready, red = not yet served"/><div className="cards">{x.length===0&&<div className="empty panel">No ready items.</div>}{x.map(o=><div className="card" key={o.id}><div className="cardhead"><h2>TABLE {o.table_no}</h2><span>{seatLabel(o)}</span></div>{(o.order_items||[]).map(i=><ItemRow key={i.id} item={i} canServe={i.status==='READY'} onServe={updateItem}/>)}</div>)}</div></>}

function Kitchen({orders,updateItem}){const x=orders.filter(o=>!['SERVED','PAID','CANCELLED','BILL_REQUESTED'].includes(o.status));return <><Title t="Kitchen" s="Update each food item independently. New tickets trigger a sound."/><div className="cards">{x.length===0&&<div className="empty panel">No pending items.</div>}{x.map(o=><div className="card" key={o.id}><div className="cardhead"><h2>TABLE {o.table_no}</h2><span>{seatLabel(o)}</span></div><small>{dt(o.created_at)}</small>{(o.order_items||[]).map(i=><div className="kitchenItem" key={i.id}><div><b>{i.qty} × {i.item_name}</b><small>{ITEM_STATUS[i.status||'NEW']}</small></div><div className="actions mini">{(i.status||'NEW')==='NEW'&&<><button className="primary" onClick={()=>updateItem(i.id,'PREPARING')}>Preparing</button><button className="success" onClick={()=>updateItem(i.id,'READY')}>✓ Ready Now</button></>}{i.status==='PREPARING'&&<button className="success" onClick={()=>updateItem(i.id,'READY')}>✓ Ready</button>}{i.status==='READY'&&<button className="success" onClick={()=>updateItem(i.id,'SERVED')}>✓ Served</button>}</div></div>)}</div>)}</div></>}

function Billing({orders,pay}){
 const groups=Object.values(orders.filter(o=>o.status==='BILL_REQUESTED').reduce((a,o)=>{(a[o.session_id]??=[]).push(o);return a},{}));
 return <><Title t="Billing" s="Closed tables waiting for payment"/><div className="cards">{groups.length===0&&<div className="empty panel">No bills waiting. When a waiter closes a table, the complete bill appears here.</div>}{groups.map(g=>{const grand=g.reduce((s,o)=>s+total(o),0);return <div className="card" key={g[0].session_id}><div className="cardhead"><h2>TABLE {g[0].table_no}</h2><span className="status">BILL READY</span></div>{g.map((o,i)=><div className="ticket" key={o.id}><b>Order #{i+1}</b>{(o.order_items||[]).map(i=><div className="line" key={i.id}><span>{i.item_name} × {i.qty}</span><b>{money(i.line_total)}</b></div>)}</div>)}<div className="grand"><span>TOTAL BILL</span><b>{money(grand)}</b></div><button className="success full" onClick={()=>pay(g[0].session_id)}>✓ COLLECT PAYMENT — {money(grand)}</button></div>})}</div></>
}

function TableHistory({orders,pay,role,updateItem,deleteItem}){
 const active=orders.filter(o=>!['PAID','CANCELLED'].includes(o.status));
 const groups=Object.values(active.reduce((a,o)=>{const k=o.session_id||`single-${o.id}`;(a[k]??=[]).push(o);return a},{}));
 return <><Title t="Table History" s="Open tables stay visible until billed. Green items are served; red items are pending."/><div className="cards">{groups.length===0&&<div className="empty panel">No open table orders.</div>}{groups.map(g=>{const grand=g.reduce((s,o)=>s+total(o),0);return <div className="card" key={g[0].session_id||g[0].id}><div className="cardhead"><h2>TABLE {g[0].table_no}</h2><span className="status">{g.every(o=>o.status==='SERVED')?'ALL SERVED':'OPEN'}</span></div>{g.map((o,i)=><div className="ticket" key={o.id}><div className="ticketHead"><b>Order #{i+1}</b><span>{seatLabel(o)}</span><small>{dt(o.created_at)}</small></div>{(o.order_items||[]).map(it=><ItemRow key={it.id} item={it} canServe={role==='waiter'&&it.status==='READY'} onServe={updateItem} canDelete={role==='waiter'&&!['BILL_REQUESTED','PAID','CANCELLED'].includes(o.status)} onDelete={deleteItem}/>)}</div>)}<div className="grand"><span>OPEN TABLE TOTAL</span><b>{money(grand)}</b></div>{role==='waiter'&&<small className="hint">Add another ticket anytime. Close the table only when the customer is done.</small>}{role==='cashier'&&g.every(o=>o.status==='BILL_REQUESTED')&&<button className="success full" onClick={()=>pay(g[0].session_id)}>COLLECT {money(grand)}</button>}</div>})}</div></>
}

function SimpleOrders({orders}){return <div className="tablewrap"><table><thead><tr><th>Table</th><th>Items</th><th>Total</th><th>Status</th><th>Time</th></tr></thead><tbody>{orders.map(o=><tr key={o.id}><td>Table {o.table_no}</td><td>{(o.order_items||[]).map(i=>`${i.item_name} ×${i.qty}`).join(', ')}</td><td>{money(total(o))}</td><td><span className="status">{STATUS[o.status]}</span></td><td>{dt(o.created_at)}</td></tr>)}</tbody></table></div>}

function Menu({menu,save,del}){
 const [open,setOpen]=useState(false);
 const [editing,setEditing]=useState(null);
 const blank={name:'',category:'Other',price:'',cost_price:'',available:true};
 const startEdit=(item=null)=>{setEditing(item?{...item}:{...blank});setOpen(true)};
 const submit=async()=>{if(!editing)return;await save(editing);setOpen(false);setEditing(null)};
 return <>
  <Title t="Food Items" s="Add, edit, enable/disable or delete menu items">
   <button className="primary" onClick={()=>startEdit()}>+ Add Food</button>
  </Title>
  <Panel>
   <div className="tablewrap">
    <table>
     <thead><tr><th>Food</th><th>Category</th><th>Price</th><th>Cost</th><th>Available</th><th>Actions</th></tr></thead>
     <tbody>
      {menu.map(i=><tr key={i.id}>
       <td>{i.name}</td><td>{i.category}</td><td>{money(i.price)}</td><td>{money(i.cost_price)}</td><td>{i.available?'Yes':'No'}</td>
       <td>
        <button className="small" onClick={()=>startEdit(i)}>Edit</button>
        <button className="small" onClick={()=>save({...i,available:!i.available})}>{i.available?'Disable':'Enable'}</button>
        <button className="small dangerText" onClick={()=>del(i.id)}>Delete</button>
       </td>
      </tr>)}
     </tbody>
    </table>
   </div>
  </Panel>
  {open && <div className="drawerBackdrop" onClick={()=>setOpen(false)}>
   <aside className="drawer" onClick={e=>e.stopPropagation()}>
    <div className="drawerHead"><h2>{editing?.id?'Edit Food Item':'Add Food Item'}</h2><button onClick={()=>setOpen(false)}>×</button></div>
    <label>Food name<input value={editing?.name||''} onChange={e=>setEditing({...editing,name:e.target.value})}/></label>
    <label>Category<input value={editing?.category||''} onChange={e=>setEditing({...editing,category:e.target.value})}/></label>
    <label>Selling price<input type="number" value={editing?.price??''} onChange={e=>setEditing({...editing,price:e.target.value})}/></label>
    <label>Cost price<input type="number" value={editing?.cost_price??''} onChange={e=>setEditing({...editing,cost_price:e.target.value})}/></label>
    <label className="check"><input type="checkbox" checked={editing?.available!==false} onChange={e=>setEditing({...editing,available:e.target.checked})}/> Available for ordering</label>
    <button className="primary full" onClick={submit}>{editing?.id?'Save Changes':'Add Food Item'}</button>
    {editing?.id && <button className="danger full" onClick={async()=>{await del(editing.id);setOpen(false);setEditing(null)}}>Delete Item</button>}
   </aside>
  </div>}
 </>;
}

function Employees({data,add,update,addAdvance,advances,payments,attendance,paySalary}){
 const [selected,setSelected]=useState(null),[openPay,setOpenPay]=useState(null),[openAdv,setOpenAdv]=useState(null);
 const [from,setFrom]=useState(''),[to,setTo]=useState('');
 const [allowance,setAllowance]=useState(0),[incentive,setIncentive]=useState(0),[personalExpense,setPersonalExpense]=useState(0),[deduction,setDeduction]=useState(0);
 const [salaryPaid,setSalaryPaid]=useState(false);
 const saveSettings=async(e)=>{await update(e,{payment_type:e._payment_type||e.payment_type||'WEEKLY',per_day_salary:Number(e._per_day_salary??e.per_day_salary??0)})};
 const calcDays=e=>attendance.filter(a=>a.employee_id===e.id&&a.status==='PRESENT'&&a.attendance_date>=from&&a.attendance_date<=to).length;
 const period=()=>{
   const now=new Date(), y=now.getFullYear(),m=now.getMonth(),d=now.getDate();
   if(!from||!to)return;
   return `${from} → ${to}`;
 };
 const payDays=openPay&&from&&to?calcDays(openPay):0;
 const payBase=openPay?payDays*Number(openPay.per_day_salary||0):0;
 const payGross=payBase+Number(allowance||0)+Number(incentive||0)-Number(personalExpense||0);
 const payAdvance=Math.min(Number(deduction||0),Number(openPay?.advance_balance||0));
 const payNet=Math.max(payGross-payAdvance,0);
 const payRemaining=Math.max(Number(openPay?.advance_balance||0)-payAdvance,0);
 return <><Title t="Employees" s="Payment settings, salary, advances and employee dashboard"><button className="primary" onClick={add}>+ Add Employee</button></Title>
 <Panel t="Employee Salary Dashboard"><div className="employeeSummaryGrid">{data.filter(e=>e.active!==false).map(e=>{const p=payments.filter(x=>x.employee_id===e.id);const week=p.filter(x=>x.payment_type==='WEEKLY').reduce((s,x)=>s+Number(x.net_salary||0),0);const month=p.filter(x=>x.payment_type==='MONTHLY').reduce((s,x)=>s+Number(x.net_salary||0),0);return <div className="card" key={e.id}><div><b>{e.name}</b> <span className="roleSpace">{e.role}</span></div><small>{e.payment_type||'WEEKLY'} · ₹{Number(e.per_day_salary||0).toLocaleString('en-IN')}/day</small><div className="salaryMini"><span>Weekly paid <b>{money(week)}</b></span><span>Monthly paid <b>{money(month)}</b></span><span>Pending lending <b>{money(e.advance_balance)}</b></span></div></div>})}</div></Panel>
 <Panel t="Employee Payment Settings"><div className="tablewrap"><table><thead><tr><th>Name</th><th>Role</th><th>Payment Type</th><th>Per Day Salary</th><th>Advance Balance</th><th>Actions</th></tr></thead><tbody>{data.map(e=><tr key={e.id}><td><b>{e.name}</b></td><td><span className="roleSpace">{e.role}</span></td><td><div className="payToggle"><button className={(e.payment_type||'WEEKLY')==='WEEKLY'?'on':''} onClick={()=>update(e,{payment_type:'WEEKLY'})}>Weekly</button><button className={(e.payment_type||'WEEKLY')==='MONTHLY'?'on':''} onClick={()=>update(e,{payment_type:'MONTHLY'})}>Monthly</button></div></td><td><input className="inlineInput" type="number" defaultValue={e.per_day_salary||0} onBlur={x=>update(e,{per_day_salary:Number(x.target.value||0)})}/></td><td>{money(e.advance_balance||0)}</td><td><button className="small" onClick={()=>setOpenAdv(e)}>+ Lending</button> <button className="small" onClick={()=>{setOpenPay(e);setFrom('');setTo('');setAllowance(0);setIncentive(0);setPersonalExpense(0);setDeduction(0)}}>Salary</button></td></tr>)}</tbody></table></div></Panel>
 <Panel t="Salary Payment History"><div className="tablewrap"><table><thead><tr><th>Employee</th><th>Period</th><th>Days</th><th>Gross</th><th>Advance Deducted</th><th>Net Salary</th><th>Status</th></tr></thead><tbody>{payments.map(p=>{const e=data.find(x=>x.id===p.employee_id);return <tr key={p.id}><td>{e?.name||'—'}</td><td>{fmtDate(p.period_start)} → {fmtDate(p.period_end)}</td><td>{p.present_days}</td><td>{money(p.gross_salary)}</td><td>{money(p.advance_deduction)}</td><td><b>{money(p.net_salary)}</b></td><td><span className="paidBadge">✓ SALARY PAID</span></td></tr>})}</tbody></table></div></Panel>
 {openAdv&&<div className="drawerBackdrop" onClick={()=>setOpenAdv(null)}><aside className="drawer" onClick={e=>e.stopPropagation()}><div className="drawerHead"><h2>Lending — {openAdv.name}</h2><button onClick={()=>setOpenAdv(null)}>×</button></div><p>Current pending lending: <b>{money(openAdv.advance_balance||0)}</b></p><label>Lending amount<input id="advanceAmount" type="number" min="0"/></label><label>Note<input id="advanceNote" placeholder="Reason / note"/></label><button className="primary full" onClick={async()=>{const a=Number(document.getElementById('advanceAmount').value||0);await addAdvance(openAdv,a,document.getElementById('advanceNote').value);setOpenAdv(null)}}>Add Lending</button></aside></div>}
 {openPay&&<div className="drawerBackdrop" onClick={()=>setOpenPay(null)}><aside className="drawer" onClick={e=>e.stopPropagation()}><div className="drawerHead"><h2>Salary — {openPay.name}</h2><button onClick={()=>setOpenPay(null)}>×</button></div><label>Period start<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Period end<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label><p>Present days: <b>{payDays}</b></p><p>Base salary: <b>{money(payBase)}</b></p><label>Allowance<input type="number" value={allowance} onChange={e=>setAllowance(e.target.value)}/></label><label>Incentive<input type="number" value={incentive} onChange={e=>setIncentive(e.target.value)}/></label><label>Personal Expense / Deduction<input type="number" value={personalExpense} onChange={e=>setPersonalExpense(e.target.value)}/></label><label>Advance Deduction<input type="number" max={openPay.advance_balance||0} value={deduction} onChange={e=>setDeduction(e.target.value)}/></label><div className="salaryCalc"><div>Gross: <b>{money(payGross)}</b></div><div>Remaining lending: <b>{money(payRemaining)}</b></div><div>Net salary: <b>{money(payNet)}</b></div></div><button className="success full" disabled={!from||!to} onClick={async()=>{await paySalary(openPay,from,to,allowance,incentive,personalExpense,deduction);setOpenPay(null)}}>✓ MARK SALARY PAID</button></aside></div>}
 </>}


function Attendance({data,records,mark}){
 const [from,setFrom]=useState(today()),[to,setTo]=useState(today());
 const days=records.filter(r=>r.attendance_date>=from&&r.attendance_date<=to);
 return <><Title t="Attendance" s="Select a date range and mark attendance for each day"/><DateRange from={from} to={to} setFrom={setFrom} setTo={setTo}/><Panel t={`Attendance: ${fmtDate(from)} ${from!==to?` → ${fmtDate(to)}`:''}`}><div className="attendanceGrid">{data.filter(x=>x.active!==false).map(e=>{const day=from===to?days.find(x=>x.employee_id===e.id&&x.attendance_date===from):null;const present=days.filter(x=>x.employee_id===e.id&&x.status==='PRESENT').length;const absent=days.filter(x=>x.employee_id===e.id&&x.status==='ABSENT').length;return <div className="card employeeAttend" key={e.id}><div><b>{e.name}</b> <span className="roleSpace">{e.role}</span></div><small>{from===to?`Status: ${day?.status||'Not marked'}`:`Present: ${present} · Absent: ${absent}`}</small>{from===to&&<div className="actions"><button className={day?.status==='PRESENT'?'success':'small'} onClick={()=>mark(e,'PRESENT',from)}>Present</button><button className={day?.status==='ABSENT'?'danger':'small'} onClick={()=>mark(e,'ABSENT',from)}>Absent</button></div>}</div>})}</div></Panel></>
}

function Expenses({data,add}){return <><Title t="Expenses" s="Track costs"><button className="primary" onClick={add}>+ Add Expense</button></Title><Panel><TableSimple heads={['Date','Description','Amount']} rows={data.map(x=>[x.expense_date,x.description,money(x.amount)])}/></Panel></>}
function exportSales(rows,type){
 const data=rows.map(o=>({Date:fmtDate(o.paid_at||o.created_at),Time:fmtDateTime(o.paid_at||o.created_at),Table:o.table_no,Total:Number(o.total||0),Payment:paymentBadge(o.payment_method).replace(/^[^ ]+ /,'')}));
 if(type==='CSV'){const keys=Object.keys(data[0]||{Date:'',Time:'',Table:'',Total:0,Payment:''});const esc=v=>`"${String(v??'').replace(/"/g,'""')}"`;const csv=[keys.join(','),...data.map(r=>keys.map(k=>esc(r[k])).join(','))].join('\\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=`brottta-sales-${today()}.csv`;a.click();return}
 const ws=XLSX.utils.json_to_sheet(data);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Sales');XLSX.writeFile(wb,`brottta-sales-${today()}.xlsx`);
}
function Analytics({orders,expenses}){
 const [from,setFrom]=useState(today()),[to,setTo]=useState(today());
 const paid=rangeFilterOrders(orders.filter(o=>o.status==='PAID'),from,to);
 const sales=paid.reduce((s,o)=>s+total(o),0),cost=expenses.filter(e=>e.expense_date>=from&&e.expense_date<=to).reduce((s,e)=>s+Number(e.amount||0),0),cash=paid.filter(o=>o.payment_method==='CASH').reduce((s,o)=>s+total(o),0),online=paid.filter(o=>o.payment_method==='ONLINE').reduce((s,o)=>s+total(o),0);
 const top={};paid.forEach(o=>(o.order_items||[]).forEach(i=>top[i.item_name]=(top[i.item_name]||0)+Number(i.qty||0)));
 return <><Title t="Sales Analytics" s="Filter sales by date range and export the results"/><DateRange from={from} to={to} setFrom={setFrom} setTo={setTo}/><div className="exportBar"><button className="primary" onClick={()=>exportSales(paid,'CSV')}>⬇ Export CSV</button><button className="primary" onClick={()=>exportSales(paid,'XLSX')}>⬇ Export Excel</button></div><div className="stats"><Stat n="Sales" v={money(sales)}/><Stat n="Cash" v={money(cash)}/><Stat n="Online" v={money(online)}/><Stat n="Expenses" v={money(cost)}/><Stat n="Net" v={money(sales-cost)}/><Stat n="Paid Bills" v={paid.length}/></div><Panel t="Sales by Date">{Object.entries(paid.reduce((a,o)=>{const d=(o.paid_at||o.created_at).slice(0,10);a[d]=(a[d]||0)+total(o);return a},{})).sort().reverse().map(([d,v])=><div className="rank" key={d}><b>{fmtDate(d)}</b><strong>{money(v)}</strong></div>)}</Panel><Panel t="Top Selling Items">{Object.entries(top).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([n,q],i)=><div className="rank" key={n}><span>#{i+1}</span><b>{n}</b><strong>{q} sold</strong></div>)}</Panel></>
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
