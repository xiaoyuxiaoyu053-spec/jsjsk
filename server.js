const express=require("express");
const http=require("http");
const WebSocket=require("ws");
const crypto=require("crypto");

const app=express();
const server=http.createServer(app);
const wss=new WebSocket.Server({server});
app.use(express.static("public"));

const rooms=new Map();
const MAX=6;

function send(ws,m){if(ws.readyState===1)ws.send(JSON.stringify(m))}
function broadcast(room,m){for(const p of room.players.values())send(p.ws,m)}
function list(room){
 return [...room.players.values()].map(p=>({
  id:p.id,name:p.name,character:p.character,ready:p.ready,host:p.host,
  x:p.x,y:p.y,z:p.z,yaw:p.yaw,pitch:p.pitch,role:p.role,alive:p.alive,transformed:!!p.transformed
 }));
}
function newRoom(){
 let code;
 do code=Math.random().toString(36).slice(2,8).toUpperCase(); while(rooms.has(code));
 const r={code,players:new Map(),started:false,keys:0,doorOpen:false};
 rooms.set(code,r); return r;
}
function findRoom(code){
 if(code&&rooms.has(code)) return rooms.get(code);
 for(const r of rooms.values()) if(!r.started&&r.players.size<MAX) return r;
 return newRoom();
}
function start(room){
 if(room.started||room.players.size<2)return;
 room.started=true;
 const ps=[...room.players.values()];
 const n=ps[Math.floor(Math.random()*ps.length)];
 ps.forEach(p=>{
  p.role=p===n?"neighbor":"explorer";
  p.alive=true;p.ready=true;
  p.x=p.role==="neighbor"?8:0;p.y=1.7;p.z=p.role==="neighbor"?7:9;
  p.yaw=0;p.pitch=0;
 });
 broadcast(room,{type:"gameStart",room:room.code,players:list(room)});
}

wss.on("connection",ws=>{
 const p={ws,id:crypto.randomUUID(),name:"Player",character:"Scout",ready:false,host:false,
  room:null,x:0,y:1.7,z:9,yaw:0,pitch:0,role:"explorer",alive:true};

 send(ws,{type:"welcome",id:p.id});

 ws.on("message",raw=>{
  let m;try{m=JSON.parse(raw)}catch{return}

  if(m.type==="join"){
   if(p.room)return;
   const r=findRoom(String(m.room||"").trim().toUpperCase());
   if(r.started||r.players.size>=MAX){send(ws,{type:"error",message:"房间已满或游戏已开始"});return}
   p.name=String(m.name||"Player").slice(0,18);
   p.character=String(m.character||"Scout").slice(0,18);
   p.room=r;p.host=r.players.size===0;
   r.players.set(p.id,p);
   send(ws,{type:"joined",id:p.id,room:r.code,host:p.host,players:list(r)});
   broadcast(r,{type:"lobby",players:list(r)});
   return;
  }

  if(!p.room)return;
  const r=p.room;

  if(m.type==="character"){
   p.character=String(m.character||"Scout").slice(0,18);
   broadcast(r,{type:"lobby",players:list(r)});
  }

  if(m.type==="ready"){
   p.ready=!p.ready;
   broadcast(r,{type:"lobby",players:list(r)});
  }

  if(m.type==="start"){
   if(!p.host)return;
   const all=[...r.players.values()];
   if(all.length>=2&&all.every(x=>x.ready))start(r);
   else send(ws,{type:"error",message:"至少2人且所有玩家都要准备"});
  }

  if(m.type==="state"){
   if(!r.started||!p.alive)return;
   p.x=Number(m.x)||0;p.y=Number(m.y)||1.7;p.z=Number(m.z)||0;
   p.yaw=Number(m.yaw)||0;p.pitch=Number(m.pitch)||0;
   broadcast(r,{type:"state",player:{id:p.id,x:p.x,y:p.y,z:p.z,yaw:p.yaw,pitch:p.pitch,character:p.character,role:p.role,alive:p.alive,transformed:!!p.transformed}});
  }

  if(m.type==="key"){
   if(!r.started||p.role!=="explorer")return;
   r.keys=Math.min(3,r.keys+1);
   if(r.keys>=3)r.doorOpen=true;
   broadcast(r,{type:"world",keys:r.keys,doorOpen:r.doorOpen});
  }

  if(m.type==="transform"){
   if(!r.started||p.role!=="neighbor"||!p.alive)return;
   p.transformed=!p.transformed;
   broadcast(r,{type:"transform",id:p.id,transformed:p.transformed});
  }

  if(m.type==="capture"){
   if(!r.started||p.role!=="neighbor"||!p.alive)return;
   const t=r.players.get(String(m.target));
   if(t&&t.role==="explorer"&&t.alive){
    t.alive=false;
    broadcast(r,{type:"captured",id:t.id,by:p.id});
   }
  }

  if(m.type==="win"){
   if(r.started&&r.doorOpen&&p.role==="explorer")
    broadcast(r,{type:"win",id:p.id,name:p.name});
  }
  if(m.type==="voice"){
   const target=r.players.get(String(m.to));
   if(target) send(target.ws,{type:"voice",from:p.id,kind:m.kind,data:m.data});
  }
 });

 ws.on("close",()=>{
  if(!p.room)return;
  const r=p.room;r.players.delete(p.id);
  if(r.players.size){
   const first=[...r.players.values()][0];
   for(const x of r.players.values())x.host=x.id===first.id;
   broadcast(r,{type:"lobby",players:list(r)});
  }else rooms.delete(r.code);
 });
});

app.get("/health",(req,res)=>res.json({ok:true,rooms:rooms.size}));
server.listen(process.env.PORT||10000,"0.0.0.0");
