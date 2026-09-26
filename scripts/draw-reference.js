// Trusty's reference pose for Draw Trusty, on a 500x500 canvas. The grader and the
// leaderboard overlay both use this, so it must stay identical to what scores were graded against.
export const DRAW_SIZE = 500;

const SEGMENTS = [
  [100, 275, 150, 340], // neck
  [150, 340, 425, 340], // back
  [200, 345, 150, 445], // front legs
  [200, 345, 250, 445],
  [350, 345, 300, 445], // back legs
  [350, 345, 400, 445],
];

export function strokeTrusty(ctx, { lineWidth, color = 'black', lineJoin = 'round' }) {
  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = lineJoin;

  ctx.beginPath();
  ctx.ellipse(100, 180, 75, 75 * 1.25, 0, 0, Math.PI * 2); // head
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(100, 220, 28, 25 * 1.25, 0, -Math.PI / 20, Math.PI + Math.PI / 20); // mouth
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(80, 130); ctx.lineTo(80, 180); // eyes
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(120, 130); ctx.lineTo(120, 180);
  ctx.stroke();

  for (const [x1, y1, x2, y2] of SEGMENTS) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.restore();
}

export function referenceCanvas(lineWidth, color = 'black') {
  const canvas = document.createElement('canvas');
  canvas.width = DRAW_SIZE;
  canvas.height = DRAW_SIZE;
  strokeTrusty(canvas.getContext('2d'), { lineWidth, color });
  return canvas;
}
