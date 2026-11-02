/* A pinhole camera with a target and a height
   At working height (CAMERA_F) the plane maps to the screen one to one and text stays sharp
   The plane holds every tab at its own ground, so moving the camera is enough to reach any tab */

export const CAMERA_F = 2400;
export const MIN_H = CAMERA_F * 0.72;
export const MAX_H = CAMERA_F * 3.4;

// the time to cover about two thirds of the remaining way, so the camera eases the same at any refresh rate
const SOFT_MS = 120;
// following a drag the camera stays close and only smooths the steps of the mouse
const HAND_MS = 38;
export const RELEASE_MS = 170;
const LONGEST_FRAME_MS = 50;
// a long task slows a flight down for a moment, the camera does not jump over the missed time
const LONGEST_STEP_MS = 34;

export class Camera {
  /* zoneOf(tab) gives the world position of the ground of a tab, tabNow() the open tab, viewport() the size of the frame
     onMoved runs after every change of the view
     onFrame runs at the end of a frame in which the camera moved, so whatever follows the camera can draw in that same frame */
  constructor({zoneOf, tabNow, viewport, left, top, plane, onMoved, onFrame = (/** @type {number} */ _now) => {}, limit = (x, y) => ({x, y})}) {
    this.zoneOf = zoneOf;
    this.tabNow = tabNow;
    this.viewport = viewport;
    this.left = left;
    this.top = top;
    this.plane = plane;
    this.onMoved = onMoved;
    this.onFrame = onFrame;
    this.limit = limit;
    this.x = this.goalX = 0;
    this.y = this.goalY = 0;
    this.h = this.goalH = CAMERA_F;
    this.tilt = 0;
    this.moving = 0;
    this.softness = SOFT_MS;
    this.lastStep = 0;
    // during a move the plane may sit between pixels, because rounding to whole pixels would show as jitter
    this.inMotion = false;
    this.travelling = 0;
    this.share = 0;
    this.landed = null;
    this.byTab = {};
    this.switching = false;
  }

  get scale() {
    return this.h / CAMERA_F;
  }

  /* the scale the camera is heading to, drags and wheel moves convert pixels with this one */
  get goalScale() {
    return this.goalH / CAMERA_F;
  }

  /* half of what the frame covers on the table from this height */
  viewBox(h = this.h) {
    const {width, height} = this.viewport(), k = h / CAMERA_F;
    return {halfW: width / 2 * k, halfH: height / 2 * k};
  }

  /* Moves with no easing, a finger allows none
     free skips the limit, for a swipe or a pinch on its way somewhere */
  jump(x, y = this.y, h = this.h, {free = false} = {}) {
    this.h = this.goalH = h;
    const held = free ? {x, y} : this.limit(x, y);
    this.x = this.goalX = held.x;
    this.y = this.goalY = held.y;
  }

  /* the table was rearranged under the camera, this keeps it looking at the same thing */
  shift(dx, dy) {
    this.x += dx;
    this.y += dy;
    this.goalX += dx;
    this.goalY += dy;
  }

  /* moves the position remembered for a tab */
  shiftMemory(tab, dx, dy) {
    const at = this.byTab[tab];
    if (at) this.byTab[tab] = {...at, x: at.x + dx, y: at.y + dy};
  }

  /* while act runs, window.scrollTo calls from the site do not move the camera */
  quietly(act) {
    this.switching = true;
    try {
      act();
    } finally {
      this.switching = false;
    }
  }

  home(tab) {
    const {width, height} = this.viewport(), zone = this.zoneOf(tab);
    return {x: zone.x + width / 2 - this.left, y: zone.y + height / 2 - this.top, h: CAMERA_F};
  }

  of(tab) {
    return this.byTab[tab] || this.home(tab);
  }

  remember(tab) {
    this.byTab[tab] = {x: this.goalX, y: this.goalY, h: this.goalH};
  }

  placeAt(tab) {
    const at = this.of(tab);
    this.x = this.goalX = at.x;
    this.y = this.goalY = at.y;
    this.h = this.goalH = at.h;
    this.tilt = 0;
    this.inMotion = false;
    this.stop();
  }

  stop() {
    if (this.moving) cancelAnimationFrame(this.moving);
    this.moving = 0;
    this.lastStep = 0;
    if (this.travelling) cancelAnimationFrame(this.travelling);
    this.travelling = 0;
    const {landed} = this;
    this.landed = null;
    if (landed) landed();
  }

  /* ends a flight at once when the page is hidden, no more animation frames would come */
  land() {
    if (!this.travelling) return;
    this.x = this.goalX;
    this.y = this.goalY;
    this.h = this.goalH;
    this.tilt = 0;
    this.apply();
    this.stop();
  }

  /* maps a point of the frame to the table, the inverse of what the camera does to the plane */
  worldOf(screenX, screenY) {
    const {width, height} = this.viewport(), k = this.scale;
    return {x: this.x + (screenX - width / 2) * k, y: this.y + (screenY - height / 2) * k};
  }

  /* the same, counted from the ground of the open tab */
  worldAt(screenX, screenY) {
    const at = this.worldOf(screenX, screenY), zone = this.zoneOf(this.tabNow());
    return {x: at.x - zone.x, y: at.y - zone.y};
  }

