import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('account withdrawal page scripts parse and preserve explicit confirmation and post-deletion status',()=>{
 const html=readFileSync(new URL('../account/index.html',import.meta.url),'utf8');
 for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
 assert.match(html,/30일 탈퇴 대기 및 Google 권한 철회/);
 assert.match(html,/탈퇴 취소 및 계정 복구/);
 assert.match(html,/Asia\/Seoul/);
 assert.match(html,/withdrawal\/start/);
 assert.match(html,/withdrawal\/confirm/);
 assert.match(html,/withdrawal\/status/);
 assert.match(html,/withdrawal=result/);
 assert.match(html,/전체 처리가 완료된 상태가 아닙니다/);
 assert.doesNotMatch(html,/인증 후 탈퇴 버튼을 다시 눌러/);
 assert.doesNotMatch(html,/사이트만 탈퇴/);
});
