import { db, storage } from "hatchable";
export const access = "user";
export const methods = ["DELETE"];
export default async function(req,res){
 const id=Number(req.params.id);
 const uid=req.user?.id;
 if(!Number.isFinite(id)||id<=0)return res.status(400).json({error:"Invalid document id."});
 if(!uid)return res.status(401).json({error:"Authentication required."});
 const found=await db.query("SELECT id,storage_key FROM documents WHERE id=$1 AND user_id=$2 LIMIT 1",[id,uid]);
 if(!found.rows.length)return res.status(404).json({error:"Document not found in your workspace."});
 const key=found.rows[0].storage_key;
 // Remove the user's document metadata and its saved analysis first.
 await db.query("DELETE FROM document_analyses WHERE document_id=$1 AND user_id=$2",[id,uid]);
 await db.query("DELETE FROM documents WHERE id=$1 AND user_id=$2",[id,uid]);
 let storageDeleted=false,storageWarning=null;
 try{if(key&&typeof storage.delete==="function"){await storage.delete(key);storageDeleted=true;}else if(key){storageWarning="The document record and analysis were deleted, but this storage adapter does not expose a delete operation."}}catch(e){storageWarning="The document record and analysis were deleted, but the stored file could not be removed automatically."}
 return res.json({ok:true,document_id:id,storage_deleted:storageDeleted,warning:storageWarning});
}