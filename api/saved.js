import { db } from "hatchable";
export const access = "user";
export const methods = ["GET","DELETE"];
export default async function(req,res){
 if(req.method==="GET"){const {rows}=await db.query("SELECT * FROM saved_research ORDER BY created_at DESC");return res.json({saved:rows});}
 const id=Number(req.body?.id); if(!Number.isFinite(id)) return res.status(400).json({error:"Invalid id."});
 const out=await db.query("DELETE FROM saved_research WHERE id=$1",[id]); res.json({ok:out.rowCount>0});
}