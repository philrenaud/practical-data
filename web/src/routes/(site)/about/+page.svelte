<svelte:head>
  <title>About · Practical Data</title>
</svelte:head>

<main class="doc">
  <a class="back" href="/">← Practical Data</a>
  <h1>About</h1>
  <p>
    Practical Data is a project by <a href="https://philrenaud.com">Phil Renaud</a> and was started in November 2026.
  </p>
  <p>
    My general thesis is that we have an awful lot more information made available to us than we can reasonably be
    expected to understand on its own, and we owe it to ourselves to build tools to make sense of it if we don't want to
    cede the task of understanding to AI.
  </p>

  <h2>Colophon</h2>
  <p>
    Headlines are set in <a href="https://www.hoodfonts.com/fonts/cambridge">Cambridge</a>, by Amy and Jen Hood of
    Hoodzpah.
  </p>
  <p>
    Body text is <a href="https://fonts.google.com/specimen/Prociono">Prociono</a>, a one-weight roman by Barry
    Schwartz, released under the SIL Open Font License.
  </p>
  <p>
    Numerals, code, and the example tables are
    <a href="https://www.ibm.com/plex/">IBM Plex Mono</a>, by Mike Abbink with Bold Monday, also under the Open Font
    License. Every digit on the site is Plex: a <code>unicode-range</code> rule covering 0–9 sits first in each font stack,
    so numbers line up in tables without any markup around them.
  </p>
  <p>
    The shading itself uses <a href="https://colorbrewer2.org/">ColorBrewer</a> schemes by Cynthia Brewer, applied with
    <a href="https://d3js.org/">D3</a>.
  </p>
</main>

<style>
  .doc {
    max-width: 720px;
    margin: 0 auto;
    padding: 56px 16px 80px;
  }
  .doc h1 {
    font-size: clamp(36px, 6vw, 56px);
    margin-bottom: 8px;
  }
  .doc h2 {
    font-size: 24px;
    margin: 36px 0 10px;
    letter-spacing: -0.01em;
  }
  .doc p {
    font-size: 17px;
    color: var(--ink);
  }
  .doc a {
    color: var(--accent);
  }
  .back {
    font:
      500 14px "IBM Plex Mono",
      monospace;
    color: var(--muted);
  }
</style>
