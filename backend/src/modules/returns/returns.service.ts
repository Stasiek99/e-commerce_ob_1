import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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

  async create(dto: CreateReturnRequestDto, userId: string) {
    const normalizedNumber = dto.orderNumber.trim().toUpperCase();
    const order = await this.prisma.order.findFirst({
      where: { orderNumber: normalizedNumber },
      select: { userId: true },
    });

    if (!order) throw new NotFoundException(`Order ${normalizedNumber} not found`);
    if (order.userId !== userId) throw new ForbiddenException();

    const request = await this.prisma.returnRequest.create({
      data: {
        orderNumber: dto.orderNumber.trim().toUpperCase(),
        email: dto.email.trim().toLowerCase(),
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        phone: dto.phone?.trim() ?? null,
        type: dto.type,
        deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
        items: dto.items as unknown as import('@prisma/client').Prisma.InputJsonValue,
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
        type: request.type as 'WITHDRAWAL' | 'COMPLAINT',
        items: dto.items,
      }),
      this.email.sendReturnAdminNotification({
        to: this.adminEmail,
        requestId: request.id,
        orderNumber: request.orderNumber,
        customerName: `${request.firstName} ${request.lastName}`,
        email: request.email,
        phone: request.phone ?? undefined,
        type: request.type as 'WITHDRAWAL' | 'COMPLAINT',
        deliveryDate: dto.deliveryDate,
        items: dto.items,
        reason: request.reason ?? undefined,
        requestedResolution: request.requestedResolution ?? undefined,
        bankAccount: request.bankAccount ?? undefined,
      }),
    ]);

    return { id: request.id, orderNumber: request.orderNumber };
  }

  async approve(id: string, adminNote?: string): Promise<void> {
    const req = await this.prisma.returnRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException(`Return request ${id} not found`);
    if (req.status === 'APPROVED' || req.status === 'COMPLETED') {
      throw new BadRequestException(`Return request is already ${req.status}`);
    }
    if (req.status === 'REJECTED') {
      throw new BadRequestException('Cannot approve a rejected return request');
    }

    await this.prisma.returnRequest.update({
      where: { id },
      data: { status: 'APPROVED', adminNote: adminNote ?? null },
    });

    this.logger.log(`Return request approved: ${id} (order ${req.orderNumber})`);

    await this.email
      .sendReturnStatusUpdate({
        to: req.email,
        firstName: req.firstName,
        orderNumber: req.orderNumber,
        requestId: req.id,
        type: req.type as 'WITHDRAWAL' | 'COMPLAINT',
        newStatus: 'APPROVED',
        adminNote,
      })
      .catch((err: Error) =>
        this.logger.warn(`Return status email failed for ${id}: ${err.message}`),
      );
  }

  async reject(id: string, adminNote?: string): Promise<void> {
    const req = await this.prisma.returnRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException(`Return request ${id} not found`);
    if (req.status === 'REJECTED') {
      throw new BadRequestException('Return request is already REJECTED');
    }
    if (req.status === 'COMPLETED') {
      throw new BadRequestException('Cannot reject a completed return request');
    }

    await this.prisma.returnRequest.update({
      where: { id },
      data: { status: 'REJECTED', adminNote: adminNote ?? null },
    });

    this.logger.log(`Return request rejected: ${id} (order ${req.orderNumber})`);

    await this.email
      .sendReturnStatusUpdate({
        to: req.email,
        firstName: req.firstName,
        orderNumber: req.orderNumber,
        requestId: req.id,
        type: req.type as 'WITHDRAWAL' | 'COMPLAINT',
        newStatus: 'REJECTED',
        adminNote,
      })
      .catch((err: Error) =>
        this.logger.warn(`Return status email failed for ${id}: ${err.message}`),
      );
  }

  // Marks the return as COMPLETED (money transferred / complaint resolved).
  // Only callable from APPROVED state to prevent accidental double-processing.
  async markRefunded(id: string, adminNote?: string): Promise<void> {
    const req = await this.prisma.returnRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException(`Return request ${id} not found`);
    if (req.status !== 'APPROVED') {
      throw new BadRequestException(
        `Return request must be APPROVED before marking as completed (current: ${req.status})`,
      );
    }

    await this.prisma.returnRequest.update({
      where: { id },
      data: { status: 'COMPLETED', adminNote: adminNote ?? null },
    });

    this.logger.log(`Return request marked as completed: ${id} (order ${req.orderNumber})`);

    await this.email
      .sendReturnStatusUpdate({
        to: req.email,
        firstName: req.firstName,
        orderNumber: req.orderNumber,
        requestId: req.id,
        type: req.type as 'WITHDRAWAL' | 'COMPLAINT',
        newStatus: 'COMPLETED',
        adminNote,
      })
      .catch((err: Error) =>
        this.logger.warn(`Return status email failed for ${id}: ${err.message}`),
      );
  }
}
