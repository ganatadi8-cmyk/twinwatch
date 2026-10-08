import { sessionSchema } from '@/lib/session-validation';
import { createWorkspace, readWorkspace } from '@/lib/workspace';
import { listSessions, saveSession } from '@/lib/session-store';
import { isSameOriginRequest } from '@/lib/request-origin';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const noStore={'Cache-Control':'private, no-store','Vary':'Cookie'};

export async function GET(request:Request){
  const existing=readWorkspace(request);
  const fresh=existing?null:createWorkspace(process.env.NODE_ENV==='production');
  const owner=existing??fresh!.owner;
  const headers={...noStore,...(fresh?{'Set-Cookie':fresh.cookie}:{})};
  try{return Response.json({sessions:await listSessions(owner)},{headers});}
  catch(error){console.error('Session history unavailable',error instanceof Error?error.message:'Storage error');return Response.json({error:'Saved sessions are unavailable. Your current report can still be downloaded.'},{status:503,headers});}
}

export async function POST(request:Request){
  const owner=readWorkspace(request);
  if(!owner)return Response.json({error:'Reload this page to initialize your private workspace.'},{status:401,headers:noStore});
  if(!isSameOriginRequest(request))return Response.json({error:'Request origin rejected.'},{status:403,headers:noStore});
  let raw;
  try{const body=await request.text();if(body.length>300000)return Response.json({error:'The session report is too large.'},{status:413,headers:noStore});raw=JSON.parse(body);}
  catch{return Response.json({error:'Invalid session report.'},{status:400,headers:noStore});}
  const parsed=sessionSchema.safeParse(raw);
  if(!parsed.success)return Response.json({error:'Invalid session measurements.'},{status:400,headers:noStore});
  try{await saveSession(owner,parsed.data);return Response.json({saved:true,id:parsed.data.id},{status:201,headers:noStore});}
  catch(error){console.error('Session save unavailable',error instanceof Error?error.message:'Storage error');return Response.json({error:'Could not save this session. Your report is still available to download.'},{status:503,headers:noStore});}
}
