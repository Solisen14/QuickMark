/**
 * QuickMark OMR geometry and pixel reader.
 * No network calls or image storage. All coordinates are in 816 x 1056 sheet units.
 */
export const SHEET = Object.freeze({
  width: 816, height: 1056,
  markerCenters: [[64, 64], [752, 64], [64, 990], [752, 990]],
  firstY: 314, rowGap: 23, firstX: 172, columnGap: 340, answerGap: 36,
  formatFirstX: 498, formatGap: 16, formatY: 198, formatSize: 12, formatBits: 8
});

export const ALPHABET = "ABCDE";

export function validQuestionCount(value) {
  return Number.isInteger(value) && value >= 1 && value <= 50;
}

/** A suggestion, never a restriction on the teacher's question count. */
export function questionCountGuidance(total) {
  if (!validQuestionCount(total)) return {text:"Choose a whole number from 1 to 50.", invalid:true};
  if (total < 5) return {text:"This might be quicker to evaluate by hand", invalid:false};
  if (total > 25) return {text:"That's a lot of multiple choice! Consider other ways to assess student learning", invalid:false};
  return null;
}

// Version marker (bit 7) distinguishes new sheets from earlier five-size layouts.
// The remaining seven bits uniquely identify all 100 question/choice combinations.
export function sheetFormatCode(total, choices) {
  if (!validQuestionCount(total) || ![4, 5].includes(choices)) {
    throw new RangeError("Sheet format requires 1–50 questions and 4 or 5 choices");
  }
  return 128 + total + (choices === 5 ? 50 : 0);
}


export function questionLayout(number, total, choices = 5) {
  if (!Number.isInteger(number) || number < 1 || number > total) {
    throw new RangeError("Question out of range");
  }
  const perColumn = Math.ceil(total / 2);
  const column = Math.floor((number - 1) / perColumn);
  const row = (number - 1) % perColumn;
  const y = SHEET.firstY + row * SHEET.rowGap;
  return {
    number, column, row, y,
    labelX: 104 + column * SHEET.columnGap,
    bubbles: Array.from({length: choices}, (_, i) =>
      ({letter: ALPHABET[i], x: SHEET.firstX + column * SHEET.columnGap + i * SHEET.answerGap, y}))
  };
}

/** Maps sheet coordinates to image coordinates. */
export function homography(source, destination) {
  if (source.length !== 4 || destination.length !== 4) throw new Error("Four points required");
  const matrix = [], rhs = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = source[i], [u, v] = destination[i];
    matrix.push([x, y, 1, 0, 0, 0, -u*x, -u*y]);
    rhs.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v*x, -v*y]);
    rhs.push(v);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) {
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    }
    if (Math.abs(matrix[pivot][col]) < 1e-9) throw new Error("Invalid scan geometry");
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    [rhs[col], rhs[pivot]] = [rhs[pivot], rhs[col]];
    const div = matrix[col][col];
    for (let j = col; j < 8; j++) matrix[col][j] /= div;
    rhs[col] /= div;
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const multiplier = matrix[row][col];
      for (let j = col; j < 8; j++) matrix[row][j] -= multiplier * matrix[col][j];
      rhs[row] -= multiplier * rhs[col];
    }
  }
  return [...rhs, 1];
}

export function mapPoint(h, x, y) {
  const d = h[6]*x + h[7]*y + h[8];
  if (!Number.isFinite(d) || Math.abs(d) < 1e-9) return [NaN, NaN];
  return [(h[0]*x+h[1]*y+h[2])/d, (h[3]*x+h[4]*y+h[5])/d];
}

/**
 * Read the printed eight-bit sheet identifier from a perspective-corrected photo.
 * Returns null if the markers are too unclear to verify confidently.
 */
