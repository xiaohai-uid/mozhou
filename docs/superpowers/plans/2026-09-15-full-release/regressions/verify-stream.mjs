// Captured baseline regression: real HTTP/filesystem, synthetic model only.
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createBook, LocalDataPlane, proseChapterPath} from 'file:///C:/zcode/novel-ai/packages/data-plane/dist/index.js';
import {makeDraftProviderBinding} from 'file:///C:/zcode/novel-ai/packages/pipeline/dist/index.js';
import {apiMiddleware} from 'file:///C:/zcode/novel-ai/apps/web/dist-server/api.js';
const dir=mkdtempSync(join(tmpdir(),'mozhou-stream-regression-'));
process.env.MOZHOU_DRAFT_PROVIDER='mock';
const server=createServer((req,res)=>apiMiddleware()(req,res,()=>{res.statusCode=404;res.end();}));
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const call=async(path,body={})=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const raw=await r.text();return {status:r.status,raw,json:()=>JSON.parse(raw)};};
function book(name){const root=join(dir,name);createBook({dir:root,title:name});const p=LocalDataPlane.openOrRebuild(root);p.createChapterDraft({chapterIndex:1,title:'One'});p.saveProseDraft({chapterIndex:1,body:'AUTHOR ORIGINAL\n',expectedRevision:0});p.close();return root;}
const results={scope:'Real local HTTP and filesystem; synthetic mock stream only, no real upstream acceptance',dir};
try {
 const root=book('http-stream');
 const before=(await call('/api/chapter.prose',{root,chapterIndex:1})).json();
 const stream=await call('/api/draft.stream',{root,chapterIndex:1,prompt:'AI REPLACEMENT TEXT'});
 const frames=stream.raw.trim().split('\n').map(x=>JSON.parse(x));
 const after=(await call('/api/chapter.prose',{root,chapterIndex:1})).json();
 const stale=await call('/api/chapter.prose.save',{root,chapterIndex:1,body:'STALE EDITOR WRITE\n',expectedRevision:before.revision});
 results.httpStream={http:stream.status,events:frames.map(x=>({event:x.event,ok:x.ok,outcome:x.outcome,error:x.error})),beforeRevision:before.revision,afterRevision:after.revision,originalLost:!after.body.includes('AUTHOR ORIGINAL'),generatedPersisted:after.body.includes('AI REPLACEMENT TEXT'),staleSaveStatus:stale.status};
 const raceRoot=book('midstream-external');const file=join(raceRoot,proseChapterPath(1));
 // C2（T04 适配）：绑定必须携带候选上下文；外部编辑写正文、生成写候选互不干扰
 const racePlane=LocalDataPlane.open(raceRoot);
 const raceScan=racePlane.getProseChapter(1);
 racePlane.close();
 const binding=makeDraftProviderBinding({bookRoot:raceRoot,chapterIndex:1,provider:'deepseek',mode:'generate',candidate:{id:'9f2f45a1-9b3c-4d5e-8f6a-7b8c9d0e1f2a',operationId:'op_verify_midstream',bookId:'book-verify',base:{revision:raceScan.revision,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')},mode:'replace'},stream:()=> (async function*(){yield 'FIRST ';writeFileSync(file,readFileSync(file,'utf8')+'EXTERNAL AUTHOR CHANGE\n');yield 'SECOND';})()});
 await binding();
 results.midstream={externalAuthorChangeLost:!readFileSync(file,'utf8').includes('EXTERNAL AUTHOR CHANGE')};
 results.unavailable=[];
 for(const path of ['/api/novel-breakdown','/api/web-search','/api/rank-scan','/api/cloud-sync.backup','/api/membership.activate']){const r=await call(path,{root});results.unavailable.push({path,status:r.status,code:r.json().code});}
 writeFileSync(join(dir,'result.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results,null,2));
 assert.equal(results.httpStream.originalLost,false,'BLOCKER: generating an unaccepted candidate overwrites existing author prose');
} finally {server.closeAllConnections();await new Promise(r=>server.close(r));}

