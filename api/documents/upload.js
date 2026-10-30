import { db,storage } from "hatchable";
export const access = "user";
export const methods = ["POST"];
export default async function(req,res){
 const f=req.files?.[0];
 if(!f) return res.status(400).json({error:"Attach a document file."});
 const allowed=["application/pdf","text/plain","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
 if(!allowed.includes(f.contentType)) return res.status(415).json({error:"Only PDF, TXT, DOC, and DOCX files are supported."});
 if(f.buffer.length>10*1024*1024) return res.status(413).json({error:"Maximum file size is 10 MB."});
 const caseId=req.body?.case_id?Number(req.body.case_id):null;
 if(caseId){const owned=await db.query("SELECT id FROM cases WHERE id=$1 AND user_id=$2 LIMIT 1",[caseId,req.user.id]);if(!owned.rows.length)return res.status(404).json({error:"Case not found in your workspace."});}
 const key="tmp/jurisai/"+req.user.id+"/"+Date.now()+"-"+f.filename.replace(/[^a-zA-Z0-9._-]/g,"_");
 const url=await storage.put(key,f.buffer,f.contentType);
 const {rows}=await db.query("INSERT INTO documents (user_id,case_id,filename,storage_key,mime_type,size_bytes,status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,case_id,filename,mime_type,size_bytes,status,created_at",[req.user.id,caseId,f.filename,key,f.contentType,f.buffer.length,"uploaded"]);
 res.status(201).json({document:rows[0],url});
}