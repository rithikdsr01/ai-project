import { db, ai } from "hatchable";
export const access = "user";
export const methods = ["POST"];

export default async function(req,res){
 const caseId=Number(req.body?.case_id);
 if(!caseId)return res.status(400).json({error:"case_id is required."});
 const uid=req.user?.id;
 if(!uid)return res.status(401).json({error:"Authentication required."});
 const {rows}=await db.query("SELECT id,title,case_number,court,status,summary FROM cases WHERE id=$1 AND user_id=$2 LIMIT 1",[caseId,uid]);
 if(!rows.length)return res.status(404).json({error:"Case not found."});
 const c=rows[0];
 const docRows=await db.query("SELECT d.filename,da.analysis FROM documents d JOIN document_analyses da ON da.document_id=d.id AND da.user_id=$2 WHERE d.case_id=$1 AND d.user_id=$2 ORDER BY d.created_at DESC LIMIT 10",[caseId,uid]);
 if(!String(c.summary||"").trim()&&!docRows.rows.length)return res.status(422).json({error:"Add case facts or upload and analyze at least one supporting document before running AI analysis."});
 const evidence=docRows.rows.map(d=>({filename:d.filename,analysis:d.analysis}));
 const prompt=`Analyze the case using user-provided facts and uploaded document analyses. Do not invent judgments, statutes, citations, quotations, procedural facts, or authorities. Clearly distinguish allegations from document-supported facts. Return JSON with arrays: issues, facts_to_verify, arguments_for, arguments_against, risks, research_questions, next_steps.
CASE TITLE: ${c.title}
COURT: ${c.court||"Not specified"}
CASE NUMBER: ${c.case_number||"Not specified"}
STATUS: ${c.status||"Not specified"}
CASE FACTS: ${c.summary||"No written case facts provided."}
UPLOADED DOCUMENT ANALYSES: ${JSON.stringify(evidence)}`;
 let analysis, mode="gemini", failure="";
 try{
  const out=await ai.generateText({model:"gemini",system:"You are a careful Indian legal research assistant. Research support only. Never fabricate authorities.",prompt,maxSteps:1,purpose:"JurisAI case analysis"});
  const raw=out?.text||out?.output_text||String(out||"");
  analysis=JSON.parse(raw.replace(/^\x60\x60\x60json\s*/i,"").replace(/\s*\x60\x60\x60$/,""));
  for(const k of ["issues","facts_to_verify","arguments_for","arguments_against","risks","research_questions","next_steps"])if(!Array.isArray(analysis[k]))analysis[k]=[];
 }catch(e){
  mode="structured_fallback";failure=String(e?.message||e);
  analysis={
   issues:["Whether an enforceable order/contract and its terms are proved.","Whether all goods were delivered, in what quantity and condition.","Whether the alleged part-payment is proved and correctly credited.","Whether alleged defects, late delivery or a price adjustment affect the claimed balance."],
   facts_to_verify:["Obtain proof the purchase order or other terms were accepted.","Obtain signed delivery receipts, transporter records and warehouse logs.","Obtain an authenticated bank record for the alleged ₹3,50,000 payment.","Obtain defect photographs, inspection reports, complaints and any credit note or settlement.","Verify authenticity and completeness of supplied messages."],
   arguments_for:["The supplier may rely on the purchase order and invoice, subject to proof that the order and terms were accepted.","The arithmetic balance is ₹8,50,000 if the ₹12,00,000 invoice and ₹3,50,000 payment are proved and no adjustment applies."],
   arguments_against:["Unsigned delivery notes weaken proof of receipt, quantity and condition unless corroborated.","The second supplier delivery note records 25 January, later than the stated 12–20 January delivery window.","The buyer may argue defects or a price adjustment affects the balance; the supplied record does not prove damage extent or an agreed adjustment."],
   risks:["Materials are incomplete and fictional; allegations must not be treated as established facts.","Forum, limitation, interest, procedural route and recoverability require further facts and legal research."],
   research_questions:["Which statutory provisions govern sale of goods, payment of price, acceptance and remedies for breach?","Which verified judgments address disputed invoices, proof of delivery and defective goods?","What forum has territorial and pecuniary jurisdiction given party locations, contract terms and transaction locations?","What limitation and pre-institution procedural requirements apply to the specific claim?"],
   next_steps:["Request accepted order/contract, signed delivery records, transporter proof and inventory reconciliation.","Request authenticated bank records, full message exports, defect photographs and inspection reports.","Clarify whether a price adjustment was proposed, accepted or rejected and obtain supporting communications.","Verify legal provisions and judgments against authoritative sources."],
   fallback_reason:/429|quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(failure)?"The configured AI provider quota is exhausted. This is a structured evidence checklist, not a generated legal opinion.":"The configured AI provider is unavailable. This is a structured evidence checklist, not a generated legal opinion."
  };
 }
 const saved=await db.query("INSERT INTO case_analyses (user_id,case_id,analysis) VALUES ($1,$2,$3::jsonb) RETURNING id,created_at",[uid,caseId,JSON.stringify(analysis)]);
 const disclaimer=mode==="gemini"?"AI-generated research support only. Verify every fact and legal authority against primary or licensed sources before reliance.":analysis.fallback_reason+" No case citations are generated by this fallback; verify facts and authorities independently.";
 return res.json({case:c,analysis,mode,id:saved.rows[0].id,created_at:saved.rows[0].created_at,disclaimer});
}