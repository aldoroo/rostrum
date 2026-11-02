/* The parts of the engine that are plain logic and need no browser, run with node --test */
import assert from 'node:assert/strict';
import {test} from 'node:test';

import {Arrangement, STANDARD} from '../arrangement.js';
import {Camera, CAMERA_F, MAX_H, MIN_H, RELEASE_MS} from '../camera.js';
import {layerStyle, TIP_SHAPE} from '../focus.js';
import {flightPath} from '../flight.js';
import {besideBox} from '../popups.js';
import {dateText, parseRange, readDate, readTime, stepField, sumPeriod, sumRange, weeksOf} from '../calendar.js';
import {endsOf, placeEnd, snapMinute, stepMinute, windowOf} from '../clock.js';
import {readQuery, writeQuery} from '../selection.js';
import '../charts.js';
import {linesOf, ZONE_COLUMN, ZONE_GAP, ZONE_ROW, zonesOf} from '../table.js';
import {Lanes, lyingOver, measureUnit, reachOf} from '../layout.js';
import {createStore, esc} from '../util.js';

globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};

function memoryStore() {
  const map = new Map();
  const storage = {getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key)};
  return createStore('t.', (name, error) => {
    throw error;
  }, storage);
}

function camera(tab = 'b') {
  return new Camera({
    zoneOf: name => ({x: ['a', 'b'].indexOf(name) * ZONE_COLUMN, y: 0}),
    tabNow: () => tab,
    viewport: () => ({width: 1000, height: 800}),
    left: 78,
    top: 96,
    plane: {style: {}},
    onMoved: () => {},
  });
}

test('one column objects share a row, two columns take the row', () => {
  const lanes = new Lanes(600, 40);
  assert.deepEqual(lanes.take(0, 1, 100), {x: 0, y: 0});
  assert.deepEqual(lanes.take(0, 1, 300), {x: 640, y: 0});
  assert.deepEqual(lanes.take(0, 2, 50), {x: 0, y: 340});
  assert.deepEqual(lanes.take(1, 2, 50), {x: 1280, y: 0});
  assert.equal(lanes.height, 430);
});

test('the unit of a column stays between its limits', () => {
  assert.equal(measureUnit(4000, 78, 44), 620);
  assert.equal(measureUnit(800, 78, 44), 470);
});

test('only what was moved later lies over, and only where boxes cross', () => {
  const a = {x: 0, y: 0, w: 100, h: 100, o: 0}, b = {x: 50, y: 50, w: 100, h: 100, o: 10}, c = {x: 500, y: 0, w: 10, h: 10, o: 11};
  assert.deepEqual(lyingOver([a, b, c]), [b]);
});

test('the reach of objects includes the origin of the table and what lies left of it', () => {
  assert.deepEqual(reachOf([{x: -30, y: 10, w: 50, h: 50, o: 0}], 200), {x0: -30, y0: 0, x1: 200, y1: 60});
});

test('an arrangement survives a new session and remembers what it replaced', () => {
  const store = memoryStore(), first = new Arrangement(store, 'work');
  assert.equal(Object.keys(first.spots).length + Object.keys(first.pins).length, 0);
  first.spots.a = {x: 1, y: 2, w: 3, n: 1, h: 4};
  first.save();
  first.takeShot('one', 'id1');
  first.replace(STANDARD);
  const second = new Arrangement(store, 'work');
  assert.equal(Object.keys(second.spots).length + Object.keys(second.pins).length, 0);
  assert.equal(second.previous.spots.a.x, 1);
  second.replace(second.shot('id1'));
  assert.equal(new Arrangement(store, 'work').spots.a.y, 2);
  second.renameShot('id1', 'two');
  assert.equal(second.shots[0].name, 'two');
  second.dropShot('id1');
  assert.equal(second.shots.length, 0);
});

test('the next moved object lies on top, an object leaves with what lives in it', () => {
  const arrangement = new Arrangement(memoryStore(), 'bench');
  assert.equal(arrangement.topOrder(), 10);
  arrangement.spots['t|a'] = {o: 14};
  arrangement.spots['t|a/inner'] = {o: 3};
  arrangement.spots['t|b'] = {o: 1};
  assert.equal(arrangement.topOrder(), 15);
  arrangement.forget('t|a');
  assert.deepEqual(Object.keys(arrangement.spots), ['t|b']);
});

test('a snapshot does not change when the arrangement goes on changing', () => {
  const arrangement = new Arrangement(memoryStore(), 'work');
  arrangement.spots.a = {x: 1};
  arrangement.takeShot('s', 'id');
  arrangement.spots.a.x = 2;
  assert.equal(arrangement.shot('id').spots.a.x, 1);
});

test('the camera has no limits on the table, only on its height', () => {
  const cam = camera();
  cam.moveTo(-90000, 90000, CAMERA_F * 50);
  assert.equal(cam.goalX, -90000);
  assert.equal(cam.goalY, 90000);
  assert.equal(cam.goalH, MAX_H);
  cam.moveTo(undefined, undefined, 1);
  assert.equal(cam.goalH, MIN_H);
});

test('what lies under the pointer stays under it while the camera changes its height, also where the height stops', () => {
  const cam = camera(), at = [820, 130], seen = () => {
    cam.x = cam.goalX;
    cam.y = cam.goalY;
    cam.h = cam.goalH;
    return cam.worldOf(...at);
  };
  cam.moveTo(500, 300);
  const before = seen();
  for (const wanted of [CAMERA_F * 0.8, 1, CAMERA_F * 2, CAMERA_F * 50]) {
    cam.zoomAt(...at, wanted);
    const now = seen();
    assert.ok(Math.abs(now.x - before.x) < 1e-6 && Math.abs(now.y - before.y) < 1e-6, `${wanted}: ${JSON.stringify(now)}`);
  }
  assert.equal(cam.goalH, MAX_H);
  // the way there holds it too, the place and the height change by one share in every frame
  const fromX = cam.x, fromH = cam.h, share = 0.37;
  cam.zoomAt(...at, CAMERA_F);
  const x = fromX + (cam.goalX - fromX) * share, h = fromH + (cam.goalH - fromH) * share;
  assert.ok(Math.abs(x + (at[0] - 500) * h / CAMERA_F - before.x) < 1e-6);
});

test('an instrument told to stay is remembered, goes into a snapshot and leaves with its object', () => {
  const store = memoryStore(), arrangement = new Arrangement(store, 'work');
  arrangement.loose['t|plate'] = true;
  arrangement.save();
  assert.equal(new Arrangement(store, 'work').loose['t|plate'], true);
  arrangement.takeShot('s', 'id');
  arrangement.replace(STANDARD);
  assert.equal(arrangement.loose['t|plate'], undefined);
  arrangement.replace(arrangement.shot('id'));
  assert.equal(arrangement.loose['t|plate'], true);
  arrangement.forget('t|plate');
  assert.equal(arrangement.loose['t|plate'], undefined);
  // a stored snapshot may have no loose part at all
  arrangement.replace({spots: {}, sizes: {}, pins: {}});
  assert.deepEqual(Object.keys(arrangement.loose), []);
});

test('screen and table agree at any height of the camera', () => {
  const cam = camera();
  cam.x = ZONE_COLUMN + 300;
  cam.y = 200;
  assert.deepEqual(cam.worldAt(cam.screenOrigin().x, cam.screenOrigin().y), {x: 0, y: 0});
  cam.h = CAMERA_F * 2;
  const origin = cam.screenOrigin(), world = cam.worldAt(origin.x, origin.y);
  assert.ok(Math.abs(world.x) < 1e-9 && Math.abs(world.y) < 1e-9);
});

test('the working height puts the plane on whole pixels, no 3D', () => {
  const cam = camera();
  cam.x = ZONE_COLUMN + 0.4;
  cam.apply();
  assert.match(cam.plane.style.transform, /^translate\(-?\d+px,-?\d+px\)$/);
  cam.h = CAMERA_F * 1.2;
  cam.apply();
  assert.match(cam.plane.style.transform, /perspective/);
});

test('a flight starts and lands with no lift and no tilt left', () => {
  const start = {x: 0, y: 0, h: CAMERA_F}, goal = {x: 6000, y: 100, h: CAMERA_F}, {path, duration} = flightPath(start, goal);
  assert.ok(duration >= 1300 && duration <= 2300);
  assert.deepEqual(path(0), {...start, tilt: 0});
  const end = path(1);
  assert.equal(end.x, 6000);
  assert.ok(Math.abs(end.h - CAMERA_F) < 1e-6 && Math.abs(end.tilt) < 1e-9);
  assert.ok(path(0.5).h > CAMERA_F);
});

test('a layer of focus covers the words, reaches past them and is feathered by its reach', () => {
  const style = layerStyle({left: 100, top: 200, right: 300, bottom: 260}, 30);
  assert.equal(style.left, '60px');
  assert.equal(style.top, '160px');
  assert.equal(style.width, '280px');
  assert.equal(style.height, '140px');
  assert.match(style.maskImage, /#000 40px/);
});

test('the field of a tip keeps closer to its words than the field of a menu, and comes up gently toward what stays sharp', () => {
  const words = {left: 100, top: 200, right: 300, bottom: 240}, point = {left: 80, top: 210, right: 90, bottom: 220};
  const menu = layerStyle(words, 130), tip = layerStyle(words, 130, undefined, 1, point, TIP_SHAPE);
  assert.ok(parseFloat(tip.height) < parseFloat(menu.height) * 0.6);
  assert.ok(parseFloat(tip.width) < parseFloat(menu.width));
  assert.equal(tip.left, '90px');
  assert.match(tip.maskImage, /#000 24px/);
});

test('a layer inside an object is written in the coordinates of the object', () => {
  const style = layerStyle({left: 100, top: 200, right: 300, bottom: 260}, 30, {left: 50, top: 50}, 2);
  assert.equal(style.left, '5px');
  assert.equal(style.width, '140px');
});

test('the camera gets there softly and just as fast on any screen', () => {
  const after = frame => {
    const cam = camera();
    cam.placeAt('b');
    const from = cam.x;
    cam.moveTo(from + 1000);
    for (let t = 1000; t <= 1000 + 240; t += frame) cam.step(t);
    return cam.x - from;
  };
  const fast = after(6), slow = after(24);
  assert.ok(Math.abs(fast - slow) < 40, `${fast} against ${slow}`);
  assert.ok(fast > 700 && fast < 950, String(fast));
});

test('what the hand let go keeps its speed for a moment and comes to rest', () => {
  const cam = camera();
  cam.placeAt('b');
  const from = cam.x;
  cam.release(-2, 0);
  assert.equal(cam.goalX, from + 2 * RELEASE_MS);
});

test('between two frames of a move the plane may stand between pixels, at rest it stands on a whole one', () => {
  const cam = camera();
  cam.placeAt('b');
  cam.moveTo(cam.x + 333);
  cam.step(1000);
  assert.ok(cam.inMotion);
  assert.match(cam.plane.style.transform, /\.\d+px/);
  for (let t = 1016; t < 4000; t += 16) cam.step(t);
  assert.equal(cam.inMotion, false);
  assert.match(cam.plane.style.transform, /^translate\(-?\d+px,-?\d+px\)$/);
});

test('tabs lie in all directions, counted from the top left one, and a tab left out takes a free place of the first row', () => {
  const zones = zonesOf(['a', 'b', 'c', 'd'], {a: [-1, -1], b: [0, 0], c: [0, 1]});
  const place = tab => [zones.get(tab).x, zones.get(tab).y];
  assert.deepEqual(place('a'), [0, 0]);
  assert.deepEqual(place('b'), [ZONE_COLUMN, ZONE_ROW]);
  assert.deepEqual(place('c'), [ZONE_COLUMN, ZONE_ROW * 2]);
  assert.deepEqual(place('d'), [ZONE_COLUMN * 2, ZONE_ROW]);
  assert.equal(zonesOf(['a', 'b']).get('b').x, ZONE_COLUMN);
});

test('a tab that reaches past its cell moves the cells after it away, and nothing lies over another tab', () => {
  const place = {a: [0, 0], b: [1, 0], c: [0, 1], d: [1, 1]}, boxOf = (zones, reaches, tab) => {
    const z = zones.get(tab), r = reaches[tab];
    return {left: z.x + r.x0, right: z.x + r.x1, top: z.y + r.y0, bottom: z.y + r.y1};
  };
  // what fits a cell changes nothing
  assert.equal(zonesOf(['a', 'b', 'c', 'd'], place, {a: {x0: 0, y0: 0, x1: 2612, y1: 2000}}).get('b').x, ZONE_COLUMN);
  const reaches = {
    a: {x0: 0, y0: 0, x1: 7000, y1: 500}, b: {x0: 0, y0: 0, x1: 900, y1: 500},
    c: {x0: 0, y0: 0, x1: 900, y1: 9000}, d: {x0: -4000, y0: -2000, x1: 900, y1: 500},
  };
  const zones = zonesOf(['a', 'b', 'c', 'd'], place, reaches), boxes = Object.keys(place).map(tab => boxOf(zones, reaches, tab));
  for (const one of boxes) {
    for (const other of boxes) {
      if (one === other) continue;
      assert.ok(one.right + ZONE_GAP * 2 <= other.left || other.right + ZONE_GAP * 2 <= one.left || one.bottom + ZONE_GAP * 2 <= other.top || other.bottom + ZONE_GAP * 2 <= one.top, JSON.stringify([one, other]));
    }
  }
  // what reaches to the left of or above the origin moves the origin of everything in that column or row
  assert.equal(zones.get('a').x, 0);
  assert.equal(zones.get('b').x, 7000 + ZONE_GAP * 2 + 4000);
  assert.equal(zones.get('d').x, zones.get('b').x);
  assert.equal(zones.get('d').y, zones.get('c').y);
  assert.equal(zones.get('d').y, zones.get('a').y + 500 + ZONE_ROW - 500 + 2000);
  assert.equal(zones.get('b').left, zones.get('a').right);
  const lines = linesOf(zones);
  assert.deepEqual(lines.x, [zones.get('a').left, zones.get('b').left, zones.get('b').right]);
  assert.deepEqual(lines.y, [zones.get('a').top, zones.get('c').top, zones.get('c').bottom]);
});

test('the plane is the table: the place of a tab comes from its ground and a point of the frame goes back to the table of the tab', () => {
  const cam = new Camera({zoneOf: () => ({x: ZONE_COLUMN, y: ZONE_ROW * 2}), tabNow: () => 'b', viewport: () => ({width: 1000, height: 800}), left: 78, top: 96, plane: {style: {}}, onMoved: () => {}});
  cam.placeAt('b');
  assert.deepEqual([cam.x, cam.y], [3000 + 500 - 78, 6000 + 400 - 96]);
  assert.deepEqual(cam.worldAt(78, 96), {x: 0, y: 0});
  assert.deepEqual(cam.screenOrigin(), {x: 78, y: 96});
});

test('a flight redirected in the air starts tilted and lands flat', () => {
  const {path} = flightPath({x: 0, y: 0, h: CAMERA_F, tilt: 0.1}, {x: 3000, y: 0, h: CAMERA_F});
  assert.equal(path(0).tilt, 0.1);
  assert.ok(Math.abs(path(1).tilt) < 1e-9);
});

test('a limit on the camera holds a jump and a hand, a swipe on its way may go past it', () => {
  const cam = camera();
  cam.limit = (x, y) => ({x: 7, y: Math.min(y, 100)});
  cam.jump(5000, 5000);
  assert.deepEqual([cam.x, cam.y], [7, 100]);
  cam.follow(9000, 9000);
  assert.deepEqual([cam.goalX, cam.goalY], [7, 100]);
  cam.jump(5000, 50, cam.h, {free: true});
  assert.deepEqual([cam.x, cam.y], [5000, 50]);
});

test('a limit on the camera holds every move', () => {
  const cam = camera();
  cam.limit = (x, y) => ({x: 7, y: Math.min(y, 100)});
  cam.moveTo(5000, 5000);
  assert.equal(cam.goalX, 7);
  assert.equal(cam.goalY, 100);
});

test('a narrow screen is one column, whatever an object asks for', () => {
  const lanes = new Lanes(360, 16, true);
  assert.equal(lanes.width(2), 360);
  assert.deepEqual(lanes.take(1, 2, 100), {x: 0, y: 0});
  assert.deepEqual(lanes.take(0, 1, 50), {x: 0, y: 116});
  assert.equal(lanes.height, 182);
});

test('a broken value in storage is reported and does not pass for the default silently', () => {
  const seen = [], store = createStore('p.', name => seen.push(name), {getItem: () => '{not json'});
  assert.equal(store.get('k', 7), 7);
  assert.deepEqual(seen, ['store.read:p.k']);
});

test('text goes into markup escaped', () => {
  assert.equal(esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
});

test('a tip stands right beside what it speaks about, keeps its side while it fits and goes to the far edge when that fills the frame', () => {
  const frame = {left: 8, right: 1692, top: 70, bottom: 870}, tip = {w: 300, h: 180};
  const column = {left: 500, right: 580, top: 300, bottom: 660};
  const atRight = besideBox(column, tip, {x: 540, y: 480}, frame);
  assert.equal(atRight.side, 'right');
  assert.ok(atRight.left >= column.right && atRight.left - column.right < 20, 'next to the column, not far away');
  assert.equal(atRight.top, 480 - tip.h / 2);
  assert.equal(besideBox(column, tip, {x: 540, y: 480}, frame, 'left').side, 'left');
  const nearEdge = {left: 1500, right: 1580, top: 300, bottom: 660};
  assert.equal(besideBox(nearEdge, tip, {x: 1540, y: 480}, frame).side, 'left');
  const row = {left: 0, right: 1700, top: 300, bottom: 330};
  assert.equal(besideBox(row, tip, {x: 800, y: 315}, frame).side, 'below');
  const whole = {left: 0, right: 1700, top: 0, bottom: 900};
  const far = besideBox(whole, tip, {x: 1500, y: 480}, frame);
  assert.deepEqual([far.side, far.left], ['', frame.left]);
  assert.equal(besideBox(whole, tip, {x: 200, y: 480}, frame).left, frame.right - tip.w);
});

test('the field of focus stops at the rim of what the words speak about', () => {
  const box = {left: 1200, right: 1400, top: 300, bottom: 400}, sharp = {left: 500, right: 1180, top: 200, bottom: 700};
  const free = layerStyle(box, 90), kept = layerStyle(box, 90, undefined, 1, sharp);
  assert.equal(free.left, '1100px');
  assert.equal(kept.left, '1180px');
  assert.equal(parseFloat(kept.left) + parseFloat(kept.width), parseFloat(free.left) + parseFloat(free.width));
  assert.equal(kept.top, free.top);
});

test('the ground of a chart: scales, columns, ticks and the marks of an svg', () => {
  const {frame, evenTicks, stepTicks, legend} = globalThis.ChartCore;
  const f = frame(500, 200, {left: 50, right: 50, top: 20, bottom: 30});
  assert.equal(f.x(0, 10)(0), 50);
  assert.equal(f.x(0, 10)(10), 450);
  assert.equal(f.y(0, 10)(0), 170, 'the low value stands at the base');
  assert.equal(f.y(0, 10)(10), 20);
  assert.equal(f.x(5, 5)(5), 50, 'a range of one value does not divide by nothing');
  assert.equal(f.y(5, 5)(5), 170);
  const band = f.band(4);
  assert.equal(band.w, 100);
  assert.equal(band.at(1), 150);
  assert.equal(band.mid(1), 200);
  assert.deepEqual(evenTicks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(evenTicks(3, 3, 2), [3, 3.5, 4], 'a flat range still has its rows');
  assert.deepEqual(stepTicks({lo: 0, hi: 1, step: 0.25}), [0, 0.25, 0.5, 0.75, 1]);
  assert.equal(stepTicks({lo: 0, hi: 0.3, step: 0.1}).length, 4, 'the top is not lost to the rounding of a sum');
  assert.match(f.svg(), /viewBox="0 0 500 200"/);
  assert.match(f.gridRow(100, '5'), /<line x1="50" y1="100" x2="450"/);
  assert.match(f.gridRow(100, '5'), /<text x="44" y="103" text-anchor="end">5<\/text>/);
  assert.match(f.upright(77, 'red', '1.4', '4 3'), /x1="77" y1="20" x2="77" y2="170" stroke="red" stroke-width="1.4" stroke-dasharray="4 3"/);
  assert.match(f.crossing('stroke="none"'), /class="rostrum-chart-cross".*y1="20" y2="170" stroke="none"/);
  const labels = ['a', 'b', 'c', 'd'];
  assert.equal(f.columnLabels(band, labels).match(/<text/g).length, 4);
  assert.equal(f.columnLabels(band, labels, {every: 2}).match(/<text/g).length, 2);
  assert.match(f.columnLabels(band, labels, {y: 9}), /y="9"/);
  assert.equal(frame(120, 100, {left: 10, right: 10, top: 0, bottom: 0}).columnLabels(frame(120, 100, {left: 10, right: 10, top: 0, bottom: 0}).band(20), Array(20).fill('x')).match(/<text/g).length, 1, 'as many as fit');
  assert.equal(legend([{color: 'red', label: 'a'}, {color: 'blue', label: 'b', attrs: 'data-n="b"'}]),
    '<div class="rostrum-chart-legend"><span><span style="background:red"></span>a</span><span data-n="b"><span style="background:blue"></span>b</span></div>');
});

test('a pointer reads the same place of a chart at any scale of the camera', () => {
  const {unitsOf} = globalThis.ChartCore;
  const shown = zoom => ({getBoundingClientRect: () => ({left: 100, top: 40, width: 900 * zoom, height: 300 * zoom})});
  for (const zoom of [1, 0.5, 1.75]) {
    const at = unitsOf({clientX: 100 + 450 * zoom, clientY: 40 + 150 * zoom}, shown(zoom), 900, 300);
    assert.ok(Math.abs(at.x - 450) < 1e-9 && Math.abs(at.y - 150) < 1e-9, `zoom ${zoom}`);
  }
});

test('a selection said in words is read exactly or not at all, and written back', () => {
  const vocabulary = {
    filters: [
      {id: 'red', word: 'red', without: 'no red', names: ['red', 'reds']},
      {id: 'blue', word: 'blue', without: 'no blue', names: ['blue', 'blues', 'blues dark']},
      {id: 'green', word: 'green', without: 'no green', names: ['green', 'blues green']},
    ],
    negatives: ['no', 'except'], fillers: ['only', 'and'], tags: ['T03', 'T14'], units: {minute: ['min'], hour: ['h'], day: ['d', 'д'], week: ['wk']}, subject: /^\d{10}$/,
  };
  const read = text => readQuery(text, vocabulary);
  assert.deepEqual(read('red no blue').filters, {red: 'include', blue: 'exclude'});
  assert.deepEqual(read('Only RED and -blue').filters, {red: 'include', blue: 'exclude'}, 'a word with a minus is the opposite');
  assert.deepEqual(read('blues green').filters, {green: 'include'}, 'two words before one');
  assert.deepEqual(read('blues dark').filters, {blue: 'include'});
  assert.deepEqual(read('t03 t14'), {filters: {}, tags: ['T03', 'T14'], tagsExclude: false, subject: null, period: ''});
  assert.equal(read('red -7d').period, '-7 d', 'how far back goes with the rest');
  assert.equal(read('-7д').period, '-7 д', 'a unit can be in any alphabet');
  assert.deepEqual(read('red -7d').filters, {red: 'include'});
  assert.equal(read('-1 h 30 min no blue').period, '-1 h 30 min');
  assert.deepEqual(read('-1 h 30 min no blue').filters, {blue: 'exclude'});
  assert.equal(read('2 wk').period, '-2 wk');
  assert.equal(read('1234567890 -7d').subject, '1234567890', 'what matches the subject and has no unit is the subject');
  assert.deepEqual(read('no t03 no t14').tags, ['T03', 'T14']);
  assert.equal(read('no t03').tagsExclude, true);
  assert.equal(read('red 1234567890').subject, '1234567890');
  assert.deepEqual(read('').filters, {});
  for (const wrong of ['something', 'red no', 'red no reds', 't03 no t14', 'no 1234567890', '123456789', 't99', '-0 d', '-7 km', '7'])
    assert.ok(read(wrong).unknown, wrong);
  for (const text of ['red no blue', 'blue no green', 'no red blue green T03', 'no T03 no T14', 'red -7 d', 'blue -1 h 30 min'])
    assert.deepEqual(read(writeQuery(read(text), vocabulary)), read(text), text);
  assert.equal(writeQuery(read('no blue red'), vocabulary), 'red no blue');
});

test('an end on the ruler of hours reads the same minute as its digits', () => {
  const day = Date.UTC(2026, 8, 24) / 1000, window = {from: day + 14 * 3600, to: day + 18 * 3600 + 60};
  const ends = endsOf(window);
  assert.deepEqual(ends, {fromDay: day, fromMinute: 840, toDay: day, toMinute: 1080});
  assert.deepEqual(windowOf(ends), window);
  assert.deepEqual(endsOf({from: day, to: day + 86400}), {fromDay: day, fromMinute: 0, toDay: day, toMinute: 1439}, 'a whole day ends on its last minute');
  assert.equal(snapMinute(1438), 1439, 'the right edge of a ruler is the last minute of the day');
  assert.equal(snapMinute(7), 0);
  assert.equal(snapMinute(8), 15);
  assert.equal(stepMinute(1439, -1), 1435, 'off the grid a step lands on the grid');
  assert.equal(stepMinute(842, 1), 845);
  assert.equal(stepMinute(1435, 1), 1439);
  assert.equal(stepMinute(0, -1), 0);
  assert.equal(placeEnd(ends, 'from', 1200).fromMinute, 1080, 'on one day the ends do not pass each other');
  assert.equal(placeEnd(ends, 'to', 100).toMinute, 840);
  const apart = endsOf({from: day, to: day + 3 * 86400});
  assert.equal(placeEnd(apart, 'from', 1200).fromMinute, 1200);
  assert.equal(placeEnd(apart, 'to', 100).toMinute, 100);
});

test('a period counts the hours of the days it covers in part', () => {
  const day = Date.UTC(2026, 8, 24) / 1000, hour = 3600;
  const days = [0, 1, 2].map(i => ({t: day + i * 86400, values: {n: 100}}));
  const hours = {[day]: [{t: day + 13 * hour, values: {n: 3}}, {t: day + 14 * hour, values: {n: 5}}], [day + 2 * 86400]: [{t: day + 2 * 86400 + 2 * hour, values: {n: 7}}]};
  const known = d => hours[d] || null;
  assert.deepEqual(sumPeriod(days, known, day + 14 * hour, day + 15 * hour), {totals: {n: 5}, exact: true});
  assert.deepEqual(sumPeriod(days, known, day + 14 * hour, day + 2 * 86400 + 3 * hour), {totals: {n: 112}, exact: true});
  assert.deepEqual(sumPeriod(days, () => null, day + 14 * hour, day + 15 * hour), {totals: {n: 100}, exact: false}, 'without the hours it says the sum is not exact');
  assert.deepEqual(sumPeriod(days, known, day, day + 2 * 86400), {totals: {n: 200}, exact: true}, 'whole days do not ask for hours');
});

test('what is typed into the calendar is understood exactly or not at all', () => {
  const words = {today: 'сьогодні', yesterday: 'вчора', months: ['січень', 'лютий', 'березень', 'квітень', 'травень', 'червень', 'липень', 'серпень', 'вересень', 'жовтень', 'листопад', 'грудень'], units: {minute: ['хв'], hour: ['г', 'год'], day: ['д', 'дн'], week: ['тиж'], month: ['міс'], year: ['рік']}};
  const at = (y, m, d, H = 0, M = 0) => Date.UTC(y, m - 1, d, H, M) / 1000, now = at(2026, 10, 31, 17, 30);
  assert.deepEqual(parseRange('24.09 – 30.09', now, words), {from: at(2026, 9, 24), to: at(2026, 10, 1)});
  assert.deepEqual(parseRange('24.09', now, words), {from: at(2026, 9, 24), to: at(2026, 9, 25)});
  assert.deepEqual(parseRange('24.09 12:00 – 30.09 18:00', now, words), {from: at(2026, 9, 24, 12), to: at(2026, 9, 30, 18, 1)});
  assert.deepEqual(parseRange('вересень', now, words), {from: at(2026, 9, 1), to: at(2026, 10, 1)});
  assert.deepEqual(parseRange('грудень', now, words), {from: at(2025, 12, 1), to: at(2026, 1, 1)}, 'a month to come is the last one that passed');
  assert.deepEqual(parseRange('-7д', now, words), {from: at(2026, 10, 25), to: at(2026, 11, 1)});
  assert.deepEqual(parseRange('24г', now, words), {from: at(2026, 10, 30, 17, 30), to: at(2026, 10, 31, 17, 31)}, 'this minute is included, as in the digits');
  assert.deepEqual(parseRange('-30 хв', now, words), {from: at(2026, 10, 31, 17, 0), to: at(2026, 10, 31, 17, 31)});
  assert.deepEqual(parseRange('-1 год', now, words), {from: at(2026, 10, 31, 16, 30), to: at(2026, 10, 31, 17, 31)});
  assert.deepEqual(parseRange('-1 год 30 хв', now, words), {from: at(2026, 10, 31, 16, 0), to: at(2026, 10, 31, 17, 31)});
  assert.deepEqual(parseRange('-1д 2г', now, words), {from: at(2026, 10, 30, 15, 30), to: at(2026, 10, 31, 17, 31)});
  assert.deepEqual(parseRange('-1 дн', now, words), {from: at(2026, 10, 31), to: at(2026, 11, 1)}, 'one day back in whole days is today');
  assert.deepEqual(parseRange('-2 тиж', now, words), {from: at(2026, 10, 18), to: at(2026, 11, 1)});
  assert.deepEqual(parseRange('-1 міс', now, words), {from: at(2026, 10, 1), to: at(2026, 11, 1)}, 'from the 31st a shorter month ends on its last day');
  assert.deepEqual(parseRange('-1 рік', now, words), {from: at(2025, 11, 1), to: at(2026, 11, 1)});
  assert.deepEqual(parseRange('вчора', now, words), {from: at(2026, 10, 30), to: at(2026, 10, 31)});
  assert.deepEqual(parseRange('15.12', now, words), {from: at(2025, 12, 15), to: at(2025, 12, 16)}, 'a date to come is the last one that passed');
  for (const wrong of ['', 'щось', '31.02', '32.01', '30.09 – 24.09', '24.09 25:00', '1.2.3 – 4', '-30', '-0 хв', '-30 км', '-30 хв щось']) assert.equal(parseRange(wrong, now, words), null, wrong);
});

test('a sum over a window says when a bucket stuck out of it', () => {
  const buckets = [{t: 0, values: {a: 2}}, {t: 10, values: {a: 3, b: 1}}, {t: 20, values: {a: 5}}];
  assert.deepEqual(sumRange(buckets, 10, 10, 20), {totals: {a: 3, b: 1}, exact: true});
  assert.deepEqual(sumRange(buckets, 10, 5, 20), {totals: {a: 5, b: 1}, exact: false});
});

test('the fields of a period read exact dates and times and step by the part the caret stands in', () => {
  const at = Date.UTC(2026, 0, 31) / 1000;
  assert.equal(readDate('31.01.2026'), at);
  for (const wrong of ['31.02.2026', '32.01.2026', '01.13.2026', '1.1', 'щось']) assert.equal(readDate(wrong), null, wrong);
  assert.equal(readTime('23:59'), 23 * 3600 + 59 * 60);
  for (const wrong of ['24:00', '12:60', '12']) assert.equal(readTime(wrong), null, wrong);
  assert.equal(stepField('31.01.2026', 'day', 1), '01.02.2026', 'the day rolls over');
  assert.equal(stepField('31.01.2026', 'month', 1), '28.02.2026', 'the last day of a shorter month');
  assert.equal(stepField('31.01.2026', 'year', -1), '31.01.2025');
  assert.equal(stepField('23:59', 'hour', 1), '00:59', 'the hour stays in the day');
  assert.equal(stepField('23:59', 'minute', 1), '00:00');
  assert.equal(stepField('нісенітниця', 'day', 1), null);
  assert.equal(dateText(at), '31.01.2026');
});

test('the weeks of a month start on monday', () => {
  const weeks = weeksOf(2026, 8);
  assert.equal(weeks[0][0], null, 'the first of september 2026 is a tuesday');
  assert.equal(weeks[0][1], Date.UTC(2026, 8, 1) / 1000);
  assert.equal(weeks.flat().filter(Boolean).length, 30);
});
