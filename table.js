/* The table, every tab has its ground on it as a cell of a grid
   There is no DOM here, so it can be tested on its own */

export const ZONE_COLUMN = 3000;
export const ZONE_ROW = 3000;
// half of the free space between the grounds of two tabs, past this the camera stands on the next one
export const ZONE_GAP = 190;

/* Gives each cell of one axis its start, its end and the position of its origin
   A cell has its usual size until a tab in it reaches further */
function axisOf(cells, reaches, cellSize, from, to) {
  const least = Math.min(...cells.map(c => c.at)), most = Math.max(...cells.map(c => c.at)), starts = new Map(), origins = new Map(), ends = new Map();
  let start = 0;
  for (let at = least; at <= most; at++) {
    const here = cells.filter(c => c.at === at).map(c => reaches[c.tab]).filter(Boolean);
    const before = Math.max(0, ...here.map(r => -r[from])), after = Math.max(0, ...here.map(r => r[to]));
    starts.set(at, start);
    origins.set(at, start + before);
    start += Math.max(cellSize, before + after + ZONE_GAP * 2);
    ends.set(at, start);
  }
  return {starts, origins, ends};
}

/* The ground of every tab, counted from the top left taken cell, a tab left out takes the next free cell of the first row
   reaches maps a tab to the box its objects take around its origin, whatever reaches past its cell moves the following cells away so nothing lies over another tab
   left, right, top and bottom bound the cell around the ground, the joints of the table run along these */
export function zonesOf(tabs, place = {}, reaches = {}) {
  // tab names come from the site, and one called "constructor" would otherwise find a value on Object.prototype
  const placed = tab => Object.hasOwn(place, tab);
  const asked = tabs.filter(placed).map(tab => place[tab]), taken = new Set(asked.map(String)), cells = new Map();
  let next = 0;
  for (const tab of tabs) {
    if (placed(tab)) {
      cells.set(tab, place[tab]);
      continue;
    }
    while (taken.has(`${next},0`)) next++;
    taken.add(`${next},0`);
    cells.set(tab, [next, 0]);
  }
  const list = [...cells], zones = new Map();
  const across = axisOf(list.map(([tab, c]) => ({tab, at: c[0]})), reaches, ZONE_COLUMN, 'x0', 'x1');
  const down = axisOf(list.map(([tab, c]) => ({tab, at: c[1]})), reaches, ZONE_ROW, 'y0', 'y1');
  for (const [tab, [column, row]] of list) {
    zones.set(tab, {
      x: across.origins.get(column), y: down.origins.get(row), column, row,
      left: across.starts.get(column) - ZONE_GAP, right: across.ends.get(column) - ZONE_GAP, top: down.starts.get(row) - ZONE_GAP, bottom: down.ends.get(row) - ZONE_GAP,
    });
  }
  return zones;
}

/* where the joints of the table run, in world units */
export function linesOf(zones) {
  const all = [...zones.values()], sorted = values => [...new Set(values)].sort((a, b) => a - b);
  return {x: sorted(all.flatMap(z => [z.left, z.right])), y: sorted(all.flatMap(z => [z.top, z.bottom]))};
}
