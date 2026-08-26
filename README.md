# adarsh.ai

Personal site of **Adarsh Bhardwaj** — AI engineer.

One hand-written HTML file. No framework, no build step, no dependencies, no analytics.
Set in [Newsreader](https://fonts.google.com/specimen/Newsreader) and
[IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono).

```
index.html                        # markup, styles and behaviour
assets/Adarsh-Bhardwaj-Resume.pdf # résumé, linked from the page
vercel.json                       # headers + clean URLs
```

## Run it

```bash
python3 -m http.server 8000   # → http://localhost:8000
```

## Deploy

**Vercel** — import the repo at [vercel.com/new](https://vercel.com/new).
Framework preset **Other**, no build command, output directory `./`.
Pushes to the default branch ship to production.

**GitHub Pages** — Settings → Pages → default branch, root.

## How it's laid out

Everything hangs off one grid: a label rail, a 660px text column, and an empty
counterweight column so the text sits optically on centre.

| Where                       | What                                              |
| --------------------------- | ------------------------------------------------- |
| `:root`                     | colour, type and layout tokens (light + dark)     |
| `.grid` / `.block`          | the page grid and section rhythm                  |
| `<header class="mast">`     | masthead — headline, lede, primary links          |
| `#work`                     | selected projects                                 |
| `#experience`               | roles                                             |
| `#stack`                    | skills, as a definition list                      |
| `#background`               | education, exams, coursework                      |
| `#contact` + `<footer>`     | email, elsewhere links, colophon                  |

Theme follows the system by default; an explicit choice is stored in `localStorage`
and can be toggled with the button or the <kbd>T</kbd> key.
