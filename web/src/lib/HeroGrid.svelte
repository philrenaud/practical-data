<!-- The animated hero texture: a procedural sheet of graph paper, drawn by a
     WebGL fragment shader. The ruling carries a paper-like bend (low-frequency
     domain warp, a drifting pitch, a slightly off-axis rotation) so it reads
     as a photographed sheet rather than generated lines, and cells pulse in
     and out with the extension's RdYlGn ramp, red on the left to green on the
     right. Without WebGL2 the hero stays flat. -->
<script lang="ts">
  // Cell height in CSS pixels, and the width:height ratio — spreadsheet
  // cells are wider than tall. The look knobs (ink strength, tint alphas,
  // pulse timing, bend amplitude) live as constants at the top of the shader.
  const CELL_PX = 8;
  const CELL_RATIO = 4.6;

  let canvas = $state<HTMLCanvasElement>();
  let live = $state(false);

  const VERT = `#version 300 es
    void main() {
      // One triangle that covers the viewport.
      vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
      gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }`;

  const FRAG = `#version 300 es
    precision highp float;
    uniform vec2 u_res;    // drawing buffer size in device pixels
    uniform vec2 u_cell;   // cell width and height in device pixels
    uniform float u_time;  // seconds

    out vec4 frag;

    const float INK = 0.4;        // line strength
    const float WASH = 0.2;      // faint paper lightening between lines
    const float TINT_LO = 0.55;   // weakest cell tint
    const float TINT_HI = 0.95;   // strongest cell tint
    const float LIT = 0.95;       // chance a cell lights on each of its cycles
    const float BEND = 0.9;       // warp amplitude, in cells
    const float BREATHE = 0.05;   // how fast the bend drifts
    const float STAGGER = 1.4;    // seconds over which the tiles first arrive
    const float ARRIVE = 0.35;    // each tile's own fade-in on arrival

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    // The extension's RdYlGn stops.
    vec3 ramp(float t) {
      t = clamp(t, 0.0, 1.0) * 5.0;
      vec3 c = mix(vec3(0.647, 0.0, 0.149), vec3(0.957, 0.427, 0.263), clamp(t, 0.0, 1.0));
      c = mix(c, vec3(0.996, 0.878, 0.545), clamp(t - 1.0, 0.0, 1.0));
      c = mix(c, vec3(0.851, 0.937, 0.545), clamp(t - 2.0, 0.0, 1.0));
      c = mix(c, vec3(0.4, 0.741, 0.388), clamp(t - 3.0, 0.0, 1.0));
      c = mix(c, vec3(0.0, 0.408, 0.216), clamp(t - 4.0, 0.0, 1.0));
      return c;
    }

    void layer(inout vec3 col, inout float a, vec3 c, float la) {
      col = mix(col, c, la);
      a = a + la * (1.0 - a);
    }

    void main() {
      vec2 s = gl_FragCoord.xy / u_res; // 0..1 across the hero, y up

      // The sheet: slightly off-axis, pitch tightening toward the top
      // right, and a bend of layered low-frequency waves that drifts
      // slowly, like paper that won't lie flat.
      float ang = -0.05 + 0.06 * s.y;
      mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
      float pitch = 1.0 + 0.22 * (0.5 * s.x + 0.5 * s.y - 0.5);
      vec2 g = rot * gl_FragCoord.xy * pitch / u_cell;
      float tb = u_time * BREATHE;
      g.x += BEND * (sin(s.y * 4.7 + 1.3 + tb) + 0.5 * sin(s.y * 9.1 + 0.6) + 0.35 * sin((s.x + s.y) * 6.3 + tb));
      g.y += BEND * (sin(s.x * 3.9 + 2.1 - tb) + 0.5 * sin(s.x * 7.7 + 4.2) + 0.35 * sin((s.x - s.y) * 5.1 + 1.0));

      // Distance to the nearest ruling line, in device pixels.
      vec2 f = abs(fract(g) - 0.5);
      vec2 dpx = (0.5 - f) / fwidth(g);
      float d = min(dpx.x, dpx.y);
      float line = 1.0 - smoothstep(0.5, 1.8, d);

      // Each cell pulses on its own period and phase; every cycle it
      // redraws whether to light, how strongly, and with which tint,
      // drifting red to green across the hero.
      vec2 id = floor(g);
      float period = mix(10.0, 30.0, hash(id + vec2(7.31, 3.7)));
      float ph = u_time / period + hash(id);
      float cyc = floor(ph);
      float env = smoothstep(0.02, 0.22, fract(ph)) * (1.0 - smoothstep(0.5, 0.78, fract(ph)));
      vec2 seed = id + vec2(cyc * 0.37, cyc * 0.91);
      float lit = step(hash(seed), LIT);
      float tint = env * lit * mix(TINT_LO, TINT_HI, hash(seed + 2.2));
      // On load each tile holds back a random beat, so the field assembles
      // cell by cell instead of appearing at once.
      tint *= smoothstep(0.0, ARRIVE, u_time - STAGGER * hash(id + vec2(3.3, 9.1)));
      vec3 color = ramp(clamp(s.x * 0.85 + 0.075 + (hash(seed + 5.5) - 0.5) * 0.3, 0.0, 1.0));

      // A soft sheen that follows the bend, so the paper has light on it.
      float sheen = WASH * (1.0 + 0.5 * sin(s.x * 5.1 + s.y * 2.9 + 1.0 + tb));

      vec3 col = vec3(0.0);
      float a = 0.0;
      layer(col, a, vec3(0.93, 0.91, 0.86), sheen);
      layer(col, a, color, tint * smoothstep(0.8, 2.4, d));
      layer(col, a, vec3(0.07, 0.1, 0.07), line * INK);
      frag = vec4(col * a, a);
    }`;

  $effect(() => {
    const el = canvas;
    if (el === undefined) return;
    const gl = el.getContext("webgl2", { alpha: true, antialias: false });
    if (gl === null) return;

    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader) ?? "shader compile failed");
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) ?? "program link failed");
    gl.useProgram(program);
    const uRes = gl.getUniformLocation(program, "u_res");
    const uCell = gl.getUniformLocation(program, "u_cell");
    const uTime = gl.getUniformLocation(program, "u_time");

    const dpr = Math.min(devicePixelRatio, 2);
    const draw = (t: number) => {
      gl.uniform2f(uRes, el.width, el.height);
      gl.uniform2f(uCell, CELL_PX * CELL_RATIO * dpr, CELL_PX * dpr);
      gl.uniform1f(uTime, t);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let visible = true;
    // The last drawn moment: resizes redraw at it, so a paused or
    // reduced-motion frame shows the field mid-cycle (20 is past the
    // arrival stagger) while a fresh load still staggers in from zero.
    let last = still ? 20 : 0;
    const frame = (now: number) => {
      last = (now % 3.6e6) / 1000;
      draw(last);
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (still || raf !== 0 || !visible || document.hidden) return;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const resize = new ResizeObserver(() => {
      el.width = Math.round(el.clientWidth * dpr);
      el.height = Math.round(el.clientHeight * dpr);
      gl.viewport(0, 0, el.width, el.height);
      draw(last);
      live = true;
    });
    resize.observe(el);
    const seen = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible) start();
      else stop();
    });
    seen.observe(el);
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      stop();
      resize.disconnect();
      seen.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  });
</script>

<canvas bind:this={canvas} class="hero-grid" class:live aria-hidden="true"></canvas>
