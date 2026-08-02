/**
 * Browser-side defect detectors.
 *
 * Everything here answers yes/no from the rendered DOM — no aesthetic
 * judgement. Each returns a list of findings so the caller can diff runs.
 * Exported as a single function that is serialized into the page by
 * page.evaluate, so it must not reference anything from module scope.
 */
export function collectFindings({ minTapTarget, minFontSize }) {
  const findings = [];
  const vw = document.documentElement.clientWidth;

  const describe = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls =
      typeof el.className === 'string' && el.className
        ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}`
        : '';
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ''}`;
  };

  const visible = (el, r) => {
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  };

  // ── 1. Horizontal overflow ────────────────────────────────────────────────
  // The single most common small-screen defect: one wide child makes the whole
  // document pan sideways. Report the offenders, not just the symptom.
  const docOverflow = document.documentElement.scrollWidth - vw;
  if (docOverflow > 1) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (!visible(el, r)) continue;
      // An element wider than the viewport, or poking past its right edge.
      if (r.right > vw + 1 || r.width > vw + 1) {
        // Skip elements whose parent already scrolls them on purpose.
        const p = el.parentElement;
        if (p && ['auto', 'scroll'].includes(getComputedStyle(p).overflowX)) continue;
        findings.push({
          type: 'horizontal-overflow',
          el: describe(el),
          detail: `right=${Math.round(r.right)} width=${Math.round(r.width)} vw=${vw}`,
        });
      }
    }
    if (!findings.some((f) => f.type === 'horizontal-overflow')) {
      findings.push({
        type: 'horizontal-overflow',
        el: 'document',
        detail: `scrollWidth exceeds viewport by ${Math.round(docOverflow)}px (no single culprit found)`,
      });
    }
  }

  // ── 2. Tap targets ────────────────────────────────────────────────────────
  const interactive = document.querySelectorAll(
    'a[href], button, input:not([type=hidden]), select, textarea, [role="button"], [role="link"], [role="tab"], [tabindex]:not([tabindex="-1"])',
  );
  for (const el of interactive) {
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    // WCAG 2.5.8 exempts targets sitting inside a sentence, where the size is
    // dictated by the surrounding line-height. Counting those made the report
    // look far worse than it is and invited "fixes" that break running text.
    const inlineInSentence =
      getComputedStyle(el).display === 'inline' &&
      [...(el.parentElement?.childNodes ?? [])].some(
        (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
      );
    if (inlineInSentence) continue;
    if (r.width < minTapTarget || r.height < minTapTarget) {
      findings.push({
        type: 'small-tap-target',
        el: describe(el),
        detail: `${Math.round(r.width)}x${Math.round(r.height)} < ${minTapTarget}`,
      });
    }
  }

  // ── 3. Tiny text ──────────────────────────────────────────────────────────
  for (const el of document.querySelectorAll('body *')) {
    // Only leaf-ish nodes carrying their own text, or font-size is counted
    // once per ancestor and every page drowns in duplicates.
    const own = [...el.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
    );
    if (!own) continue;
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size < minFontSize) {
      findings.push({
        type: 'tiny-text',
        el: describe(el),
        detail: `${size}px < ${minFontSize}px`,
      });
    }
  }

  // ── 4. Clipped text ───────────────────────────────────────────────────────
  // Content wider than its own clipping box: an ellipsis nobody asked for, or
  // a label cut mid-word.
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.overflowX !== 'hidden' && cs.overflow !== 'hidden') continue;
    if (!el.textContent?.trim()) continue;
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      findings.push({
        type: 'clipped-text',
        el: describe(el),
        detail: `content ${el.scrollWidth}px in ${el.clientWidth}px box`,
      });
    }
  }

  return findings;
}
