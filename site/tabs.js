// Tool tabs: each tab shows its tool's panel in place, without leaving the page.
(() => {
  const tabs = [...document.querySelectorAll('[role="tab"]')];

  // tab may be null: no tool selected and no Result FC shown.
  function select(tab) {
    for (const t of tabs) {
      const active = t === tab;
      t.setAttribute("aria-selected", String(active));
      t.tabIndex = active || (!tab && t === tabs[0]) ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !active;
    }
    // Lets the rest of the page react (upload button, preview) to the new tool.
    document.dispatchEvent(new CustomEvent("toolchange", { detail: tab ? tab.id.replace("tab-", "") : "" }));
  }

  // Tool FC folds down to the open tool once someone starts working in it;
  // its heading is a toggle to bring the full list back.
  const list = document.querySelector(".tool-list");
  const toggle = document.getElementById("tool-toggle");

  function setCollapsed(collapsed) {
    list.classList.toggle("collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
  }

  toggle.addEventListener("click", () => setCollapsed(toggle.getAttribute("aria-expanded") === "true"));

  for (const type of ["pointerdown", "input"]) {
    document.addEventListener(type, (event) => {
      if (event.target.closest('main [role="tabpanel"]')) setCollapsed(true);
    });
  }

  tabs.forEach((tab, i) => {
    // Clicking the open tool again un-selects it and reopens the full list.
    tab.addEventListener("click", () => {
      if (tab.getAttribute("aria-selected") === "true") {
        select(null);
        setCollapsed(false);
      } else {
        select(tab);
      }
    });
    // Arrow keys move between tabs, as screen-reader users expect.
    tab.addEventListener("keydown", (event) => {
      const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      const next = tabs[(i + step + tabs.length) % tabs.length];
      next.focus();
      select(next);
    });
  });
})();
