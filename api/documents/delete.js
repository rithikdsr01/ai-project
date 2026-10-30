import { db, storage } from "hatchable";
export const access = "user";
export const methods = ["POST"];
export default async function(req,res){
 const uid=req.user?.id;
 const id=Number(req.body?.id);
 if(!uid)return res.status(401).json({error:"Authentication required."});
 if(!Number.isSafeInteger(id)||id<=0)return res.status(400).json({error:"A valid document id is required."});
 const found=await db.query("SELECT id,storage_key,filename FROM documents WHERE id=$1 AND user_id=$2 LIMIT 1",[id,uid]);
 if(!found.rows.length)return res.status(404).json({error:"This document was not found in your workspace. Refresh the page and try again."});
 const key=found.rows[0].storage_key;
 // Delete metadata using the document owner's id; the FK also cascades its analysis.
 const deleted=await db.query("DELETE FROM documents WHERE id=$1 AND user_id=$2 RETURNING id",[id,uid]);
 if(!deleted.rowCount)return res.status(409).json({error:"The document was not deleted. Refresh the document list and try again."});
 let warning=null;
 try{
  if(key&&typeof storage.delete==="function")await storage.delete(key);
  else if(key)warning="The document and analysis were removed from JurisAI, but the storage provider does not expose file deletion. Contact the workspace administrator to purge the stored binary.";
 }catch(e){warning="The document and analysis were removed from JurisAI, but the stored binary could not be purged automatically."}
 return res.json({ok:true,document_id:id,filename:found.rows[0].filename,warning});
}