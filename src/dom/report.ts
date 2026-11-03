/**
 * The store build's "Looks wrong" dialog. It shows the whole report before
 * anything is sent: what the dialog renders is the payload, with no hidden
 * fields. The user can leave the page address out and add a short note. It is
 * in a shadow root, so page CSS does not reach it.
 */
import type { FlagReport } from "../api/flag.ts";
import { FLAG_LIMITS } from "../api/flag.ts";

/** What the user chose: send with or without the address, with an optional note. Null is cancel. */
export interface ReportChoice {
  readonly includeUrl: boolean;
  readonly note: string;
}

const CSS = `
:host { all: initial; }
.scrim {
  position: fixed; inset: 0; z-index: 2147483647; display: flex; align-items: center; justify-content: center;
  background: rgb(10 10 12 / 0.45); padding: 16px;
}
.panel {
  box-sizing: border-box; width: min(560px, 100%); max-height: min(80vh, 640px); overflow: auto;
  padding: 18px; border-radius: 12px; background: rgb(22 22 26 / 0.98); color: #f3f1ec;
  font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  box-shadow: 0 1px 0 rgb(255 255 255 / 0.06) inset, 0 16px 44px rgb(0 0 0 / 0.4);
}
h1 { margin: 0 0 4px; font-size: 15px; font-weight: 600; color: #fff; }
.sub { margin: 0 0 14px; color: #a7a196; }
.field { margin: 10px 0; }
.page-title { color: #d9d4ca; }
table { border-collapse: collapse; width: 100%; margin: 6px 0 2px; font-size: 12px; }
th, td { border: 1px solid rgb(255 255 255 / 0.14); padding: 3px 7px; text-align: left; color: #d9d4ca; }
th { color: #f3f1ec; }
label { display: flex; gap: 8px; align-items: baseline; cursor: pointer; color: #d9d4ca; }
.url { overflow-wrap: anywhere; color: #a7a196; }
textarea {
  box-sizing: border-box; width: 100%; min-height: 56px; margin-top: 4px; padding: 7px 9px; border-radius: 8px;
  border: 1px solid rgb(255 255 255 / 0.18); background: rgb(255 255 255 / 0.06); color: #f3f1ec;
  font: inherit; resize: vertical;
}
textarea:focus-visible { outline: 2px solid #8f82f0; outline-offset: 1px; }
.buttons { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
button {
  all: unset; cursor: pointer; padding: 7px 13px; border-radius: 8px; color: #d9d4ca;
  background: rgb(255 255 255 / 0.08);
}
button:hover { background: rgb(255 255 255 / 0.12); color: #fff; }
button.send { background: #f3f1ec; color: #16151a; font-weight: 600; }
button:focus-visible { outline: 2px solid #8f82f0; outline-offset: 1px; }
`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ""): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className !== "") node.className = className;
  if (text !== "") node.textContent = text;
  return node;
};

/** Renders the report's table sample exactly as the payload carries it. */
const sample = (report: FlagReport): HTMLTableElement => {
  const table = document.createElement("table");
  const head = table.createTHead().insertRow();
  for (const h of report.table.headers) head.append(el("th", "", h));
  const body = table.createTBody();
  for (const row of report.table.rows) {
    const tr = body.insertRow();
    for (const cell of row) tr.append(el("td", "", cell));
  }
  return table;
};

/**
 * Shows the report and resolves with the user's choice, or null on cancel.
 * `report` must carry the page address, so the dialog can show what the
 * checkbox includes; the caller rebuilds the payload if it is unticked.
 */
export const confirmReport = (report: FlagReport): Promise<ReportChoice | null> =>
  new Promise((resolve) => {
    const host = document.createElement("span");
    host.setAttribute("data-pd-report", "");
    host.style.setProperty("all", "initial", "important");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${CSS}</style>`;
    const scrim = el("div", "scrim");
    const panel = el("div", "panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Report wrong shading");

    panel.append(el("h1", "", "Report wrong shading"));
    panel.append(el("p", "sub", "This is the whole report. It goes to the maintainer and nowhere else."));

    const titleField = el("div", "field");
    titleField.append(
      el(
        "span",
        "page-title",
        `${report.kind === "shaded" ? "Shaded" : "Not shaded"}: ${report.table.title ?? report.pageTitle}`,
      ),
    );
    panel.append(titleField, sample(report));
    if (report.table.rows.length < FLAG_LIMITS.rows)
      panel.append(el("p", "sub", "Sample rows only; the report never carries more than five."));
    else panel.append(el("p", "sub", `First ${FLAG_LIMITS.rows} rows only.`));

    const urlField = el("div", "field");
    const urlLabel = el("label", "");
    const urlBox = document.createElement("input");
    urlBox.type = "checkbox";
    urlBox.checked = true;
    const urlText = el("span", "", "Include the page address");
    const urlValue = el("div", "url", report.url ?? "");
    urlLabel.append(urlBox, urlText);
    urlField.append(urlLabel, urlValue);
    urlBox.addEventListener("change", () => {
      urlValue.textContent = urlBox.checked ? (report.url ?? "") : "";
    });
    if (report.url !== undefined) panel.append(urlField);

    const noteField = el("div", "field");
    const note = document.createElement("textarea");
    note.maxLength = FLAG_LIMITS.note;
    note.placeholder = "What looks wrong? (optional)";
    noteField.append(note);
    panel.append(noteField);

    const buttons = el("div", "buttons");
    const cancel = el("button", "", "Cancel");
    const send = el("button", "send", "Send report");
    buttons.append(cancel, send);
    panel.append(buttons);

    const close = (choice: ReportChoice | null) => {
      removeEventListener("keydown", onKey, true);
      host.remove();
      resolve(choice);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        close(null);
      }
    };
    addEventListener("keydown", onKey, true);
    cancel.addEventListener("click", () => close(null));
    send.addEventListener("click", () => close({ includeUrl: urlBox.checked, note: note.value }));
    scrim.addEventListener("click", (ev) => {
      if (ev.target === scrim) close(null);
    });

    scrim.append(panel);
    root.append(scrim);
    document.documentElement.append(host);
    send.focus();
  });
