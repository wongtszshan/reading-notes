// Cloudflare Worker · 知间读书笔记 GitHub 写入代理
// Secrets: GITHUB_TOKEN, WRITE_PASSWORD
// Vars (optional): APP_ORIGIN=https://wongtszshan.github.io, REPO=wongtszshan/reading-notes, BRANCH=main
const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const reply=(obj,status=200,origin="*")=>new Response(JSON.stringify(obj),{status,headers:{...headers,"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,X-Write-Key","Vary":"Origin"}});
function constantEqual(a,b){a=String(a||"");b=String(b||"");let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0}
function allowPath(path){return path==="data/books.json"||/^data\/books\/[a-zA-Z0-9-]{8,80}\/(?:book\.json|cover\.jpg|notes\/[a-zA-Z0-9-]{8,80}\.json)$/.test(path)}
export default {async fetch(request,env){
const origin=request.headers.get("Origin")||"", allowed=env.APP_ORIGIN||"https://wongtszshan.github.io";
if(origin&&origin!==allowed)return reply({error:"Origin not allowed"},403,allowed);
if(request.method==="OPTIONS")return reply({},204,allowed);
const url=new URL(request.url),repo=env.REPO||"wongtszshan/reading-notes",branch=env.BRANCH||"main";
const authorized=!!env.WRITE_PASSWORD&&constantEqual(request.headers.get("X-Write-Key"),env.WRITE_PASSWORD);
if(url.pathname==="/health")return reply({ok:true,authorized},authorized?200:401,allowed);
if(!env.GITHUB_TOKEN||!env.WRITE_PASSWORD)return reply({error:"Worker secrets not configured"},503,allowed);
const gh=async(path,method="GET",body=null)=>{
const opts={method,headers:{"Authorization":"Bearer "+env.GITHUB_TOKEN,"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28","User-Agent":"reading-notes-worker"}};
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
if(!authorized)return reply({error:"写入口令不正确"},401,allowed);
if(!["/write","/delete"].includes(url.pathname)||request.method!=="POST")return reply({error:"Not found"},404,allowed);
let input;try{input=await request.json()}catch{return reply({error:"Invalid JSON"},400,allowed)}
const path=String(input.path||"");if(!allowPath(path))return reply({error:"Invalid path"},400,allowed);
if(url.pathname==="/write"){
if(typeof input.content!=="string"||input.content.length>1800000)return reply({error:"Invalid or oversized content"},400,allowed);
const current=await gh(path);
if(current.status!==404&&!current.ok)return reply({error:"Cannot verify existing file"},502,allowed);
const sha=current.ok?current.json.sha:null;
if((input.sha||null)!==(sha||null))return reply({error:"版本冲突：云端文件已变化，请刷新后重试"},409,allowed);
let encoded=input.encoding==="base64"?input.content:btoa(String.fromCharCode(...new TextEncoder().encode(input.content)));
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