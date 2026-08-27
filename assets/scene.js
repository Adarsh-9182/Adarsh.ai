/* ===========================================================================
   The model.

   Not a background. This is the shape both Paisa and NutriScan actually have,
   drawn in three layers and left running:

     intake      a question arrives
     routing     a supervisor hands it to whichever specialist owns it
     engine      a stack of rigid orthogonal grids — the deterministic part
                 that computes, and that the model is not allowed to overrule

   A pulse falls into the supervisor, takes one edge to a specialist, drops
   into the engine, walks the grid in right angles only, and comes back up.
   Edges light as traffic crosses them, pulses drag a trail, and the whole
   thing is lit additively in the dark theme so a busy router actually glows.
   The free routing happens above; the straight lines happen below. That
   distinction is the argument the work is built on, so it is the picture.

   Hand-written WebGL — no Three.js, no build step. Lines and points are all
   this needs, and writing them directly is smaller than the library import.
   =========================================================================== */

(function () {
  "use strict";

  var canvas = document.getElementById('scene');
  if (!canvas) return;

  var gl = canvas.getContext('webgl2', { antialias: true, alpha: true, powerPreference: 'high-performance' })
        || canvas.getContext('webgl',  { antialias: true, alpha: true });

  if (!gl) { document.documentElement.classList.add('no-gl'); return; }

  var reduced = matchMedia('(prefers-reduced-motion: reduce)');
  var coarse  = matchMedia('(pointer: coarse)');

  /* ── Shaders ────────────────────────────────────────────────────────────
     GLSL ES 1.00 so the same source compiles under WebGL 1 and 2. Depth is
     carried by fog and by alpha, never by a lighting model: the scene is a
     drawing, not a photograph.
     ──────────────────────────────────────────────────────────────────── */

  var LINE_VS = [
    'attribute vec3 aPos;',
    'attribute float aAlpha;',
    'uniform mat4 uProj, uView;',
    'uniform float uFogNear, uFogFar;',
    'varying float vAlpha;',
    'void main(){',
    '  vec4 mv = uView * vec4(aPos, 1.0);',
    '  gl_Position = uProj * mv;',
    '  float fog = 1.0 - smoothstep(uFogNear, uFogFar, -mv.z);',
    '  vAlpha = aAlpha * fog;',
    '}'
  ].join('\n');

  var LINE_FS = [
    'precision mediump float;',
    'uniform vec3 uColor;',
    'uniform float uMaster;',
    'varying float vAlpha;',
    'void main(){ gl_FragColor = vec4(uColor, vAlpha * uMaster); }'
  ].join('\n');

  var PT_VS = [
    'attribute vec3 aPos;',
    'attribute float aSize;',
    'attribute float aAlpha;',
    'attribute float aKind;',   // 0 = hollow node, 1 = solid pulse
    'attribute vec3 aColor;',
    'uniform mat4 uProj, uView;',
    'uniform float uScale, uFogNear, uFogFar;',
    'varying float vAlpha; varying float vKind; varying vec3 vColor;',
    'void main(){',
    '  vec4 mv = uView * vec4(aPos, 1.0);',
    '  gl_Position = uProj * mv;',
    '  gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.1), 1.0, 96.0);',
    '  float fog = 1.0 - smoothstep(uFogNear, uFogFar, -mv.z);',
    '  vAlpha = aAlpha * fog; vKind = aKind; vColor = aColor;',
    '}'
  ].join('\n');

  var PT_FS = [
    'precision mediump float;',
    'uniform float uMaster;',
    'varying float vAlpha; varying float vKind; varying vec3 vColor;',
    'void main(){',
    '  float d = length(gl_PointCoord - vec2(0.5));',
    '  if (d > 0.5) discard;',
    '  float a;',
    '  if (vKind < 0.5) {',
    // hollow ring — reads as a drawn node, not a glowing orb
    '    a = smoothstep(0.50, 0.42, d) * smoothstep(0.26, 0.34, d);',
    '  } else {',
    // hot core inside a wide halo — a signal in transit
    '    a = smoothstep(0.50, 0.06, d) * 0.42 + smoothstep(0.17, 0.02, d);',
    '  }',
    '  gl_FragColor = vec4(vColor, min(a, 1.0) * vAlpha * uMaster);',
    '}'
  ].join('\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s)); return null;
    }
    return s;
  }
  function program(vs, fs, attrs, unis) {
    var p = gl.createProgram();
    var v = compile(gl.VERTEX_SHADER, vs), f = compile(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(p)); return null; }
    var o = { id: p, a: {}, u: {} };
    attrs.forEach(function (n) { o.a[n] = gl.getAttribLocation(p, n); });
    unis.forEach(function (n) { o.u[n] = gl.getUniformLocation(p, n); });
    return o;
  }

  var lineProg = program(LINE_VS, LINE_FS,
    ['aPos', 'aAlpha'], ['uProj', 'uView', 'uColor', 'uMaster', 'uFogNear', 'uFogFar']);
  var ptProg = program(PT_VS, PT_FS,
    ['aPos', 'aSize', 'aAlpha', 'aKind', 'aColor'],
    ['uProj', 'uView', 'uScale', 'uMaster', 'uFogNear', 'uFogFar']);

  if (!lineProg || !ptProg) { document.documentElement.classList.add('no-gl'); return; }

  /* ── Matrices ─────────────────────────────────────────────────────────── */

  function perspective(out, fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    out[0]=f/aspect; out[1]=0; out[2]=0;  out[3]=0;
    out[4]=0; out[5]=f; out[6]=0;         out[7]=0;
    out[8]=0; out[9]=0; out[10]=(far+near)*nf; out[11]=-1;
    out[12]=0;out[13]=0;out[14]=2*far*near*nf; out[15]=0;
    return out;
  }
  // General form, because the camera rolls: the up vector is not always +Y.
  function lookAt(out, ex, ey, ez, cx, cy, cz, ux, uy, uz) {
    var zx=ex-cx, zy=ey-cy, zz=ez-cz;
    var zl=Math.hypot(zx,zy,zz) || 1; zx/=zl; zy/=zl; zz/=zl;
    var xx=uy*zz-uz*zy, xy=uz*zx-ux*zz, xz=ux*zy-uy*zx;
    var xl=Math.hypot(xx,xy,xz) || 1; xx/=xl; xy/=xl; xz/=xl;
    var yx=zy*xz-zz*xy, yy=zz*xx-zx*xz, yz=zx*xy-zy*xx;
    out[0]=xx; out[1]=yx; out[2]=zx; out[3]=0;
    out[4]=xy; out[5]=yy; out[6]=zy; out[7]=0;
    out[8]=xz; out[9]=yz; out[10]=zz; out[11]=0;
    out[12]=-(xx*ex+xy*ey+xz*ez);
    out[13]=-(yx*ex+yy*ey+yz*ez);
    out[14]=-(zx*ex+zy*ey+zz*ez);
    out[15]=1;
    return out;
  }

  var proj = new Float32Array(16), view = new Float32Array(16);

  /* ── The three layers ───────────────────────────────────────────────────
     Specialists sit at deliberately uneven heights so the routing layer
     reads as a layer and not as a dial. Their engine entry points snap to
     whole grid coordinates, because that is the point: above the floor
     things are placed, on the floor they are aligned.
     ──────────────────────────────────────────────────────────────────── */

  var FLOOR = -2.65, INTAKE_Y = 3.15;
  var DECKS = [0, -2.0, -3.8];          // the engine, stacked for depth
  var DECK_A = [1, 0.42, 0.17];

  var supervisor = { x: 0, y: 0, z: 0, hot: 0, size: 0.21 };

  var specialists = [
    { x: -3.0, y:  0.38, z: -1.0 },
    { x: -1.5, y: -0.18, z:  2.5 },
    { x:  1.5, y:  0.50, z:  2.0 },
    { x:  3.0, y: -0.12, z: -0.5 },
    { x:  0.5, y:  0.26, z: -3.0 },
    { x: -2.5, y: -0.30, z: -2.5 }
  ].map(function (s) {
    s.hot = 0; s.size = 0.13;
    s.gx = Math.round(s.x); s.gz = Math.round(s.z);   // engine entry, grid-aligned
    return s;
  });

  var nodes = [supervisor].concat(specialists);

  /* ── Static geometry: the engine decks ──────────────────────────────────
     Built once. Alpha is baked per-vertex so the grids can fade at their
     edges, and deck by deck with depth, without extra draw calls.
     ──────────────────────────────────────────────────────────────────── */

  var HALF = 6, STEP = 1.0, SEGS = 24;
  var lp = [], la = [];

  function seg(ax, ay, az, bx, by, bz, aa, ba) {
    lp.push(ax, ay, az, bx, by, bz); la.push(aa, ba);
  }
  // radial falloff so each deck dissolves instead of ending in a hard square
  function gridFade(a, b) {
    var d = Math.hypot(a, b) / (HALF * 1.25);
    return Math.max(0, 1 - d * d) * 0.95;
  }

  DECKS.forEach(function (dy, di) {
    var y = FLOOR + dy, k = DECK_A[di];
    for (var i = -HALF; i <= HALF; i += STEP) {
      for (var n = 0; n < SEGS; n++) {
        var z0 = -HALF + (n / SEGS) * HALF * 2;
        var z1 = -HALF + ((n + 1) / SEGS) * HALF * 2;
        seg(i, y, z0, i, y, z1, gridFade(i, z0) * k, gridFade(i, z1) * k);
        seg(z0, y, i, z1, y, i, gridFade(z0, i) * k, gridFade(z1, i) * k);
      }
    }
  });

  var linePos = new Float32Array(lp), lineAlpha = new Float32Array(la);
  var lineCount = linePos.length / 3;

  var bLinePos = gl.createBuffer(), bLineAlpha = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bLinePos);   gl.bufferData(gl.ARRAY_BUFFER, linePos, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, bLineAlpha); gl.bufferData(gl.ARRAY_BUFFER, lineAlpha, gl.STATIC_DRAW);

  /* ── Routing edges, which light up under traffic ────────────────────────
     Kept in their own small dynamic buffer so an edge can brighten the
     moment a pulse commits to it. You can watch the router choose.
     ──────────────────────────────────────────────────────────────────── */

  var edges = [];
  specialists.forEach(function (s) {                       // 0..5  supervisor → specialist
    edges.push({ a: [0, 0, 0], b: [s.x, s.y, s.z], base: 0.30, hot: 0 });
  });
  specialists.forEach(function (s) {                       // 6..11 specialist → engine
    edges.push({ a: [s.x, s.y, s.z], b: [s.gx, FLOOR, s.gz], base: 0.16, hot: 0 });
  });
  edges.push({ a: [0, INTAKE_Y, 0], b: [0, 0, 0], base: 0.22, hot: 0 });   // 12 intake

  var edgePos = new Float32Array(edges.length * 6);
  var edgeAlpha = new Float32Array(edges.length * 2);
  edges.forEach(function (e, i) {
    edgePos[i*6]=e.a[0]; edgePos[i*6+1]=e.a[1]; edgePos[i*6+2]=e.a[2];
    edgePos[i*6+3]=e.b[0]; edgePos[i*6+4]=e.b[1]; edgePos[i*6+5]=e.b[2];
  });
  var bEdgePos = gl.createBuffer(), bEdgeAlpha = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bEdgePos); gl.bufferData(gl.ARRAY_BUFFER, edgePos, gl.STATIC_DRAW);

  /* ── Pulses ─────────────────────────────────────────────────────────────
     Each one carries a route it has to finish: fall in, get handed to a
     specialist, drop into the engine, walk it in right angles, come back up.
     Nothing here is random except which specialist gets the work — which is
     the one thing that is genuinely a decision. Each drags a trail so the
     path it took stays legible for a moment after it has gone.
     ──────────────────────────────────────────────────────────────────── */

  var PULSES = coarse.matches ? 16 : 48;
  var TRAIL  = coarse.matches ? 5  : 9;
  var pulses = [];

  function route() {
    var si = (Math.random() * specialists.length) | 0;
    var s = specialists[si];
    var pts = [];
    var a = Math.random() * Math.PI * 2, r = 1.6 + Math.random() * 1.9;

    pts.push([Math.cos(a) * r, INTAKE_Y + Math.random() * 1.4, Math.sin(a) * r]); // arrives
    pts.push([0, 0, 0]);                                                          // supervisor
    pts.push([s.x, s.y, s.z]);                                                    // its specialist
    pts.push([s.gx, FLOOR, s.gz]);                                                // into the engine

    var gx = s.gx, gz = s.gz, axis = Math.random() < 0.5;
    var hops = 3 + ((Math.random() * 3) | 0);
    for (var h = 0; h < hops; h++) {                                              // right angles only
      var d = (1 + ((Math.random() * 3) | 0)) * (Math.random() < 0.5 ? -1 : 1);
      if (axis) gx = Math.max(-HALF, Math.min(HALF, gx + d));
      else      gz = Math.max(-HALF, Math.min(HALF, gz + d));
      axis = !axis;
      pts.push([gx, FLOOR, gz]);
    }
    pts.push([gx, 1.2, gz]);                                                      // the answer surfaces
    pts.push([gx, 3.6, gz]);

    var trail = [];
    for (var t = 0; t < TRAIL; t++) trail.push([pts[0][0], pts[0][1], pts[0][2]]);

    return { pts: pts, i: 0, t: 0, speed: 0.55 + Math.random() * 0.7,
             node: s, si: si, fired: false, trail: trail, tw: 0 };
  }

  for (var pi = 0; pi < PULSES; pi++) {
    var p = route();
    p.i = (Math.random() * (p.pts.length - 1)) | 0;   // stagger, so nothing starts in lockstep
    p.t = Math.random();
    pulses.push(p);
  }

  /* ── Dynamic point buffers ──────────────────────────────────────────── */

  var MAXP = nodes.length + PULSES * (1 + TRAIL);
  var ptPos = new Float32Array(MAXP * 3);
  var ptSize = new Float32Array(MAXP);
  var ptAlpha = new Float32Array(MAXP);
  var ptKind = new Float32Array(MAXP);
  var ptColor = new Float32Array(MAXP * 3);

  var bPos = gl.createBuffer(), bSize = gl.createBuffer(), bAlpha = gl.createBuffer(),
      bKind = gl.createBuffer(), bColor = gl.createBuffer();

  /* ── Palette, read from CSS so the themes stay in one place ─────────── */

  var C = { line: [0, 0, 0], node: [0, 0, 0], accent: [1, 0, 0], master: 1, additive: false };

  function hexToRgb(h) {
    h = (h || '').trim().replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) return [0, 0, 0];
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  function readPalette() {
    var cs = getComputedStyle(document.documentElement);
    C.line   = hexToRgb(cs.getPropertyValue('--gl-line'));
    C.node   = hexToRgb(cs.getPropertyValue('--gl-node'));
    C.accent = hexToRgb(cs.getPropertyValue('--gl-accent'));
    C.master = parseFloat(cs.getPropertyValue('--gl-master')) || 1;
    // Additive light only works over a dark ground; on paper it would erase
    // the signals instead of making them glow.
    C.additive = parseFloat(cs.getPropertyValue('--gl-additive')) > 0.5;
  }
  readPalette();
  window.sceneReadPalette = readPalette;

  /* ── Camera ─────────────────────────────────────────────────────────────
     Scroll flies it: the top of the page sits down inside the routing layer
     at eye level, and by the bottom you are well above the whole stack
     looking down through every deck. It rolls slightly the whole time, and
     the pointer swings it. Nothing here is a nudge any more.
     ──────────────────────────────────────────────────────────────────── */

  var scrollP = 0, scrollTarget = 0;
  var mx = 0, my = 0, mtx = 0, mty = 0;
  var rootEl = document.documentElement;

  /* Keyframes, not a drift. Each stop is a shot the page actually wants at
     that point in the reading, and the scroll cuts between them:

       0.00  inside the routing layer, at eye level with the supervisor
       0.26  down on the engine decks, where the work is being computed
       0.52  pulled wide and high — the whole stack at once
       0.78  back in among the specialists
       1.00  above the intake, looking down the way a question arrives     */
  var KEYS = [
    { at: 0.00, rad:  5.4, high:  0.75, ty: -0.25, ang: 0.45, sh:  0.06 },
    { at: 0.26, rad:  7.6, high: -1.35, ty: -2.55, ang: 1.85, sh:  0.02 },
    { at: 0.52, rad: 16.4, high:  8.60, ty: -1.70, ang: 3.15, sh: -0.06 },
    { at: 0.78, rad:  8.2, high:  1.30, ty: -0.70, ang: 4.55, sh: -0.04 },
    { at: 1.00, rad:  6.6, high:  4.40, ty:  0.35, ang: 5.60, sh: -0.10 }
  ];

  var shot = { rad: 0, high: 0, ty: 0, ang: 0, sh: 0 };
  function sample(p) {
    var i = 0;
    while (i < KEYS.length - 2 && p > KEYS[i + 1].at) i++;
    var a = KEYS[i], b = KEYS[i + 1];
    var span = Math.max(1e-4, b.at - a.at);
    var t = Math.min(1, Math.max(0, (p - a.at) / span));
    t = t * t * (3 - 2 * t);
    shot.rad  = a.rad  + (b.rad  - a.rad)  * t;
    shot.high = a.high + (b.high - a.high) * t;
    shot.ty   = a.ty   + (b.ty   - a.ty)   * t;
    shot.ang  = a.ang  + (b.ang  - a.ang)  * t;
    shot.sh   = a.sh   + (b.sh   - a.sh)   * t;
    return shot;
  }

  /* The page tells the model which specialist it is currently talking about,
     so the card you are reading and the node it describes are the same thing. */
  var focusIdx = -1;
  window.sceneFocus = function (i) {
    focusIdx = (typeof i === 'number' && i >= 0 && i < specialists.length) ? i : -1;
  };

  function onScroll() {
    var h = Math.max(1, document.body.scrollHeight - innerHeight);
    scrollTarget = Math.min(1, Math.max(0, scrollY / h));
    // The panels are frosted rather than solid, so the model stays visible
    // through them the whole way down — the wash only takes the edge off.
    var w = 0.16 + 0.44 * Math.min(1, Math.max(0, scrollY / (innerHeight * 0.7)));
    rootEl.style.setProperty('--wash', w.toFixed(3));
  }
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (!coarse.matches) {
    addEventListener('pointermove', function (e) {
      mtx = (e.clientX / innerWidth - 0.5) * 2;
      mty = (e.clientY / innerHeight - 0.5) * 2;
    }, { passive: true });
  }

  /* ── Resize ─────────────────────────────────────────────────────────── */

  var W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  resize();
  addEventListener('resize', resize);

  /* ── Draw ───────────────────────────────────────────────────────────── */

  gl.enable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);          // painter's order; everything is translucent line-work

  function lerp(a, b, t) { return a + (b - a) * t; }

  var last = performance.now();

  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    scrollP += (scrollTarget - scrollP) * Math.min(1, dt * 4.5);
    mx += (mtx - mx) * Math.min(1, dt * 3);
    my += (mty - my) * Math.min(1, dt * 3);

    var K = sample(scrollP);
    var ang  = K.ang + now * 0.000045 + mx * 0.30;
    var rad  = K.rad;
    var high = K.high - my * 1.05;
    var roll = Math.sin(now * 0.00012) * 0.075 + mx * 0.055;

    lookAt(view,
      Math.cos(ang) * rad, high, Math.sin(ang) * rad,
      0, K.ty, 0,
      Math.sin(roll), Math.cos(roll), 0);
    perspective(proj, 54 * Math.PI / 180, W / H, 0.1, 100);

    // Shift the projection centre rather than the camera, so the model sits
    // where the page has room for it without the perspective going flat.
    proj[9] += K.sh;

    // cool the edges, then let this frame's traffic reheat them
    for (var q = 0; q < edges.length; q++) edges[q].hot = Math.max(0, edges[q].hot - dt * 1.6);

    // advance every pulse along its route
    var n = nodes.length;
    for (var j = 0; j < pulses.length; j++) {
      var p = pulses[j];
      var A = p.pts[p.i], B = p.pts[p.i + 1];
      var len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]) || 0.001;
      p.t += (p.speed * dt * 3.2) / len;

      if (p.t >= 1) {
        p.t = 0; p.i++;
        if (p.i === 1) { supervisor.hot = 1; edges[12].hot = 1; }        // handed in
        if (p.i === 2 && !p.fired) { p.node.hot = 1; p.fired = true; edges[p.si].hot = 1; }
        if (p.i === 3) edges[6 + p.si].hot = 1;                          // into the engine
        if (p.i >= p.pts.length - 1) { p = pulses[j] = route(); A = p.pts[0]; B = p.pts[1]; }
      }

      var t = p.t;
      var px = A[0] + (B[0] - A[0]) * t;
      var py = A[1] + (B[1] - A[1]) * t;
      var pz = A[2] + (B[2] - A[2]) * t;

      // ring-buffer the trail at a fixed cadence so it does not shorten
      // when the frame rate rises
      p.tw += dt;
      if (p.tw > 0.028) {
        p.tw = 0;
        p.trail.pop();
        p.trail.unshift([px, py, pz]);
      }

      // fade in on arrival, fade out as the answer leaves the top
      var head = p.i === 0 ? Math.min(1, t * 1.6) : 1;
      var tail = p.i >= p.pts.length - 2 ? 1 - t : 1;
      var vis = head * tail;
      var inEngine = p.i >= 3 && p.i < p.pts.length - 2;

      var base = n + j * (1 + TRAIL);
      var i3 = base * 3;
      ptPos[i3] = px; ptPos[i3 + 1] = py; ptPos[i3 + 2] = pz;
      ptSize[base]  = inEngine ? 0.070 : 0.090;
      ptAlpha[base] = 0.95 * vis;
      ptKind[base]  = 1;
      ptColor[i3] = C.accent[0]; ptColor[i3 + 1] = C.accent[1]; ptColor[i3 + 2] = C.accent[2];

      for (var k = 0; k < TRAIL; k++) {
        var ti = base + 1 + k, t3 = ti * 3, tp = p.trail[k];
        var f = 1 - (k + 1) / (TRAIL + 1);
        ptPos[t3] = tp[0]; ptPos[t3 + 1] = tp[1]; ptPos[t3 + 2] = tp[2];
        ptSize[ti]  = (inEngine ? 0.070 : 0.090) * (0.30 + f * 0.62);
        ptAlpha[ti] = 0.5 * f * f * vis;
        ptKind[ti]  = 1;
        ptColor[t3] = C.accent[0]; ptColor[t3 + 1] = C.accent[1]; ptColor[t3 + 2] = C.accent[2];
      }
    }

    // nodes, with their arrival flash decaying and a slow idle breath
    if (focusIdx >= 0) {
      specialists[focusIdx].hot = Math.max(specialists[focusIdx].hot, 0.8);
      edges[focusIdx].hot = Math.max(edges[focusIdx].hot, 0.7);
      edges[6 + focusIdx].hot = Math.max(edges[6 + focusIdx].hot, 0.45);
    }

    for (var b = 0; b < n; b++) {
      var nd = nodes[b];
      nd.hot = Math.max(0, nd.hot - dt * 1.9);
      var breath = 1 + Math.sin(now * 0.0013 + b * 1.7) * 0.06;
      var n3 = b * 3;
      ptPos[n3] = nd.x; ptPos[n3 + 1] = nd.y; ptPos[n3 + 2] = nd.z;
      ptSize[b]  = nd.size * breath * (1 + nd.hot * 0.55);
      ptAlpha[b] = 0.5 + nd.hot * 0.5;
      ptKind[b]  = 0;
      var col = nd.hot > 0.02 ? C.accent : C.node;
      ptColor[n3] = col[0]; ptColor[n3 + 1] = col[1]; ptColor[n3 + 2] = col[2];
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // the engine decks
    gl.useProgram(lineProg.id);
    gl.uniformMatrix4fv(lineProg.u.uProj, false, proj);
    gl.uniformMatrix4fv(lineProg.u.uView, false, view);
    gl.uniform3fv(lineProg.u.uColor, C.line);
    gl.uniform1f(lineProg.u.uMaster, C.master);
    gl.uniform1f(lineProg.u.uFogNear, 7.0);
    gl.uniform1f(lineProg.u.uFogFar, 26.0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bLinePos);
    gl.enableVertexAttribArray(lineProg.a.aPos);
    gl.vertexAttribPointer(lineProg.a.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bLineAlpha);
    gl.enableVertexAttribArray(lineProg.a.aAlpha);
    gl.vertexAttribPointer(lineProg.a.aAlpha, 1, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, lineCount);

    // the routing edges, lit by their traffic
    for (var m = 0; m < edges.length; m++) {
      var ed = edges[m], lit = ed.base + ed.hot * 0.85;
      edgeAlpha[m*2] = lit; edgeAlpha[m*2+1] = lit * 0.75;
    }
    gl.uniform3fv(lineProg.u.uColor, C.accent);
    gl.bindBuffer(gl.ARRAY_BUFFER, bEdgePos);
    gl.vertexAttribPointer(lineProg.a.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bEdgeAlpha);
    gl.bufferData(gl.ARRAY_BUFFER, edgeAlpha, gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(lineProg.a.aAlpha, 1, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, edges.length * 2);

    // nodes and signals — added rather than blended in the dark theme, so a
    // busy router actually glows where the traffic overlaps
    if (C.additive) gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    gl.useProgram(ptProg.id);
    gl.uniformMatrix4fv(ptProg.u.uProj, false, proj);
    gl.uniformMatrix4fv(ptProg.u.uView, false, view);
    gl.uniform1f(ptProg.u.uScale, (H * DPR) / (2 * Math.tan(27 * Math.PI / 180)));
    gl.uniform1f(ptProg.u.uMaster, C.master);
    gl.uniform1f(ptProg.u.uFogNear, 8.0);
    gl.uniform1f(ptProg.u.uFogFar, 28.0);

    function attr(buf, data, loc, size) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    }
    attr(bPos, ptPos, ptProg.a.aPos, 3);
    attr(bSize, ptSize, ptProg.a.aSize, 1);
    attr(bAlpha, ptAlpha, ptProg.a.aAlpha, 1);
    attr(bKind, ptKind, ptProg.a.aKind, 1);
    attr(bColor, ptColor, ptProg.a.aColor, 3);
    gl.drawArrays(gl.POINTS, 0, MAXP);
  }

  /* ── Loop ───────────────────────────────────────────────────────────────
     Still under reduced motion — the diagram is drawn once and left alone —
     and stopped entirely while the tab is hidden.
     ──────────────────────────────────────────────────────────────────── */

  var running = false, raf = 0;

  function tick(now) { frame(now); raf = requestAnimationFrame(tick); }

  function start() {
    if (running || reduced.matches) return;
    running = true; last = performance.now(); raf = requestAnimationFrame(tick);
  }
  function stop() { running = false; cancelAnimationFrame(raf); }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else start();
  });

  if (reduced.matches) {
    scrollP = scrollTarget; frame(performance.now());
    addEventListener('scroll', function () { scrollP = scrollTarget; frame(performance.now()); }, { passive: true });
    addEventListener('resize', function () { frame(performance.now()); });
  } else {
    start();
  }

  reduced.addEventListener('change', function () {
    if (reduced.matches) stop(); else start();
  });

  document.documentElement.classList.add('gl-on');
})();
