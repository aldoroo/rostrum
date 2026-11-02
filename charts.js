/* Shared chart helpers for margins and scales, ticks, grid rows, legends, canvas axes, hit testing and hover tips
   A page draws its own marks and passes text already escaped
   Plain script with no imports so a page can call it straight away */
(root => {
  // a page sets its own names here before it draws
  const names = {grid: '--rostrum-hair', cross: 'rostrum-chart-cross', legend: 'rostrum-chart-legend', tip: 'rostrum-tip', prism: 'rostrum-chart-prism', font: '10px sans-serif'};
  const colours = new Map(), reported = new Set();
  const NO_COLOUR = '#888';

  /* Canvas cannot read var(--name), so it is resolved here
     A token nobody defined is reported once and drawn grey */
  const token = value => {
    const text = String(value || ''), asked = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+?)\s*)?\)$/.exec(text);
    if (!asked) return text;
    if (!colours.has(text)) {
      const found = getComputedStyle(document.documentElement).getPropertyValue(asked[1]).trim();
      if (!found && !asked[2] && !reported.has(text)) {
        reported.add(text);
        console.error(`${new Date().toISOString()} ChartCore: the colour token ${asked[1]} is not defined, it is drawn grey`);
      }
      colours.set(text, found || asked[2] || NO_COLOUR);
    }
    return colours.get(text);
  };

  /* width to draw at, a hidden chart gets a usual width and is drawn again when shown */
  const widthOf = (el, least = 360, usual = 900) => Math.max(least, Math.floor(el.clientWidth || el.parentElement.clientWidth || usual));

  const evenTicks = (lo, hi, parts) => {
    const span = (hi - lo) || 1;
    return Array.from({length: parts + 1}, (_, g) => lo + span * g / parts);
  };

  const stepTicks = ({lo, hi, step}) => {
    const ticks = [];
    for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(v);
    return ticks;
  };

  /* A chart of W by H with margins around its plot, it gives scales, columns and the SVG parts every chart has */
  const frame = (W, H, {left: L, right: R, top: T, bottom: B}) => ({
    W, H, L, R, T, B,
    x(lo, hi) {
      const span = (hi - lo) || 1;
      return v => L + (W - L - R) * ((v - lo) / span);
    },
    y(lo, hi) {
      const span = (hi - lo) || 1;
      return v => T + (H - T - B) * (1 - (v - lo) / span);
    },
    band(n) {
      const w = (W - L - R) / n;
      return {w, n, at: i => L + w * i, mid: i => L + w * (i + 0.5)};
    },
    svg: () => `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none">`,
    /* a line across the plot with its label on the left */
    gridRow: (y, label, labelStyle = '') => `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" style="stroke:var(${names.grid})"/><text x="${L - 6}" y="${y + 3}" text-anchor="end"${labelStyle ? ` style="${labelStyle}"` : ''}>${label}</text>`,
    /* a dashed line from the top of the plot to its base */
    upright: (x, color, width, dash) => `<line x1="${x}" y1="${T}" x2="${x}" y2="${H - B}" stroke="${color}" stroke-width="${width}" stroke-dasharray="${dash}"/>`,
    /* the line that follows the hovered column, moved by bandHover */
    crossing: attrs => `<line class="${names.cross}" x1="0" x2="0" y1="${T}" y2="${H - B}" ${attrs}/>`,
    /* labels of the columns, every n-th when place.every is set, otherwise as many as fit */
    /** @param {any} [place] {every, y} */
    columnLabels(band, labels, place = {}) {
      const step = place.every || Math.max(1, Math.ceil(band.n / Math.max(1, Math.floor((W - L - R) / 64))));
      const at = place.y === undefined ? H - 8 : place.y;
      let s = '';
      labels.forEach((label, i) => {
        if (i % step === 0) s += `<text x="${band.mid(i)}" y="${at}" text-anchor="middle">${label}</text>`;
      });
      return s;
    },
  });

  /* each item is {color, label, attrs}, label is ready markup */
  const legend = items => `<div class="${names.legend}">${items.map(item => `<span${item.attrs ? ` ${item.attrs}` : ''}><span style="background:${item.color}"></span>${item.label}</span>`).join('')}</div>`;

  /* sizes a canvas to a frame, clears it and returns a context that draws in frame units */
  const canvasOf = (canvas, W, H) => {
    colours.clear();
    const ratio = Math.min(2, root.devicePixelRatio || 1);
    canvas.width = Math.round(W * ratio);
    canvas.height = Math.round(H * ratio);
    const c = canvas.getContext('2d');
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    c.clearRect(0, 0, W, H);
    return c;
  };

  /* draws the rows and labels of a canvas chart, ticks are {x, label, last} under the plot */
  const paintAxes = (c, f, {lo, hi, parts = 5, yFormat, ticks, grid, ink}) => {
    const y = f.y(lo, hi);
    c.font = names.font;
    c.strokeStyle = token(grid);
    c.fillStyle = token(ink);
    c.textAlign = 'right';
    c.textBaseline = 'middle';
    for (const v of evenTicks(lo, hi, parts)) {
      c.beginPath();
      c.moveTo(f.L, y(v));
      c.lineTo(f.W - f.R, y(v));
      c.stroke();
      c.fillText(yFormat ? yFormat(v) : v.toFixed(1), f.L - 6, y(v));
    }
    c.textBaseline = 'alphabetic';
    for (const tick of ticks) {
      c.textAlign = tick.last ? 'right' : 'center';
      c.fillText(tick.label, tick.x, f.H - 12);
    }
  };

  /* dashed lines {y, color, label} across a canvas chart with the label at the right end, lines outside the range are skipped */
  const paintLevels = (c, f, lines, lo, hi) => {
    const y = f.y(lo, hi);
    for (const line of lines || []) {
      if (line.y == null || line.y < lo || line.y > hi) continue;
      const color = token(line.color);
      c.strokeStyle = color;
      c.setLineDash([5, 4]);
      c.lineWidth = 1.6;
      c.beginPath();
      c.moveTo(f.L, y(line.y));
      c.lineTo(f.W - f.R, y(line.y));
      c.stroke();
      c.setLineDash([]);
      c.lineWidth = 1;
      c.fillStyle = color;
      c.textAlign = 'right';
      c.fillText(line.label, f.W - f.R, y(line.y) - 4);
    }
  };

  /* nearest mark to a point, the earlier mark wins a tie */
  class HitGrid {
    constructor(hits, padding) {
      this.hits = hits;
      this.padding = padding;
      this.cells = new Map();
      this.radius = 0;
      this.size = 16;
      hits.forEach((h, i) => {
        if (!Number.isFinite(h.x) || !Number.isFinite(h.y)) return;
        this.radius = Math.max(this.radius, h.r + padding);
        const key = `${Math.floor(h.x / this.size)},${Math.floor(h.y / this.size)}`;
        let cell = this.cells.get(key);
        if (!cell) {
          cell = [];
          this.cells.set(key, cell);
        }
        cell.push(i);
      });
    }

    near(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      let best = null, bd = 1e9, bi = Infinity;
      const s = this.size, r = this.radius;
      for (let gx = Math.floor((x - r) / s); gx <= Math.floor((x + r) / s); gx++) {
        for (let gy = Math.floor((y - r) / s); gy <= Math.floor((y + r) / s); gy++) {
          const cell = this.cells.get(`${gx},${gy}`);
          if (!cell) continue;
          for (const i of cell) {
            const h = this.hits[i], d = (h.x - x) ** 2 + (h.y - y) ** 2;
            if ((d < bd || (best !== null && d === bd && i < bi)) && d <= (h.r + this.padding) ** 2) {
              bd = d;
              bi = i;
              best = h;
            }
          }
        }
      }
      return best;
    }
  }

  /* pointer position in chart units, the camera may be showing the chart scaled */
  const unitsOf = (event, el, W, H) => {
    const box = el.getBoundingClientRect();
    return {x: (event.clientX - box.left) / (box.width / W), y: (event.clientY - box.top) / (box.height / H)};
  };

  /* only write when the text changes, a rewrite restarts the popup writing animation */
  const tipText = (tip, text) => {
    if (tip.textContent !== text) tip.textContent = text;
  };

  /* shows the tip of the column under the pointer, data-rostrum-about tells the engine which column the tip is about */
  const bandHover = (svg, tip, {W, L, band, html, onColumn}) => {
    const holder = tip.parentElement, cross = svg.querySelector(`.${names.cross}`), {w, n} = band;
    const pick = event => {
      const i = Math.floor((unitsOf(event, svg, W, 1).x - L) / w);
      return i >= 0 && i < n ? i : null;
    };
    const hide = () => {
      tip.style.display = 'none';
      if (cross) cross.setAttribute('visibility', 'hidden');
    };
    svg.onmousemove = event => {
      const i = pick(event);
      if (onColumn) onColumn(i);
      if (i == null) {
        hide();
        return;
      }
      if (cross) {
        const x = band.mid(i);
        cross.setAttribute('x1', x);
        cross.setAttribute('x2', x);
        cross.setAttribute('visibility', 'visible');
      }
      if (tip.dataset.at !== String(i)) {
        tip.dataset.at = i;
        tip.innerHTML = html(i);
        tip.dataset.rostrumAbout = `${band.at(i) / W} 0 ${w / W} 1`;
      }
      tip.style.display = 'block';
      const left = band.mid(i) * svg.getBoundingClientRect().width / W;
      tip.style.left = `${Math.max(0, Math.min(left + 14, holder.clientWidth - tip.offsetWidth - 4))}px`;
      tip.style.top = '6px';
    };
    svg.onmouseleave = () => {
      if (onColumn) onColumn(null);
      hide();
    };
  };

  /* Shows the tip of the mark under the pointer on a canvas
     near(event) finds the mark, text(mark) gives its words, press(mark) handles a click, place(mark, event) says where the tip stands */
  const markHover = (canvas, tip, {near, size, text, press, place}) => {
    canvas.onmousemove = event => {
      const mark = near(event);
      canvas.style.cursor = mark ? 'pointer' : 'default';
      if (!mark) {
        tip.style.display = 'none';
        return;
      }
      const {W, H} = size();
      tipText(tip, text(mark));
      tip.dataset.rostrumAbout = `${(mark.x - 6) / W} ${(mark.y - 6) / H} ${12 / W} ${12 / H}`;
      tip.style.display = 'block';
      const at = place(mark, event);
      tip.style.left = `${Math.max(0, Math.min(at.x + 12, canvas.clientWidth - tip.offsetWidth - 4))}px`;
      tip.style.top = `${Math.max(0, at.y - 30)}px`;
    };
    canvas.onmouseleave = () => {
      tip.style.display = 'none';
    };
    canvas.onclick = event => {
      const mark = near(event);
      if (mark) press(mark);
    };
  };

  /* Opens one residual series of a stacked chart into its parts
     A part leaves the gate as thick as its true share and arrives at a row that keeps its place, so growth from column to column stays visible
     Parts scrolled out of the rows arrive together at the edge they left through
     gate is {x, w, top, height}, rows is {x, top, height, viewport}, all in the units of the holder */
  const prism = (holder, {W, H, gate, rows, duration = 130, enter = 320}) => {
    const NS = 'http://www.w3.org/2000/svg', still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', names.prism);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    const add = cls => {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('class', cls);
      svg.append(path);
      return path;
    };
    const beam = add('beam'), mark = add('mark'), lens = add('lens');
    lens.setAttribute('d', `M${gate.x} ${gate.top}h${gate.w}v${gate.height}h${-gate.w}Z`);
    holder.append(svg);
    const from = gate.x + gate.w, to = rows.x - 2, mid = (from + to) / 2;
    const ribbon = ([a, b, c, d]) => `M${from} ${a.toFixed(2)}C${mid} ${a.toFixed(2)} ${mid} ${c.toFixed(2)} ${to} ${c.toFixed(2)}` +
      `L${to} ${d.toFixed(2)}C${mid} ${d.toFixed(2)} ${mid} ${b.toFixed(2)} ${from} ${b.toFixed(2)}Z`;
    const ribbons = new Map();
    let ray = null, frameId = 0, entered = false, lit = null;
    const place = ({path, now}) => path.setAttribute('d', ribbon(now));
    const placeRay = () => {
      if (!ray) return;
      const [x, a, b] = ray.now;
      beam.setAttribute('d', `M${x} ${a.toFixed(2)}L${gate.x} ${gate.top}V${gate.top + gate.height}L${x} ${b.toFixed(2)}Z`);
    };
    const tween = ms => {
      cancelAnimationFrame(frameId);
      const moving = [...ribbons.values(), ...(ray ? [ray] : [])], started = performance.now();
      moving.forEach(item => { item.was = item.now.slice(); });
      const step = at => {
        if (!svg.isConnected) return;
        const t = Math.min(1, (at - started) / ms), eased = 1 - (1 - t) ** 3;
        moving.forEach(item => { item.now = item.was.map((v, i) => v + (item.to[i] - v) * eased); });
        ribbons.forEach(place);
        placeRay();
        if (t < 1) frameId = requestAnimationFrame(step);
      };
      frameId = requestAnimationFrame(step);
    };
    /* parts are {key, value, row, hot} in row order, segment is {x, w, y, h} or null, scroll is the scroll offset of the rows */
    const draw = ({parts, segment, scroll = 0, animate = true}) => {
      const total = parts.reduce((sum, part) => sum + part.value, 0) || 1;
      const first = Math.ceil(scroll / rows.height), last = Math.floor((scroll + rows.viewport) / rows.height) - 1;
      const stack = [];
      const outside = (key, value) => {
        const open = stack.find(item => item.key === key);
        if (open) open.value += value;
        else stack.push({key, value, edge: key === '^' ? rows.top : rows.top + rows.viewport});
      };
      parts.forEach(part => {
        if (part.row < first) outside('^', part.value);
        else if (part.row > last) outside('v', part.value);
        else stack.push({...part, centre: rows.top + (part.row + 0.5) * rows.height - scroll});
      });
      const largest = Math.max(1e-9, ...stack.filter(item => item.centre != null).map(item => item.value));
      let y = gate.top;
      const seen = new Set();
      stack.forEach(item => {
        const span = gate.height * item.value / total, reach = item.centre == null
          ? Math.min(3, span) : item.value > 0 ? Math.max(1, (rows.height - 4) * item.value / largest) : 0;
        const edge = item.centre == null ? item.edge : item.centre;
        const target = [y, y + (item.value > 0 ? Math.max(0.6, span) : 0), edge - reach / 2, edge + reach / 2];
        y += span;
        seen.add(item.key);
        let held = ribbons.get(item.key);
        if (!held) {
          const path = add('part');
          held = {path, now: entered ? target.slice() : [gate.top + gate.height / 2, gate.top + gate.height / 2, edge, edge], to: target};
          ribbons.set(item.key, held);
        }
        held.to = target;
        held.path.setAttribute('class', `part${item.hot ? ' hot' : ''}${item.key === lit ? ' lit' : ''}`);
        if (!animate || still) {
          held.now = target.slice();
          place(held);
        }
      });
      ribbons.forEach((held, key) => {
        if (!seen.has(key)) {
          held.path.remove();
          ribbons.delete(key);
        }
      });
      if (segment && segment.h > 0) {
        const target = [segment.x + segment.w, segment.y, segment.y + segment.h];
        ray = ray ? {...ray, to: target} : {now: target.slice(), to: target};
        if (!animate || still) ray.now = target.slice();
        mark.setAttribute('d', `M${segment.x} ${segment.y}h${segment.w}v${segment.h}h${-segment.w}Z`);
        beam.style.visibility = mark.style.visibility = '';
        placeRay();
      } else {
        ray = null;
        beam.style.visibility = mark.style.visibility = 'hidden';
      }
      if (still || !animate) cancelAnimationFrame(frameId);
      else tween(entered ? duration : enter);
      entered = true;
    };
    const light = key => {
      if (lit != null && ribbons.has(lit)) ribbons.get(lit).path.classList.remove('lit');
      lit = key;
      if (key != null && ribbons.has(key)) ribbons.get(key).path.classList.add('lit');
    };
    return {draw, light};
  };

  const newTip = () => {
    const tip = document.createElement('div');
    tip.className = names.tip;
    tip.style.display = 'none';
    return tip;
  };

  root.ChartCore = {names, token, widthOf, evenTicks, stepTicks, frame, legend, canvasOf, paintAxes, paintLevels, HitGrid, unitsOf, tipText, bandHover, markHover, prism, newTip};
})(globalThis);
