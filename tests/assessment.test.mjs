import test from "node:test";
import assert from "node:assert/strict";
import {initAssessmentAcknowledgement, ACKNOWLEDGEMENT_KEY} from "../assessment.js";

function createElement() {
  const listeners = {};
  return {
    hidden:false, checked:false, disabled:false, open:false,
    textContent:"", focused:false, calls:{show:0,close:0},
    addEventListener(type,fn) { (listeners[type]??=[]).push(fn); },
    emit(type,event={preventDefault(){this.defaultPrevented=true;},defaultPrevented:false}) {
      for(const fn of listeners[type]||[])fn(event);
      return event;
    },
    showModal(){this.open=true;this.calls.show++;},
    close(){this.open=false;this.calls.close++;},
    focus(){this.focused=true;}
  };
}
function buildFixture(storage) {
  const ids=["assessmentDialog","assessmentCheckbox","assessmentContinue","assessmentAcknowledgementRow","assessmentRememberNote","aboutAssessment"];
  const elements=Object.fromEntries(ids.map(id=>[id,createElement()]));
  const root={getElementById:id=>elements[id]??null};
  const provider=()=>storage;
  return {...elements,root,provider};
}
function memoryStorage() {
  const map=new Map();
  return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};
}

test("new visitors see a modal and cannot proceed without checking",()=>{
  const storage=memoryStorage(), ui=buildFixture(storage);
  const controller=initAssessmentAcknowledgement(ui.root,ui.provider);
  assert.equal(ui.assessmentDialog.open,true);
  assert.equal(ui.assessmentDialog.calls.show,1);
  assert.equal(ui.assessmentCheckbox.focused,true);
  assert.equal(ui.assessmentContinue.disabled,true);
  const cancelled=ui.assessmentDialog.emit("cancel");
  assert.equal(cancelled.defaultPrevented,true);
  ui.assessmentContinue.emit("click");
  assert.equal(ui.assessmentDialog.open,true);
  assert.equal(storage.getItem(ACKNOWLEDGEMENT_KEY),null);
  assert.equal(controller.isAcknowledged(),false);
});

test("checking and continuing saves the acknowledgement locally",()=>{
  const storage=memoryStorage(), ui=buildFixture(storage);
  const controller=initAssessmentAcknowledgement(ui.root,ui.provider);
  ui.assessmentCheckbox.checked=true;
  ui.assessmentCheckbox.emit("change");
  assert.equal(ui.assessmentContinue.disabled,false);
  ui.assessmentContinue.emit("click");
  assert.equal(ui.assessmentDialog.open,false);
  assert.equal(storage.getItem(ACKNOWLEDGEMENT_KEY),"yes");
  assert.equal(controller.isAcknowledged(),true);
});

test("return visitors skip the welcome screen but may reopen it",()=>{
  const storage=memoryStorage();
  storage.setItem(ACKNOWLEDGEMENT_KEY,"yes");
  const ui=buildFixture(storage);
  initAssessmentAcknowledgement(ui.root,ui.provider);
  assert.equal(ui.assessmentDialog.open,false);
  ui.aboutAssessment.emit("click");
  assert.equal(ui.assessmentDialog.open,true);
  assert.equal(ui.assessmentAcknowledgementRow.hidden,true);
  assert.equal(ui.assessmentRememberNote.hidden,true);
  assert.equal(ui.assessmentContinue.textContent,"Back to QuickMark");
  assert.equal(ui.assessmentContinue.disabled,false);
  assert.equal(ui.assessmentContinue.focused,true);
  const cancelled=ui.assessmentDialog.emit("cancel");
  assert.equal(cancelled.defaultPrevented,false);
  ui.assessmentContinue.emit("click");
  assert.equal(ui.assessmentDialog.open,false);
});

test("restricted browser storage does not prevent acknowledgement",()=>{
  const ui=buildFixture({
    getItem(){throw new Error("Storage denied");},
    setItem(){throw new Error("Storage denied");}
  });
  const controller=initAssessmentAcknowledgement(ui.root,ui.provider);
  assert.equal(ui.assessmentDialog.open,true);
  ui.assessmentCheckbox.checked=true;
  ui.assessmentCheckbox.emit("change");
  ui.assessmentContinue.emit("click");
  assert.equal(ui.assessmentDialog.open,false);
  assert.equal(controller.isAcknowledged(),true);
});

test("the dialog is not bypassable by resetting the checkbox after prior acceptance",()=>{
  const storage=memoryStorage(), ui=buildFixture(storage);
  initAssessmentAcknowledgement(ui.root,ui.provider);
  ui.assessmentCheckbox.checked=true;
  ui.assessmentCheckbox.emit("change");
  ui.assessmentContinue.emit("click");
  ui.assessmentCheckbox.checked=false;
  ui.aboutAssessment.emit("click");
  assert.equal(ui.assessmentAcknowledgementRow.hidden,true);
  assert.equal(ui.assessmentContinue.disabled,false);
});
