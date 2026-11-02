/* The table as a WebGL scene in table units with z up towards the camera and the top of the table at z=0
   Lamps are fixed in the room, the material is mid grey and looks dim only because light is low, scratches are a height map and page objects are emitters
   It draws only when something moved */
import {CAMERA_F} from './camera.js';
import {SLIDE_MS} from './object.js';
import {ZONE_COLUMN, ZONE_ROW} from './table.js';
import {coarse} from './util.js';

const SCENE_MAX_EMITTERS = 32;
const SCENE_MAX_SCANS = 14;
const SCENE_MAX_SEAMS = 24;
const SCENE_TILE = 1600;
const SCRATCH_TEXELS = 2048;
const SCRATCH_TEXELS_LITE = 1024;
// this many frames in a row this slow give the table fewer pixels, one pause between two movements does not count
const SLOW_MS = 30;
const SLOW_MS_LITE = 50;
const SLOW_RUN = 12;
// frames this soon after a long task say nothing about the GPU
const BUSY_MS = 250;
// a new accent light rises over this time, along with the figure it lights
const ACCENT_MS = 900;
const MOST_PIXELS = 3500000;
const LOWEST_RATIO = 0.6;
// the light of an object reaches this far past its rim
const LIGHT_REACH = 500;
const FLASH_MS = 720;
const LITE_FRAME_MS = 30;
const LITE_EMITTERS = 10;

const SCENE_VERTEX = `#version 300 es
in vec2 corner;void main(){gl_Position=vec4(corner,0.,1.);}`;

const vec3 = values => `vec3(${values.map(v => v.toFixed(3)).join(',')})`;

const seamFunction = (name, lines, count, cell) => `float ${name}(float v){
  if(${count}==0)return 1e6;
  float d=1e6;for(int i=0;i<${count};i++)d=min(d,abs(v-${lines}[i]));
  float beyond=v<${lines}[0]?${lines}[0]-v:v-${lines}[${count}-1];
  if(beyond>0.){float m=mod(beyond,${cell}.);d=min(d,min(m,${cell}.-m));}
  return d;
}`;

