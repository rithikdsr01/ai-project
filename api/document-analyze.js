import { db,ai,knowledge } from "hatchable";
export const access = "user";
export const methods = ["POST"];
function chunks(text,size=3500){const clean=String(text||"").replace(/\s+/g," ").trim();const out=[];for(let i=0;i<clean.length;i+=size)out.push(clean.slice(i,i+size));return out}
export default async function(req,res){
 const documentId=Number(req.body?.document_id);
 const text=String(req.body?.text||"").trim();
 if(!documentId)return res.status(400).json({error:"document_id is required."});
 if(text.length<50)return res.status(422).json({error:"The PDF text could not be extracted or is too short to analyze. Try a text-based PDF."});
 const found=await db.query("SELECT id,filename,mime_type,size_bytes FROM documents WHERE id=$1 AND user_id=$2 LIMIT 1",[documentId,req.user.id]);
 if(!found.rows.length)return res.status(404).json({error:"Document not found."});
 const d=found.rows[0];
 const parts=chunks(text);
 let analysis={summary:"",facts:[],issues:[],provisions:[],arguments_for:[],arguments_against:[],findings:[],strengths:[],weaknesses:[],required_documents:[],research_questions:[],risks:[],next_steps:[],relevant_cases:[]};
 const prompt=`Analyze the following legal document as a legal research assistant. Never invent a judgment, statute, citation, quotation, holding, fact, or case reference. Only use the supplied document text. Return valid JSON with exactly these keys: summary (string), facts (array), issues (array), provisions (array), arguments_for (array), arguments_against (array), findings (array), strengths (array), weaknesses (array), required_documents (array), research_questions (array), risks (array), next_steps (array), relevant_cases (array). strengths must identify legally relevant strengths supported by the document; weaknesses must identify vulnerabilities, contradictions, missing proof or unfavorable facts; required_documents must list concrete evidence/documents needed to prove or defend the issues; research_questions must be questions that should be researched; risks must flag uncertainty, limitation, procedural or evidentiary risk; next_steps must be practical research/evidence steps. relevant_cases must initially be an empty array because case authorities must be retrieved separately from the live legal source. If something is not stated, say so rather than guessing.\n\nDOCUMENT: ${d.filename}\nTEXT:\n${text.slice(0,90000)}`;
 try{const out=await ai.generateText({model:"gemini",system:"You are JurisAI, a careful source-grounded legal document analyst. This is research support, not legal advice.",prompt,maxSteps:1,purpose:"JurisAI PDF case analysis"});const raw=out?.text||out?.output_text||String(out||"");analysis=JSON.parse(raw.replace(/^```json\s*/i,"").replace(/\s*```$/,""))}catch(e){return res.status(503).json({error:"AI analysis is not available yet. Enable an AI provider in Hatchable project settings, then try again.",detail:e?.message||String(e)})}
 const base=knowledge.base("jurisai_judgments",{dimensions:1536});
 let indexed=0;
 for(let i=0;i<Math.min(parts.length,60);i++){try{const emb=await ai.embed(parts[i]);const vector=emb?.embedding||emb?.embeddings?.[0];if(!vector)continue;await base.add({id:"upload-"+req.user.id+"-"+documentId+"-"+i,text:parts[i],embedding:vector,metadata:{case_name:d.filename,court:"User-uploaded document",citation:"Document source",judgment_date:null,source:"Private uploaded document",source_url:null,document_id:documentId,owner_id:req.user.id,chunk_index:i,explanation:"Indexed from a private user-uploaded document."}});indexed++}catch(e){console.log("chunk indexing failed",i,e?.message||e)}}
 const disclaimer="AI-generated research support only. The analysis uses only extracted text from this private document. Verify every legal proposition against the document and authoritative sources before reliance.";
 await db.query("UPDATE documents SET status=$1 WHERE id=$2 AND user_id=$3",["analyzed",documentId,req.user.id]);
 await db.query("INSERT INTO document_analyses (document_id,user_id,analysis,chunks_indexed,disclaimer) VALUES ($1,$2,$3::jsonb,$4,$5) ON CONFLICT (document_id) DO UPDATE SET analysis=EXCLUDED.analysis,chunks_indexed=EXCLUDED.chunks_indexed,disclaimer=EXCLUDED.disclaimer,updated_at=now()",[documentId,req.user.id,JSON.stringify(analysis),indexed,disclaimer]);
 res.json({document:d,analysis,chunks_indexed:indexed,disclaimer});
}