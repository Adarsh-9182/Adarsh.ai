# adarsh.ai

Personal portfolio of **Adarsh Bhardwaj** — Software & AI Engineer.

A single-file, zero-dependency site: `index.html` holds the markup, design system and
all interaction code. No build step, no framework, no tracking.

## Structure

```
index.html                       # the entire site (HTML + CSS + JS)
assets/Adarsh-Bhardwaj-Resume.pdf # résumé served from the site
vercel.json                      # headers + clean URLs for Vercel
```

## Run locally

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Deploy

**Vercel** — import the repo at [vercel.com/new](https://vercel.com/new).
Framework preset: **Other**. Build command: *none*. Output directory: `./`.
Every push to the default branch ships a new production deploy.

**GitHub Pages** — Settings → Pages → deploy from the default branch, root.

## Editing content

Everything is static HTML, so content lives next to its markup:

| What            | Where in `index.html`            |
| --------------- | -------------------------------- |
| Design tokens   | `:root { --bg, --v, --m, --c … }`|
| Hero + stats    | `<header class="hero">`          |
| Experience      | `<section id="experience">`      |
| Projects        | `<section id="work">`            |
| Skills          | `<section id="stack">`           |
| Focus/education | `<section id="focus">`           |
| Rotating roles  | `const ROLES` in the script      |
| Marquee words   | `const WORDS` in the script      |
