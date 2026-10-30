import { db } from "hatchable";
export const access = "user";
export const methods = ["GET","POST"];
export default async function(req,res){
  const uid=req.user?.id;
  if(!uid) return res.status(401).json({error:"Authentication required."});
  if(req.method==="GET"){
    const {rows}=await db.query("SELECT id,title,case_number,court,status,summary,created_at,updated_at FROM cases WHERE user_id=$1 ORDER BY updated_at DESC",[uid]);
    return res.json({cases:rows});
  }
  const {title,case_number,court,status,summary}=req.body||{};
  if(!title?.trim()) return res.status(400).json({error:"Title is required."});
  const {rows}=await db.query("INSERT INTO cases (user_id,title,case_number,court,status,summary) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",[uid,title.trim(),case_number||null,court||null,status||"Researching",summary||null]);
  res.status(201).json({case:rows[0]});
}