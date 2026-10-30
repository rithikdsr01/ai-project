import { db } from "hatchable";
export const access = "user";
export const methods = ["GET"];
export default async function(req,res){
 const uid=req.user?.id;
 if(!uid)return res.status(401).json({error:"Authentication required."});
 const {rows}=await db.query("SELECT id,query,result_count,created_at FROM research_history WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",[uid]);
 res.json({history:rows});
}