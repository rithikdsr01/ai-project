import { db, ai } from "hatchable";

export const access = "user";
export const methods = ["GET", "POST"];

const clean = (v, max = 12000) => String(v ?? "").trim().slice(0, max);
const TYPE_GUIDANCE = {
  "Legal Notice": "Formal notice: parties/placeholders, subject, factual basis, chronology, contractual/legal basis only where supported, itemised demand and calculation, deadline placeholder, reservation of rights and service checklist. Never invent service details.",
  "Plaint": "Working plaint structure: court/jurisdiction placeholders, parties, numbered material facts, cause of action, jurisdiction, limitation, valuation/court-fee placeholders, reliefs, verification and document list. Mark missing requirements [VERIFY].",
  "Written Statement": "Preliminary objections; paragraph-wise response only if the plaint is supplied; defendant's version; legal grounds; set-off/counterclaim only if instructed and supported; prayer and verification. Never invent paragraph numbering from an unseen plaint.",
  "Writ Petition": "Working structure: court and jurisdiction placeholders, parties, synopsis/list of dates, facts, questions/grounds, interim relief if requested, final prayer, affidavit/annexure checklist. Do not invent government action, rights violations or maintainability facts.",
  "Petition": "Identify the forum and legal/procedural basis from supplied facts. Use jurisdiction, facts, grounds, relief and verification placeholders. If the forum or route is unclear, flag it instead of pretending the document is filing-ready.",
  "Internal Case Assessment": "Executive assessment; confirmed facts versus allegations; chronology; issues; arguments for each party; evidence matrix; legal research questions; risks; missing facts/documents; action plan; provisional conclusion.",
  "Research Memorandum": "Question presented; qualified short answer; facts; applicable law; issue-by-issue analysis; contrary arguments; conclusion; authorities table; open research questions.",
  "Custom Legal Draft": "Choose a structure appropriate to the stated objective. If document type, forum or relief is ambiguous, state assumptions and use [VERIFY / ADD DETAILS]."
};

