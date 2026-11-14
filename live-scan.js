/**
 * Lightweight continuity checks for browser-camera scanning.
 * Never accept a single frame as a grade.
 */
export function answerFingerprint(answers) {
  return answers.map(row => row.status === "read" ? row.answer :
    row.status === "blank" ? "-" : "?").join("|");
}

/**
 * A stable result needs several consecutive equal readings, with no long gap.
 * Invalid frames reset the candidate rather than repeating the last score.
 */
export function createReadingStabilizer(required = 3, maxGapMs = 2000) {
  if (!Number.isInteger(required) || required < 2) throw new RangeError("At least two frames required");
  let signature = null;
  let frames = 0;
  let lastTime = -Infinity;
  return {
    add(fingerprint, time) {
      if (typeof fingerprint !== "string" || !fingerprint.length ||
          !Number.isFinite(time)) {
        this.reset();
        return {stable:false, frames:0};
      }
      if (fingerprint !== signature || time - lastTime > maxGapMs || time < lastTime) {
        signature = fingerprint;
        frames = 1;
      } else {
        frames += 1;
      }
      lastTime = time;
      return {stable:frames >= required, frames, fingerprint:signature};
    },
    reset() {signature = null; frames = 0; lastTime = -Infinity;},
    get frames() {return frames;}
  };
}
