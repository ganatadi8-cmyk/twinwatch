import { neon } from '@neondatabase/serverless';
import type { Session } from './posture';

function database(){
  const connection=process.env.DATABASE_URL;
  if(!connection)throw new Error('Session storage is not configured.');
  return neon(connection);
}
export async function listSessions(owner:string):Promise<Session[]>{
  const sql=database();
  const rows=await sql`SELECT data FROM twinwatch_sessions WHERE owner_hash = ${owner} ORDER BY created_at DESC LIMIT 50`;
  return rows.map(r=>r.data as Session);
}
export async function saveSession(owner:string,session:Session){
  const sql=database();
  await sql`INSERT INTO twinwatch_sessions (owner_hash,id,created_at,data) VALUES (${owner},${session.id},${session.createdAt},${JSON.stringify(session)}::jsonb) ON CONFLICT (owner_hash,id) DO UPDATE SET data=excluded.data`;
}
