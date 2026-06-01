import { BadRequestException } from '@nestjs/common';

type AllowedMime = 'image/jpeg' | 'image/png' | 'image/webp';

function detectMime(buf: Buffer): AllowedMime | null {
  if (buf.length < 12) return null;

  // JPEG: SOI marker FF D8 followed by any APP marker FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';

  // PNG: 8-byte signature 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) return 'image/png';

  // WebP: "RIFF" at 0, "WEBP" at 8 (4-byte file-size field in between)
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return 'image/webp';

  return null;
}

export async function validateImageMagicBytes(
  buffer: Buffer,
): Promise<AllowedMime> {
  const mime = detectMime(buffer);
  if (!mime) {
    throw new BadRequestException(
      'Invalid file type. Only JPEG, PNG, and WebP images are allowed.',
    );
  }
  return mime;
}
