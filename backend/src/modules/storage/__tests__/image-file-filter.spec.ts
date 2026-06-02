import { BadRequestException } from '@nestjs/common';
import { validateImageMagicBytes } from '../image-file-filter';

// Minimal magic-byte sequences. file-type v16 inspects the first bytes only.
const JPEG_MAGIC = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const PNG_MAGIC = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00,
]);
const WEBP_MAGIC = Buffer.from([
  0x52, 0x49, 0x46, 0x46, // "RIFF"
  0x24, 0x00, 0x00, 0x00, // file size (arbitrary)
  0x57, 0x45, 0x42, 0x50, // "WEBP"
]);
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="50"/></svg>');
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
const RANDOM_BYTES = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);

describe('validateImageMagicBytes', () => {
  describe('allowed types', () => {
    it('returns image/jpeg for a JPEG buffer', async () => {
      const result = await validateImageMagicBytes(JPEG_MAGIC);

      expect(result).toBe('image/jpeg');
    });

    it('returns image/png for a PNG buffer', async () => {
      const result = await validateImageMagicBytes(PNG_MAGIC);

      expect(result).toBe('image/png');
    });

    it('returns image/webp for a WebP buffer', async () => {
      const result = await validateImageMagicBytes(WEBP_MAGIC);

      expect(result).toBe('image/webp');
    });
  });

  describe('blocked types — stored XSS prevention', () => {
    it('throws BadRequestException for SVG content regardless of the declared Content-Type header', async () => {
      // Core attack vector: attacker sends SVG bytes with Content-Type: image/jpeg.
      // Multer sets file.mimetype from the header — file-type reads actual bytes.
      await expect(validateImageMagicBytes(SVG_BYTES)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for PDF bytes', async () => {
      await expect(validateImageMagicBytes(PDF_MAGIC)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for unrecognized binary content', async () => {
      await expect(validateImageMagicBytes(RANDOM_BYTES)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for an empty buffer', async () => {
      await expect(validateImageMagicBytes(Buffer.alloc(0))).rejects.toThrow(BadRequestException);
    });

    it('includes a human-readable message in the rejection', async () => {
      await expect(validateImageMagicBytes(SVG_BYTES)).rejects.toThrow(
        'Only JPEG, PNG, and WebP images are allowed',
      );
    });
  });
});
