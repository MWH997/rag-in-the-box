/**
 * Layout audit, run inside the page.
 *
 * Checks the failures that screenshots hide: content wider than the viewport,
 * text clipped inside a fixed box, controls too small to hit on a phone, and
 * elements that sit on top of each other. Every finding names the element and
 * the measurement that produced it, so a fix can be verified by rerunning.
 *
 * Load it in dev with Vite's filesystem route:
 *   await import("/@fs/ABSOLUTE/PATH/qa/audit.js")
 * then call window.__ragAudit().
 */

function describe(element) {
  const id = element.id ? `#${element.id}` : "";
  const classes =
    typeof element.className === "string" && element.className
      ? `.${element.className.trim().split(/\s+/).slice(0, 3).join(".")}`
      : "";
  const text = (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 48);
  return `${element.tagName.toLowerCase()}${id}${classes}${text ? ` "${text}"` : ""}`;
}

function isScrollable(style) {
  return (
    ["auto", "scroll"].includes(style.overflowX) || ["auto", "scroll"].includes(style.overflowY)
  );
}

/**
 * True when an ancestor scrolls horizontally.
 *
 * A wide table inside its own scroll container is meant to extend past the
 * viewport; that is the whole point of putting it there. Only content that
 * escapes with nothing to catch it is a defect.
 */
function insideHorizontalScroller(element) {
  let parent = element.parentElement;
  while (parent && parent !== document.body) {
    const style = getComputedStyle(parent);
    if (["auto", "scroll"].includes(style.overflowX)) return true;
    parent = parent.parentElement;
  }
  return false;
}

function isVisible(element, style) {
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")
    return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * How much of an element a scrolling ancestor is currently hiding.
 *
 * getBoundingClientRect reports where a box would be, not where it can be seen.
 * Content scrolled past the end of a scroll container still reports a position
 * beyond that container, which reads as an overlap with whatever sits below.
 * That is not a layout fault: the reader scrolls and it comes into view.
 *
 * Returns the visible rectangle, or null when the element is entirely clipped.
 */
function visibleRect(element) {
  let rect = element.getBoundingClientRect();
  let parent = element.parentElement;
  while (parent && parent !== document.documentElement) {
    const style = getComputedStyle(parent);
    const clipsY = ["auto", "scroll", "hidden"].includes(style.overflowY);
    const clipsX = ["auto", "scroll", "hidden"].includes(style.overflowX);
    if (clipsY || clipsX) {
      const bounds = parent.getBoundingClientRect();
      const top = clipsY ? Math.max(rect.top, bounds.top) : rect.top;
      const bottom = clipsY ? Math.min(rect.bottom, bounds.bottom) : rect.bottom;
      const left = clipsX ? Math.max(rect.left, bounds.left) : rect.left;
      const right = clipsX ? Math.min(rect.right, bounds.right) : rect.right;
      if (bottom - top <= 0 || right - left <= 0) return null;
      rect = { top, bottom, left, right, width: right - left, height: bottom - top };
    }
    parent = parent.parentElement;
  }
  return rect;
}

/**
 * True for content deliberately hidden from sight but kept for assistive
 * technology: a one pixel clipped box, or a file input behind a styled button.
 * Its measurements say nothing about the visible layout.
 */
function isScreenReaderOnly(element, style) {
  if (element.classList.contains("sr-only")) return true;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 1 && rect.height <= 1) return true;
  return style.clipPath.startsWith("inset(50%") || style.clip === "rect(0px, 0px, 0px, 0px)";
}