  /* where the origin of the open tab falls on the screen */
  screenOrigin() {
    const {width, height} = this.viewport(), zone = this.zoneOf(this.tabNow());
    const atWork = this.h === CAMERA_F, dx = zone.x - this.x, dy = zone.y - this.y, whole = atWork && !this.inMotion;
    return {
      x: whole ? Math.round(width / 2 + dx) : width / 2 + dx / this.scale,
      y: whole ? Math.round(height / 2 + dy) : height / 2 + dy / this.scale,
    };
  }

  apply() {
    const {width, height} = this.viewport(), cx = width / 2, cy = height / 2, whole = n => (this.inMotion ? Math.round(n * 100) / 100 : Math.round(n));
    // at working height the plane uses whole pixels and no 3D, so the browser rasterizes the text as plain text
    this.plane.style.transform = this.h === CAMERA_F && !this.tilt
      ? `translate(${whole(cx - this.x)}px,${whole(cy - this.y)}px)`
      : `translate(${cx}px,${cy}px) perspective(${CAMERA_F}px) translate3d(0,0,${CAMERA_F - this.h}px) rotateX(${this.tilt}rad) translate(${-this.x}px,${-this.y}px)`;
    this.onMoved();
  }

  step(now) {
    this.moving = 0;
    const dx = this.goalX - this.x, dy = this.goalY - this.y, dh = this.goalH - this.h;
    if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3 && Math.abs(dh) < 0.3 && Math.abs(this.tilt) < 0.001) {
      this.x = this.goalX;
      this.y = this.goalY;
      this.h = this.goalH;
      this.tilt = 0;
      this.inMotion = false;
      this.lastStep = 0;
      this.apply();
      this.onFrame(now);
      return;
    }
    const dt = this.lastStep ? Math.min(now - this.lastStep, LONGEST_FRAME_MS) : 16, near = 1 - Math.exp(-dt / this.softness);
    this.lastStep = now;
    this.inMotion = true;
    this.x += dx * near;
    this.y += dy * near;
    this.h += dh * near;
    this.tilt *= 1 - near;
    this.apply();
    this.onFrame(now);
    this.moving = requestAnimationFrame(next => this.step(next));
  }

  go() {
    if (!this.moving) this.moving = requestAnimationFrame(now => this.step(now));
  }

  /* a drag says where the camera should be and the camera follows closely */
  follow(x, y) {
    if (this.travelling) this.stop();
    const held = this.limit(x, y);
    this.goalX = held.x;
    this.goalY = held.y;
    this.softness = HAND_MS;
    this.go();
  }

  /* the drag ended, the camera coasts to rest from the speed of the pointer */
  release(vx, vy) {
    this.softness = RELEASE_MS;
    const held = this.limit(this.goalX - vx * RELEASE_MS, this.goalY - vy * RELEASE_MS);
    this.goalX = held.x;
    this.goalY = held.y;
    this.go();
  }

  moveTo(x, y, h) {
    // a move during a flight ends the flight where it is
    if (this.travelling) this.stop();
    if (x !== undefined) this.goalX = x;
    if (y !== undefined) this.goalY = y;
    if (h !== undefined) this.goalH = Math.max(MIN_H, Math.min(MAX_H, h));
    const held = this.limit(this.goalX, this.goalY);
    this.goalX = held.x;
    this.goalY = held.y;
    this.softness = SOFT_MS;
    this.go();
  }

  /* What lies under this point of the frame stays under it while the height changes
     Position and height ease by the same share per frame, so this holds on every frame of the way */
  zoomAt(screenX, screenY, h) {
    const {width, height} = this.viewport(), goal = Math.max(MIN_H, Math.min(MAX_H, h));
    const change = (this.goalH - goal) / CAMERA_F;
    this.moveTo(this.goalX + (screenX - width / 2) * change, this.goalY + (screenY - height / 2) * change, goal);
  }

  goHome(tab) {
    const home = this.home(tab);
    this.moveTo(home.x, home.y, home.h);
  }

  /* flies along path(t), the clock starts with the first frame so the time the tab took to show is not part of the flight */
  travel(path, duration, landed) {
    this.stop();
    const goal = path(1);
    this.goalX = goal.x;
    this.goalY = goal.y;
    this.goalH = goal.h;
    this.landed = landed;
    this.share = 0;
    let gone = 0, last = 0;
    this.inMotion = true;
    const tick = now => {
      gone += last ? Math.min(now - last, LONGEST_STEP_MS) : 0;
      last = now;
      this.share = Math.min(1, gone / duration);
      const at = path(this.share);
      this.x = at.x;
      this.y = at.y;
      this.h = this.share === 1 ? goal.h : at.h;
      this.tilt = this.share === 1 ? 0 : at.tilt;
      this.apply();
      this.onFrame(now);
      if (this.share < 1) {
        this.travelling = requestAnimationFrame(tick);
        return;
      }
      this.travelling = 0;
      this.inMotion = false;
      this.apply();
      const done = this.landed;
      this.landed = null;
      if (done) done();
    };
    this.travelling = requestAnimationFrame(tick);
  }
}
