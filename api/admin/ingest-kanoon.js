import { ai,db,knowledge } from "hatchable";
export const access = "admin";
export const methods = ["POST"];
function chunk(text,size=3500){const clean=String(text||"").replace(/\s+/g," ").trim();const out=[];for(let i=0;i<clean.length;i+=size)out.push(clean.slice(i,i+size));return out}
export default async function(req,res){
 const docId=String(req.body?.doc_id||"").trim();
 if(!docId)return res.status(400).json({error:"doc_id is required."});
 const token=process.env.INDIANKANOON_API_TOKEN;
 if(!token)return res.status(503).json({error:"Indian Kanoon connector is not configured yet."});
 const r=await fetch("https://api.indiankanoon.org/doc/"+encodeURIComponent(docId)+"/",{headers:{Authorization:"Token "+token,Accept:"application/json"}});
 const data=await r.json().catch(()=>({}));
 if(!r.ok)return res.status(r.status).json({error:"Indian Kanoon document request failed",details:data});
 const title=data.title||data.docmeta?.title||"Untitled judgment";
 const text=data.doc||data.text||data.body||data.html||"";
 if(!text)return res.status(422).json({error:"The source did not return document text."});
 const meta=data.docmeta||{};
 const sourceUrl="https://indiankanoon.org/doc/"+docId+"/";
 const parts=chunk(text);
 const base=knowledge.base("jurisai_judgments",{dimensions:1536});
 for(let i=0;i<parts.length;i++){
   const emb=await ai.embed(parts[i]);
   const vector=emb?.embedding||emb?.embeddings?.[0];
   await base.add({id:"ik-"+docId+"-"+i,text:parts[i],embedding:vector,metadata:{case_name:title,court:meta.docsource||data.docsource||"",citation:meta.citation||data.citation||"",judgment_date:meta.date||data.date||null,source:"Indian Kanoon",source_url:sourceUrl,external_id:docId,chunk_index:i,explanation:"Retrieved from the configured Indian Kanoon source."}});
 }
 await db.query("INSERT INTO legal_sources (source_type,external_id,title,court,citation,judgment_date,source_url,status,chunk_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (source_type,external_id) DO UPDATE SET title=EXCLUDED.title,court=EXCLUDED.court,citation=EXCLUDED.citation,judgment_date=EXCLUDED.judgment_date,source_url=EXCLUDED.source_url,status=EXCLUDED.status,chunk_count=EXCLUDED.chunk_count,updated_at=now()",["indiankanoon",docId,title,meta.docsource||data.docsource||null,meta.citation||data.citation||null,meta.date||data.date||null,sourceUrl,"indexed",parts.length]);
 res.json({ok:true,doc_id:docId,title,chunks_indexed:parts.length,source_url:sourceUrl});
}