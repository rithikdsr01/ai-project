import { db,ai,knowledge } from "hatchable";
export const access = "user";
export const methods = ["POST"];
const DEMO=[
 {id:"demo-1",case_name:"Sample Constitutional Law Judgment",court:"Illustrative — Demo Record",judgment_date:"2024-01-15",citation:"DEMO/CONST/001",relevance_score:91,explanation:"Demo-only record illustrating retrieval, ranking, and provenance. This is not a real legal authority.",source:"Mock legal dataset",source_url:"#",demo:true,body:"Clearly labelled sample data for the MVP; replace with verified legal sources."},
 {id:"demo-2",case_name:"Sample Administrative Law Judgment",court:"Illustrative — Demo Record",judgment_date:"2023-08-10",citation:"DEMO/ADMIN/002",relevance_score:84,explanation:"Demo-only record illustrating relevance ranking and source provenance.",source:"Mock legal dataset",source_url:"#",demo:true,body:"Clearly labelled sample data for the MVP; replace with verified legal sources."}
];
export default async function(req,res){
 const query=String(req.body?.query||"").trim();
 if(query.length<3) return res.status(400).json({error:"Enter a legal research question of at least 3 characters."});
 let hits=[];
 let ikDocs=[];
 let ikError="";
 const ikToken=process.env.INDIANKANOON_API_TOKEN;
 if(ikToken){
   try{
     // Convert long natural-language questions into a focused legal search query; preserve the original as a fallback.
     let searchQuery=query;
     try{
       const qOut=await ai.generateText({model:"gemini",system:"You rewrite legal research questions into concise search keywords only. Do not answer the question, invent citations, or add facts. Return one short search query of 4-12 meaningful words.",messages:[{role:"user",content:query}],purpose:"legal-search-query-rewrite"});
       const candidate=String(qOut?.text||qOut?.output_text||"").trim().replace(/^["\']|["\']$/g,"");
       if(candidate.length>=3&&candidate.length<=180)searchQuery=candidate;
     }catch(e){console.log("Search query rewrite unavailable; using original query",e?.message||e)}
     const searchOnce=async(q)=>{
       const url="https://api.indiankanoon.org/search/";
       const r=await fetch(url,{method:"POST",headers:{Authorization:"Token "+ikToken,Accept:"application/json","Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({formInput:q,pagenum:"0"}).toString()});
       const text=await r.text();
       if(!r.ok) throw new Error("Indian Kanoon API "+r.status+": "+text.slice(0,300));
       const data=JSON.parse(text);
       return Array.isArray(data.docs)?data.docs:[];
     };
     // Deterministic fallback: long natural-language prompts often perform poorly in keyword search.
     const stop=new Set(["find","indian","judgments","judgment","cases","case","relevant","where","what","which","that","this","with","from","into","under","about","after","before","between","their","there","they","them","have","has","been","being","were","was","are","and","the","for","but","not","also","give","provide","based","upon","wherein","disputed","generally"]);
     const keywords=query.toLowerCase().replace(/[^a-z0-9\\s]/g," ").split(/\\s+/).filter(w=>w.length>2&&!stop.has(w));
     const keywordQuery=keywords.slice(0,10).join(" ");
     const issueQueries=[];
     const lowerQuery=query.toLowerCase();
     if(/invoice|payment|recovery|unpaid|commercial/.test(lowerQuery))issueQueries.push("commercial invoice money recovery disputed payment delivery");
     if(/defect|quality|goods|delivery|sale of goods/.test(lowerQuery))issueQueries.push("Sale of Goods Act defective goods delivery acceptance buyer seller");
     if(/summary suit|order 37|order xxxvii/.test(lowerQuery))issueQueries.push("Order 37 CPC summary suit invoice triable issue leave to defend");
     const searchQueries=[...issueQueries,keywordQuery,searchQuery,query].filter((q,i,a)=>q&&a.findIndex(x=>x.toLowerCase()===q.toLowerCase())===i);
     const uniqueDocs=new Map();
     for(const q of searchQueries){
       try{const found=await searchOnce(q);for(const d of found){const key=String(d.tid||d.id||d.title||"");if(key&&!uniqueDocs.has(key))uniqueDocs.set(key,d);}if(uniqueDocs.size>=10)break;}
       catch(e){ikError=String(e?.message||e);}
     }
     ikDocs=Array.from(uniqueDocs.values());
   }catch(e){ikError=String(e?.message||e);console.log("Indian Kanoon search failed",ikError)}
 }
 try{
   const docs=knowledge.base("jurisai_judgments",{dimensions:1536});
   hits=await docs.search(query,{topK:8});
 }catch(e){console.log("knowledge search unavailable",e?.message||e)}
 const judgmentDocs=ikDocs.filter(d=>{const title=String(d.title||"").toLowerCase();return !/(^|\\s)(act|rules|code|regulation|law commission report)(,|\\s|$)/i.test(title)||/\\b(vs?\\.?|versus|in re)\\b/i.test(title)});
 const ikResults=judgmentDocs.slice(0,10).map((d,i)=>({
   id:String(d.tid||"ik-"+i),
   case_name:d.title||"Indian Kanoon judgment",
   court:d.docsource||"Court not recorded",
   judgment_date:d.publishdate||d.date||null,
   citation:d.citation||"",
   relevance_score:Math.max(1,100-i*3),
   explanation:d.headline||"Retrieved directly from Indian Kanoon search.",
   source:"Indian Kanoon",
   source_url:d.tid?"https://indiankanoon.org/doc/"+d.tid+"/":"https://indiankanoon.org/",
   demo:false,
   body:d.headline||""
 }));
 // Filter obviously off-topic live search hits before synthesis. The classifier only receives source metadata/snippets; it cannot create or alter legal authorities.
 if(ikResults.length){
   try{
     const filterOut=await ai.generateText({model:"gemini",system:"You are a conservative legal-search relevance filter. Select only source items that are directly relevant to the legal question. Do not treat isolated common words as sufficient evidence of relevance (act, goods, court, law). Return strict JSON only: {\"relevant_indices\":[0,1]}. If none are relevant, return an empty array.",messages:[{role:"user",content:"LEGAL QUESTION:\\n"+query+"\\nSOURCES (zero-based indices):\\n"+ikResults.map((x,i)=>i+": "+x.case_name+" | "+x.court+" | "+x.judgment_date+" | "+x.explanation).join("\\n")}],purpose:"legal-source-relevance-filter"});
     const raw=String(filterOut?.text||filterOut?.output_text||"").replace(/```json|```/g,"").trim();
     const parsed=JSON.parse(raw);
     if(Array.isArray(parsed.relevant_indices)){const keep=new Set(parsed.relevant_indices.filter(i=>Number.isInteger(i)&&i>=0&&i<ikResults.length));for(let i=ikResults.length-1;i>=0;i--)if(!keep.has(i))ikResults.splice(i,1);}
   }catch(e){console.log("Source relevance filtering unavailable; retaining retrieved results",e?.message||e)}
 }
 const kbResults=hits.map((h,i)=>({
   id:h.id||"kb-"+i,
   case_name:h.metadata?.case_name||h.metadata?.title||"Indexed legal source",
   court:h.metadata?.court||"Court not recorded",
   judgment_date:h.metadata?.judgment_date||null,
   citation:h.metadata?.citation||"",
   relevance_score:Math.round((h.similarity||0)*100),
   explanation:h.metadata?.explanation||"Retrieved from the JurisAI knowledge base.",
   source:h.metadata?.source||"Indexed legal source",
   source_url:h.metadata?.source_url||"#",
   demo:false,
   body:h.metadata?._text||""
 }));
 if(ikToken&&ikError) return res.status(502).json({error:"Indian Kanoon retrieval failed. Replace the Indian Kanoon API token in Hatchable Setup and try again.",details:ikError,query});
 // Never present a generic AI answer as if case-law retrieval succeeded.
 const results=ikResults.length?ikResults:kbResults;
 const retrieval_source=ikResults.length?"indian_kanoon":kbResults.length?"knowledge_base":"none";
 if(!results.length){
   const message=!ikToken
     ? "No judgments were retrieved. The Indian Kanoon connector is not configured, and the indexed legal knowledge base returned no matching cases. Add a valid INDIANKANOON_API_TOKEN in Hatchable project secrets or ingest verified judgments, then search again."
     : "No verified judgments were returned from Indian Kanoon or the indexed knowledge base. Try a shorter query focused on the legal issue, or check the Indian Kanoon connector.";
   try{await db.query("INSERT INTO research_history (user_id,query,result_count) VALUES ($1,$2,$3)",[req.user.id,query,0]);}catch(e){console.log("Could not save empty research history",e?.message||e)}
   return res.json({query,results:[],analysis:"",source_mode:"none",ai_mode:"no_verified_sources",indian_kanoon_configured:Boolean(ikToken),indian_kanoon_error:ikError||null,error:message,setup:!ikToken?"Open Hatchable project settings/secrets and add INDIANKANOON_API_TOKEN using a valid Indian Kanoon API token. Do not put the token in frontend code.":undefined,disclaimer:"No case law was retrieved, so JurisAI has not generated a substitute general-information answer or invented citations."});
 }
 await db.query("INSERT INTO research_history (user_id,query,result_count) VALUES ($1,$2,$3)",[req.user.id,query,results.length]);
 let analysis="";
 try{
   const context=results.slice(0,5).map((h,i)=>"["+String(i+1)+"] "+h.case_name+" | Court: "+(h.court||"")+" | Date: "+(h.judgment_date||"")+" | Citation: "+(h.citation||"")+" | Source: "+(h.source||"")+" | Detail: "+(h.body||h.explanation||"")).join(" || ");
   const hasSources=results.some(r=>!r.demo);
   const system=hasSources
     ? "You are JurisAI, a source-grounded legal research assistant. Use only the supplied retrieved context. Never invent judgments, citations, statutes, holdings, or facts. If the context is insufficient, say so. Cite retrieved sources as [1], [2], etc."
     : "You are JurisAI, a careful legal information assistant. No verified legal source was retrieved for this question. Give a concise general-information explanation only; do not invent case citations, quotations, holdings, or statutory text. Explicitly state that the response is not source-grounded and should be verified against an official or licensed legal source.";
   const prompt=hasSources
     ? "Question: "+query+"\nRetrieved context:\n"+context+"\nGive a concise research synthesis with source-number references."
     : "Question: "+query+"\nNo verified sources were retrieved. Give a concise general legal-information overview, identify what should be verified, and do not present the answer as legal advice.";
   const out=await ai.generateText({model:"gemini",system,messages:[{role:"user",content:prompt}],purpose:"legal-research"});
   analysis=out?.text||"";
 }catch(e){
   console.log("AI analysis unavailable",e?.message||e);
   analysis="Retrieved "+results.length+" source record(s) from "+(retrieval_source==="indian_kanoon"?"Indian Kanoon":"the JurisAI knowledge base")+". AI synthesis is temporarily unavailable. Open each result and verify the full judgment, court, date, citation, relevant paragraphs, and current validity. Search snippets alone do not establish a legal holding.";
 }
 res.json({query,results,analysis,source_mode:retrieval_source,indian_kanoon_configured:Boolean(ikToken),indian_kanoon_error:ikError||null,ai_mode:results.some(r=>!r.demo)?"source_grounded":"general_information",disclaimer:"These are retrieved source records, not a guarantee that each judgment supports the proposition. Open and verify every authority before relying on it."});
}