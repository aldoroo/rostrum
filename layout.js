/* The standard place of objects in lanes of two columns, pure geometry with no DOM
   An object the user placed by hand still takes its slot here, so its neighbours stay where they are */

function spanWidth(unit, gap, columns) {
  return unit * columns + gap * (columns - 1);
}

export function measureUnit(viewportWidth, left, gap, {min = 470, max = 620, margin = 30} = {}) {
  return Math.max(min, Math.min(max, Math.floor((viewportWidth - left - margin - gap) / 2)));
}

export class Lanes {
  /* single is for a narrow screen, everything lies in one column of the width of the unit */
  constructor(unit, gap, single = false) {
    this.unit = unit;
    this.gap = gap;
    this.single = single;
    this.tops = [[0, 0], [0, 0]];
  }

  width(columns) {
    return this.single ? this.unit : spanWidth(this.unit, this.gap, columns);
  }

  /* the next free slot of a lane for an object of one or two columns */
  take(lane, columns, height) {
    if (this.single) {
      const y = this.tops[0][0];
      this.tops[0][0] = y + height + this.gap;
      return {x: 0, y};
    }
    const inLane = lane === 1 ? 1 : 0, whole = columns >= 2, col = this.tops[inLane];
    const at = whole ? 0 : col[1] < col[0] - 1 ? 1 : 0;
    const y = whole ? Math.max(col[0], col[1]) : col[at];
    const bottom = y + height + this.gap;
    if (whole) col[0] = col[1] = bottom;
    else col[at] = bottom;
    return {x: inLane * 2 * (this.unit + this.gap) + at * (this.unit + this.gap), y};
  }

  get height() {
    return Math.max(...this.tops[0], ...this.tops[1]);
  }
}

/* the objects that lie over another one, the higher order wins and an order of zero never lies over anything */
export function lyingOver(placed) {
  return placed.filter(a => placed.some(b =>
    b.o < a.o && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
}

/* the box that holds all objects and the origin of the table */
export function reachOf(placed, minWidth) {
  const reach = {x0: 0, y0: 0, x1: minWidth, y1: 0};
  for (const p of placed) {
    reach.x0 = Math.min(reach.x0, p.x);
    reach.y0 = Math.min(reach.y0, p.y);
    reach.x1 = Math.max(reach.x1, p.x + p.w);
    reach.y1 = Math.max(reach.y1, p.y + p.h);
  }
  return reach;
}
