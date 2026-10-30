import { db } from "hatchable";
export const access = "admin";
export const methods = ["GET"];
export default async function(req,res){const r=await db.query("SELECT COUNT(*)::int AS sources,COALESCE(SUM(chunk_count),0)::int AS chunks FROM legal_sources WHERE status='indexed'");res.json({sources:r.rows[0]?.sources||0,chunks:r.rows[0]?.chunks||0,mode:(r.rows[0]?.sources||0)>0?"verified_source_layer":"demo_data"});}