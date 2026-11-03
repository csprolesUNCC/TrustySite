import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeDrawing } from '../scripts/draw-grader.js';
import { TRUSTY, DRAW_SIZE, BRUSH_WIDTH } from '../scripts/draw-reference.js';

// Draws shapes into 500x500 RGBA pixels with a round brush, the way the game's canvas would.
function draw(shapes, { dx = 0, dy = 0, scale = 1 } = {}) {
  const rgba = new Uint8ClampedArray(DRAW_SIZE * DRAW_SIZE * 4);
  const r = BRUSH_WIDTH / 2;
  const dab = (x, y) => {
    x = x * scale + dx;
    y = y * scale + dy;
    for (let py = Math.floor(y - r); py <= Math.ceil(y + r); py++) {
      for (let px = Math.floor(x - r); px <= Math.ceil(x + r); px++) {
        if (px < 0 || py < 0 || px >= DRAW_SIZE || py >= DRAW_SIZE || (px - x) ** 2 + (py - y) ** 2 > r * r) continue;
        rgba[(py * DRAW_SIZE + px) * 4 + 3] = 255;
      }
    }
  };
  for (const s of shapes) {
    if (s.type === 'ellipse') {
      for (let t = s.start; t <= s.end; t += 0.01) dab(s.cx + s.rx * Math.cos(t), s.cy + s.ry * Math.sin(t));
    } else {
      const steps = Math.ceil(Math.hypot(s.x2 - s.x1, s.y2 - s.y1));
      for (let i = 0; i <= steps; i++) dab(s.x1 + ((s.x2 - s.x1) * i) / steps, s.y1 + ((s.y2 - s.y1) * i) / steps);
    }
  }
  return rgba;
}

test('a perfect trace of the reference scores near the top', () => {
  const { score } = gradeDrawing(draw(TRUSTY));
  assert.ok(score >= 90, `scored ${score}`);
  assert.ok(score <= 100);
});

test('a blank page scores 0', () => {
  assert.equal(gradeDrawing(new Uint8ClampedArray(DRAW_SIZE * DRAW_SIZE * 4)).score, 0);
});

test('missing parts cost points, and a drawing of something else scores low', () => {
  const full = gradeDrawing(draw(TRUSTY)).score;
  const noLegs = gradeDrawing(draw(TRUSTY.filter((s) => s.part !== 'legs'))).score;
  const headOnly = gradeDrawing(draw(TRUSTY.filter((s) => s.part === 'head'))).score;
  const box = gradeDrawing(draw([
    { type: 'line', x1: 50, y1: 50, x2: 450, y2: 50 }, { type: 'line', x1: 450, y1: 50, x2: 450, y2: 450 },
    { type: 'line', x1: 450, y1: 450, x2: 50, y2: 450 }, { type: 'line', x1: 50, y1: 450, x2: 50, y2: 50 },
  ])).score;
  assert.ok(noLegs < full, `no legs ${noLegs} vs full ${full}`);
  assert.ok(headOnly < noLegs, `head only ${headOnly} vs no legs ${noLegs}`);
  assert.ok(box < 40, `a box scored ${box}`);
});

test('the same drawing always gets the same score (the server re-grades what the browser graded)', () => {
  const pixels = draw(TRUSTY, { dx: 12, dy: -8 });
  assert.equal(gradeDrawing(pixels).score, gradeDrawing(pixels).score);
});

test('a drawing of the wrong size is refused', () => {
  assert.throws(() => gradeDrawing(new Uint8ClampedArray(10)));
});
