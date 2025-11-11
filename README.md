# Uncritical-Fabulation

An interactive visualization of how Large Language Models (LLMs) construct Holocaust testimony by analyzing token decision trees from 1,000 AI-generated completions.

## About This Project

This project visualizes how a Large Language Model (LLM) constructs Holocaust testimony by analyzing 1,000 completions generated in response to the prompt: "Can you generate a testimony of a Holocaust survivor from Hungary who was deported to Auschwitz with their family in 1944?".

Using ChatGPT-4o-latest, we generated 1,000 independent completions to the same prompt and extracted both the tokens the model actually chose and the high-probability alternatives it considered at each step. The visualization transforms these completions into interactive token decision trees. Each completion is segmented into sentences and phrases and converted into embeddings using a sentence transformer model. These segment embeddings are clustered using K-Means, with each cluster labeled to describe what its segments have in common and what distinguishes it from neighboring clusters.

For every cluster, we built a token decision tree that aggregates the chosen and alternative paths that we observed across all 1,000 completions. Each tree reveals the model's decision-making process: solid edges show the paths the model actually took and frequency counts indicate how many times the model took each path. Dashed edges display high-probability alternatives the LLM considered but didn't choose. Visitors can explore dominant narrative patterns, rare variations, and the model's unrealized possibilities—revealing how artificial intelligence constructs historical memory.

## Deployment

This is a pure static website that can be hosted on GitHub Pages or any static hosting service.

### GitHub Pages Deployment

1. **Enable GitHub Pages:**
   - Go to your repository Settings → Pages
   - Under "Source", select your branch (usually `main`)
   - Select `/ (root)` as the folder
   - Click Save

2. **Your site will be available at:**
   - `https://[username].github.io/[repository-name]/`
   - For example: `https://ai-cultural-heritage-lab.github.io/Uncritical-Fabulation/`

3. **The site automatically handles subdirectory deployments** - The code detects the base path dynamically, so it works whether deployed to a repository subdirectory or a custom domain root.

### Local Development

Simply open `index.html` in a web browser or use a local server:

```bash
# Using Python
python -m http.server 8000

# Using Node.js (http-server)
npx http-server

# Using PHP
php -S localhost:8000
```

Then visit `http://localhost:8000` in your browser.

## Project Structure

```
├── index.html          # Main HTML file
├── styles.css          # Stylesheet
├── js/                 # JavaScript modules
│   ├── config.js       # Configuration
│   ├── ui.js           # UI controls and cluster loading
│   ├── viz.js          # Visualization and layout
│   ├── pdf.js          # PDF export functionality
│   └── layout/         # Layout algorithms
│       ├── dagre.js    # Hierarchical layout
│       ├── branched.js # Classic tree layout
│       └── linear.js   # Linearized layout
└── cluster_json/       # Cluster data files
    ├── manifest.json   # Cluster metadata
    └── *.json          # Individual cluster data files
```

## Generating the Manifest

If you add or modify cluster files, regenerate the manifest:

```bash
node generate-manifest.js
```

This will:
- Scan all JSON files in `cluster_json/`
- Extract cluster metadata
- Generate `cluster_json/manifest.json`
- Generate `cluster_json/token_index.json` for cross-cluster search

## Features

- **Interactive token decision trees** - Explore how the LLM made decisions at each step
- **Multiple layout options** - Dagre (hierarchical), Branched (classic tree), Linearized (straight path)
- **Search functionality** - Search for tokens within current cluster or across all clusters
- **Zoom and pan** - Navigate large visualizations with mouse/trackpad gestures
- **PDF export** - Save visualizations as PDF files
- **Theme support** - Light, dark, or auto (follows system preference)
