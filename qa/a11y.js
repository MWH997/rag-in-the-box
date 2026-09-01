/**
 * Accessibility audit, run inside the page.
 *
 * Checks the WCAG 2.2 AA criteria that can be decided by measurement. It does
 * not replace judgement: whether alternative text is *meaningful*, whether a
 * heading describes its section, whether an error message helps, all still need
 * a person. What it does catch is the mechanical half, which is where most of
 * the failures are and all of the regressions.
 *
 * Load it in dev with Vite's filesystem route:
 *   await import("/@fs/ABSOLUTE/PATH/qa/a11y.js")
 * then call window.__ragA11y().
 *
 * Every finding names the criterion, so a disagreement is about the standard
 * rather than about taste.
 */

function describe(element) {
  const id = element.id ? `#${element.id}` : "";
  const classes =
    typeof element.className === "string" && element.className
      ? `.${element.className.trim().split(/\s+/).slice(0, 2).join(".")}`
      : "";
  const text = (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  return `${element.tagName.toLowerCase()}${id}${classes}${text ? ` "${text}"` : ""}`;
}

function isVisible(element) {
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** Screen-reader-only content is present on purpose and is not measured for size. */
function isScreenReaderOnly(element) {
  if (element.classList.contains("sr-only")) return true;
  const style = getComputedStyle(element);
  return style.clipPath.startsWith("inset(50%") || style.clip === "rect(0px, 0px, 0px, 0px)";
}

/* -------------------------------------------------------------------------- */
/* Colour                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Resolves any CSS colour to sRGB, including oklch().
 *
 * This matters more than it looks. The design system is written in oklch, and
 * getComputedStyle hands oklch back unchanged rather than converting it. A
 * parser that only understands rgb() therefore returns null for every colour on
 * the page, and a contrast check that skips what it cannot parse reports a
 * clean sheet while having measured nothing at all. Painting the colour and
 * reading the pixel is the one method that cannot be fooled by a colour space.
 */
const colourCanvas = document.createElement("canvas");
colourCanvas.width = 1;
colourCanvas.height = 1;
const colourContext = colourCanvas.getContext("2d", { willReadFrequently: true });
const colourCache = new Map();

function parseColour(value) {
  if (!value || value === "transparent" || value === "none") return null;
  if (colourCache.has(value)) return colourCache.get(value);

  // Alpha survives the round trip only if it is read separately: the canvas
  // composites onto its own cleared surface.
  colourContext.clearRect(0, 0, 1, 1);
  colourContext.fillStyle = "#000";
  colourContext.fillStyle = value;
  // An unparseable colour leaves fillStyle at the previous value.
  if (colourContext.fillStyle === "#000000" && !/^#0{3,8}$|black/i.test(value.trim())) {
    colourCache.set(value, null);
    return null;
  }
  colourContext.fillRect(0, 0, 1, 1);
  const [r, g, b, alpha] = colourContext.getImageData(0, 0, 1, 1).data;
  const result = { r, g, b, a: alpha / 255 };
  colourCache.set(value, result);
  return result;
}

/** Flattens a translucent colour onto what sits behind it. */
function over(top, bottom) {
  const a = top.a;
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}

/** Relative luminance, per WCAG 2.x. */
function luminance({ r, g, b }) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(foreground, background) {
  const light = luminance(foreground);
  const dark = luminance(background);
  const [hi, lo] = light > dark ? [light, dark] : [dark, light];
  return (hi + 0.05) / (lo + 0.05);
}

/** The colour actually painted behind an element, walking up through transparency. */
function effectiveBackground(element) {
  let node = element;
  let result = { r: 255, g: 255, b: 255, a: 1 };
  const stack = [];
  while (node && node !== document.documentElement.parentElement) {
    const colour = parseColour(getComputedStyle(node).backgroundColor);
    if (colour && colour.a > 0) {
      stack.push(colour);
      if (colour.a === 1) break;
    }
    node = node.parentElement;
  }
  for (const colour of stack.reverse()) result = over(colour, result);
  return result;
}

/** Text at or above this size needs 3:1 rather than 4.5:1, per 1.4.3. */
function isLargeText(style) {
  const size = Number.parseFloat(style.fontSize);
  const weight = Number.parseInt(style.fontWeight, 10) || 400;
  const pt = size * 0.75;
  return pt >= 18 || (pt >= 14 && weight >= 700);
}

/* -------------------------------------------------------------------------- */

window.__ragA11y = function audit() {
  // Transitions are switched off for the duration of the audit.
  //
  // A colour in mid transition computes to wherever it has reached, not where
  // it is going. In a backgrounded tab animations do not tick at all, so a
  // theme change freezes every colour at its old value and the contrast figures
  // describe a paint that no longer exists. Suppressing transitions makes the
  // measurement the same whether or not anyone is watching the page.
  const freeze = document.createElement("style");
  freeze.textContent =
    "*, *::before, *::after { transition: none !important; animation: none !important; }";
  document.head.append(freeze);
  // Reading a layout property flushes the style change before anything is measured.
  void document.body.offsetHeight;

  const findings = [];
  const add = (criterion, level, element, detail) =>
    findings.push({ criterion, level, element: describe(element), detail });

  const all = [...document.querySelectorAll("body *")];
  const visible = all.filter((element) => isVisible(element));

  // 1.1.1 Non-text content. An image needs a text alternative, and an empty
  // alt is a valid one meaning "decorative".
  for (const image of document.querySelectorAll("img")) {
    if (!image.hasAttribute("alt")) {
      add("1.1.1 Non-text content", "A", image, "img has no alt attribute");
    }
  }

  // Inline SVG is either decorative and hidden, or it needs a name.
  for (const svg of document.querySelectorAll("svg")) {
    if (!isVisible(svg)) continue;
    const hidden = svg.getAttribute("aria-hidden") === "true";
    const named =
      svg.getAttribute("aria-label") ??
      svg.getAttribute("aria-labelledby") ??
      svg.querySelector("title");
    const inNamedControl = svg.closest("[aria-label], [aria-labelledby], button, a[href]");
    if (!hidden && !named && !inNamedControl) {
      add("1.1.1 Non-text content", "A", svg, "svg is neither hidden nor named");
    }
  }

  // 4.1.2 Name, role, value. Every control needs an accessible name.
  const controls = visible.filter((element) =>
    element.matches("button, a[href], input, select, textarea, [role='button'], [role='tab']"),
  );
  for (const control of controls) {
    if (control.matches("input[type='hidden']")) continue;
    const label =
      control.getAttribute("aria-label")?.trim() ||
      (control.getAttribute("aria-labelledby") &&
        control
          .getAttribute("aria-labelledby")
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim()) ||
      (control.id &&
        document.querySelector(`label[for="${CSS.escape(control.id)}"]`)?.textContent) ||
      control.closest("label")?.textContent ||
      control.textContent?.trim() ||
      control.getAttribute("title")?.trim() ||
      (control.matches("input") ? control.getAttribute("placeholder")?.trim() : "");
    if (!label || label.length === 0) {
      add("4.1.2 Name, role, value", "A", control, "control has no accessible name");
    }
  }

  // 3.3.2 Labels or instructions. A placeholder disappears as soon as someone
  // types, so it is not a label.
  for (const field of visible.filter((element) =>
    element.matches(
      "input:not([type='hidden']):not([type='submit']):not([type='button']), select, textarea",
    ),
  )) {
    const hasRealLabel =
      Boolean(field.getAttribute("aria-label")?.trim()) ||
      Boolean(field.getAttribute("aria-labelledby")) ||
      Boolean(field.id && document.querySelector(`label[for="${CSS.escape(field.id)}"]`)) ||
      Boolean(field.closest("label"));
    if (!hasRealLabel) {
      add(
        "3.3.2 Labels or instructions",
        "A",
        field,
        field.getAttribute("placeholder")
          ? "only a placeholder, which vanishes on typing"
          : "no label",
      );
    }
  }

  // 1.4.3 Contrast, for text.
  for (const element of visible) {
    if (isScreenReaderOnly(element)) continue;
    const ownText = [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent.trim())
      .join("")
      .trim();
    if (ownText.length === 0) continue;

    const style = getComputedStyle(element);
    const foreground = parseColour(style.color);
    if (!foreground) continue;
    const background = effectiveBackground(element);
    const flattened = foreground.a < 1 ? over(foreground, background) : foreground;
    const ratio = contrast(flattened, background);
    const required = isLargeText(style) ? 3 : 4.5;
    if (ratio < required) {
      add(
        "1.4.3 Contrast (minimum)",
        "AA",
        element,
        `${ratio.toFixed(2)}:1 against its background, needs ${required}:1`,
      );
    }
  }

  // 2.4.7 Focus visible.
  //
  // getComputedStyle takes a pseudo-ELEMENT, not a pseudo-class, so asking it
  // for ":focus-visible" quietly returns the element's ordinary style and every
  // control looks unfocusable. The rules are read instead: something must give
  // focus an indicator, and nothing may take it away without replacing it.
  const focusRules = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin stylesheet, not ours
    }
    const walk = (list) => {
      for (const rule of list) {
        if (rule.cssRules) walk(rule.cssRules);
        if (!rule.selectorText || !rule.style) continue;
        if (rule.selectorText.includes(":focus")) focusRules.push(rule);
      }
    };
    walk(rules);
  }

  const givesIndicator = (rule) => {
    const outlineStyle = rule.style.getPropertyValue("outline-style");
    const outline = rule.style.getPropertyValue("outline");
    const width = rule.style.getPropertyValue("outline-width");
    const shadow = rule.style.getPropertyValue("box-shadow");
    const removes = /\bnone\b|\b0\b/.test(outline) || outlineStyle === "none";
    const hasOutline = Boolean(outline || outlineStyle || width) && !removes;
    const hasShadow = Boolean(shadow) && shadow !== "none";
    return hasOutline || hasShadow;
  };

  if (!focusRules.some(givesIndicator)) {
    add(
      "2.4.7 Focus visible",
      "AA",
      document.head,
      "no rule gives keyboard focus a visible indicator",
    );
  }

  for (const rule of focusRules) {
    const outline = rule.style.getPropertyValue("outline");
    const outlineStyle = rule.style.getPropertyValue("outline-style");
    const removes = /^\s*(none|0)\s*$/.test(outline) || outlineStyle === "none";
    const shadow = rule.style.getPropertyValue("box-shadow");
    if (removes && (!shadow || shadow === "none")) {
      add(
        "2.4.7 Focus visible",
        "AA",
        document.head,
        `"${rule.selectorText}" removes the focus outline without replacing it`,
      );
    }
  }

  // 2.5.8 Target size (minimum), 24 by 24 CSS pixels. A pseudo-element may
  // enlarge the pressable area without changing the line box, and inline links
  // inside a sentence are exempt.
  for (const control of controls) {
    if (isScreenReaderOnly(control)) continue;
    const rect = control.getBoundingClientRect();
    const after = getComputedStyle(control, "::after");
    let width = rect.width;
    let height = rect.height;
    if (after.content !== "none" && after.position === "absolute") {
      const inset = (value) => Math.abs(Number.parseFloat(value) || 0);
      width += inset(after.left) + inset(after.right);
      height += inset(after.top) + inset(after.bottom);
    }
    const inlineInSentence =
      control.matches("a[href]") && getComputedStyle(control).display.startsWith("inline");
    if (!inlineInSentence && (width < 24 || height < 24)) {
      add(
        "2.5.8 Target size (minimum)",
        "AA",
        control,
        `${Math.round(width)}x${Math.round(height)}px pressable, needs 24x24`,
      );
    }
  }

  // 1.3.1 Info and relationships: heading order should not skip a level.
  const headings = visible.filter((element) => /^H[1-6]$/.test(element.tagName));
  let previous = 0;
  for (const heading of headings) {
    const level = Number(heading.tagName[1]);
    if (previous && level > previous + 1) {
      add("1.3.1 Info and relationships", "A", heading, `h${previous} is followed by h${level}`);
    }
    previous = level;
  }

  // 2.4.1 Bypass blocks, and 1.3.1: a page needs landmarks and one main.
  const mains = document.querySelectorAll("main, [role='main']");
  if (mains.length === 0) {
    add("1.3.1 Info and relationships", "A", document.body, "page has no main landmark");
  } else if (mains.length > 1) {
    add("1.3.1 Info and relationships", "A", document.body, `${mains.length} main landmarks`);
  }

  // 3.1.1 Language of page.
  if (!document.documentElement.getAttribute("lang")) {
    add("3.1.1 Language of page", "A", document.documentElement, "html has no lang attribute");
  }

  // 2.4.2 Page titled.
  if (!document.title || document.title.trim().length === 0) {
    add("2.4.2 Page titled", "A", document.documentElement, "document has no title");
  }

  // 4.1.2: an aria-labelledby or aria-describedby pointing at nothing names
  // nothing, and reads as silence.
  for (const element of all) {
    for (const attribute of ["aria-labelledby", "aria-describedby", "aria-controls"]) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      const missing = value.split(/\s+/).filter((id) => id && !document.getElementById(id));
      if (missing.length > 0) {
        add(
          "4.1.2 Name, role, value",
          "A",
          element,
          `${attribute} points at ${missing.join(", ")}`,
        );
      }
    }
  }

  // 1.4.4 Resize text: a viewport that blocks zoom traps anyone who needs it.
  const viewport = document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "";
  if (/user-scalable\s*=\s*no/.test(viewport) || /maximum-scale\s*=\s*1/.test(viewport)) {
    add("1.4.4 Resize text", "AA", document.head, "the viewport prevents zooming");
  }

  const seen = new Set();
  const unique = findings.filter((finding) => {
    const key = `${finding.criterion}|${finding.element}|${finding.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  freeze.remove();

  return {
    url: location.pathname,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    total: unique.length,
    byCriterion: unique.reduce((counts, finding) => {
      counts[finding.criterion] = (counts[finding.criterion] ?? 0) + 1;
      return counts;
    }, {}),
    findings: unique.slice(0, 40),
  };
};

window.__ragA11yReady = true;
