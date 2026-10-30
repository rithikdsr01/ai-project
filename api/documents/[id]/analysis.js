import { db } from "hatchable";
export const access = "user";
export const methods = ["GET"];
export default async function(req,res){
 const id=Number(req.params.id);
 if(!id)return res.status(400).json({error:"Document id is required."});
 const {rows}=await db.query("SELECT d.id,d.filename,d.mime_type,d.size_bytes,d.status,a.analysis,a.chunks_indexed,a.disclaimer,a.created_at AS analyzed_at FROM documents d JOIN document_analyses a ON a.document_id=d.id WHERE d.id=$1 AND d.user_id=$2 LIMIT 1",[id,req.user.id]);
 if(!rows.length)return res.status(404).json({error:"No saved analysis found for this document."});
 const r=rows[0];
 res.json({document:{id:r.id,filename:r.filename,mime_type:r.mime_type,size_bytes:r.size_bytes,status:r.status},analysis:r.analysis,chunks_indexed:r.chunks_indexed,disclaimer:r.disclaimer,analyzed_at:r.analyzed_at});
}