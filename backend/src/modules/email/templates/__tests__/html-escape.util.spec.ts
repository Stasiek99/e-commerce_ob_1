import { escapeHtml, sanitizeUrl } from '../html-escape.util';

describe('escapeHtml()', () => {
  it('escapes & to &amp;', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });

  it('escapes < to &lt;', () => {
    expect(escapeHtml('<b>bold</b>')).toBe('&lt;b&gt;bold&lt;/b&gt;');
  });

  it('escapes > to &gt;', () => {
    expect(escapeHtml('3 > 2')).toBe('3 &gt; 2');
  });

  it('escapes " to &quot;', () => {
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
  });

  it("escapes ' to &#x27;", () => {
    expect(escapeHtml("it's")).toBe('it&#x27;s');
  });

  it('escapes all special chars in a script injection payload', () => {
    const payload = '<script>alert("xss")</script>';
    const escaped = escapeHtml(payload);
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
    expect(escaped).not.toContain('"');
    expect(escaped).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('returns empty string for null', () => {
    expect(escapeHtml(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(escapeHtml(undefined)).toBe('');
  });

  it('returns safe strings unchanged', () => {
    expect(escapeHtml('Hello, World!')).toBe('Hello, World!');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('sanitizeUrl()', () => {
  it('allows https URLs', () => {
    const url = 'https://inpost.pl/trace/12345';
    expect(sanitizeUrl(url)).toBe(url);
  });

  it('allows http URLs', () => {
    const url = 'http://example.com/track';
    expect(sanitizeUrl(url)).toBe(url);
  });

  it('blocks javascript: scheme → returns "#"', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('#');
  });

  it('blocks data: scheme → returns "#"', () => {
    expect(sanitizeUrl('data:text/html,<script>evil()</script>')).toBe('#');
  });

  it('blocks vbscript: scheme → returns "#"', () => {
    expect(sanitizeUrl('vbscript:msgbox(1)')).toBe('#');
  });

  it('blocks malformed URLs → returns "#"', () => {
    expect(sanitizeUrl('not-a-url')).toBe('#');
  });

  it('returns "#" for null', () => {
    expect(sanitizeUrl(null)).toBe('#');
  });

  it('returns "#" for undefined', () => {
    expect(sanitizeUrl(undefined)).toBe('#');
  });

  it('returns "#" for empty string', () => {
    expect(sanitizeUrl('')).toBe('#');
  });

  it('HTML-escapes special chars in the URL', () => {
    const url = 'https://example.com/search?q=<test>';
    const result = sanitizeUrl(url);
    expect(result).not.toContain('<');
    expect(result).toContain('&lt;');
  });
});
