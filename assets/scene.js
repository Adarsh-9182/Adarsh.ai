/* ===========================================================================
   The model.

   Not a background. This is the shape both Paisa and NutriScan actually have,
   drawn in three layers and left running:

     intake      a question arrives
     routing     a supervisor hands it to whichever specialist owns it
     engine      a rigid, orthogonal grid underneath — the deterministic part
                 that computes, and that the model is not allowed to overrule

   A pulse falls into the supervisor, takes one edge to a specialist, drops
   into the engine, walks the grid in right angles only, and comes back up.
   The free routing happens above; the straight lines happen below. That
   distinction is the whole argument of the work, so it is the whole picture.

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
    '  gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.1), 1.0, 64.0);',
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
    // solid core with a soft halo — a signal in transit
    '    a = smoothstep(0.50, 0.30, d) * 0.55 + smoothstep(0.22, 0.10, d);',
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
  function lookAt(out, ex, ey, ez, cx, cy, cz) {
    var zx=ex-cx, zy=ey-cy, zz=ez-cz;
    var zl=Math.hypot(zx,zy,zz) || 1; zx/=zl; zy/=zl; zz/=zl;
    // x = normalize(cross(up, z)) with up = (0,1,0), which reduces to (zz, 0, -zx)
    var xx = zz, xy = 0, xz = -zx;
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

  /* ── Static geometry ────────────────────────────────────────────────────
     Built once. Alpha is baked per-vertex so the grid can fade at its edges
     without a second draw call.
     ──────────────────────────────────────────────────────────────────── */

  var HALF = 6, STEP = 1.0;
  var lp = [], la = [];

  function seg(ax, ay, az, bx, by, bz, aa, ba) {
    lp.push(ax, ay, az, bx, by, bz); la.push(aa, ba);
  }
  // radial falloff so the engine dissolves instead of ending in a hard square
  function gridFade(a, b) {
    var d = Math.hypot(a, b) / (HALF * 1.25);
    return Math.max(0, 1 - d * d) * 0.82;
  }

  for (var i = -HALF; i <= HALF; i += STEP) {
    var stepsN = 24;
    for (var k = 0; k < stepsN; k++) {          // split so alpha can vary along the line
      var z0 = -HALF + (k / stepsN) * HALF * 2;
      var z1 = -HALF + ((k + 1) / stepsN) * HALF * 2;
      seg(i, FLOOR, z0, i, FLOOR, z1, gridFade(i, z0), gridFade(i, z1));
      seg(z0, FLOOR, i, z1, FLOOR, i, gridFade(z0, i), gridFade(z1, i));
    }
  }

  // routing edges: supervisor to each specialist
  specialists.forEach(function (s) {
    seg(0, 0, 0, s.x, s.y, s.z, 0.72, 0.52);
    // the drop into the engine, and the snap onto the grid
    seg(s.x, s.y, s.z, s.gx, FLOOR, s.gz, 0.20, 0.40);
  });

  // intake
  seg(0, INTAKE_Y, 0, 0, 0, 0, 0.05, 0.58);

  var linePos = new Float32Array(lp), lineAlpha = new Float32Array(la);
  var lineCount = linePos.length / 3;

  var bLinePos = gl.createBuffer(), bLineAlpha = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, bLinePos);   gl.bufferData(gl.ARRAY_BUFFER, linePos, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, bLineAlpha); gl.bufferData(gl.ARRAY_BUFFER, lineAlpha, gl.STATIC_DRAW);

  /* ── Pulses ─────────────────────────────────────────────────────────────
     Each one carries a route it has to finish: fall in, get handed to a
     specialist, drop into the engine, walk it in right angles, come back up.
     Nothing here is random except which specialist gets the work — which is
     the one thing that is genuinely a decision.
     ──────────────────────────────────────────────────────────────────── */

  var PULSES = coarse.matches ? 9 : 22;
  var pulses = [];

  function route() {
    var s = specialists[(Math.random() * specialists.length) | 0];
    var pts = [];
    var a = Math.random() * Math.PI * 2, r = 1.6 + Math.random() * 1.9;

    pts.push([Math.cos(a) * r, INTAKE_Y + Math.random() * 1.2, Math.sin(a) * r]); // arrives
    pts.push([0, 0, 0]);                                                          // supervisor
    pts.push([s.x, s.y, s.z]);                                                    // its specialist
    pts.push([s.gx, FLOOR, s.gz]);                                                // into the engine

    var gx = s.gx, gz = s.gz, axis = Math.random() < 0.5;
    var hops = 2 + ((Math.random() * 2) | 0);
    for (var h = 0; h < hops; h++) {                                              // right angles only
      var d = (1 + ((Math.random() * 3) | 0)) * (Math.random() < 0.5 ? -1 : 1);
      if (axis) gx = Math.max(-HALF, Math.min(HALF, gx + d));
      else      gz = Math.max(-HALF, Math.min(HALF, gz + d));
      axis = !axis;
      pts.push([gx, FLOOR, gz]);
    }
    pts.push([gx, 1.2, gz]);                                                      // the answer surfaces
    pts.push([gx, 3.4, gz]);

    return { pts: pts, i: 0, t: 0, speed: 0.5 + Math.random() * 0.55, node: s, fired: false };
  }

  for (var pi = 0; pi < PULSES; pi++) {
    var p = route();
    p.i = (Math.random() * (p.pts.length - 1)) | 0;   // stagger, so nothing starts in lockstep
    p.t = Math.random();
    pulses.push(p);
  }

  /* ── Dynamic point buffers ──────────────────────────────────────────── */

  var MAXP = nodes.length + PULSES;
  var ptPos = new Float32Array(MAXP * 3);
  var ptSize = new Float32Array(MAXP);
  var ptAlpha = new Float32Array(MAXP);
  var ptKind = new Float32Array(MAXP);
  var ptColor = new Float32Array(MAXP * 3);

  var bPos = gl.createBuffer(), bSize = gl.createBuffer(), bAlpha = gl.createBuffer(),
      bKind = gl.createBuffer(), bColor = gl.createBuffer();

  /* ── Palette, read from CSS so the themes stay in one place ─────────── */

  var C = { line: [0, 0, 0], node: [0, 0, 0], accent: [1, 0, 0], master: 1 };

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
  }
  readPalette();
  window.sceneReadPalette = readPalette;

  /* ── Camera ─────────────────────────────────────────────────────────────
     Scroll pulls the camera up and back: the hero looks along the routing
     layer at eye level, and by the end of the page you are above the whole
     thing looking down at the engine. The pointer only ever nudges.
     ──────────────────────────────────────────────────────────────────── */

  var scrollP = 0, scrollTarget = 0;
  var mx = 0, my = 0, mtx = 0, mty = 0;

  var rootEl = document.documentElement;

  function onScroll() {
    var h = Math.max(1, document.body.scrollHeight - innerHeight);
    scrollTarget = Math.min(1, Math.max(0, scrollY / h));
    // The wash is a reading aid, so it tracks the first screen rather than the
    // page — but it never reaches zero: the masthead has prose in it too, and a
    // grid line through a sentence is not depth, it is a defect.
    var w = 0.44 + 0.56 * Math.min(1, Math.max(0, scrollY / (innerHeight * 0.7)));
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
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.DEPTH_TEST);          // painter's order; everything is translucent line-work

  function lerp(a, b, t) { return a + (b - a) * t; }

  var last = performance.now();

  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    scrollP += (scrollTarget - scrollP) * Math.min(1, dt * 4.5);
    mx += (mtx - mx) * Math.min(1, dt * 3);
    my += (mty - my) * Math.min(1, dt * 3);

    var e = scrollP * scrollP * (3 - 2 * scrollP);                 // smoothstep
    var ang  = 0.62 + e * 1.15 + now * 0.000022 + mx * 0.16;
    var rad  = lerp(7.2, 14.6, e);
    var high = lerp(1.25, 7.4, e) - my * 0.55;

    lookAt(view,
      Math.cos(ang) * rad, high, Math.sin(ang) * rad,
      0, lerp(-0.45, -1.5, e), 0);
    perspective(proj, 50 * Math.PI / 180, W / H, 0.1, 100);

    // Shift the projection centre rather than the camera: the model drops into
    // the lower half of the hero without the perspective going flat, and slides
    // back to centre as the document takes over.
    proj[9] += lerp(0.28, 0.0, e);

    // advance every pulse along its route
    var n = nodes.length;
    for (var j = 0; j < pulses.length; j++) {
      var p = pulses[j];
      var A = p.pts[p.i], B = p.pts[p.i + 1];
      var len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]) || 0.001;
      p.t += (p.speed * dt * 3.2) / len;

      if (p.t >= 1) {
        p.t = 0; p.i++;
        if (p.i === 1) supervisor.hot = 1;                          // handed in
        if (p.i === 2 && !p.fired) { p.node.hot = 1; p.fired = true; }
        if (p.i >= p.pts.length - 1) { pulses[j] = route(); continue; }
      }

      var t = p.t;
      var idx = (n + j) * 3;
      ptPos[idx]     = A[0] + (B[0] - A[0]) * t;
      ptPos[idx + 1] = A[1] + (B[1] - A[1]) * t;
      ptPos[idx + 2] = A[2] + (B[2] - A[2]) * t;

      // fade in on arrival, fade out as the answer leaves the top
      var head = p.i === 0 ? t : 1;
      var tail = p.i >= p.pts.length - 2 ? 1 - t : 1;
      ptSize[n + j]  = p.i >= 3 && p.i < p.pts.length - 2 ? 0.062 : 0.078;
      ptAlpha[n + j] = 0.95 * head * tail;
      ptKind[n + j]  = 1;
      ptColor[idx] = C.accent[0]; ptColor[idx + 1] = C.accent[1]; ptColor[idx + 2] = C.accent[2];
    }

    // nodes, with their arrival flash decaying
    for (var q = 0; q < n; q++) {
      var nd = nodes[q];
      nd.hot = Math.max(0, nd.hot - dt * 1.9);
      var i3 = q * 3;
      ptPos[i3] = nd.x; ptPos[i3 + 1] = nd.y; ptPos[i3 + 2] = nd.z;
      ptSize[q]  = nd.size * (1 + nd.hot * 0.42);
      ptAlpha[q] = 0.5 + nd.hot * 0.5;
      ptKind[q]  = 0;
      var col = nd.hot > 0.02 ? C.accent : C.node;
      ptColor[i3] = col[0]; ptColor[i3 + 1] = col[1]; ptColor[i3 + 2] = col[2];
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // structure
    gl.useProgram(lineProg.id);
    gl.uniformMatrix4fv(lineProg.u.uProj, false, proj);
    gl.uniformMatrix4fv(lineProg.u.uView, false, view);
    gl.uniform3fv(lineProg.u.uColor, C.line);
    gl.uniform1f(lineProg.u.uMaster, C.master);
    gl.uniform1f(lineProg.u.uFogNear, 7.0);
    gl.uniform1f(lineProg.u.uFogFar, 24.0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bLinePos);
    gl.enableVertexAttribArray(lineProg.a.aPos);
    gl.vertexAttribPointer(lineProg.a.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bLineAlpha);
    gl.enableVertexAttribArray(lineProg.a.aAlpha);
    gl.vertexAttribPointer(lineProg.a.aAlpha, 1, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, lineCount);

    // nodes and signals
    gl.useProgram(ptProg.id);
    gl.uniformMatrix4fv(ptProg.u.uProj, false, proj);
    gl.uniformMatrix4fv(ptProg.u.uView, false, view);
    gl.uniform1f(ptProg.u.uScale, (H * DPR) / (2 * Math.tan(25 * Math.PI / 180)));
    gl.uniform1f(ptProg.u.uMaster, C.master);
    gl.uniform1f(ptProg.u.uFogNear, 8.0);
    gl.uniform1f(ptProg.u.uFogFar, 26.0);

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
    // one static frame, then hold
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
