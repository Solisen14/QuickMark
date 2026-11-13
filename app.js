import {SHEET, ALPHABET, questionLayout, homography, grayscale, findMarkers, readAnswers, gradeAnswers, validQuestionCount, sheetFormatCode, readSheetFormatCode, questionCountGuidance} from "./omr.js?v=0.3";

const $ = id => document.getElementById(id);
const STORAGE_KEY = "quickmark-answer-key-v1";
const state = {
  title:"", total:20, choices:4, key:Array(20).fill(null),
  image:null, turns:0, detections:null, overrides:{}, confirmed:false
};

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 3500);
}

function loadSaved() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!data || !validQuestionCount(data.total) || ![4,5].includes(data.choices) ||
        !Array.isArray(data.key)) return;
    state.title = String(data.title || "").slice(0,70);
    state.total = data.total; state.choices = data.choices;
    state.key = Array.from({length:state.total}, (_,i) =>
      ALPHABET.slice(0,state.choices).includes(data.key[i]) ? data.key[i] : null);
  } catch (_) { /* In private browsing, the app still works without persistence. */ }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      title:state.title,total:state.total,choices:state.choices,key:state.key
    }));
  } catch (_) { /* No data is sent elsewhere if storage is unavailable. */ }
}

function sharedKeyLink() {
  const data={version:1,title:state.title,total:state.total,choices:state.choices,key:state.key};
  const bytes=new TextEncoder().encode(JSON.stringify(data));
  let binary="";
  for(const byte of bytes)binary+=String.fromCharCode(byte);
  const encoded=btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
  return location.href.split("#")[0]+"#key="+encoded;
}

function importKeyFromFragment() {
  if(!location.hash.startsWith("#key="))return false;
  try{
    const code=location.hash.slice(5).replace(/-/g,"+").replace(/_/g,"/");
    const bytes=Uint8Array.from(atob(code),char=>char.charCodeAt(0));
    const data=JSON.parse(new TextDecoder().decode(bytes));
    if(data.version!==1||!validQuestionCount(data.total)||![4,5].includes(data.choices)||
       !Array.isArray(data.key)||data.key.length!==data.total||
       !data.key.every(letter=>ALPHABET.slice(0,data.choices).includes(letter)))throw Error("Invalid key");
    state.title=String(data.title||"").slice(0,70);
    state.total=data.total;state.choices=data.choices;state.key=data.key.slice();
    clearTimeout(countUpdateTimer);
    countUpdateTimer=null;
    save();
    history.replaceState(null,"",location.pathname+location.search);
    return true;
  }catch(_){
    toast("This answer-key link is invalid or incomplete.");
    return false;
  }
}

function copyKeyLink() {
  if(!keyComplete()){toast("Complete your answer key before sharing.");return;}
  const link=sharedKeyLink();
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(link).then(
      ()=>toast("Key link copied. Open it on your iPhone."),
      ()=>window.prompt("Copy this link to your iPhone:",link)
    );
  }else window.prompt("Copy this link to your iPhone:",link);
}

function keyComplete() { return state.key.length===state.total && state.key.every(Boolean); }

function updateKeyStatus() {
  const entered = state.key.filter(Boolean).length;
  $("keyStatus").textContent = entered+" / "+state.total+" entered";
  $("keyStatus").classList.toggle("ready",keyComplete());
  $("scanKeyStatus").textContent = keyComplete() ? "Key ready · "+state.total+" questions" : "Key incomplete";
  $("scanKeyStatus").classList.toggle("ready",keyComplete());
  $("shareKey").disabled=!keyComplete();
}

function renderKey() {
  const grid = $("keyGrid");
  grid.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (let i=0;i<state.total;i++) {
    const row = document.createElement("div");
    row.className = "key-item";
    const label = document.createElement("span");
    label.className = "question-number";
    label.textContent = String(i+1).padStart(2,"0");
    row.append(label);
    const choices = document.createElement("div");
    choices.className = "key-choices";
    choices.setAttribute("role","group");
    choices.setAttribute("aria-label","Correct answer, question "+(i+1));
    for (const letter of ALPHABET.slice(0,state.choices)) {
      const button = document.createElement("button");
      button.type="button";button.className="key-choice";
      button.textContent=letter;
      button.dataset.question=String(i);button.dataset.letter=letter;
      button.setAttribute("aria-label","Question "+(i+1)+": "+letter);
      button.setAttribute("aria-pressed",String(state.key[i]===letter));
      choices.append(button);
    }
    row.append(choices);fragment.append(row);
  }
  grid.append(fragment);
  updateKeyStatus();
}

