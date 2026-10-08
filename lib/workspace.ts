import { createHash, randomBytes } from 'node:crypto';

export const WORKSPACE_COOKIE='tw_workspace';
const valid=/^[A-Za-z0-9_-]{43}$/;
export function readWorkspace(request:Request):string|null {
  const cookies=request.headers.get('cookie')??'';
  const entry=cookies.split(';').map(s=>s.trim()).find(s=>s.startsWith(WORKSPACE_COOKIE+'='));
  const token=entry?.slice(WORKSPACE_COOKIE.length+1);
  return token&&valid.test(token)?createHash('sha256').update(token).digest('hex'):null;
}
export function createWorkspace(secure:boolean) {
  const token=randomBytes(32).toString('base64url');
  return {owner:createHash('sha256').update(token).digest('hex'),cookie:`${WORKSPACE_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure?'; Secure':''}`};
}
