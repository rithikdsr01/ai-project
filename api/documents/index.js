import { db } from "hatchable";
export const access = "user";
export const methods = ["GET"];
export default async function(req,res){
 const {rows}=await db.query("SELECT id,case_id,filename,mime_type,size_bytes,status,created_at FROM documents WHERE user_id=$1 ORDER BY created_at DESC",[req.user.id]);
 res.json({documents:rows});
}