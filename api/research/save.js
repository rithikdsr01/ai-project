import { db } from "hatchable";
export const access = "user";
export const methods = ["POST"];
export default async function(req,res){
 const b=req.body||{};
 if(!b.title) return res.status(400).json({error:"Title is required."});
 const {rows}=await db.query("INSERT INTO saved_research (user_id,title,case_name,citation,court,source_url,explanation,relevance_score,judgment_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",[req.user.id,b.title,b.case_name||null,b.citation||null,b.court||null,b.source_url||null,b.explanation||null,b.relevance_score??null,b.judgment_date||null]);
 res.status(201).json({saved:rows[0]});
}