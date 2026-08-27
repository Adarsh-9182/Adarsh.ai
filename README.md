# adarshbhardwaj.space

Personal site of **Adarsh Bhardwaj** — AI engineer.

Two hand-written files, no framework, no build step, no dependencies, no analytics.
Type is [Archivo](https://fonts.google.com/specimen/Archivo),
[Instrument Sans](https://fonts.google.com/specimen/Instrument+Sans) and
[Geist Mono](https://fonts.google.com/specimen/Geist+Mono).

```
index.html                        # markup, styles and page behaviour
assets/scene.js                   # the 3D model, in raw WebGL
assets/Adarsh-Bhardwaj-Resume.pdf # résumé, linked from the page
vercel.json                       # headers + clean URLs
```

## Run it

```bash
python3 -m http.server 8000   # → http://localhost:8000
```

## The model

The thing running behind the page is not a background. It is the architecture both
Paisa and NutriScan actually have, drawn in three layers and left running:

| Layer     | What it is                                                              |
| --------- | ----------------------------------------------------------------------- |
| Intake    | a question arrives                                                       |
| Routing   | a supervisor hands it to whichever specialist owns it                    |
| Engine    | a rigid orthogonal grid — the deterministic layer that computes          |

A pulse falls into the supervisor, takes one edge to a specialist, drops into the
engine, walks the grid in right angles only, and comes back up. The free routing
happens above; the straight lines happen below.

`assets/scene.js` is raw WebGL — no Three.js. The scene is lines and points, which
is less code to write directly than the library import would have cost. Shaders are
GLSL ES 1.00 so the same source compiles under WebGL 1 and 2, and the whole thing
falls back to nothing (`.no-gl`) if neither context is available.

It reads its colours from the CSS custom properties `--gl-line`, `--gl-node`,
`--gl-accent` and `--gl-master`, so both themes stay defined in one place. It holds
still under `prefers-reduced-motion`, thins out on coarse pointers, and stops
entirely while the tab is hidden.

## How the page is laid out

| Where                       | What                                              |
| --------------------------- | ------------------------------------------------- |
| `:root`                     | colour, type and layout tokens (light + dark)     |
| `.wash`                     | scroll-driven scrim that lifts prose off the model |
| `<header class="mast">`     | masthead — headline, lede, links, model caption   |
| `#work`                     | selected projects                                  |
| `#experience`               | roles                                              |
| `#stack`                    | skills, as a definition list                       |
| `#background`               | education, exams, coursework                       |
| `#contact` + `<footer>`     | email, elsewhere links, colophon                   |

Theme follows the system by default; an explicit choice is stored in `localStorage`
and can be toggled with the button or the <kbd>T</kbd> key.

## Deploy

**Vercel** — framework preset **Other**, no build command, output directory `./`.
Pushes to the default branch ship to production.
