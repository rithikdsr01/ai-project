import { ai,db } from "hatchable";
export const access = "admin";
export const methods = ["POST"];
export default async function(req,res){
 const q=String(req.body?.query||"").trim();
 if(q.length<3)return res.status(400).json({error:"Enter a search query."});
 const token=process.env.INDIANKANOON_API_TOKEN;
 if(!token)return res.status(503).json({error:"Indian Kanoon connector is not configured yet.",setup:"Add INDIANKANOON_API_TOKEN in the Hatchable project secrets."});
 const url="https://api.indiankanoon.org/search/?formInput="+encodeURIComponent(q)+"&pagenum=0";
 const r=await fetch(url,{headers:{Authorization:"Token "+token,Accept:"application/json"}});
 const data=await r.json().catch(()=>({}));
 if(!r.ok)return res.status(r.status).json({error:"Indian Kanoon request failed",details:data});
 const docs=Array.isArray(data.docs)?data.docs:[];
 res.json({query:q,found:data.found||docs.length,results:docs.map((d)=>({external_id:String(d.tid||d.id||""),title:d.title||"",court:d.docsource||"",headline:d.headline||"",source_url:d.tid?"https://indiankanoon.org/doc/"+d.tid+"/":null,docsize:d.docsize||null}))});
}