window.__ragAudit = function audit(options = {}) {
  const tolerance = options.tolerance ?? 1;
  const minTouchTarget = options.minTouchTarget ?? 24;
  const viewportWidth = document.documentElement.clientWidth;
  const findings = [];

  const add = (kind, element, detail) => {
    findings.push({ kind, element: describe(element), detail });
  };

  // 1. The page itself must never scroll sideways.
  const pageOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  if (pageOverflow > tolerance) {
    findings.push({
      kind: "page-overflow",
      element: "html",
      detail: `document scrolls ${pageOverflow}px sideways`,
    });
  }

  const all = Array.from(document.body.querySelectorAll("*"));

  for (const element of all) {
    const style = getComputedStyle(element);
    if (!isVisible(element, style)) continue;
    if (isScreenReaderOnly(element, style)) continue;
    const rect = element.getBoundingClientRect();

    // 2. Nothing may stick out past the right edge of the viewport, unless it
    // sits inside something built to scroll sideways.
    const scrollerAncestor = insideHorizontalScroller(element);
    if (!scrollerAncestor && rect.right - viewportWidth > tolerance && style.position !== "fixed") {
      add(
        "outside-viewport",
        element,
        `right edge at ${Math.round(rect.right)}px, viewport is ${viewportWidth}px`,
      );
    }
    if (!scrollerAncestor && rect.left < -tolerance && style.position !== "fixed") {
      add("outside-viewport", element, `left edge at ${Math.round(rect.left)}px`);
    }

    // 3. Content wider than its own box, in a box that cannot scroll.
    // Truncation with an ellipsis is a design decision, so only a hard clip
    // with no ellipsis and no scroll is reported.
    const contentOverflow = element.scrollWidth - element.clientWidth;
    const truncatesDeliberately = style.textOverflow === "ellipsis";
    if (
      contentOverflow > tolerance &&
      !isScrollable(style) &&
      !scrollerAncestor &&
      !truncatesDeliberately &&
      element.clientWidth > 0
    ) {
      const hardClip = style.overflowX === "hidden";
      add(
        hardClip ? "text-clipped" : "content-overflow",
        element,
        `content is ${contentOverflow}px wider than the box`,
      );
    }

    // 4. A control whose label is cut off.
    const interactive = element.matches("button, a, [role='button'], [role='radio'], summary");
    if (interactive) {
      if (
        element.scrollWidth - element.clientWidth > tolerance &&
        style.overflowX === "hidden" &&
        style.textOverflow !== "ellipsis"
      ) {
        add(
          "control-label-clipped",
          element,
          `label is ${element.scrollWidth - element.clientWidth}px wider than the control`,
        );
      }
      // WCAG 2.5.8 exempts a link sitting inside a sentence, since shrinking
      // the target is the price of it being part of running text. It also
      // accepts a small control whose pressable area is enlarged by other
      // means, which here is a pseudo element that takes no space in the line.
      const inlineInProse = style.display === "inline" && element.tagName === "A";
      const after = getComputedStyle(element, "::after");
      const pseudoHeight = Number.parseFloat(after.height) || 0;
      const pseudoWidth = Number.parseFloat(after.width) || 0;
      const effectiveHeight = Math.max(
        rect.height,
        after.position === "absolute" ? pseudoHeight : 0,
      );
      const effectiveWidth = Math.max(rect.width, after.position === "absolute" ? pseudoWidth : 0);
      if (!inlineInProse && (effectiveHeight < minTouchTarget || effectiveWidth < minTouchTarget)) {
        add(
          "small-target",
          element,
          `${Math.round(effectiveWidth)}x${Math.round(effectiveHeight)}px pressable, below the ${minTouchTarget}px minimum`,
        );
      }
    }

    // 5. Text that overflows its line box vertically, which means a fixed
    // height is cutting off a wrapped label.
    if (
      element.children.length === 0 &&
      (element.textContent ?? "").trim().length > 0 &&
      element.scrollHeight - element.clientHeight > tolerance &&
      style.overflowY === "hidden" &&
      !style.webkitLineClamp.match(/^\d+$/)
    ) {
      add(
        "text-vertically-clipped",
        element,
        `content is ${element.scrollHeight - element.clientHeight}px taller than the box`,
      );
    }
  }

  // 6. Interactive elements that overlap each other, which usually means one
  // is unclickable.
  const interactives = all.filter((element) => {
    const style = getComputedStyle(element);
    return (
      isVisible(element, style) &&
      element.matches("button, a[href], input, select, textarea") &&
      !element.closest("[aria-hidden='true']")
    );
  });
  for (let i = 0; i < interactives.length; i += 1) {
    for (let j = i + 1; j < interactives.length; j += 1) {
      const a = interactives[i];
      const b = interactives[j];
      if (a.contains(b) || b.contains(a)) continue;
      // Measured after clipping, so content merely scrolled out of view is not
      // reported as sitting on top of whatever the scroller sits above.
      const ra = visibleRect(a);
      const rb = visibleRect(b);
      if (!ra || !rb) continue;
      const overlapX = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const overlapY = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (overlapX > 4 && overlapY > 4) {
        findings.push({
          kind: "overlap",
          element: `${describe(a)} over ${describe(b)}`,
          detail: `${Math.round(overlapX)}x${Math.round(overlapY)}px overlap`,
        });
      }
    }
  }

  const seen = new Set();
  const unique = findings.filter((finding) => {
    const key = `${finding.kind}|${finding.element}|${finding.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    url: location.pathname,
    viewport: `${viewportWidth}x${window.innerHeight}`,
    total: unique.length,
    byKind: unique.reduce((counts, finding) => {
      counts[finding.kind] = (counts[finding.kind] ?? 0) + 1;
      return counts;
    }, {}),
    findings: unique.slice(0, 40),
  };
};

window.__ragAuditReady = true;
