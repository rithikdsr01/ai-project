import { knowledge } from "hatchable";
export const access = "admin";
export const methods = ["POST"];
export default async function(req,res){const q=String(req.body?.query||"").trim();if(q.length<3)return res.status(400).json({error:"Enter a query."});const base=knowledge.base("jurisai_judgments",{dimensions:1536});const hits=await base.search(q,{topK:10});res.json({query:q,results:hits.map((h)=>({id:h.id,score:h.similarity,text:h.text,metadata:h.metadata}))});}