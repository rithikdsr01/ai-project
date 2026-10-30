import { db } from "hatchable";
export const access = "user";
export const methods = ["GET","POST"];
export default async function(req,res){
 if(req.method==="GET"){const {rows}=await db.query("SELECT id,body,case_id,saved_research_id,created_at,updated_at FROM notes ORDER BY updated_at DESC");return res.json({notes:rows});}
 const {body,case_id,saved_research_id}=req.body||{};
 if(!body?.trim()) return res.status(400).json({error:"Note cannot be empty."});
 const {rows}=await db.query("INSERT INTO notes (user_id,body,case_id,saved_research_id) VALUES ($1,$2,$3,$4) RETURNING *",[req.user.id,body.trim(),case_id||null,saved_research_id||null]);
 res.status(201).json({note:rows[0]});
}