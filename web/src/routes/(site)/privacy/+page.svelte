<!-- Keep this page in step with PRIVACY.md. -->
<svelte:head>
  <title>Privacy policy · Practical Data</title>
</svelte:head>

<main class="doc">
  <a class="back" href="/">← Practical Data</a>
  <h1>Privacy policy</h1>
  <p><em>Practical Data, a Chrome extension. Last updated October 29, 2026.</em></p>
  <p>
    Practical Data shades the comparable columns of tables on web pages. To decide what each column means, it asks a
    decision model. From version 1.1.0, that goes by default through the free endpoint at <code
      >api.practicaldata.dev</code
    >, run by the extension's author; you can instead use your own key with a provider you pay for directly. Version
    1.0.0 has no free endpoint and always uses your own key. This page says exactly what each involves.
  </p>
  <h2>What leaves your browser</h2>
  <p>
    When a table comes within about a screen of the viewport on a site where the extension is on, the extension sends
    this to the provider set in its options:
  </p>
  <ul>
    <li>The page title.</li>
    <li>The table's caption or nearest heading, and its column headers.</li>
    <li>
      A few sample values from each column, and the distinct labels in label columns (for example <code
        >Lightweight</code
      >, <code>Versatile</code>, <code>Powerful</code>).
    </li>
    <li>The first and last two rows, to check whether they are totals.</li>
  </ul>
  <p>
    It does <strong>not</strong> send the page URL, cookies, form contents, text outside tables, or anything from tables you
    never scroll near.
  </p>
  <h2>Who receives it</h2>
  <p>Only the provider set in the extension's options:</p>
  <ul>
    <li>
      <strong>Free</strong> (the default from version 1.1.0), at <code>api.practicaldata.dev</code>: a Cloudflare Worker
      run by the extension's author. It forwards the table text to TypeSafe (below) with the author's key and returns
      the answers. It receives, along with the table text, a random id the extension makes when installed (not derived
      from you or your browser) and, like any web server, your IP address. It keeps:
      <ul>
        <li>
          <strong>The answers</strong>, in Cloudflare's cache for up to 30 days, keyed by a one-way hash of the request,
          so a table another reader already asked about is answered without asking again. The table text itself is not
          stored.
        </li>
        <li>
          <strong>Today's request count for each install id</strong> and the day's total, to enforce the daily allowance.
          Each day's counts are deleted two days later.
        </li>
        <li>
          Your IP address is used only by Cloudflare's rate limiter, for about a minute, and is not stored by the
          Worker.
        </li>
        <li>
          <strong>Anonymous counts</strong> of requests, in Cloudflare Workers Analytics Engine for three months: for
          each request, whether it was answered from the cache, answered by the model, or refused and why; the input
          tokens it used; how many requests its install had made that day; and, when the model's provider refuses a
          request, the provider's HTTP status. They have no install id, IP address, location, or table text. They show
          how much the endpoint is used and whether it is abused. The code that writes them is public:
          <a href="https://github.com/philrenaud/practical-data/blob/main/src/api/usage.ts"
            ><code>src/api/usage.ts</code></a
          >.
        </li>
      </ul>
      Nothing is logged. The Worker, its cache, and the counts run on Cloudflare, under
      <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare's privacy policy</a>. The table text goes to
      TypeSafe and to no one else.
    </li>
    <li>
      <strong>TypeSafe</strong> (Jev, with your own key), at <code>api.typesafe.ai</code>, under
      <a href="https://typesafe.ai">TypeSafe's terms and privacy policy</a>.
    </li>
    <li>
      <strong>Cloudflare</strong> (Clef on Workers AI, with your own token), at <code>api.cloudflare.com</code>, under
      <a href="https://www.cloudflare.com/privacypolicy/">Cloudflare's privacy policy</a>.
    </li>
  </ul>
  <p>
    With your own key or token, the extension's author receives nothing. The extension has no analytics, telemetry or
    crash reports with any provider.
  </p>
  <h2>What is stored, and where</h2>
  <p>All in your browser's extension storage, on your device:</p>
  <ul>
    <li><strong>A random install id</strong>, sent only to the free endpoint.</li>
    <li>
      <strong>Your API key or token</strong>, if you entered one in the options. It is read only by the extension's own
      pages and background worker and sent only to the provider you chose. Web pages and the scripts that run on them
      can't read it.
    </li>
    <li>
      <strong>Cached model answers</strong>, so an unchanged table is not sent twice. The cache is capped; the oldest
      entries are evicted. Options has a button to clear it.
    </li>
    <li><strong>Your settings</strong>: palette, mode, and the sites you turned on or off.</li>
    <li>
      <strong>For the current browser session only</strong>: pages you paused and per-table choices (rows or columns,
      hidden).
    </li>
  </ul>
  <h2>Your controls</h2>
  <ul>
    <li>
      <strong>Use your own key</strong> instead of the free endpoint, so table text goes straight to the provider you pay.
    </li>
    <li>
      <strong>Turn a site off</strong>, or switch to <strong>Only sites I turn on</strong> so nothing is sent unless you enable
      a site. Do this for pages with private data.
    </li>
    <li><strong>Pause a page</strong> from the toolbar popup or with <kbd>⌥⇧H</kbd>.</li>
    <li><strong>Clear cached answers</strong> in the options.</li>
    <li><strong>Uninstall</strong> to remove everything the extension stored.</li>
  </ul>
  <p>Sites can opt out for all users with <code>&lt;meta name="practical-data" content="off"&gt;</code>.</p>
  <h2>Changes</h2>
  <p>Changes to this policy will be noted here with a new date.</p>
  <ul>
    <li>October 21, 2026: the free endpoint keeps anonymous request counts.</li>
    <li>
      October 29, 2026: the counts record the provider's HTTP status when a request fails upstream, and link the code
      that writes them.
    </li>
  </ul>
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
  .doc p,
  .doc li {
    font-size: 17px;
    color: var(--ink);
  }
  .doc li + li {
    margin-top: 6px;
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
