// Trusty's reference pose for Draw Trusty, on a 500x500 canvas. The game draws it, the leaderboard
// overlays it, and scripts/draw-grader.js (in the browser and in api/draw-api.js) grades against it.
export const DRAW_SIZE = 500;
export const BRUSH_WIDTH = 5;

export const TRUSTY = [
  { part: 'head', type: 'ellipse', cx: 100, cy: 180, rx: 75, ry: 75 * 1.25, start: 0, end: Math.PI * 2 },
  { part: 'mouth', type: 'ellipse', cx: 100, cy: 220, rx: 28, ry: 25 * 1.25, start: -Math.PI / 20, end: Math.PI + Math.PI / 20 },
  { part: 'eyes', type: 'line', x1: 80, y1: 130, x2: 80, y2: 180 },
  { part: 'eyes', type: 'line', x1: 120, y1: 130, x2: 120, y2: 180 },
  { part: 'neck', type: 'line', x1: 100, y1: 275, x2: 150, y2: 340 },
  { part: 'back', type: 'line', x1: 150, y1: 340, x2: 425, y2: 340 },
  { part: 'legs', type: 'line', x1: 200, y1: 345, x2: 150, y2: 445 },
  { part: 'legs', type: 'line', x1: 200, y1: 345, x2: 250, y2: 445 },
  { part: 'legs', type: 'line', x1: 350, y1: 345, x2: 300, y2: 445 },
  { part: 'legs', type: 'line', x1: 350, y1: 345, x2: 400, y2: 445 },
];

export function strokeTrusty(ctx, { lineWidth, color = 'black', lineJoin = 'round' }) {
  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = lineJoin;
  for (const shape of TRUSTY) {
    ctx.beginPath();
    if (shape.type === 'ellipse') {
      ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, shape.start, shape.end);
    } else {
      ctx.moveTo(shape.x1, shape.y1);
      ctx.lineTo(shape.x2, shape.y2);
    }
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
