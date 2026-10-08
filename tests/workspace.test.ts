import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspace,readWorkspace} from '../lib/workspace.ts';
test('workspace capability is private, secure and stable across requests',()=>{
  const w=createWorkspace(true);assert.match(w.cookie,/HttpOnly/);assert.match(w.cookie,/SameSite=Lax/);assert.match(w.cookie,/Secure/);
  const r=new Request('https://twinwatch.test',{headers:{cookie:w.cookie.split(';')[0]}});
  assert.equal(readWorkspace(r),w.owner);
});
test('different browsers receive separate namespaces and malformed capabilities are rejected',()=>{
  assert.notEqual(createWorkspace(true).owner,createWorkspace(true).owner);
  assert.equal(readWorkspace(new Request('https://twinwatch.test')),null);
  assert.equal(readWorkspace(new Request('https://twinwatch.test',{headers:{cookie:'tw_workspace=guess'}})),null);
});
