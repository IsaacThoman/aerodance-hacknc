import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createStudio } from '../server/index.js';
import { newProject } from '../core.js';

const dataDir=await mkdtemp(path.join(tmpdir(),'studio-format-'));
const {app,store}=createStudio({dataDir});
const supported=await store.save(newProject('supported-project'),null);
const future=newProject('unsupported-project');
future.schemaVersion=2;
future.metadata.title='Future format fixture';
future.updatedAt='9999-01-01T00:00:00.000Z';
future.tracks=future.tracks.map(({playerId,label})=>({playerId,label,dataId:'edited',originalDataId:'original',offsetMs:0}));
const futureBytes=Buffer.from(JSON.stringify(future));
await store.atomic(store.location(future.projectId,'project.json'),futureBytes);
const server=app.listen(4193,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const browser=await chromium.launch({args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  page.setDefaultTimeout(30000);
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    for(const Type of [window.WebGLRenderingContext,window.WebGL2RenderingContext]) {
      if(!Type) continue;
      for(const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced'])
        if(Type.prototype[name]) Type.prototype[name]=()=>{};
    }
  });
  await page.goto('http://127.0.0.1:4193');
  await page.getByRole('heading',{name:'Make every move yours.'}).waitFor();
  assert.equal(await page.getByLabel('Open project').inputValue(),supported.projectId);
  await page.getByText(/Opened a compatible project/).waitFor();
  assert.equal(await page.getByRole('option',{name:/Future format fixture/}).isDisabled(),true);
  assert.deepEqual(await readFile(store.location(future.projectId,'project.json')),futureBytes);
  // With no readable projects, the editor offers recovery rather than crashing
  // or automatically replacing the incompatible project.
  await rm(store.location(supported.projectId),{recursive:true,force:true});
  await page.reload();
  await page.getByRole('alert').filter({hasText:/No saved project can be opened/}).waitFor();
  assert.equal((await store.list()).length,1);
  await page.getByRole('button',{name:'Create new project',exact:true}).click();
  await page.getByRole('heading',{name:'Make every move yours.'}).waitFor();
  assert.notEqual(await page.getByLabel('Open project').inputValue(),future.projectId);
  assert.equal((await store.list()).length,2);
  assert.deepEqual(await readFile(store.location(future.projectId,'project.json')),futureBytes);
  assert.deepEqual(errors,[]);
  console.log('Project loading passed: incompatible latest project skipped, recovery from unsupported-only library, preserved project bytes, no render errors.');
} finally {
  await browser.close(); await new Promise(resolve=>server.close(resolve));
  await rm(dataDir,{recursive:true,force:true});
}
