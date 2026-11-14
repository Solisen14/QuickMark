import {
  SHEET, grayscale, findMarkers, homography, readSheetFormatCode,
  sheetFormatCode, readAnswers, gradeAnswers, mapPoint
} from "./omr.js?v=0.3";
import {answerFingerprint, createReadingStabilizer} from "./live-scan.js?v=0.6";

const MAX_FRAME_EDGE = 1100;
const SCAN_INTERVAL_MS = 520;

/**
 * Client-side, permission-based camera scanner. No media leaves this page.
 * onStable delivers a stable read for the existing grading/review interface.
 */
export function initLiveCameraScanner({isKeyReady, getSettings, onStable, onNext}) {
  const $ = id => document.getElementById(id);
  const video = $("liveVideo");
  const overlay = $("liveOverlay");
  const stage = $("liveCameraStage");
  const liveArea = $("liveWorkspace");
  const scanIntro = $("scanIntro");
  const status = $("liveStatus");
  const scoreBadge = $("liveScoreBadge");
  const scoreLabel = $("liveScoreLabel");
  const scoreValue = $("liveScoreValue");
  const nextButton = $("liveNextSheet");
  const reviewButton = $("liveReview");
  const cameraError = $("cameraUnavailable");
  const stopButton = $("stopLiveScan");
  const startButton = $("startLiveScan");

  const scratch = document.createElement("canvas");
  const scratchCtx = scratch.getContext("2d", {willReadFrequently:true});
  const tracker = createReadingStabilizer(3, 2000);

  let stream = null;
  let generation = 0;
  let timer = null;
  let frozen = false;
  let waitingForRemoval = false;
  let latestMarkers = null;
  let latestHomography = null;
  let latestGrade = null;

  const active = () => Boolean(stream);

  function updateStatus(message, kind = "") {
    if (status.textContent !== message) status.textContent = message;
    status.dataset.kind = kind;
  }

  function drawOverlay(markers, projection, grade = null) {
    if (!scratch.width || !scratch.height) return;
    overlay.width = scratch.width;
    overlay.height = scratch.height;
    const ctx = overlay.getContext("2d");
    ctx.clearRect(0,0,overlay.width,overlay.height);
    if (!markers) return;
    const unit = Math.max(2, overlay.width / 280);
    ctx.lineJoin = "round";
    ctx.lineWidth = unit * 1.5;
    ctx.strokeStyle = grade ? "#dff28a" : "#91d1ed";
    ctx.beginPath();
    for (const [i,index] of [0,1,3,2,0].entries()) {
      if (i===0) ctx.moveTo(...markers[index]);
      else ctx.lineTo(...markers[index]);
    }
    ctx.stroke();

    for (const [x,y] of markers) {
      ctx.fillStyle = grade ? "#dff28a" : "#91d1ed";
      ctx.beginPath();
      ctx.arc(x,y,unit * 2.3,0,2*Math.PI);
      ctx.fill();
    }

    if (!grade || !projection) return;

    // Project the grade onto the header region of the actual paper.
    const [x,y] = mapPoint(projection, 408, 154);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const fontSize = Math.max(19, Math.min(37,overlay.width/22));
    const label = grade.correct + "/" + grade.total + " · " + grade.percent + "%";
    ctx.save();
    ctx.font = "800 "+fontSize+"px system-ui, sans-serif";
    const textWidth=ctx.measureText(label).width;
    const width=textWidth+fontSize*1.15;
    const height=fontSize*1.55;
    const left=Math.max(5,Math.min(x-width/2,overlay.width-width-5));
    const top=Math.max(5,Math.min(y-height/2,overlay.height-height-5));
    ctx.fillStyle="rgba(17,31,26,.94)";
    if (ctx.roundRect) {
      ctx.beginPath();ctx.roundRect(left,top,width,height,Math.max(7,fontSize/4));ctx.fill();
    } else ctx.fillRect(left,top,width,height);
    ctx.fillStyle="#dff28a";
    ctx.textAlign="center";
    ctx.textBaseline="middle";
    ctx.fillText(label,left+width/2,top+height/2);
    ctx.restore();
  }

  function showGrade(grade, confirmed = false) {
    latestGrade=grade;
    if (!grade || !frozen) return;
    scoreBadge.hidden=false;
    scoreLabel.textContent=confirmed ? "GRADE CONFIRMED" :
      grade.flagged ? "PROVISIONAL · REVIEW NEEDED" : "RESULT READY · VERIFY";
    scoreValue.textContent=grade.correct+"/"+grade.total+" · "+grade.percent+"%";
    drawOverlay(latestMarkers,latestHomography,grade);
  }

  function stop() {
    const wasLive = !liveArea.hidden || Boolean(stream);
    generation++;
    if (timer !== null) clearTimeout(timer);
    timer=null;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream=null;
    }
    video.pause();
    video.srcObject=null;
    tracker.reset();
    frozen=false;
    waitingForRemoval=false;
    latestMarkers=null;
    latestHomography=null;
    latestGrade=null;
    scoreBadge.hidden=true;
    nextButton.hidden=true;
    reviewButton.hidden=true;
    liveArea.hidden=true;
    scanIntro.hidden=false;
    overlay.width=1;overlay.height=1;
    startButton.disabled=false;
    startButton.textContent="◉ Start live scan";
    if (wasLive) onNext();
  }

  function queueNext(token) {
    if (token!==generation || !active() || frozen) return;
    timer=setTimeout(()=>scanFrame(token),SCAN_INTERVAL_MS);
  }

  function scanFrame(token) {
    if (token!==generation || !active() || frozen) return;
    try {
      const w=video.videoWidth,h=video.videoHeight;
      if (!w || !h || video.readyState < 2) {
        updateStatus("Waiting for camera video…");
        queueNext(token);
        return;
      }
      const scale=Math.min(1,MAX_FRAME_EDGE/Math.max(w,h));
      const width=Math.round(w*scale),height=Math.round(h*scale);
      if (scratch.width!==width || scratch.height!==height) {
        scratch.width=width;
        scratch.height=height;
      }
      scratchCtx.drawImage(video,0,0,width,height);
      const pixels=scratchCtx.getImageData(0,0,width,height);
      const gray=grayscale(pixels);
      const markers=findMarkers(gray,width,height);

      if (!markers) {
        tracker.reset();
        latestMarkers=null;latestHomography=null;
        drawOverlay(null,null);
        if (waitingForRemoval) {
          waitingForRemoval=false;
          updateStatus("Position the next sheet so all four corner squares are visible.");
        } else {
          updateStatus("Looking for four corner squares. Fill the frame with the page.");
        }
        queueNext(token);
        return;
      }

      const projection=homography(SHEET.markerCenters,markers);
      latestMarkers=markers;latestHomography=projection;
      drawOverlay(markers,projection);

      if (waitingForRemoval) {
        tracker.reset();
        updateStatus("Move the previous sheet out of view before scanning the next.");
        queueNext(token);
        return;
      }

      const settings=getSettings();
      const format=readSheetFormatCode(gray,width,height,projection);
      if (format!==sheetFormatCode(settings.total,settings.choices)) {
        tracker.reset();
        updateStatus("Page detected, but its format doesn't match your current answer key.","warning");
        queueNext(token);
        return;
      }

      const answers=readAnswers(gray,width,height,markers,settings.total,settings.choices);
      const recognized=answers.filter(a=>a.status==="read").length;
      if (!recognized) {
        tracker.reset();
        updateStatus("Page found. No clearly filled answers yet; hold steady or improve lighting.","warning");
        queueNext(token);
        return;
      }
      const result=tracker.add(answerFingerprint(answers),performance.now());
      if (!result.stable) {
        updateStatus("Reading answers… "+result.frames+" of 3 consistent frames.");
        queueNext(token);
        return;
      }

      // Capture the stable result before returning control to the UI.
      frozen=true;
      const grade=gradeAnswers(answers,settings.key);
      showGrade(grade);
      nextButton.hidden=false;
      reviewButton.hidden=false;
      updateStatus(grade.flagged ?
        "Stable reading found. Review ambiguous marks before confirming a grade." :
        "Stable reading found. Check and confirm this result.","ready");
      onStable(answers);
    } catch (error) {
      tracker.reset();
      console.error("QuickMark live scan error:",error);
      updateStatus("Couldn't read this frame. Adjust lighting or try the photo option.","warning");
      queueNext(token);
    }
  }

  async function start() {
    if (!isKeyReady()) {
      cameraError.hidden=false;
      cameraError.textContent="Finish your answer key before starting the camera.";
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      cameraError.hidden=false;
      cameraError.textContent="Live camera access is unavailable here. Use Take photo or Choose photo.";
      return;
    }

    stop();
    onNext();
    cameraError.hidden=true;
    scanIntro.hidden=true;
    liveArea.hidden=false;
    updateStatus("Requesting rear camera permission…");
    startButton.disabled=true;
    const token=generation;
    try {
      const opened=await navigator.mediaDevices.getUserMedia({
        audio:false,
        video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:960}}
      });
      if (token!==generation) {
        opened.getTracks().forEach(track=>track.stop());
        return;
      }
      stream=opened;
      video.srcObject=stream;
      video.muted=true;
      video.playsInline=true;
      await video.play();
      if (token!==generation)return;
      updateStatus("Point the rear camera at a completed QuickMark sheet.");
      queueNext(token);
    } catch (error) {
      if (token!==generation)return;
      console.warn("QuickMark camera access unavailable:",error?.name||error);
      stop();
      cameraError.hidden=false;
      cameraError.textContent=
        error?.name==="NotAllowedError" || error?.name==="PermissionDeniedError"
          ? "Camera access was declined. Allow camera access in your browser or use Take photo."
          : "Unable to start live scanning on this device. Take photo and Choose photo still work.";
    }
  }

  function next() {
    if (!active() || !frozen) return;
    frozen=false;
    waitingForRemoval=true;
    latestGrade=null;
    tracker.reset();
    scoreBadge.hidden=true;
    nextButton.hidden=true;
    reviewButton.hidden=true;
    onNext();
    drawOverlay(latestMarkers,latestHomography);
    updateStatus("Move the previous sheet out of view to scan the next.");
    queueNext(generation);
  }

  startButton.addEventListener("click",start);
  stopButton.addEventListener("click",stop);
  nextButton.addEventListener("click",next);
  reviewButton.addEventListener("click",()=>document.getElementById("results")?.scrollIntoView({
    behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth",block:"start"
  }));
  document.addEventListener("visibilitychange",()=>{
    if(document.hidden && active())stop();
  });
  window.addEventListener("pagehide",()=>{if(active())stop();});

  return {start,stop,showGrade,active, get frozen(){return frozen;}};
}
