import { db,ai } from "hatchable";
export const access="user";
export const methods=["POST"];

function cleanText(v,max=12000){return String(v||"").trim().slice(0,max)}
function parseJson(text){
  try{return JSON.parse(text)}
  catch(_){
    const m=String(text||"").match(/\{[\s\S]*\}/);
    if(m)try{return JSON.parse(m[0])}catch(_2){}
    return null
  }
}
async function getContext(uid,caseId){
  const c=await db.query("SELECT id,title,case_number,court,status,summary FROM cases WHERE id=$1 AND user_id=$2 LIMIT 1",[Number(caseId),uid]);
  if(!c.rows.length)return null;
  const docs=await db.query("SELECT d.id,d.filename,d.mime_type,d.status,da.analysis,da.disclaimer FROM documents d LEFT JOIN document_analyses da ON da.document_id=d.id AND da.user_id=$2 WHERE d.case_id=$1 AND d.user_id=$2 ORDER BY d.created_at DESC LIMIT 12",[Number(caseId),uid]);
  const ca=await db.query("SELECT analysis,created_at FROM case_analyses WHERE case_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1",[Number(caseId),uid]);
  const saved=await db.query("SELECT title,case_name,citation,court,source_url,explanation,relevance_score,judgment_date FROM saved_research WHERE user_id=$1 ORDER BY created_at DESC LIMIT 15",[uid]);
  return {case:c.rows[0],documents:docs.rows,case_analysis:ca.rows[0]?.analysis||null,authorities:saved.rows};
}
export default async function(req,res){
  const uid=req.user?.id;
  if(!uid)return res.status(401).json({error:"Authentication required."});
  const b=req.body||{};
  const mode=String(b.mode||"").trim();
  if(!["attack","cross"].includes(mode))return res.status(400).json({error:"mode must be attack or cross."});
  if(!b.case_id)return res.status(400).json({error:"case_id is required."});
  const ctx=await getContext(uid,b.case_id);
  if(!ctx)return res.status(404).json({error:"Case not found in your workspace."});
  const context=JSON.stringify(ctx);
  if(mode==="attack"){
    const prompt=`You are an adversarial Indian litigation strategist helping an advocate stress-test a case. Use ONLY the supplied case context. Do not invent facts, authorities, citations, statutes, dates, evidence, or procedural history. If something is unknown, say "Not established in the supplied record." Produce strict JSON with exactly these arrays: weakest_points, contradictions_or_uncertainties, missing_evidence, maintainability_or_procedural_objections, strongest_arguments_against, authority_risks, questions_the_opponent_may_ask, recommended_repairs. Each item should be concise but specific and tied to the supplied record. Include a short risk_level field with one of LOW, MEDIUM, HIGH and a readiness_score integer 0-100.

CASE CONTEXT:\n${context}`;
    try{
      const out=await ai.generateText({model:"gemini",system:"You are a careful Indian legal litigation-analysis assistant. Never fabricate authority or facts. Research support only.",prompt,maxSteps:1,purpose:"JurisAI Attack My Case"});
      const data=parseJson(out?.text||out?.output_text||String(out||""));
      if(!data)return res.status(502).json({error:"AI returned an unreadable attack analysis. Please try again."});
      return res.json({mode,case:ctx.case,analysis:data,disclaimer:"AI stress-test only. Verify every factual, procedural and legal proposition against the case record and authoritative sources."});
    }catch(e){return res.status(503).json({error:"AI attack analysis is unavailable. Check the configured AI provider.",detail:e?.message||String(e)})}
  }
  const turns=Array.isArray(b.turns)?b.turns.slice(-12).map(x=>({role:String(x.role||""),text:cleanText(x.text,3000)})):[];
  const answer=cleanText(b.answer,5000);
  const prompt=`You are an opposing counsel conducting a rigorous cross-examination simulation for an Indian litigation matter. Use ONLY the supplied case context. Never invent facts or authorities. Ask one focused question at a time. Questions should test facts, chronology, documents, inconsistencies, admissions, legal assumptions and evidentiary support. If the advocate supplied an answer, assess it briefly: identify unsupported assertions, contradictions or evasions, then ask the next strongest question. Do not provide a real legal conclusion. Return strict JSON: {"question":"...","assessment":"...","pressure_point":"...","next_focus":"...","score":0-100}. For the first turn, assessment can be "Simulation started." If the record is insufficient for a factual question, ask the advocate to identify the missing source rather than inventing it.\n\nCASE CONTEXT:\n${context}\n\nPREVIOUS TURNS:\n${JSON.stringify(turns)}\n\nLATEST ANSWER:\n${answer}`;
  try{
    const out=await ai.generateText({model:"gemini",system:"You are an adversarial but professional Indian litigation cross-examination simulator. Never fabricate facts or law.",prompt,maxSteps:1,purpose:"JurisAI Cross-Examination Simulator"});
    const data=parseJson(out?.text||out?.output_text||String(out||""));
    if(!data?.question)return res.status(502).json({error:"AI returned an unreadable cross-examination question. Please try again."});
    return res.json({mode,case:ctx.case,turn:data,disclaimer:"Simulation only. It is not legal advice and should not be treated as a prediction of court questions or outcome."});
  }catch(e){return res.status(503).json({error:"AI cross-examination is unavailable. Check the configured AI provider.",detail:e?.message||String(e)})}
}