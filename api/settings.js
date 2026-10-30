import { db } from "hatchable";
export const access = "user";
export const methods = ["GET","PUT"];
export default async function(req,res){
 if(req.method==="GET"){
   const {rows}=await db.query("SELECT id,firm_name,role_title,jurisdiction,created_at,updated_at FROM user_settings WHERE user_id=$1 LIMIT 1",[req.user.id]);
   return res.json({settings:rows[0]||{jurisdiction:"India"}});
 }
 const b=req.body||{};
 const {rows}=await db.query("INSERT INTO user_settings (user_id,firm_name,role_title,jurisdiction) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id) DO UPDATE SET firm_name=EXCLUDED.firm_name,role_title=EXCLUDED.role_title,jurisdiction=EXCLUDED.jurisdiction,updated_at=now() RETURNING *",[req.user.id,b.firm_name||null,b.role_title||null,b.jurisdiction||"India"]);
 res.json({settings:rows[0]});
}