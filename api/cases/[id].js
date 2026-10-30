import { db } from "hatchable";
export const access = "user";
export const methods = ["GET","PUT","DELETE"];
export default async function(req,res){
  const id=Number(req.params.id);
  if(!Number.isFinite(id)) return res.status(400).json({error:"Invalid case id."});
  const uid=req.user?.id;
  if(!uid)return res.status(401).json({error:"Authentication required."});
  if(req.method==="GET"){
    const {rows}=await db.query("SELECT * FROM cases WHERE id=$1 AND user_id=$2",[id,uid]);
    if(!rows[0]) return res.status(404).json({error:"Case not found in your workspace."});
    const docs=await db.query("SELECT d.id,d.filename,d.mime_type,d.size_bytes,d.status,d.created_at,da.analysis,da.chunks_indexed FROM documents d LEFT JOIN document_analyses da ON da.document_id=d.id AND da.user_id=$2 WHERE d.case_id=$1 AND d.user_id=$2 ORDER BY d.created_at DESC",[id,uid]);
    return res.json({case:rows[0],documents:docs.rows});
  }
  if(req.method==="DELETE"){
    const out=await db.query("DELETE FROM cases WHERE id=$1 AND user_id=$2",[id,uid]);
    return res.json({ok:out.rowCount>0});
  }
  const {title,case_number,court,status,summary}=req.body||{};
  if(!title?.trim()) return res.status(400).json({error:"Title is required."});
  const {rows}=await db.query("UPDATE cases SET title=$1,case_number=$2,court=$3,status=$4,summary=$5,updated_at=now() WHERE id=$6 AND user_id=$7 RETURNING *",[title.trim(),case_number||null,court||null,status||"Researching",summary||null,id,req.user.id]);
  if(!rows[0]) return res.status(404).json({error:"Case not found."});
  res.json({case:rows[0]});
}