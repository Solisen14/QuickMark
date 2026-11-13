import test from "node:test";
import assert from "node:assert/strict";
import {SHEET, questionLayout, homography, mapPoint, findMarkers, readAnswers, gradeAnswers, validQuestionCount, questionCountGuidance, sheetFormatCode, readSheetFormatCode} from "../omr.js";

function makeSheet(total=20, choices=4, responses=[]) {
  const width=SHEET.width,height=SHEET.height,gray=new Uint8Array(width*height).fill(249);
  const pixel=(x,y,v)=>{
    if(x>=0&&x<width&&y>=0&&y<height)gray[y*width+x]=v;
  };
  for(const [cx,cy] of SHEET.markerCenters)
    for(let y=cy-14;y<cy+14;y++)for(let x=cx-14;x<cx+14;x++)pixel(x,y,20);
  const code=sheetFormatCode(total,choices);
  for(let bit=0;bit<SHEET.formatBits;bit++){
    const cx=SHEET.formatFirstX+SHEET.formatGap*bit;
    for(let dy=-6;dy<=6;dy++)for(let dx=-6;dx<=6;dx++){
      if(Math.abs(dx)===6||Math.abs(dy)===6||(code&(1<<bit))) {
        pixel(cx+dx,SHEET.formatY+dy,20);
      }
    }
  }
  for(let n=1;n<=total;n++){
    const layout=questionLayout(n,total,choices);
    const marks=responses[n-1]||"";
    for(const bubble of layout.bubbles){
      for(let dy=-11;dy<=11;dy++)for(let dx=-11;dx<=11;dx++){
        const d=Math.sqrt(dx*dx+dy*dy);
        if(d>=8&&d<=10) pixel(bubble.x+dx,bubble.y+dy,55);
        if(marks.includes(bubble.letter)&&d<=7.3)pixel(bubble.x+dx,bubble.y+dy,30);
      }
    }
  }
  return {width,height,gray};
}

test("question positions stay on a letter-sized page for 50 questions",()=>{
  const first=questionLayout(1,50,5);
  const secondColumn=questionLayout(26,50,5);
  const last=questionLayout(50,50,5);
  assert.equal(first.bubbles[0].x,172);
  assert.equal(secondColumn.bubbles[0].x,512);
  assert.equal(last.y,866);
  assert.ok(last.bubbles.at(-1).x<752);
});

test("homography maps a distorted quadrilateral to the requested image corners",()=>{
  const destination=[[76,88],[730,65],[99,1050],[759,1020]];
  const h=homography(SHEET.markerCenters,destination);
  SHEET.markerCenters.forEach((point,i)=>{
    const got=mapPoint(h,...point);
    assert.ok(Math.abs(got[0]-destination[i][0])<.001);
    assert.ok(Math.abs(got[1]-destination[i][1])<.001);
  });
});

test("detects four alignment squares and correctly scores shaded bubbles",()=>{
  const correct=Array.from({length:20},(_,i)=>"ABCD"[i%4]);
  const responses=correct.slice();
  responses[3]="A";responses[10]="B";responses[17]="C";
  const {width,height,gray}=makeSheet(20,4,responses);
  const markers=findMarkers(gray,width,height);
  assert.ok(markers,"all four markers must be found");
  markers.forEach((xy,i)=>{
    assert.ok(Math.abs(xy[0]-SHEET.markerCenters[i][0])<=1);
    assert.ok(Math.abs(xy[1]-SHEET.markerCenters[i][1])<=1);
  });
  const detected=readAnswers(gray,width,height,markers,20,4);
  assert.equal(detected.filter(r=>r.status==="read").length,20);
  assert.deepEqual(detected.map(r=>r.answer),responses);
  const graded=gradeAnswers(detected,correct);
  assert.equal(graded.correct,17);
  assert.equal(graded.percent,85);
  assert.equal(graded.flagged,0);
});

test("blank and multiple marks are not guessed",()=>{
  const responses=Array(10).fill("A");
  responses[1]="";responses[4]="AB";
  const {width,height,gray}=makeSheet(10,5,responses);
  const markers=findMarkers(gray,width,height);
  assert.ok(markers);
  const detected=readAnswers(gray,width,height,markers,10,5);
  assert.equal(detected[1].status,"blank");
  assert.equal(detected[1].answer,null);
  assert.equal(detected[4].status,"review");
  assert.equal(detected[4].answer,null);
  const graded=gradeAnswers(detected,Array(10).fill("A"));
  assert.equal(graded.flagged,1);
  assert.equal(graded.blank,1);
  assert.equal(graded.provisional,true);
});

