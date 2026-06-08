const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
};

export function escapeHtml(value: string | null | undefined): string {
  if (value == null) return '';
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
}

// Strips javascript: / data: and any other non-http(s) protocol from URLs that
// originate outside the backend (carrier tracking links, user-supplied redirects).
// Falls back to '#' rather than omitting the href so the anchor remains visible.
export function sanitizeUrl(url: string | null | undefined): string {
  if (!url) return '#';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '#';
    return escapeHtml(url);
  } catch {
    return '#';
  }
}