export default async function(req, res) {
  const uid = req.user?.id;
  if (!uid) return res.status(401).json({ error: "Authentication required." });

  if (req.method === "GET") {
    const { rows } = await db.query(
      "SELECT d.id,d.case_id,d.title,d.draft_type,d.instructions,d.content,d.status,d.created_at,d.updated_at,c.title AS case_title FROM legal_drafts d LEFT JOIN cases c ON c.id=d.case_id WHERE d.user_id=$1 ORDER BY d.updated_at DESC",
      [uid]
    );
    return res.json({ drafts: rows });
  }

  const b = req.body || {};
  const type = clean(b.draft_type || "Custom Legal Draft", 100);
  if (!type) return res.status(400).json({ error: "draft_type is required." });
  const instructions = clean(b.instructions || "Prepare a careful, professional working draft.", 12000);
  const requestedCaseId = b.case_id ? Number(b.case_id) : null;
  let caseId = null, c = null, caseWarning = null;

  if (requestedCaseId) {
    const q = await db.query("SELECT id,title,case_number,court,status,summary FROM cases WHERE id=$1 AND user_id=$2 LIMIT 1", [requestedCaseId, uid]);
    if (q.rows.length) { c = q.rows[0]; caseId = c.id; }
    else caseWarning = "The selected case could not be found in your workspace. This draft will be generated without case-specific context.";
  } else if (b.case_title) {
    const q = await db.query("SELECT id,title,case_number,court,status,summary FROM cases WHERE title=$1 AND user_id=$2 ORDER BY updated_at DESC LIMIT 1", [clean(b.case_title, 300), uid]);
    if (q.rows.length) { c = q.rows[0]; caseId = c.id; }
  }

  let docs = [], analyses = [];
  if (caseId) {
    try {
      const q = await db.query("SELECT id,filename,status,created_at FROM documents WHERE case_id=$1 AND user_id=$2 ORDER BY created_at ASC", [caseId, uid]);
      docs = q.rows;
      if (docs.length) {
        const ids = docs.map(d => d.id);
        const a = await db.query("SELECT document_id,analysis,disclaimer,chunks_indexed,updated_at FROM document_analyses WHERE user_id=$1 AND document_id = ANY($2::bigint[])", [uid, ids]);
        analyses = a.rows;
      }
    } catch (e) {
      console.log("Could not load case documents for drafting.", e?.message || e);
      caseWarning = [caseWarning, "Some case-document context could not be loaded. Check Documents before relying on this draft."].filter(Boolean).join(" ");
    }
  }

  const saved = await db.query(
    "SELECT title,case_name,citation,court,source_url,explanation,relevance_score,judgment_date FROM saved_research WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20",
    [uid]
  );

  const docContext = docs.map(d => {
    const a = analyses.find(x => String(x.document_id) === String(d.id));
    return { document_id: d.id, filename: d.filename, status: d.status, analysis: a?.analysis || null, analysis_disclaimer: a?.disclaimer || null, chunks_indexed: a?.chunks_indexed || 0 };
  });

  // Automatically retrieve candidate precedents for this matter instead of relying only on manually saved research.
  let retrievedAuthorities = [];
  let retrievalStatus = "not_configured";
  const ikToken = process.env.INDIANKANOON_API_TOKEN;
  if (c && ikToken) {
    try {
      const issuePrompt = "From this Indian legal matter, produce JSON only: {queries:[query1,query2,query3]}. Make 3 distinct, concise Indian judgment search queries: one for the central legal issue, one for the key evidentiary/procedural issue, and one for the opposing party's strongest legal issue. 4-10 meaningful words per query. Do not answer, invent citations, or add facts. Matter: " + JSON.stringify({title:c.title,summary:c.summary,documents:docContext});
      let queries = [];
      try {
        const qo = await ai.generateText({model:"gemini",system:"You are a legal search-query planner. Return strict JSON only and never invent case citations.",prompt:issuePrompt,maxSteps:1,purpose:"JurisAI matter precedent query planning"});
        const parsed = JSON.parse(String(qo?.text || qo?.output_text || "").replace(/\x60\x60\x60json|\x60\x60\x60/g,"").trim());
        if (Array.isArray(parsed.queries)) queries = parsed.queries.map(q=>clean(q,180)).filter(q=>q.length>=4).slice(0,3);
      } catch (e) { console.log("Precedent query planning unavailable", e?.message || e); }
      if (!queries.length) queries = [clean((c.title || "") + " " + (c.summary || ""),180)].filter(q=>q.length>=4);
      const unique = new Map();
      for (const query of queries.slice(0,3)) {
        const rr = await fetch("https://api.indiankanoon.org/search/", {
          method:"POST",
          headers:{Authorization:"Token "+ikToken,Accept:"application/json","Content-Type":"application/x-www-form-urlencoded"},
          body:new URLSearchParams({formInput:query,pagenum:"0"}).toString()
        });
        if (!rr.ok) { retrievalStatus = "source_error"; continue; }
        const payload = await rr.json().catch(()=>({}));
        for (const d of (Array.isArray(payload.docs) ? payload.docs : [])) {
          const id = String(d.tid || d.id || "");
          if (!id || unique.has(id)) continue;
          unique.set(id,{
            case_name:d.title || "Judgment title unavailable",
            court:d.docsource || "Court not recorded",
            citation:d.citation || "",
            judgment_date:d.publishdate || d.date || null,
            source_url:"https://indiankanoon.org/doc/"+id+"/",
            source:"Indian Kanoon search result; verify the full judgment",
            search_snippet:d.headline || "",
            search_query:query
          });
        }
      }
      retrievedAuthorities = Array.from(unique.values()).slice(0,12);
      if (retrievedAuthorities.length) retrievalStatus = "candidate_results";
      else if (retrievalStatus !== "source_error") retrievalStatus = "no_results";
    } catch (e) {
      retrievalStatus = "source_error";
      console.log("Automatic precedent retrieval failed",e?.message || e);
    }
  }

  const prompt = [
    "TASK: Prepare a high-quality Indian legal working draft using only the case facts and supplied source material.",
    "DRAFT TYPE: " + type,
    "REQUIRED STRUCTURE: " + (TYPE_GUIDANCE[type] || TYPE_GUIDANCE["Custom Legal Draft"]),
    "USER INSTRUCTIONS: " + instructions,
    "SELECTED CASE RECORD: " + (c ? JSON.stringify(c) : "No case selected."),
    "UPLOADED DOCUMENTS AND THEIR SAVED ANALYSES: " + JSON.stringify(docContext),
    "USER-SAVED LEGAL AUTHORITIES: " + JSON.stringify(saved.rows),
    "AUTOMATICALLY RETRIEVED CANDIDATE PRECEDENTS (search metadata/snippets only; verify full judgment before relying): " + JSON.stringify(retrievedAuthorities),
    "PRECEDENT RETRIEVAL STATUS: " + retrievalStatus,
    "",
    "MANDATORY ACCURACY RULES:",
    "1. Never invent facts, dates, parties, amounts, documents, quotations, provisions, judgments, citations, courts, holdings, procedural steps, service of notice or admissions.",
    "2. Treat case summaries and document analyses as potentially incomplete summaries, not as proof that the underlying document says more than the supplied analysis records.",
    "3. Distinguish CONFIRMED IN SUPPLIED MATERIAL, PARTY ALLEGATION, INFERENCE, and NOT PROVIDED / TO VERIFY. Never turn an allegation into a finding.",
    "4. For important disputed facts, identify the supplied source document; otherwise mark [SOURCE / EVIDENCE REQUIRED].",
    "5. You may discuss saved authorities and automatically retrieved candidate precedents only as candidates. Preserve their recorded names, courts, citations and URLs exactly; never fill missing metadata from memory. Candidate search snippets are not proof of a holding.",
    "6. If candidate precedents were retrieved, include a table/list with case name, recorded court/date/citation, source URL, apparent relevance based only on the snippet, and a warning to verify the full judgment and paragraphs. Never claim the authority supports a proposition unless supplied source text establishes it.",
    "7. If no relevant authority was retrieved or saved, state: No case-law authority was retrieved for this draft; targeted precedent research is required.",
    "7. Do not claim filing readiness. Mark forum, jurisdiction, limitation, court fee, procedure, statutory amendments and local rules [VERIFY WITH ADVOCATE] if not established.",
    "8. Check arithmetic explicitly and state assumptions. Do not infer interest or costs without a source basis.",
    "9. Include adverse facts and plausible counterarguments. Avoid certainty where evidence is missing.",
    "10. Output clean readable plain text with numbered headings and paragraphs. Avoid raw Markdown symbols, pipe tables, JSON and model commentary.",
    "11. End with VERIFICATION CHECKLIST and AUTHORITIES USED / RESEARCH GAPS. List only authorities actually supplied.",
    "12. If the AI service cannot produce a reliable draft, return an explicit error rather than fabricated content."
  ].join("\n");

  let content = "";
  try {
    const out = await ai.generateText({
      model: "gemini",
      system: "You are JurisAI, a meticulous Indian legal drafting and research assistant. Prioritize evidentiary discipline, procedural caution, source provenance, balanced arguments and usable document structure. You are not a substitute for an advocate. Follow all mandatory accuracy rules.",
      prompt,
      maxSteps: 1,
      purpose: "JurisAI grounded legal drafting v2"
    });
    content = clean(out?.text || out?.output_text || "", 50000);
    if (!content || content.length < 100) throw new Error("The model returned an empty or unusably short draft.");
  } catch (e) {
    return res.status(503).json({
      error: "JurisAI could not generate a reliable draft because the AI provider is unavailable or returned an incomplete response. Existing drafts are unchanged. Retry after the provider quota/service recovers.",
      detail: e?.message || String(e)
    });
  }

  const title = clean(b.title || (type + " — " + (c?.title || "Untitled matter")), 300);
  const ins = await db.query(
    "INSERT INTO legal_drafts (user_id,case_id,title,draft_type,instructions,content) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,created_at,updated_at",
    [uid, caseId, title, type, instructions, content]
  );

  return res.json({
    draft: { ...ins.rows[0], case_id: caseId, title, draft_type: type, instructions, content, case_title: c?.title || null, status: "Draft" },
    context_used: { case_linked: Boolean(c), uploaded_documents: docs.length, analyzed_documents: analyses.length, saved_authorities_available: saved.rows.length, auto_retrieved_candidate_precedents: retrievedAuthorities.length, precedent_retrieval_status: retrievalStatus },
    disclaimer: "AI-generated working draft. Verify facts, document references, authorities, procedural requirements and filing details with a qualified Indian advocate before use.",
    warning: caseWarning
  });
}