test("no four printed markers means no confident reading",()=>{
  const width=816,height=1056,gray=new Uint8Array(width*height).fill(255);
  assert.equal(findMarkers(gray,width,height),null);
});

test("every 50-question format is supported",()=>{
  for(const choices of [4,5]){
    const responses=Array.from({length:50},(_,i)=>"ABCDE"[i%choices]);
    const {width,height,gray}=makeSheet(50,choices,responses);
    const markers=findMarkers(gray,width,height);
    assert.ok(markers);
    const found=readAnswers(gray,width,height,markers,50,choices);
    assert.deepEqual(found.map(r=>r.answer),responses);
  }
});

test("the question-count field accepts whole numbers 1–50 only",()=>{
  for(let n=1;n<=50;n++)assert.equal(validQuestionCount(n),true);
  for(const n of [0,-1,51,100,1.5,NaN,"20",null])assert.equal(validQuestionCount(n),false);
});

test("guidance is gentle at the requested boundaries, not a restriction",()=>{
  const short="This might be quicker to evaluate by hand";
  const long="That's a lot of multiple choice! Consider other ways to assess student learning";
  for(const n of [1,2,3,4])assert.deepEqual(questionCountGuidance(n),{text:short,invalid:false});
  for(const n of [5,10,20,25])assert.equal(questionCountGuidance(n),null);
  for(const n of [26,27,40,50])assert.deepEqual(questionCountGuidance(n),{text:long,invalid:false});
  assert.equal(questionCountGuidance(0).invalid,true);
  assert.equal(questionCountGuidance(51).invalid,true);
  assert.equal(validQuestionCount(1),true);
  assert.equal(validQuestionCount(50),true);
});

test("all 100 printable answer-sheet formats have unique identifiers",()=>{
  const used=new Set();
  for(let total=1;total<=50;total++){
    for(const choices of [4,5]){
      const code=sheetFormatCode(total,choices);
      assert.ok(code>=128&&code<256,"new format's version bit must always be set");
      assert.ok(!used.has(code),"format code must never collide");
      used.add(code);
    }
  }
  assert.equal(used.size,100);
  assert.throws(()=>sheetFormatCode(0,4),RangeError);
  assert.throws(()=>sheetFormatCode(51,5),RangeError);
  assert.throws(()=>sheetFormatCode(20,6),RangeError);
});

test("every boundary count scans from a matching printed-sheet code",()=>{
  for(const total of [1,4,5,24,25,26,27,50]){
    for(const choices of [4,5]){
      const responses=Array.from({length:total},(_,i)=>"ABCDE"[i%choices]);
      const {width,height,gray}=makeSheet(total,choices,responses);
      const markers=findMarkers(gray,width,height);
      assert.ok(markers,"alignment must work for "+total+" questions");
      const h=homography(SHEET.markerCenters,markers);
      assert.equal(readSheetFormatCode(gray,width,height,h),sheetFormatCode(total,choices));
      const found=readAnswers(gray,width,height,markers,total,choices);
      assert.deepEqual(found.map(r=>r.answer),responses);
      const grade=gradeAnswers(found,responses);
      assert.equal(grade.correct,total);
      assert.equal(grade.percent,100);
    }
  }
});

test("an old four-bit sheet is never mistaken for a new format",()=>{
  const {width,height,gray}=makeSheet(20,4,Array(20).fill("A"));
  // Remove the new versioned bit squares. The old legacy flags were elsewhere.
  for(let i=0;i<SHEET.formatBits;i++){
    const cx=SHEET.formatFirstX+SHEET.formatGap*i;
    for(let y=SHEET.formatY-6;y<=SHEET.formatY+6;y++)
      for(let x=cx-6;x<=cx+6;x++)gray[y*width+x]=249;
  }
  const h=homography(SHEET.markerCenters,SHEET.markerCenters);
  assert.notEqual(readSheetFormatCode(gray,width,height,h),sheetFormatCode(20,4));
});
