// Captured baseline regression: real HTTP/filesystem, synthetic model only.
import { tmpdir } from 'node:os';
// 发布评审 R1/R2 修复后黑盒验证（2026-09-15，HEAD 含修复）。
// 镜像 prose-release-repro-20260914.mjs 的攻击面，但断言【正确行为】：
// 过期/外部/双端/committed 全部 409 零覆盖；显式重开走 reopenChapter 语义。
// 仅写本目录临时书；断言失败即非零退出。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { apiMiddleware } from 'file:///C:/zcode/novel-ai/apps/web/dist-server/api.js';
import { createBook, LocalDataPlane, proseChapterPath } from 'file:///C:/zcode/novel-ai/packages/data-plane/dist/index.js';
const dir = mkdtempSync(join(tmpdir(),'mozhou-save-regression-'));
const server = createServer((req,res)=>apiMiddleware()(req,res,()=>{res.statusCode=404;res.end();}));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${server.address().port}`;
async function call(path, body) {
  const response = await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  return { status: response.status, body: await response.json() };
}
const results = { fixedAtHead: true, dir };
try {
  // —— R1 场景 1：读取后外部改盘，保存必须 409 且磁盘原文保留 ——
  const root=join(dir,'external-edit'); createBook({dir:root,title:'Verify external edit'});
  let plane=LocalDataPlane.openOrRebuild(root); plane.createChapterDraft({chapterIndex:1,title:'One'}); plane.close();
  const file=join(root,proseChapterPath(1));
  const readSnap=await call('/api/chapter.prose',{root,chapterIndex:1});
  assert.equal(readSnap.status,200); assert.equal(readSnap.body.exists,true);
  const readRevision=readSnap.body.revision;
  writeFileSync(file,readFileSync(file,'utf8')+'EXTERNAL AUTHOR CONTENT\n');
  const staleSave=await call('/api/chapter.prose.save',{root,chapterIndex:1,body:'STALE BROWSER CONTENT',expectedRevision:readRevision});
  const diskAfterStale=readFileSync(file,'utf8');
  results.externalEdit={
    saveStatus:staleSave.status, code:staleSave.body.code,
    externalContentKept:diskAfterStale.includes('EXTERNAL AUTHOR CONTENT'),
    staleContentRejected:!diskAfterStale.includes('STALE BROWSER CONTENT'),
  };
  assert.equal(staleSave.status,409); assert.equal(staleSave.body.code,'PROSE_EXTERNAL_CHANGE');
  assert.equal(results.externalEdit.externalContentKept,true);
  assert.equal(results.externalEdit.staleContentRejected,true);

  // —— R1 场景 1b：作者显式核对后覆盖（验收 E 的解决流程；外部改盘需确认位）——
  const latestExternal=await call('/api/chapter.prose',{root,chapterIndex:1});
  const noConfirm=await call('/api/chapter.prose.save',{root,chapterIndex:1,body:'未确认覆盖\n',expectedRevision:latestExternal.body.revision});
  assert.equal(noConfirm.status,409); assert.equal(noConfirm.body.code,'PROSE_EXTERNAL_CHANGE');
  const resolvedExternal=await call('/api/chapter.prose.save',{root,chapterIndex:1,body:'作者核对外部改动后重写的内容\n',expectedRevision:latestExternal.body.revision,confirmExternalOverwrite:true});
  assert.equal(resolvedExternal.status,200);
  results.externalEdit.explicitResolveStatus=resolvedExternal.status;
  assert.equal(readFileSync(file,'utf8').includes('作者核对外部改动后重写的内容'),true);

  // —— R1 场景 2：双端同版本读取，第二端 409；显式核对后覆盖才成功 ——
  const readAgain=await call('/api/chapter.prose',{root,chapterIndex:1});
  const sharedRevision=readAgain.body.revision;
  const firstSave=await call('/api/chapter.prose.save',{root,chapterIndex:1,body:'第一端内容\n',expectedRevision:sharedRevision});
  assert.equal(firstSave.status,200);
  const secondSave=await call('/api/chapter.prose.save',{root,chapterIndex:1,body:'第二端过期内容\n',expectedRevision:sharedRevision});
  const diskAfterRace=readFileSync(file,'utf8');
  results.twoEditors={
    secondStatus:secondSave.status, code:secondSave.body.code,
    currentRevision:secondSave.body.currentRevision,
    firstEditorContentKept:diskAfterRace.includes('第一端内容'),
    staleRejected:!diskAfterRace.includes('第二端过期内容'),
  };
  assert.equal(secondSave.status,409); assert.equal(secondSave.body.code,'PROSE_REVISION_CONFLICT');
  assert.equal(results.twoEditors.currentRevision,sharedRevision+1);
  const latest=await call('/api/chapter.prose',{root,chapterIndex:1});
  const resolved=await call('/api/chapter.prose.save',{root,chapterIndex:1,body:'第二端核对后覆盖\n',expectedRevision:latest.body.revision});
  assert.equal(resolved.status,200);
  results.explicitResolve={status:resolved.status,revision:resolved.body.revision};
  assert.equal(readFileSync(file,'utf8').includes('第二端核对后覆盖'),true);

  // —— R2 场景：committed 普通保存 409 零变更；显式重开走 reopenChapter；重开后保存可回读 ——
  const committedRoot=join(dir,'committed'); createBook({dir:committedRoot,title:'Verify committed'});
  plane=LocalDataPlane.openOrRebuild(committedRoot); plane.createChapterDraft({chapterIndex:1,title:'One'});
  const commit=plane.commitChapter({chapterIndex:1,summary:'定稿',finalProse:'FINAL AUTHOR CONTENT\n'}); plane.close();
  const committedFile=join(committedRoot,proseChapterPath(1));
  const before=readFileSync(committedFile,'utf8');
  const snap=await call('/api/chapter.prose',{root:committedRoot,chapterIndex:1});
  assert.equal(snap.body.phase,'committed'); assert.equal(snap.body.commitId,commit.commitId);
  const normalSave=await call('/api/chapter.prose.save',{root:committedRoot,chapterIndex:1,body:'DRAFT OVER COMMITTED',expectedRevision:snap.body.revision});
  const after=readFileSync(committedFile,'utf8');
  results.committed={
    saveStatus:normalSave.status, code:normalSave.body.code, commitId:normalSave.body.commitId,
    fileUnchanged:after===before,
  };
  assert.equal(normalSave.status,409); assert.equal(normalSave.body.code,'CHAPTER_COMMITTED');
  assert.equal(normalSave.body.commitId,commit.commitId);
  assert.equal(results.committed.fileUnchanged,true);

  const reopened=await call('/api/chapter.reopen',{root:committedRoot,chapterIndex:1});
  assert.equal(reopened.status,200);
  assert.equal(reopened.body.reopenedFromCommitId,commit.commitId);
  const afterReopen=readFileSync(committedFile,'utf8');
  const events=readFileSync(join(committedRoot,'.mozhou','events.jsonl'),'utf8');
  results.reopen={
    status:reopened.status,
    reopenedFromCommitId:reopened.body.reopenedFromCommitId,
    phaseDraft:afterReopen.includes('phase: draft'),
    finalContentKept:afterReopen.includes('FINAL AUTHOR CONTENT'),
    chapterReopenedEvent:events.includes('"type":"ChapterReopened"'),
    commitTraceable:events.includes(commit.commitId),
  };
  assert.equal(results.reopen.phaseDraft,true);
  assert.equal(results.reopen.finalContentKept,true);
  assert.equal(results.reopen.chapterReopenedEvent,true);
  assert.equal(results.reopen.commitTraceable,true);

  const snapAfterReopen=await call('/api/chapter.prose',{root:committedRoot,chapterIndex:1});
  const postReopenSave=await call('/api/chapter.prose.save',{root:committedRoot,chapterIndex:1,body:'重开后的新草稿\n',expectedRevision:snapAfterReopen.body.revision});
  assert.equal(postReopenSave.status,200);
  const reread=await call('/api/chapter.prose',{root:committedRoot,chapterIndex:1});
  results.postReopenEdit={saveStatus:postReopenSave.status,rereadConsistent:reread.body.body.includes('重开后的新草稿')};
  assert.equal(results.postReopenEdit.rereadConsistent,true);

  console.log(JSON.stringify(results,null,2));
  writeFileSync(join(dir,'result.json'),JSON.stringify(results,null,2));
  console.log('ALL CORRECT-BEHAVIOR ASSERTIONS PASSED');
} finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }


