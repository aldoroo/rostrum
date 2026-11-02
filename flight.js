/* A flight between two tabs is the camera moving over the one table, lifted higher on a longer way and tilted
   The table and the content move in one frame by one matrix, so they cannot drift apart
   Both tabs stay on the table the whole way, the tabs between them show only the light of their objects */
import {reducedMotion} from './util.js';

const PEAK_TILT = 11 * Math.PI / 180;

const smooth = t => t * t * t * (t * (6 * t - 15) + 10);

/* the square of the sine gives every quantity zero speed at both ends, a redirected flight starts tilted and loses that tilt gradually */
export function flightPath(start, goal) {
  const way = Math.hypot(goal.x - start.x, goal.y - start.y), lift = Math.min(4.2, 1.5 + way / 5200), tilted = start.tilt || 0;
  const path = t => {
    const e = smooth(t), arc = Math.sin(Math.PI * t) ** 2;
    return {x: start.x + (goal.x - start.x) * e, y: start.y + (goal.y - start.y) * e, h: (start.h + (goal.h - start.h) * e) * (1 + (lift - 1) * arc), tilt: PEAK_TILT * arc + tilted * (1 - e)};
  };
  return {path, duration: Math.min(2300, 1300 + way * 0.04)};
}

/* show() brings the tab in front, rostrum.flight is {from, to, endsAt} during the flight */
export function fly(rostrum, from, to, show) {
  const {camera} = rostrum, start = {x: camera.x, y: camera.y, h: camera.h, tilt: camera.tilt};
  camera.remember(from);
  if (!rostrum.flightOn || reducedMotion()) {
    show();
    camera.placeAt(to);
    camera.apply();
    rostrum.collect();
    return;
  }
  rostrum.trace('flight.start', `${from}>${to}`);
  const goal = camera.of(to), {path, duration} = flightPath(start, goal);
  rostrum.flight = {from, to, endsAt: performance.now() + duration};
  // no hover for what passes under a resting pointer, hit tests and tips would cost frames
  rostrum.plane.style.pointerEvents = 'none';
  show();
  rostrum.neighbours.refresh();
  rostrum.collect();
  // what the camera will see at the goal is drawn as it lands and does not show up on the way
  rostrum.igniteAt(goal);
  camera.travel(path, duration, () => {
    rostrum.flight = null;
    rostrum.plane.style.pointerEvents = '';
    // a landing counts as rest right away
    rostrum.lastMoved = 0;
    rostrum.landed();
    rostrum.trace('flight.end', to);
    rostrum.neighbours.refresh();
    rostrum.collect();
  });
}
