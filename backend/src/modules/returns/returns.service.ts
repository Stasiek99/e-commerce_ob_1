import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CreateReturnRequestDto } from './dto/create-return.dto';

@Injectable()
export class ReturnsService {
  private readonly logger = new Logger(ReturnsService.name);
  private readonly adminEmail: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {
    this.adminEmail = this.config.get<string>('ADMIN_DEFAULT_EMAIL', 'admin@aromaterie.pl');
  }

  async create(dto: CreateReturnRequestDto) {
    const request = await (this.prisma as any).returnRequest.create({
      data: {
        orderNumber: dto.orderNumber.trim().toUpperCase(),
        email: dto.email.trim().toLowerCase(),
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        phone: dto.phone?.trim() ?? null,
        type: dto.type,
        deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
        items: dto.items,
        reason: dto.reason?.trim() ?? null,
        requestedResolution: dto.requestedResolution ?? null,
        bankAccount: dto.bankAccount?.trim().toUpperCase() ?? null,
      },
    });

    this.logger.log(
      `Return request created: ${request.id} for order ${request.orderNumber} (${request.type})`,
    );

    await Promise.allSettled([
      this.email.sendReturnConfirmation({
        to: request.email,
        firstName: request.firstName,
        orderNumber: request.orderNumber,
        requestId: request.id,
        type: request.type,
        items: dto.items,
      }),
      this.email.sendReturnAdminNotification({
        to: this.adminEmail,
        requestId: request.id,
        orderNumber: request.orderNumber,
        customerName: `${request.firstName} ${request.lastName}`,
        email: request.email,
        phone: request.phone ?? undefined,
        type: request.type,
        deliveryDate: dto.deliveryDate,
        items: dto.items,
        reason: request.reason ?? undefined,
        requestedResolution: request.requestedResolution ?? undefined,
        bankAccount: request.bankAccount ?? undefined,
      }),
    ]);

    return { id: request.id, orderNumber: request.orderNumber };
  }
}