/* to brighten the room raise the lamp and leave the table as is */
function fragmentSource({lamp = [0.86, 0.97, 1.08], albedo = [0.205, 0.225, 0.24]} = {}) {
  const SCENE_FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 res;uniform float pixel;uniform vec3 target;uniform float camH,camF,tilt;
uniform int emitters;uniform vec4 rect[${SCENE_MAX_EMITTERS}];uniform vec4 tint[${SCENE_MAX_EMITTERS}];
uniform int scans;uniform vec4 scanRect[${SCENE_MAX_SCANS}];uniform float scanHead[${SCENE_MAX_SCANS}];
uniform sampler2D scratches;
uniform int seamsX,seamsY;uniform float seamX[${SCENE_MAX_SEAMS}];uniform float seamY[${SCENE_MAX_SEAMS}];
out vec4 color;
const float LAMP_Z=1750.;const vec2 LAMP_CELL=vec2(1180.,2100.);const vec2 LAMP_HALF=vec2(46.,620.);
const vec3 LAMP=${vec3(lamp)};const vec3 ALBEDO=${vec3(albedo)};
const float TILE=${SCENE_TILE}.;
const float COVER_GLOSS=.86;const float COVER_DIM=.16;
// smoothstep with falling edges is undefined in GLSL, every GPU answers its own way
float fall(float high,float low,float x){return 1.-smoothstep(low,high,x);}
float box(vec2 p,vec2 h){vec2 d=abs(p)-h;return length(max(d,0.))+min(max(d.x,d.y),0.);}
vec3 ground(vec2 p){return texture(scratches,p/TILE).rgb;}
// distance to the nearest joint, past the last cell the table goes on in cells of the usual size
${seamFunction('seamAcross', 'seamX', 'seamsX', ZONE_COLUMN)}
${seamFunction('seamDown', 'seamY', 'seamsY', ZONE_ROW)}
float heightAt(vec2 p){
  vec3 g=ground(p);
  // a groove around the ground of every tab, the joints between the slabs of the table
  float groove=fall(1.6,.4,seamAcross(p.x))+fall(1.6,.4,seamDown(p.y));
  return -g.r*.075-groove*3.;
}
// what the lamps give to a ray leaving the table, the strips reflect in it blurred by the roughness of the surface
float lampsInRay(vec3 p,vec3 r,float rough){
  if(r.z<.02)return 0.;
  float t=(LAMP_Z-p.z)/r.z;vec2 q=p.xy+r.xy*t;
  vec2 c=mod(q,LAMP_CELL)-LAMP_CELL*.5;
  float blur=max(6.,rough*rough*t*.9);
  float d=box(c,LAMP_HALF);
  return fall(blur,-blur,d)*min(1.,90./blur);
}
// the light that reaches the table, a pool under each strip with the falloff of distance and angle
float lampsOnTable(vec2 p){
  vec2 c=mod(p,LAMP_CELL)-LAMP_CELL*.5;
  float d=max(box(c,LAMP_HALF),0.);
  float cosine=LAMP_Z/sqrt(LAMP_Z*LAMP_Z+d*d);
  return cosine*cosine*cosine*cosine;
}
void main(){
  vec2 s=vec2(gl_FragCoord.x,res.y-gl_FragCoord.y)/pixel-res/pixel*.5;
  float ca=cos(tilt),sa=sin(tilt);
  vec3 dv=normalize(vec3(s,-camF));
  vec3 rd=vec3(dv.x,dv.y*ca+dv.z*sa,-dv.y*sa+dv.z*ca);
  vec3 ro=target+vec3(0.,camH*sa,camH*ca);
  float t=-ro.z/rd.z;vec3 p=ro+rd*t;
  vec3 v=-rd;
  vec3 g=ground(p.xy);
  float e=1.8;
  float hx=heightAt(p.xy+vec2(e,0.))-heightAt(p.xy-vec2(e,0.)),hy=heightAt(p.xy+vec2(0.,e))-heightAt(p.xy-vec2(0.,e));
  vec3 n=normalize(vec3(-hx,-hy,2.*e/.9));
  float rough=clamp(.5+g.g*.2+g.b*.2,.05,1.);
  float coat=clamp(.16+g.r*.4+g.g*.14+g.b*.25,.05,1.);
  vec3 albedo=ALBEDO*(1.-.14*g.b);
  const float f0=.04;
  vec3 r=reflect(rd,n);
  float fresnel=f0+(1.-f0)*pow(1.-max(dot(n,v),0.),5.);
  float pool=lampsOnTable(p.xy);
  float room=.022+.105*pool*pool;
  vec3 lit=albedo*room*LAMP;
  vec3 gloss=LAMP*fresnel*(lampsInRay(p,r,rough)*1.15+lampsInRay(p,r,coat)*.13);
  float near=1.-smoothstep(camF*1.15,camF*1.8,camH);
  // the steep wall of a scuff catches a lamp the flat top misses, a short soft glint that slides as the camera moves
  vec3 wall=normalize(vec3(-hx*7.,-hy*7.,2.*e/.9));
  gloss+=LAMP*lampsInRay(p,reflect(rd,wall),.1)*smoothstep(.05,.24,g.r)*.03*near;
  // a few grains in the coat, each tilted its own way, a grain flares only while its mirror direction passes over a lamp
  vec2 grain=floor(p.xy/13.);
  float seedG=fract(sin(dot(grain,vec2(127.1,311.7)))*43758.5453);
  if(seedG>.991&&near>0.){
    vec2 at=grain*13.+vec2(fract(seedG*91.7),fract(seedG*37.3))*10.+1.5;
    vec3 tiltG=normalize(vec3(fract(seedG*13.1)-.5,fract(seedG*29.7)-.5,1.5));
    float flare=lampsInRay(p,reflect(rd,tiltG),.05);
    float dist=length(p.xy-at);
    gloss+=LAMP*flare*(fall(1.3,.2,dist)*.34+.018*exp(-dist/2.2))*near;
  }
  // objects are emitters in the surface, their light scatters in its top layer around them
  float cover=0.;
  for(int i=0;i<emitters;i++){
    vec2 c=rect[i].xy+rect[i].zw*.5;
    float d=box(p.xy-c,rect[i].zw*.5);
    float inside=fall(.7,-.7,d);
    float rim=fall(1.4,.2,abs(d));
    float out_=max(d,0.);
    vec3 light=tint[i].rgb*abs(tint[i].a);
    if(tint[i].a>0.)cover=max(cover,inside*min(1.,tint[i].a*4.));
    if(tint[i].a<0.){
      float fromLeft=p.x-rect[i].x;
      lit+=light*inside*(.0022+.052*exp(-max(fromLeft,0.)/64.));
      lit+=light*inside*fall(2.6,1.4,fromLeft)*.62;
      lit+=light*.016*exp(-max(d,0.)/12.)*fall(26.,0.,abs(p.x-rect[i].x));
      continue;
    }
    float fromTop=1.-smoothstep(rect[i].y,rect[i].y+rect[i].w,p.y);
    float edgeLit=.72+.56*fromTop;
    lit+=light*inside*(.003+.017*exp(min(d,0.)/20.)*edgeLit);
    lit+=light*rim*.15*edgeLit;
    float spill=.022*exp(-out_/10.)+.009*exp(-out_/54.)+.0016*exp(-out_/230.);
    lit+=light*spill*(1.+.3*g.r+.4*g.g);
  }
  // an object waiting for data has a point of light on its rim with a tail behind it, when the data land one pass of light goes down it
  for(int i=0;i<scans;i++){
    vec4 q=scanRect[i];
    float d=box(p.xy-q.xy-q.zw*.5,q.zw*.5);
    if(d>70.)continue;
    vec3 scanLight=LAMP*vec3(.62,.88,1.);
    float head=scanHead[i];
    if(head<0.){
      float y=q.y+q.w*(-head)*1.12-q.w*.06;
      float strength=sin(3.1416*(-head));
      lit+=scanLight*fall(.7,-.7,d)*strength*(.11*exp(-abs(p.y-y)/9.)+.03*exp(-max(y-p.y,0.)/110.)*step(p.y,y));
      continue;
    }
    vec2 l=p.xy-q.xy;
    float per=2.*(q.z+q.w),top=abs(l.y),right=abs(l.x-q.z),bottom=abs(l.y-q.w),leftSide=abs(l.x),least=min(min(top,right),min(bottom,leftSide));
    float along=least==top?l.x:least==right?q.z+l.y:least==bottom?q.z+q.w+q.z-l.x:per-l.y;
    float behind=mod(head*per-along+per,per);
    float tail=exp(-behind/190.);
    lit+=scanLight*tail*(fall(2.4,.8,abs(d))*.62+.05*exp(-abs(d)/14.));
  }
  // objects dim the lamp reflections, so text on an object never stands on a bright lamp
  lit=lit*(1.-COVER_DIM*cover)+gloss*(1.-COVER_GLOSS*cover);
  // lens falloff, the cosine of the angle off the axis to the fourth power, with a tighter vignette on top
  float off=length(s)/camF;float cosine=1./sqrt(1.+off*off);
  lit*=pow(cosine,4.)*(1.-.5*smoothstep(.22,.62,length(s/(res/pixel))));
  // a filmic curve and a grade, the shadows lean to teal and the highlights stay neutral
  lit*=1.15;
  vec3 m=(lit*(2.51*lit+.03))/(lit*(2.43*lit+.59)+.14);
  m=mix(m*vec3(.9,1.,1.07),m,smoothstep(0.,.5,dot(m,vec3(.33))));
  m=pow(clamp(m,0.,1.),vec3(1./2.2));
  // dither against banding in dark gradients
  float dither=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))))-.5;
  color=vec4(m+dither/255.,1.);
}`;
  return SCENE_FRAGMENT;
}

/* a seeded generator, the scuffs of the table are the same on every load */
function seeded(seed) {
  let h = 2166136261;
  for (const ch of seed) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = (h + 0x6D2B79F5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* paints the tile, red holds the depth of scratches, green the duller areas left by wiping, blue the rings left by glassware */
function paintScratches(texels) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = texels;
  const ctx = canvas.getContext('2d'), rnd = seeded('table'), size = SCENE_TILE, k = texels / size, wipe = -0.32;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, texels, texels);
  ctx.scale(k, k);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  const marks = [];
  for (let i = 0; i < 60; i++) marks.push({x: rnd() * size, y: rnd() * size, len: size * (0.2 + rnd() * 0.5), turn: wipe + (rnd() - 0.5) * 0.1, bend: (rnd() - 0.5) * 60, style: `rgba(0,255,0,${0.03 + rnd() * 0.05})`, width: 30 + rnd() * 110});
  for (let i = 0; i < 2400; i++) marks.push({x: rnd() * size, y: rnd() * size, len: 4 + rnd() ** 2.4 * 130, turn: rnd() < 0.8 ? wipe + (rnd() - 0.5) * 0.34 : rnd() * Math.PI, bend: (rnd() - 0.5) * 5, style: `rgba(255,0,0,${0.07 + rnd() * 0.24})`, width: 0.5 + rnd() * 0.9});
  for (let i = 0; i < 46; i++) marks.push({x: rnd() * size, y: rnd() * size, len: size * (0.14 + rnd() * 0.42), turn: wipe + (rnd() - 0.5) * 0.2, bend: (rnd() - 0.5) * 90, style: `rgba(255,0,0,${0.1 + rnd() * 0.22})`, width: 0.7 + rnd() * 0.9});
  const rings = Array.from({length: 8}, () => ({x: rnd() * size, y: rnd() * size, r: 26 + rnd() * 48, from: rnd() * Math.PI * 2, arc: Math.PI * (0.8 + rnd() * 1.2), width: 1 + rnd() * 2}));
  for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
    for (const m of marks) {
      // the tile repeats, a neighbour paints here only what reaches over the edge
      const x = m.x + dx, y = m.y + dy, reach = m.len + m.width + Math.abs(m.bend);
      if (x + reach < 0 || x - reach > size || y + reach < 0 || y - reach > size) continue;
      ctx.strokeStyle = m.style;
      ctx.lineWidth = m.width;
      const cos = Math.cos(m.turn), sin = Math.sin(m.turn);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + cos * m.len * 0.5 - sin * m.bend, y + sin * m.len * 0.5 + cos * m.bend, x + cos * m.len, y + sin * m.len);
      ctx.stroke();
    }
    for (const r of rings) {
      ctx.strokeStyle = 'rgba(0,0,255,.26)';
      ctx.lineWidth = r.width;
      ctx.beginPath();
      ctx.arc(r.x + dx, r.y + dy, r.r, r.from, r.from + r.arc);
      ctx.stroke();
    }
  }
  const worn = document.createElement('canvas');
  worn.width = worn.height = texels;
  const soft = worn.getContext('2d');
  soft.filter = 'blur(1.5px)';
  for (const dx of [-texels, 0, texels]) for (const dy of [-texels, 0, texels]) soft.drawImage(canvas, dx, dy);
  return worn;
}

function compileProgram(gl, material) {
  const compile = (type, source, name) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`scene: ${name} shader failed to compile: ${gl.getShaderInfoLog(shader)}`);
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, SCENE_VERTEX, 'vertex'));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource(material), 'fragment'));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`scene: the program failed to link: ${gl.getProgramInfoLog(program)}`);
  gl.useProgram(program);
  return program;
}

export class Scene {
  /* isLaid(tab) says whether a tab lies on the table right now, rampOf(owner, clock) how far the light of an object has come on, onDrawn(view) runs after each frame */
  constructor({camera, isLaid, rampOf, material, onDrawn, scans = (/** @type {number} */ _clock) => [], trace, report}) {
    this.camera = camera;
    this.isLaid = isLaid;
    this.rampOf = rampOf;
    this.material = material;
    this.onDrawn = onDrawn;
    this.trace = trace;
    this.report = report;
    /** @type {WebGL2RenderingContext | null} */
    this.gl = null;
    /** @type {any} */
    this.canvas = null;
    this.scans = scans;
    /** @type {Record<string, any>} */
    this.uniforms = {};
    this.frame = 0;
    /** @type {Record<string, any[]>} */
    this.emitters_ = {};
    this.offsets = {};
    this.seams = {x: new Float32Array(0), y: new Float32Array(0)};
    /** @type {any[]} */
    this.flashes = [];
    this.lastDraw = 0;
    this.lastBusy = -Infinity;
    this.ratio = 0;
    this.slowFrames = 0;
    this.gpuName = '';
    this.lite = coarse();
  }

  start() {
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      this.busy = new PerformanceObserver(() => {
        this.lastBusy = performance.now();
      });
      this.busy.observe({entryTypes: ['longtask']});
    }
    const canvas = document.createElement('canvas');
    canvas.id = 'rostrumCanvas';
    canvas.setAttribute('aria-hidden', 'true');
    const gl = canvas.getContext('webgl2', {antialias: false, alpha: false});
    if (!gl) throw new Error('scene: this browser gives no WebGL2 context, the table cannot be rendered');
    this.canvas = canvas;
    this.setup(gl);
    this.gl = gl;
    document.body.prepend(canvas);
    const names = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpuName = names ? String(gl.getParameter(names.UNMASKED_RENDERER_WEBGL)) : '';
    // with software rendering the CPU draws every pixel, so the table starts at its lowest scale, the long tasks this causes would hide the slowness from keepUp
    if (/swiftshader|basic render|llvmpipe|software/i.test(this.gpuName)) {
      this.lite = true;
      this.ratio = LOWEST_RATIO;
      console.warn(`${new Date().toISOString()} scene: no GPU, ${this.gpuName}, the table is drawn at the lowest scale, half rate, fewer lights`);
    }
    canvas.addEventListener('webglcontextlost', (/** @type {Event} */ e) => {
      if (!this.gl) return;
      this.trace('gl.lost');
      this.report('scene.gl', new Error('the WebGL context of the table was lost'));
      e.preventDefault();
    });
    // a phone takes the GPU away from a background page, so everything is rebuilt when the context comes back
    canvas.addEventListener('webglcontextrestored', () => {
      this.trace('gl.restored');
      this.setup(gl);
      this.resize();
      this.request();
    });
    this.resize();
  }

  stop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.busy) this.busy.disconnect();
    if (!this.gl) return;
    const lose = this.gl.getExtension('WEBGL_lose_context');
    this.gl = null;
    if (lose) lose.loseContext();
    this.canvas.remove();
  }

  setup(gl) {
    const program = compileProgram(gl, this.material);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const corner = gl.getAttribLocation(program, 'corner');
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paintScratches(this.lite ? SCRATCH_TEXELS_LITE : SCRATCH_TEXELS));
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
    if (anisotropy) gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    for (const name of ['res', 'pixel', 'target', 'camH', 'camF', 'tilt', 'emitters', 'rect', 'tint', 'scans', 'scanRect', 'scanHead', 'scratches', 'seamsX', 'seamsY', 'seamX', 'seamY']) this.uniforms[name] = gl.getUniformLocation(program, name);
  }

  resize(fixed) {
    const {gl, canvas} = this;
    if (!gl) return;
    // a phone has many pixels and a small GPU, the table is soft enough to do with fewer
    const most = this.lite ? 0.75 : 1.5;
    const fits = Math.sqrt(MOST_PIXELS / (innerWidth * innerHeight));
    const ratio = typeof fixed === 'number' ? fixed : Math.min(this.ratio || most, window.devicePixelRatio || 1, fits);
    const width = Math.round(innerWidth * ratio), height = Math.round(innerHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
    this.ratio = ratio;
    this.request();
  }

  request() {
    if (!this.frame) this.frame = requestAnimationFrame(now => this.draw(now));
  }

  /* the camera moved in this frame, so the table draws in it too and does not lag a frame behind what lies on it */
  flush(now) {
    if (!this.frame) return;
    cancelAnimationFrame(this.frame);
    this.draw(now);
  }

  view() {
    const {x, y, h, tilt} = this.camera;
    return {x, y, h, tilt};
  }

  setEmitters(tab, list) {
    this.emitters_[tab] = list;
  }

  /* the table was rearranged, the lights of the tab move along */
  shiftEmitters(tab, dx, dy) {
    for (const r of this.emitters_[tab] || []) {
      r.x += dx;
      r.y += dy;
    }
  }

  /* a tab is sliding to its new place, its lights are offset along with it */
  setOffset(tab, dx, dy) {
    if (dx || dy) this.offsets[tab] = {x: dx, y: dy};
    else delete this.offsets[tab];
    this.request();
  }

  setSeams({x, y}) {
    if (x.length > SCENE_MAX_SEAMS || y.length > SCENE_MAX_SEAMS) this.report('scene.seams', new Error(`${x.length} and ${y.length} joints of the table, the shader takes ${SCENE_MAX_SEAMS} on an axis, the rest are not drawn`));
    this.seams = {x: Float32Array.from(x.slice(0, SCENE_MAX_SEAMS).map(v => v + 1)), y: Float32Array.from(y.slice(0, SCENE_MAX_SEAMS).map(v => v + 1))};
    this.request();
  }

  emittersOf(tab) {
    return this.emitters_[tab] || [];
  }

  get emitterCount() {
    return Object.values(this.emitters_).flat().length;
  }

  flash(rect, tint) {
    this.flashes.push({at: performance.now(), ...rect, tint});
    this.request();
  }

  draw(now) {
    this.frame = 0;
    if (!this.gl) return;
    // a phone draws the table at half the rate of the content that moves over it
    if (this.lite && now - this.lastDraw < LITE_FRAME_MS) {
      this.request();
      return;
    }
    this.keepUp(now);
    const {gl, uniforms} = this, cam = this.view(), {rects, tints, used, warming, scanRects, scanHeads, scanning} = this.lights(cam);
    gl.uniform2f(uniforms.res, this.canvas.width, this.canvas.height);
    gl.uniform1f(uniforms.pixel, this.ratio);
    gl.uniform3f(uniforms.target, cam.x, cam.y, 0);
    gl.uniform1f(uniforms.camH, cam.h);
    gl.uniform1f(uniforms.camF, CAMERA_F);
    gl.uniform1f(uniforms.tilt, cam.tilt);
    gl.uniform1i(uniforms.emitters, used);
    gl.uniform4fv(uniforms.rect, rects);
    gl.uniform4fv(uniforms.tint, tints);
    gl.uniform1i(uniforms.scans, scanning);
    gl.uniform4fv(uniforms.scanRect, scanRects);
    gl.uniform1fv(uniforms.scanHead, scanHeads);
    gl.uniform1i(uniforms.seamsX, this.seams.x.length);
    gl.uniform1i(uniforms.seamsY, this.seams.y.length);
    if (this.seams.x.length) gl.uniform1fv(uniforms.seamX, this.seams.x);
    if (this.seams.y.length) gl.uniform1fv(uniforms.seamY, this.seams.y);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.onDrawn(cam);
    if (warming) this.request();
  }

  /* a machine that cannot keep up gets fewer pixels, measured from the gap between two draws of one movement */
  keepUp(now) {
    const gap = now - this.lastDraw;
    this.lastDraw = now;
    if (gap >= 500) this.slowFrames = 0;
    else if (gap > 0) {
      if (performance.now() - this.lastBusy < BUSY_MS) this.slowFrames = 0;
      else this.slowFrames = gap > (this.lite ? SLOW_MS_LITE : SLOW_MS) ? this.slowFrames + 1 : 0;
      if (this.slowFrames >= SLOW_RUN && this.ratio > LOWEST_RATIO) {
        this.ratio = Math.max(LOWEST_RATIO, this.ratio * 0.8);
        this.slowFrames = 0;
        console.warn(`${new Date().toISOString()} scene: frames take too long, render scale lowered to ${this.ratio.toFixed(2)}`);
        this.resize(this.ratio);
      } else if (this.slowFrames >= SLOW_RUN && !this.lite) {
        // fewer pixels were not enough, so the table is drawn as on a phone, with fewer lights at half the rate of the content
        this.lite = true;
        this.slowFrames = 0;
        console.warn(`${new Date().toISOString()} scene: frames still take too long at the lowest render scale, the table is drawn at half rate with fewer lights`);
      }
    }
  }

  /* The emitters nearest to where the camera looks, as many as the shader takes
     Tabs not laid out are lit only when seen from high above or from a flight, at working height the camera may wander over their ground and nothing of them lies there
     A negative strength in the uniforms means light from the left edge */
  lights(cam) {
    const far = Math.max(0, Math.min(1, (cam.h / CAMERA_F - 1.1) / 0.5)), clock = performance.now(), box = this.camera.viewBox(cam.h), halfW = box.halfW + LIGHT_REACH, halfH = box.halfH + LIGHT_REACH;
    // an emitter out of the frame costs every pixel the same as one in it, so it is skipped, and what has not lit up yet takes no slot
    const inView = r => (r.x < cam.x + halfW && r.x + r.w > cam.x - halfW && r.y < cam.y + halfH && r.y + r.h > cam.y - halfH);
    const all = Object.values(this.emitters_).flat().filter(r => (far > 0 || this.isLaid(r.tab)) && inView(r) && this.rampOf(r.owner, clock) > 0);
    const distance = r => Math.abs(r.x + r.w / 2 - cam.x) + Math.abs(r.y + r.h / 2 - cam.y) * 0.6;
    const most = this.lite ? LITE_EMITTERS : SCENE_MAX_EMITTERS;
    const near = all.length > most ? all.map(r => [distance(r), r]).sort((a, b) => a[0] - b[0]).slice(0, most).map(p => p[1]) : all;
    const rects = new Float32Array(SCENE_MAX_EMITTERS * 4), tints = new Float32Array(SCENE_MAX_EMITTERS * 4);
    let warming = false, used = 0;
    for (const r of near) {
      const ramp = this.rampOf(r.owner, clock), rising = r.since ? Math.min(1, (clock - r.since) / ACCENT_MS) : 1, power = (this.isLaid(r.tab) ? ramp : ramp * far) * rising * rising * (3 - 2 * rising);
      if (rising < 1) warming = true;
      // keeps drawing while a light ramps up, an object not seen yet stays at 0 and asks for no frames
      if (ramp < 1 && ramp > 0) warming = true;
      if (power <= 0) continue;
      // the outline follows the slide of an object that moved or grew
      const going = r.slide ? 1 - Math.min(1, (clock - r.slide.at) / SLIDE_MS) : 0, left = 1 - (1 - going) ** 3;
      if (going > 0) warming = true;
      const off = this.offsets[r.tab];
      rects.set([r.x + (off ? off.x : 0), r.y + (off ? off.y : 0) + (going > 0 ? r.slide.dy * left : 0), r.w, r.h + (going > 0 ? r.slide.dh * left : 0)], used * 4);
      tints.set([...r.tint.color, (r.tint.edge ? -1 : 1) * r.tint.strength * power], used * 4);
      used++;
    }
    this.flashes = this.flashes.filter(f => clock - f.at < FLASH_MS);
    for (const f of this.flashes) {
      if (used >= SCENE_MAX_EMITTERS) break;
      const t = (clock - f.at) / FLASH_MS;
      rects.set([f.x, f.y, f.w, f.h], used * 4);
      tints.set([f.tint[0], f.tint[1], f.tint[2], -1.5 * (1 - t) * (1 - t)], used * 4);
      used++;
      warming = true;
    }
    const seen = this.scans(clock).filter(inView).slice(0, SCENE_MAX_SCANS), scanRects = new Float32Array(SCENE_MAX_SCANS * 4), scanHeads = new Float32Array(SCENE_MAX_SCANS);
    seen.forEach((scan, i) => {
      scanRects.set([scan.x, scan.y, scan.w, scan.h], i * 4);
      scanHeads[i] = scan.head;
    });
    return {rects, tints, used, warming: warming || seen.length > 0, scanRects, scanHeads, scanning: seen.length};
  }
}
