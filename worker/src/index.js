// Cloudflare Worker · 知间读书笔记 GitHub 写入代理
// Secrets: GITHUB_TOKEN, WRITE_PASSWORD
// Vars (optional): APP_ORIGIN=https://wongtszshan.github.io, REPO=wongtszshan/reading-notes, BRANCH=main
const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const reply=(obj,status=200,origin="*")=>new Response(JSON.stringify(obj),{status,headers:{...headers,"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,X-Write-Key,Authorization","Vary":"Origin"}});
function constantEqual(a,b){a=String(a||"");b=String(b||"");let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0}
function allowPath(path){return path==="data/books.json"||/^data\/books\/[a-zA-Z0-9-]{8,80}\/(?:book\.json|cover\.jpg|notes\/[a-zA-Z0-9-]{8,80}\.json)$/.test(path)}

// A signed 30-day bearer token. The existing WRITE_PASSWORD is the signing secret;
// changing that secret immediately invalidates all issued sessions.
const SESSION_SECONDS=30*24*60*60;
const encoder=new TextEncoder();
function b64url(bytes){let binary="";for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}
function decode64(s){let str=atob(s.replace(/-/g,"+").replace(/_/g,"/"));return Uint8Array.from(str,c=>c.charCodeAt(0))}
async function sign(key,data){const k=await crypto.subtle.importKey("raw",encoder.encode("reading-notes-session-v1:"+key),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return new Uint8Array(await crypto.subtle.sign("HMAC",k,encoder.encode(data)))}
async function issueToken(key,remember){const payload={v:1,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+(remember?SESSION_SECONDS:12*60*60),nonce:crypto.randomUUID()};const encoded=b64url(encoder.encode(JSON.stringify(payload)));return "v1."+encoded+"."+b64url(await sign(key,"v1."+encoded))}
async function verifyToken(key,token){if(!key||typeof token!=="string"||token.length>2048)return false;let parts=token.split(".");if(parts.length!==3||parts[0]!=="v1")return false;try{let payload=JSON.parse(new TextDecoder().decode(decode64(parts[1]))),now=Math.floor(Date.now()/1000);if(payload.v!==1||!Number.isInteger(payload.exp)||!Number.isInteger(payload.iat)||payload.iat>now+60||payload.exp<=now||payload.exp>payload.iat+SESSION_SECONDS)return false;let signature=decode64(parts[2]),actual=await sign(key,"v1."+parts[1]);if(signature.length!==actual.length)return false;let diff=0;for(let i=0;i<signature.length;i++)diff|=signature[i]^actual[i];return diff===0}catch{return false}}

export default {async fetch(request,env){
const origin=request.headers.get("Origin")||"", allowed=env.APP_ORIGIN||"https://wongtszshan.github.io";
if(origin&&origin!==allowed)return reply({error:"Origin not allowed"},403,allowed);
if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":allowed,"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,X-Write-Key,Authorization","Vary":"Origin"}});
const url=new URL(request.url),repo=env.REPO||"wongtszshan/reading-notes",branch=env.BRANCH||"main";
if(!env.GITHUB_TOKEN||!env.WRITE_PASSWORD)return reply({error:"Worker secrets not configured"},503,allowed);
if(url.pathname==="/health")return reply({ok:true},200,allowed);
if(url.pathname==="/auth/login"&&request.method==="POST"){
let input;try{input=await request.json()}catch{return reply({error:"Invalid JSON"},400,allowed)}
if(!constantEqual(input?.password,env.WRITE_PASSWORD))return reply({error:"写入口令不正确"},401,allowed);
const remember=input.remember===true;
return reply({ok:true,token:await issueToken(env.WRITE_PASSWORD,remember),expiresIn:remember?SESSION_SECONDS:43200},200,allowed);
}
const bearer=request.headers.get("Authorization")||"";
const authorized=bearer.startsWith("Bearer ")&&await verifyToken(env.WRITE_PASSWORD,bearer.slice(7));
if(url.pathname==="/auth/session")return reply({ok:authorized},authorized?200:401,allowed);
const gh=async(path,method="GET",body=null)=>{
const opts={method,headers:{"Authorization":"Bearer "+env.GITHUB_TOKEN,"Accept":"application/vnd.github+json","Content-Type":"application/json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"reading-notes-worker"}};
if(body)opts.body=JSON.stringify(body);
const r=await fetch("https://api.github.com/repos/"+repo+"/contents/"+path+(method==="GET"?"?ref="+encodeURIComponent(branch):""),opts);
const txt=await r.text();let json={};try{json=JSON.parse(txt)}catch{}
return {ok:r.ok,status:r.status,json};
};
if(url.pathname==="/file"&&request.method==="GET"){
const path=url.searchParams.get("path")||"";if(!allowPath(path))return reply({error:"Invalid path"},400,allowed);
const r=await gh(path);if(r.status===404)return reply({error:"Not found"},404,allowed);
if(!r.ok)return reply({error:"GitHub read failed "+r.status},502,allowed);
return reply({sha:r.json.sha,content:r.json.content,encoding:r.json.encoding},200,allowed);
}
if(!authorized)return reply({error:"登录已过期，请重新验证写入口令"},401,allowed);
if(!["/write","/delete"].includes(url.pathname)||request.method!=="POST")return reply({error:"Not found"},404,allowed);
let input;try{input=await request.json()}catch{return reply({error:"Invalid JSON"},400,allowed)}
const path=String(input.path||"");if(!allowPath(path))return reply({error:"Invalid path"},400,allowed);
if(url.pathname==="/write"){
if(typeof input.content!=="string"||input.content.length>1800000)return reply({error:"Invalid or oversized content"},400,allowed);
const current=await gh(path);
if(current.status!==404&&!current.ok)return reply({error:"Cannot verify existing file"},502,allowed);
const sha=current.ok?current.json.sha:null;
if((input.sha||null)!==(sha||null))return reply({error:"版本冲突：云端文件已变化，请刷新后重试"},409,allowed);
let encoded=input.content;if(input.encoding!=="base64"){const bytes=new TextEncoder().encode(input.content);let binary="";for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));encoded=btoa(binary);}
const out=await gh(path,"PUT",{message:"notes: update "+path,content:encoded,branch,...(sha?{sha}:{})});
if(!out.ok)return reply({error:"GitHub write failed "+out.status+": "+(out.json.message||"")},out.status===409?409:502,allowed);
return reply({ok:true,commitSha:out.json.commit?.sha,sha:out.json.content?.sha},200,allowed);
}
const current=await gh(path);if(!current.ok)return reply({error:"File not found or unavailable"},404,allowed);
if(input.sha!==current.json.sha)return reply({error:"版本冲突"},409,allowed);
const out=await gh(path,"DELETE",{message:"notes: delete "+path,sha:input.sha,branch});
if(!out.ok)return reply({error:"GitHub deletion failed"},502,allowed);
return reply({ok:true,commitSha:out.json.commit?.sha},200,allowed);
}};