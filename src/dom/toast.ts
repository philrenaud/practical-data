/**
 * A one-line notice at the bottom-right of the page, in a shadow root so that
 * page CSS does not reach it. The dev build uses it to confirm flags.
 */
const CSS = `
:host { all: initial; }
.toast {
  position: fixed; z-index: 2147483646; right: 16px; bottom: 16px; max-width: min(420px, calc(100vw - 32px));
  padding: 9px 12px; border-radius: 9px; background: rgb(22 22 26 / 0.96); color: #f3f1ec;
  font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  box-shadow: 0 1px 0 rgb(255 255 255 / 0.06) inset, 0 8px 22px rgb(0 0 0 / 0.28);
}
a { color: #b9afff; }
`;

let host: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Shows `text`, with an optional link, until `ms` passes or the next toast replaces it. */
export const toast = (text: string, link?: { href: string; label: string }, ms = 6000) => {
  host?.remove();
  clearTimeout(timer);
  host = document.createElement("span");
  host.setAttribute("data-pd-toast", "");
  host.style.setProperty("all", "initial", "important");
  const root = host.attachShadow({ mode: "open" });
  const box = document.createElement("div");
  box.className = "toast";
  box.setAttribute("role", "status");
  box.textContent = text;
  if (link !== undefined) {
    const a = document.createElement("a");
    a.href = link.href;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = link.label;
    box.append(" ", a);
  }
  const style = document.createElement("style");
  style.textContent = CSS;
  root.append(style, box);
  document.documentElement.append(host);
  timer = setTimeout(() => {
    host?.remove();
    host = null;
  }, ms);
};
