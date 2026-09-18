# Diagram & Notes Tools

A set of tools that run **entirely in the browser** — no server, no login, no build step. All data stays on your device (localStorage / File System Access API).

## Contents

- **Mind Map** (`mindmap.html`) — radial mind map: drag & drop, collapse/expand, per-node description, mark done, zoom, PNG/JSON export, JSON import.
- **Sequence Diagram** (`sequence.html`) — write text-based interactions, rendered automatically. Supports solid/dashed lines, failure (X), red color, self-loops, title, separators, notes.
- **Flow Diagram** (`flow.html`) — process flows: terminator, process, decision, input/output, document, subprocess, free text; curved/elbow arrows, colors, grouping.
- **Free Diagram** (`free.html`) — free canvas: rectangle, ellipse, diamond, text; object-inside-object, colors, grouping.
- **Notes (Markdown)** (`notes.html`) — WYSIWYG Markdown notes editor: open a local folder, browse files, auto-save, colors/highlight, fonts, tables, collapsible sections, nested lists, raw source toggle, PDF export.

> Note: the folder access & auto-save features in Notes use the File System Access API — a Chromium-based browser (Chrome/Edge) is required.

## Run locally

Since it is pure static files, just open `index.html` in a browser. For some features (e.g. folder access) it is best to run via a simple static server:

```bash
# Python 3
python -m http.server 8000
# then open http://localhost:8000

# or Node (if installed)
npx serve .
```

## Structure

```
.
├── index.html        # home page (tool list)
├── mindmap.html
├── sequence.html
├── flow.html
├── free.html
├── notes.html
├── css/
│   └── app.css
└── js/
    ├── mindmap.js
    ├── sequence.js
    ├── diagram-core.js   # used by flow.html & free.html
    └── notes.js
```

## Deploy to GitHub Pages

An automatic workflow is included at `.github/workflows/deploy.yml`. After pushing to the `main` branch:

1. Open the repository on GitHub → **Settings** → **Pages**.
2. Under **Build and deployment**, choose **Source: GitHub Actions**.
3. Every push to `main` deploys the site automatically.

The site will be available at `https://<username>.github.io/<repo>/`.

Alternative without Actions: Settings → Pages → Source: **Deploy from a branch** → pick `main` / `root`. The `.nojekyll` file ensures assets are served as-is.

## License

Free to use. Built with love from Darjo, kota autopilot.
