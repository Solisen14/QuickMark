import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {validQuestionCount, questionCountGuidance} from "../omr.js";

// Exercise the actual UI handlers without introducing a browser testing dependency.
const source=readFileSync(new URL("../app.js",import.meta.url),"utf8");
const start=source.indexOf("let countUpdateTimer=null;");
const finish=source.indexOf("\nfunction changeChoices()",start);
assert.ok(start>=0&&finish>start,"Question count handlers must be present");
const handlers=source.slice(start,finish);

function harness() {
  const events=[];
  let timerId=0;
  const pending=new Map();
  const hint={hidden:true,textContent:"",classList:{toggle(name,value){events.push(["class",name,value]);}}};
  const field={value:"20"};
  const state={total:20,key:Array(20).fill(null)};
  const context={
    state,validQuestionCount,questionCountGuidance,
    $:id=>id==="questionCount"?field:hint,
    resetScan:()=>events.push("resetScan"),
    renderKey:()=>events.push("renderKey"),
    renderSheet:()=>events.push("renderSheet"),
    save:()=>events.push("save"),
    toast:message=>events.push(["toast",message]),
    setTimeout:fn=>{const id=++timerId;pending.set(id,fn);return id;},
    clearTimeout:id=>pending.delete(id)
  };
  vm.runInNewContext(handlers+"\nthis.ui={updateCountHint,scheduleCountUpdate,changeTotal};",context);
  return {field,hint,state,events,ui:context.ui,flush(){
    const callbacks=Array.from(pending.values());pending.clear();
    for(const fn of callbacks)fn();
  }};
}

test("typing a valid count updates guidance before redraw and redraws without blur",()=>{
  const h=harness();
  h.field.value="4";
  h.ui.scheduleCountUpdate();
  assert.equal(h.hint.hidden,false);
  assert.equal(h.hint.textContent,"This might be quicker to evaluate by hand");
  assert.equal(h.state.total,20);
  h.flush();
  assert.equal(h.state.total,4);
  assert.equal(h.state.key.length,4);
  assert.ok(h.events.includes("renderKey"),"answer grid must redraw");
  assert.ok(h.events.includes("renderSheet"),"printable sheet must redraw");
  assert.ok(h.events.includes("save"),"updated test configuration must persist");
});

test("typing a two-digit number quickly does not apply the interim first digit",()=>{
  const h=harness();
  h.state.key[10]="B";
  h.field.value="3";
  h.ui.scheduleCountUpdate();
  h.field.value="30";
  h.ui.scheduleCountUpdate();
  h.flush();
  assert.equal(h.state.total,30);
  assert.equal(h.state.key[10],"B");
  assert.equal(h.hint.textContent,"That's a lot of multiple choice! Consider other ways to assess student learning");
  assert.equal(h.events.filter(x=>x==="renderKey").length,1);
});

test("5 and 25 have no warnings, but 26 does and remains valid",()=>{
  const h=harness();
  for(const count of [5,25]){
    h.field.value=String(count);
    h.ui.scheduleCountUpdate();
    assert.equal(h.hint.hidden,true);
    h.flush();
    assert.equal(h.state.total,count);
  }
  h.field.value="26";
  h.ui.scheduleCountUpdate();
  assert.equal(h.hint.hidden,false);
  h.flush();
  assert.equal(h.state.total,26);
});

test("a typed invalid count is not applied and is restored at commit",()=>{
  const h=harness();
  h.field.value="51";
  h.ui.scheduleCountUpdate();
  assert.equal(h.hint.hidden,false);
  assert.equal(h.hint.textContent,"Choose a whole number from 1 to 50.");
  h.flush();
  assert.equal(h.state.total,20);
  h.ui.changeTotal();
  assert.equal(h.field.value,"20");
  assert.equal(h.state.total,20);
});

test("question field uses real-time input listener, plus immediate change listener",()=>{
  assert.match(source,/\$\("questionCount"\)\.addEventListener\("input",scheduleCountUpdate\)/);
  assert.match(source,/\$\("questionCount"\)\.addEventListener\("change",changeTotal\)/);
});