function syncKeyButtons(question) {
  const buttons = $("keyGrid").querySelectorAll('button[data-question="'+question+'"]');
  buttons.forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.letter===state.key[question])));
  updateKeyStatus();
}

function setTab(name) {
  document.querySelectorAll(".step").forEach(button => {
    const active=button.dataset.tab===name;
    button.classList.toggle("active",active);
    button.setAttribute("aria-selected",String(active));
    button.tabIndex=active?0:-1;
  });
  for (const tab of ["key","print","scan"]) $("panel-"+tab).hidden = tab!==name;
  if (name==="print") renderSheet();
  if (name==="scan") updateKeyStatus();
  document.querySelector(".steps").scrollIntoView({block:"start",behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
}

function svgElement(parent, tag, attributes={}, text) {
  const el=document.createElementNS("http://www.w3.org/2000/svg",tag);
  for (const [k,v] of Object.entries(attributes)) el.setAttribute(k,String(v));
  if (text!==undefined) el.textContent=text;
  parent.append(el);return el;
}

function buildSheet() {
  const svg= document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("viewBox","0 0 816 1056");
  svg.setAttribute("xmlns","http://www.w3.org/2000/svg");
  svg.setAttribute("role","img");
  svg.setAttribute("aria-label","QuickMark printable answer sheet with "+state.total+" questions");
  svgElement(svg,"rect",{x:0,y:0,width:816,height:1056,fill:"#fff"});
  for (const [x,y] of SHEET.markerCenters) {
    svgElement(svg,"rect",{x:x-14,y:y-14,width:28,height:28,fill:"#101517"});
  }
  svgElement(svg,"text",{x:103,y:142,"font-size":43,"font-weight":850,"letter-spacing":"-2",fill:"#151c23","font-family":"Arial, sans-serif"},"QuickMark");
  svgElement(svg,"text",{x:104,y:169,"font-size":13,"font-weight":700,fill:"#5a6a62","font-family":"Arial, sans-serif"},"MULTIPLE-CHOICE ANSWER SHEET");
  svgElement(svg,"text",{x:104,y:205,"font-size":15,fill:"#222","font-family":"Arial, sans-serif"},"Test: "+(state.title.slice(0,47)||"________________________________"));
  svgElement(svg,"text",{x:104,y:231,"font-size":14,fill:"#222","font-family":"Arial, sans-serif"},"Name (optional): _______________________________________");
  svgElement(svg,"text",{x:104,y:251,"font-size":12,fill:"#515b58","font-family":"Arial, sans-serif"},"Fill ONE bubble completely per question. Keep all four corner squares visible.");
  // Machine-readable format identifier guards against scanning a sheet with a different layout.
  svgElement(svg,"text",{x:SHEET.formatFirstX-4,y:171,"font-size":10,"font-weight":700,fill:"#3d4944","font-family":"Arial, sans-serif"},"SHEET FORMAT");
  const code=sheetFormatCode(state.total,state.choices);
  for (let i=0;i<SHEET.formatBits;i++) {
    const x=SHEET.formatFirstX+SHEET.formatGap*i;
    svgElement(svg,"rect",{x:x-SHEET.formatSize/2,y:SHEET.formatY-SHEET.formatSize/2,
      width:SHEET.formatSize,height:SHEET.formatSize,
      stroke:"#1b2523","stroke-width":1.6,fill:code&(1<<i)?"#101517":"#fff"});
  }
  svgElement(svg,"line",{x1:100,y1:275,x2:716,y2:275,stroke:"#b4c2bb","stroke-width":1.2});
  for (let col=0;col<2;col++) {
    for (let j=0;j<state.choices;j++) {
      const x=SHEET.firstX+col*SHEET.columnGap+j*SHEET.answerGap;
      svgElement(svg,"text",{x,y:302,"text-anchor":"middle","font-size":13,"font-weight":800,fill:"#39463f","font-family":"Arial, sans-serif"},ALPHABET[j]);
    }
  }
  svgElement(svg,"line",{x1:410,y1:284,x2:410,y2:892,stroke:"#e4e9e6","stroke-width":1});
  for (let n=1;n<=state.total;n++) {
    const layout=questionLayout(n,state.total,state.choices);
    svgElement(svg,"text",{x:layout.labelX,y:layout.y+5,"font-size":14,"font-weight":700,fill:"#243029","font-family":"Arial, sans-serif"},String(n).padStart(2,"0"));
    for (const bubble of layout.bubbles)
      svgElement(svg,"circle",{cx:bubble.x,cy:bubble.y,r:9,fill:"#fff",stroke:"#343e3a","stroke-width":1.8});
  }
  svgElement(svg,"line",{x1:103,y1:930,x2:713,y2:930,stroke:"#d8dfdc","stroke-width":1});
  svgElement(svg,"text",{x:103,y:957,"font-size":12,fill:"#506159","font-family":"Arial, sans-serif"},"Fill bubbles darkly using a pencil or pen. Erase cleanly if changing an answer.");
  svgElement(svg,"text",{x:103,y:977,"font-size":11,fill:"#738178","font-family":"Arial, sans-serif"},"QuickMark · The Curiosity Lab · No student data is printed in the sheet code.");
  return svg;
}

function renderSheet() {
  const sheet=buildSheet();
  $("sheetPreview").replaceChildren(sheet);
  $("printRoot").replaceChildren(sheet.cloneNode(true));
}

let countUpdateTimer=null;

function updateCountHint() {
  const hint=$("questionCountHint");
  const raw=$("questionCount").value.trim();
  const guidance=raw ? questionCountGuidance(Number(raw)) : null;
  hint.hidden=!guidance;
  hint.classList.toggle("invalid",Boolean(guidance?.invalid));
  if (guidance) hint.textContent=guidance.text;
}

// Commit after a short pause so typing "30" doesn't temporarily truncate the
// answer key to three questions. Blur/Enter still commits immediately.
function scheduleCountUpdate() {
  updateCountHint();
  clearTimeout(countUpdateTimer);
  countUpdateTimer=null;
  const raw=$("questionCount").value.trim();
  const count=Number(raw);
  if (raw && validQuestionCount(count) && count!==state.total) {
    countUpdateTimer=setTimeout(()=>{
      countUpdateTimer=null;
      changeTotal();
    },200);
  }
}

function changeTotal() {
  clearTimeout(countUpdateTimer);
  countUpdateTimer=null;
  const field=$("questionCount");
  const raw=field.value.trim();
  const total=Number(raw);
  if (!raw || !validQuestionCount(total)) {
    toast("Enter a whole number from 1 to 50.");
    field.value=String(state.total);
    updateCountHint();
    return;
  }
  if (total!==state.total) {
    const old=state.key;
    state.total=total;
    state.key=Array.from({length:total},(_,i)=>old[i]||null);
    resetScan();
    renderKey();
    renderSheet();
    save();
  }
  updateCountHint();
}

function changeChoices() {
  state.choices=Number($("choiceCount").value);
  state.key=state.key.map(a=>ALPHABET.slice(0,state.choices).includes(a)?a:null);
  resetScan();
  renderKey();save();
}

function applyPaste() {
  const raw=$("pasteAnswers").value.toUpperCase().replace(/[\s,;|.\-\/]/g,"");
  if (!raw || /[^A-E]/.test(raw) || raw.length!==state.total ||
      Array.from(raw).some(c=>!ALPHABET.slice(0,state.choices).includes(c))) {
    $("pasteMessage").textContent="Enter exactly "+state.total+" valid letters (A–"+ALPHABET[state.choices-1]+").";
    return;
  }
  resetScan();state.key=Array.from(raw);renderKey();save();
  $("pasteMessage").textContent="Answer key applied.";
  $("pasteAnswers").value="";
  toast("All "+state.total+" answers added.");
}

async function loadPhoto(file) {
  if (!keyComplete()) {toast("Finish the answer key before scanning.");return;}
  if (!file||!file.type.startsWith("image/")) {toast("Choose a photo of your answer sheet.");return;}
  if (file.size>28*1024*1024) {toast("Photo too large. Choose an image under 28 MB.");return;}
  const url=URL.createObjectURL(file);
  try {
    const photo=new Image();
    await new Promise((resolve,reject)=>{
      photo.onload=resolve;photo.onerror=()=>reject(new Error("Could not open this photo"));
      photo.src=url;
    });
    state.image=photo;state.turns=0;state.overrides={};state.detections=null;state.confirmed=false;
    $("scanIntro").hidden=true;$("scanWorkspace").hidden=false;
    $("scanFeedback").textContent="Reading alignment squares and answers…";
    $("results").hidden=true;
    await new Promise(resolve=>setTimeout(resolve,40));
    scanPhoto();
  } catch(e){toast(e.message||"Unable to read the photo");}
  finally{URL.revokeObjectURL(url);$("cameraInput").value="";$("uploadInput").value="";}
}

function renderPhotoCanvas() {
  const img=state.image;
  const sourceW=img.naturalWidth,sourceH=img.naturalHeight;
  const rotated=state.turns%2!==0;
  const originalW=rotated?sourceH:sourceW,originalH=rotated?sourceW:sourceH;
  const scale=Math.min(1,1600/Math.max(originalW,originalH));
  const canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.round(originalW*scale));
  canvas.height=Math.max(1,Math.round(originalH*scale));
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  const w=canvas.width,h=canvas.height;
  if (state.turns===1){ctx.translate(w,0);ctx.rotate(Math.PI/2);}
  else if(state.turns===2){ctx.translate(w,h);ctx.rotate(Math.PI);}
  else if(state.turns===3){ctx.translate(0,h);ctx.rotate(-Math.PI/2);}
  ctx.drawImage(img,0,0,sourceW*scale,sourceH*scale);
  return canvas;
}

function drawPreview(canvas,markers) {
  const preview=$("photoPreview");
  preview.width=canvas.width;preview.height=canvas.height;
  const ctx=preview.getContext("2d");
  ctx.drawImage(canvas,0,0);
  if (!markers) return;
  ctx.strokeStyle="#b7f16b";ctx.lineWidth=Math.max(3,canvas.width/240);
  ctx.beginPath();
  [0,1,3,2,0].forEach((idx,i)=>{
    if(i===0)ctx.moveTo(...markers[idx]);else ctx.lineTo(...markers[idx]);
  });
  ctx.stroke();
  for (const [x,y] of markers) {
    ctx.fillStyle="#e7ff8c";ctx.beginPath();
    ctx.arc(x,y,Math.max(5,canvas.width/120),0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="#151c23";ctx.lineWidth=2;ctx.stroke();
  }
}

function scanPhoto() {
  if (!state.image)return;
  try {
    const canvas=renderPhotoCanvas();
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    const gray=grayscale(ctx.getImageData(0,0,canvas.width,canvas.height));
    const markers=findMarkers(gray,canvas.width,canvas.height);
    drawPreview(canvas,markers);
    if(!markers){
      state.detections=null;$("results").hidden=true;
      $("scanFeedback").className="scan-feedback error";
      $("scanFeedback").textContent="Could not locate all four alignment squares. Keep the entire page visible, improve lighting, move closer, or rotate the photo.";
      return;
    }
    const h=homography(SHEET.markerCenters,markers);
    const actualCode=readSheetFormatCode(gray,canvas.width,canvas.height,h);
    const expectedCode=sheetFormatCode(state.total,state.choices);
    if(actualCode!==expectedCode){
      state.detections=null;$("results").hidden=true;
      $("scanFeedback").className="scan-feedback error";
      $("scanFeedback").textContent="The sheet format doesn't match this answer key (or the format marks are unclear). Print the matching sheet and retake the photo.";
      return;
    }
    state.detections=readAnswers(gray,canvas.width,canvas.height,markers,state.total,state.choices);
    state.overrides={};state.confirmed=false;
    $("scanFeedback").className="scan-feedback";
    $("scanFeedback").textContent="Four alignment squares found. Format verified. Review the detected answers before recording the grade.";
    $("results").hidden=false;
    renderResults();
  } catch(error){
    console.error("QuickMark scan failed:",error);
    state.detections=null;$("results").hidden=true;
    $("scanFeedback").className="scan-feedback error";
    $("scanFeedback").textContent="The photo couldn't be analyzed. Try again with a brighter, clearer image.";
  }
}

function currentAnswers() {
  return state.detections.map((a,i)=>{
    if(!Object.hasOwn(state.overrides,i))return a;
    const answer=state.overrides[i];
    if (answer==="-")return {...a,status:"blank",answer:null};
    if (answer==="?")return {...a,status:"review",answer:null};
    return {...a,status:"read",answer};
  });
}

function renderResults() {
  if(!state.detections)return;
  const graded=gradeAnswers(currentAnswers(),state.key);
  $("scorePercent").textContent=graded.percent+"%";
  $("scoreFraction").textContent=graded.correct+" of "+graded.total+" correct";
  $("statCorrect").textContent=graded.correct;
  $("statBlank").textContent=graded.blank;
  $("statReview").textContent=graded.flagged;
  $("scoreLabel").textContent=state.confirmed?"Confirmed grade":graded.provisional?"Provisional score":"Detected score";
  const allBlank=graded.blank===graded.total;
  const notice=$("reviewNotice");
  notice.classList.toggle("warning",graded.flagged>0||allBlank);
  notice.textContent=graded.flagged>0 ?
    graded.flagged+" question(s) need review. Choose an answer or Blank for every flagged question before confirming." :
    allBlank ? "No filled answers were detected. Check the sheet and lighting before confirming." :
    "All answers have been resolved. Please check the detections before confirming the grade.";
  $("confirmScore").disabled=graded.flagged>0||allBlank;
  $("confirmScore").textContent=state.confirmed?"Grade confirmed ✓":"Confirm grade";
  $("reviewRows").replaceChildren();
  const fragment=document.createDocumentFragment();
  for(let i=0;i<graded.rows.length;i++){
    const row=graded.rows[i];
    const wrapper=document.createElement("div");
    wrapper.className="review-row "+(row.status==="review"?"flagged":row.correct?"correct":row.status==="blank"?"":"incorrect");
    const label=document.createElement("label");label.textContent="Q"+(i+1);
    const select=document.createElement("select");
    select.setAttribute("aria-label","Detected answer for question "+(i+1));
    select.dataset.index=String(i);
    const options=[["?","Review"],["-","Blank"],...Array.from(ALPHABET.slice(0,state.choices),c=>[c,c])];
    for(const [value,text] of options){
      const option=document.createElement("option");option.value=value;option.textContent=text;select.append(option);
    }
    select.value=row.status==="review"?"?":row.answer||"-";
    const result=document.createElement("span");
    result.className=row.status==="review"?"needs":row.correct?"right":"wrong";
    result.textContent=row.status==="review"?"Check":row.correct?"✓":row.status==="blank"?"Blank":"Key "+row.expected;
    wrapper.append(label,select,result);fragment.append(wrapper);
  }
  $("reviewRows").append(fragment);
}

function resetScan() {
  state.image=null;state.detections=null;state.overrides={};state.confirmed=false;state.turns=0;
  $("scanIntro").hidden=false;$("scanWorkspace").hidden=true;$("results").hidden=true;
}

function copySummary() {
  if(!state.detections)return;
  const grade=gradeAnswers(currentAnswers(),state.key);
  const missed=grade.rows.filter(r=>!r.correct).map(r=>r.number);
  const result=(state.title||"QuickMark assessment")+"\nScore: "+grade.correct+"/"+grade.total+
    " ("+grade.percent+"%)\nReview needed: "+grade.flagged+
    "\nIncorrect/blank questions: "+(missed.join(", ")||"None")+
    "\nStatus: "+(state.confirmed?"Confirmed":"Not confirmed");
  if(navigator.clipboard&&navigator.clipboard.writeText)
    navigator.clipboard.writeText(result).then(()=>toast("Result copied."),()=>toast("Clipboard unavailable on this device."));
  else toast("Clipboard unavailable on this device.");
}

function bindEvents() {
  document.querySelectorAll(".step").forEach(button=>{
    button.addEventListener("click",()=>setTab(button.dataset.tab));
    button.addEventListener("keydown",event=>{
      if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
      event.preventDefault();
      const tabs=Array.from(document.querySelectorAll(".step"));
      const idx=tabs.indexOf(button);
      const next=event.key==="Home"?0:event.key==="End"?2:
        (idx+(event.key==="ArrowRight"?1:2))%3;
      setTab(tabs[next].dataset.tab);tabs[next].focus();
    });
  });
  $("testTitle").addEventListener("input",event=>{
    state.title=event.target.value.slice(0,70);save();
  });
  $("questionCount").addEventListener("input",scheduleCountUpdate);
  $("questionCount").addEventListener("change",changeTotal);
  $("questionCount").addEventListener("keydown",event=>{
    if (event.key==="Enter") {event.preventDefault();changeTotal();}
  });
  $("choiceCount").addEventListener("change",changeChoices);
  $("keyGrid").addEventListener("click",event=>{
    const button=event.target.closest("button[data-question]");
    if(!button)return;
    const i=Number(button.dataset.question),letter=button.dataset.letter;
    state.key[i]=state.key[i]===letter?null:letter;
    resetScan();
    syncKeyButtons(i);save();
  });
  $("clearKey").addEventListener("click",()=>{
    if(state.key.every(v=>v===null))return;
    if(!window.confirm("Clear all "+state.total+" correct answers?"))return;
    state.key=Array(state.total).fill(null);
    resetScan();
    renderKey();save();
  });
  $("applyPaste").addEventListener("click",applyPaste);
  $("shareKey").addEventListener("click",copyKeyLink);
  $("toPrint").addEventListener("click",()=>setTab("print"));
  $("toScan").addEventListener("click",()=>setTab("scan"));
  $("printButton").addEventListener("click",()=>{renderSheet();window.print();});
  $("cameraInput").addEventListener("change",event=>loadPhoto(event.target.files[0]));
  $("uploadInput").addEventListener("change",event=>loadPhoto(event.target.files[0]));
  $("rotateImage").addEventListener("click",()=>{
    if(!state.image)return;
    state.turns=(state.turns+1)%4;state.detections=null;state.confirmed=false;scanPhoto();
  });
  $("anotherPhoto").addEventListener("click",resetScan);
  $("reviewRows").addEventListener("change",event=>{
    const select=event.target.closest("select[data-index]");
    if(!select)return;
    state.overrides[Number(select.dataset.index)]=select.value;
    state.confirmed=false;renderResults();
  });
  $("confirmScore").addEventListener("click",()=>{
    if(!state.detections)return;
    const graded=gradeAnswers(currentAnswers(),state.key);
    if(graded.flagged||graded.blank===graded.total)return;
    state.confirmed=true;renderResults();toast("Grade confirmed. Ready for your next sheet.");
  });
  $("copyScore").addEventListener("click",copySummary);
}

loadSaved();
const keyImportedOnLoad=importKeyFromFragment();
$("testTitle").value=state.title;
$("questionCount").value=String(state.total);
$("choiceCount").value=String(state.choices);
renderKey();renderSheet();updateCountHint();bindEvents();
if(keyImportedOnLoad)toast("Answer key imported to this device.");
window.addEventListener("hashchange",()=>{
  if(!importKeyFromFragment())return;
  resetScan();
  $("testTitle").value=state.title;
  $("questionCount").value=String(state.total);
  $("choiceCount").value=String(state.choices);
  renderKey();renderSheet();updateCountHint();setTab("key");toast("Answer key imported to this device.");
});
if("serviceWorker" in navigator && location.protocol==="https:"){
  // Reload after an updated worker takes control so the UI uses one coherent build.
  let switchedController=false;
  navigator.serviceWorker.addEventListener("controllerchange",()=>{
    if(switchedController)return;
    switchedController=true;
    location.reload();
  });
  navigator.serviceWorker.register("./sw.js")
    .then(registration=>registration.update())
    .catch(()=>{/* The app still works online if offline support is unavailable. */});
}
