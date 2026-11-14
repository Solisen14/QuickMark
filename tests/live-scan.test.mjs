import test from "node:test";
import assert from "node:assert/strict";
import {answerFingerprint, createReadingStabilizer} from "../live-scan.js";

const answers = (values) => values.map((value, i) => ({
  number:i+1,
  status:value==="-" ? "blank" : value==="?" ? "review" : "read",
  answer:value==="-"||value==="?" ? null : value
}));

test("live scanner requires three consistent frames before showing a result",()=>{
  const tracker=createReadingStabilizer();
  const signature=answerFingerprint(answers(["A","C","B","-"]));
  assert.deepEqual(tracker.add(signature,100),{stable:false,frames:1,fingerprint:signature});
  assert.deepEqual(tracker.add(signature,600),{stable:false,frames:2,fingerprint:signature});
  assert.deepEqual(tracker.add(signature,1100),{stable:true,frames:3,fingerprint:signature});
});

test("a changing bubble cannot immediately produce a grade",()=>{
  const tracker=createReadingStabilizer();
  const first=answerFingerprint(answers(["A","B"]));
  const changed=answerFingerprint(answers(["A","C"]));
  tracker.add(first,0);
  tracker.add(first,520);
  assert.equal(tracker.add(changed,1040).stable,false);
  assert.equal(tracker.add(changed,1560).stable,false);
  assert.equal(tracker.add(changed,2080).stable,true);
});

test("lost page, unclear frame and long gaps clear stability",()=>{
  const tracker=createReadingStabilizer();
  const frame=answerFingerprint(answers(["A","B","C"]));
  tracker.add(frame,100);
  tracker.add(frame,620);
  assert.equal(tracker.add(null,1140).stable,false);
  assert.equal(tracker.add(frame,1660).frames,1);
  assert.equal(tracker.add(frame,5000).frames,1);
  assert.equal(tracker.add(frame,5500).frames,2);
});

test("ambiguous and blank answers are distinct fingerprints, not guessed letters",()=>{
  const known=answerFingerprint(answers(["A","B","-"]));
  const uncertain=answerFingerprint(answers(["A","B","?"]));
  assert.notEqual(known,uncertain);
  assert.equal(known,"A|B|-");
  assert.equal(uncertain,"A|B|?");
});

test("new next-sheet session cannot inherit previous stable reading",()=>{
  const tracker=createReadingStabilizer();
  const frame=answerFingerprint(answers(["D"]));
  tracker.add(frame,100);
  tracker.add(frame,600);
  assert.equal(tracker.add(frame,1200).stable,true);
  tracker.reset();
  assert.equal(tracker.add(frame,1800).frames,1);
  assert.equal(tracker.add(frame,2300).stable,false);
});

test("invalid required frame count is rejected",()=>{
  assert.throws(()=>createReadingStabilizer(1),RangeError);
});
