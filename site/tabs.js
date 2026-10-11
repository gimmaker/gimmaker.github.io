// Tool tabs: each tab shows its tool's panel in place, without leaving the page.
(() => {
  const tabs = [...document.querySelectorAll('[role="tab"]')];

  function select(tab) {
    for (const t of tabs) {
      const active = t === tab;
      t.setAttribute("aria-selected", String(active));
      t.tabIndex = active ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !active;
    }
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(tab));
    // Arrow keys move between tabs, as screen-reader users expect.
    tab.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      const next = tabs[(i + step + tabs.length) % tabs.length];
      next.focus();
      select(next);
    });
  });
})();
