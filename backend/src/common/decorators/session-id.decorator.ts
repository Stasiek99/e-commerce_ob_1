import { BadRequestException, createParamDecorator, ExecutionContext } from '@nestjs/common';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Extracts x-session-id from the request header and validates it is a UUID.
 * Returns undefined when the header is absent (authenticated users may omit it).
 * Throws 400 when the header is present but not a valid UUID.
 */
export const SessionId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const value = request.headers['x-session-id'];
    if (!value) return undefined;
    if (!UUID_RE.test(value)) {
      throw new BadRequestException('x-session-id must be a valid UUID');
    }
    return value;
  },
);