export function readSheetFormatCode(gray, width, height, h) {
  let code = 0;
  for (let i = 0; i < SHEET.formatBits; i++) {
    const cx = SHEET.formatFirstX + SHEET.formatGap * i;
    const values = [];
    for (let dy = -3; dy <= 3; dy += 3) {
      for (let dx = -3; dx <= 3; dx += 3) {
        const [u, v] = mapPoint(h, cx + dx, SHEET.formatY + dy);
        const x = Math.round(u), y = Math.round(v);
        if (x >= 0 && x < width && y >= 0 && y < height) {
          values.push(gray[y * width + x]);
        }
      }
    }
    const [bx, by] = mapPoint(h, cx, SHEET.formatY + 21);
    const x = Math.round(bx), y = Math.round(by);
    if (values.length < 6 || x < 0 || x >= width || y < 0 || y >= height) return null;
    const level = values.reduce((a, b) => a + b, 0) / values.length;
    const background = gray[y * width + x];
    const contrast = background - level;
    if (contrast > 50) code |= 1 << i;
    else if (contrast > 20) return null; // Do not guess ambiguous format markers.
  }
  return code;
}

export function grayscale(imageData) {
  const {data, width, height} = imageData;
  const gray = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = Math.round(0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2]);
  }
  return gray;
}

function percentile(array, fraction) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < array.length; i += 3) hist[array[i]]++;
  const target = Math.ceil(Math.ceil(array.length / 3) * fraction);
  let count = 0;
  for (let i = 0; i < 256; i++) {
    count += hist[i];
    if (count >= target) return i;
  }
  return 255;
}

/**
 * Finds the four large, filled square alignment marks.
 * Returns null rather than assuming coordinates when confidence is insufficient.
 */
export function findMarkers(gray, width, height) {
  if (gray.length !== width * height) throw new Error("Invalid image dimensions");
  const bright = percentile(gray, .88);
  const cutoff = Math.max(65, Math.min(166, Math.round(bright * .61)));
  const seen = new Uint8Array(gray.length);
  const queue = new Int32Array(gray.length);
  const minSide = Math.max(10, Math.round(Math.min(width, height) * .009));
  const maxSide = Math.round(Math.min(width, height) * .115);
  const candidates = [];

  for (let start = 0; start < gray.length; start++) {
    if (seen[start]) continue;
    seen[start] = 1;
    if (gray[start] > cutoff) continue;
    let head = 0, tail = 1;
    queue[0] = start;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    while (head < tail) {
      const index = queue[head++];
      const x = index % width, y = (index / width) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const near = [x > 0 ? index-1 : -1, x < width-1 ? index+1 : -1,
                    y > 0 ? index-width : -1, y < height-1 ? index+width : -1];
      for (const next of near) {
        if (next < 0 || seen[next]) continue;
        seen[next] = 1;
        if (gray[next] <= cutoff) queue[tail++] = next;
      }
    }
    const w = maxX-minX+1, h = maxY-minY+1, area = tail;
    const fill = area/(w*h), ratio = w/h;
    if (w >= minSide && h >= minSide && w <= maxSide && h <= maxSide &&
        area >= minSide*minSide*.64 && fill >= .82 && ratio > .57 && ratio < 1.72) {
      candidates.push({x:(minX+maxX)/2, y:(minY+maxY)/2, area, fill});
    }
  }
  const quadrants = [[],[],[],[]];
  for (const c of candidates) {
    const quadrant = (c.y >= height/2 ? 2 : 0) + (c.x >= width/2 ? 1 : 0);
    quadrants[quadrant].push(c);
  }
  if (quadrants.some(q => q.length === 0)) return null;
  for (const q of quadrants) {
    q.sort((a,b) => b.area-a.area);
    q.length = Math.min(q.length, 9);
  }
  let best = null, bestScore = -Infinity;
  for (const tl of quadrants[0]) for (const tr of quadrants[1])
  for (const bl of quadrants[2]) for (const br of quadrants[3]) {
    const top = Math.hypot(tr.x-tl.x,tr.y-tl.y);
    const bottom = Math.hypot(br.x-bl.x,br.y-bl.y);
    const left = Math.hypot(bl.x-tl.x,bl.y-tl.y);
    const right = Math.hypot(br.x-tr.x,br.y-tr.y);
    if (tr.x <= tl.x || br.x <= bl.x || bl.y <= tl.y || br.y <= tr.y) continue;
    const pageWidth = (top+bottom)/2, pageHeight = (left+right)/2;
    const coverage = pageWidth*pageHeight/(width*height);
    if (coverage < .10 || pageWidth < width*.22 || pageHeight < height*.22) continue;
    const areas = [tl.area,tr.area,bl.area,br.area];
    const variation = Math.max(...areas)/Math.min(...areas);
    if (variation > 4.5) continue;
    const aspectError = Math.abs(Math.log((pageWidth/pageHeight)/(688/926)));
    if (aspectError > .9) continue;
    const parallelPenalty = Math.abs(Math.log(top/bottom)) + Math.abs(Math.log(left/right));
    const score = coverage*7 + Math.log(Math.min(...areas))*.18 -
      aspectError*1.1 - parallelPenalty*.38 - Math.log(variation)*.6;
    if (score > bestScore) {
      bestScore = score;
      best = [[tl.x,tl.y],[tr.x,tr.y],[bl.x,bl.y],[br.x,br.y]];
    }
  }
  return best;
}

