import { createHash } from 'crypto';
import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  RawBodyRequest,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { Request } from 'express';
import { Webhook } from 'svix';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';

interface ResendEmailData {
  email_id: string;
  from: string;
  to: string[];
  subject?: string;
  created_at?: string;
  bounce?: { message: string; subType: string; type: string };
  [key: string]: unknown;
}

interface ResendWebhookEvent {
  type: string;
  created_at: string;
  data: ResendEmailData;
}

@Controller('email/webhook')
export class EmailWebhookController {
  private readonly logger = new Logger(EmailWebhookController.name);
  private readonly webhookSecret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.webhookSecret = config.get<string>('RESEND_WEBHOOK_SECRET', '');
  }

  @Post()
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('svix-id') svixId: string,
    @Headers('svix-timestamp') svixTimestamp: string,
    @Headers('svix-signature') svixSignature: string,
  ) {
    if (!this.webhookSecret) {
      throw new ServiceUnavailableException('Webhook signature verification not configured');
    }

    const wh = new Webhook(this.webhookSecret);
    try {
      wh.verify(req.rawBody!.toString('utf8'), {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      });
    } catch {
      throw new BadRequestException('Invalid webhook signature');
    }

    const event = req.body as ResendWebhookEvent;
    const { type, data } = event;
    const to = Array.isArray(data.to) ? data.to[0] : data.to;

    await this.prisma.emailLog.create({
      data: {
        resendEmailId: data.email_id,
        event: type,
        to: to ?? '',
        subject: data.subject ?? null,
        payload: event as object,
      },
    });

    this.logger.log(`Resend webhook: ${type} → ${to} (${data.email_id})`);

    if (type === 'email.bounced') {
      this.logger.warn(`Email bounced for ${to}: ${data.bounce?.message ?? 'unknown reason'}`);
      const toHash = createHash('sha256').update(to).digest('hex').slice(0, 12);
      Sentry.withScope((scope) => {
        scope.setTag('email.event', 'bounced');
        scope.setTag('email.to_hash', toHash);
        scope.setContext('email', { emailId: data.email_id, subject: data.subject, bounce: data.bounce });
        Sentry.captureMessage(`Email bounced (to_hash=${toHash})`, 'warning');
      });
      if (to) {
        await this.prisma.user.updateMany({
          where: { email: to },
          data: { emailBounced: true, emailBouncedAt: new Date() },
        });
      }
    }

    if (type === 'email.complained') {
      this.logger.warn(`Spam complaint from ${to} (email_id: ${data.email_id})`);
      const toHash = createHash('sha256').update(to).digest('hex').slice(0, 12);
      Sentry.withScope((scope) => {
        scope.setTag('email.event', 'complained');
        scope.setTag('email.to_hash', toHash);
        scope.setContext('email', { emailId: data.email_id, subject: data.subject });
        Sentry.captureMessage(`Spam complaint (to_hash=${toHash})`, 'warning');
      });
    }
  }
}