function imagePixel(gray, width, height, x, y) {
  const px = Math.round(x), py = Math.round(y);
  if (px < 0 || py < 0 || px >= width || py >= height) return NaN;
  return gray[py*width+px];
}

function readBubble(gray, width, height, h, x, y) {
  let sum = 0, count = 0, dark = 0;
  for (let dy = -6; dy <= 6; dy += 3) {
    for (let dx = -6; dx <= 6; dx += 3) {
      if (dx*dx + dy*dy > 41) continue;
      const [u,v] = mapPoint(h,x+dx,y+dy);
      const level = imagePixel(gray,width,height,u,v);
      if (!Number.isFinite(level)) continue;
      sum += level; count++;
      if (level < 155) dark++;
    }
  }
  const margins = [[-15,0],[15,0],[-14,5],[14,5]];
  let bgSum = 0, bgCount = 0;
  for (const [dx,dy] of margins) {
    const [u,v] = mapPoint(h,x+dx,y+dy);
    const p = imagePixel(gray,width,height,u,v);
    if (Number.isFinite(p)) {bgSum+=p;bgCount++;}
  }
  if (count < 10 || bgCount < 3) return {state:"uncertain",contrast:0};
  const mean = sum/count, bg = bgSum/bgCount;
  const contrast = bg-mean;
  const inkFraction = dark/count;
  // Relative contrast helps with uneven lighting; uncertain marks require manual review.
  const state = contrast >= 51 && (inkFraction >= .12 || contrast >= 74)
    ? "marked" : contrast >= 19 ? "uncertain" : "empty";
  return {state, contrast:Math.round(contrast), inkFraction};
}

export function readAnswers(gray, width, height, markers, total, choices) {
  const h = homography(SHEET.markerCenters, markers);
  const answers = [];
  for (let n = 1; n <= total; n++) {
    const {bubbles} = questionLayout(n,total,choices);
    const readings = bubbles.map(b => ({letter:b.letter,...readBubble(gray,width,height,h,b.x,b.y)}));
    const marked = readings.filter(r => r.state === "marked");
    const uncertain = readings.filter(r => r.state === "uncertain");
    let status = "blank", answer = null;
    if (marked.length === 1 && uncertain.length === 0) {
      answer = marked[0].letter;
      status = "read";
    } else if (marked.length > 1 || uncertain.length > 0) {
      status = "review";
    }
    answers.push({number:n, status, answer, readings});
  }
  return answers;
}

export function gradeAnswers(answers, key) {
  let correct=0, flagged=0, blank=0;
  const rows = answers.map((a,i) => {
    const expected = key[i] || null;
    const match = a.status === "read" && a.answer === expected;
    if (match) correct++;
    if (a.status === "review") flagged++;
    if (a.status === "blank") blank++;
    return {...a,expected,correct:match};
  });
  return {rows, correct, total:key.length, percent: key.length ? Math.round(correct/key.length*1000)/10 : 0,
          flagged, blank, provisional:flagged>0};
}
