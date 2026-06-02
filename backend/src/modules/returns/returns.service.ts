import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '@fragrance-store/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { EmailQueueService } from '../email/email-queue.service';
import { PaymentsService } from '../payments/payments.service';
import { CreateReturnRequestDto } from './dto/create-return.dto';

@Injectable()
export class ReturnsService {
  private readonly logger = new Logger(ReturnsService.name);
  private readonly adminEmail: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailQueueService,
    private readonly config: ConfigService,
    private readonly payments: PaymentsService,
  ) {
    this.adminEmail = this.config.get<string>('ADMIN_DEFAULT_EMAIL', 'admin@aromaterie.pl');
  }

  async create(dto: CreateReturnRequestDto, userId: string) {
    const normalizedNumber = dto.orderNumber.trim().toUpperCase();
    const [order, user] = await Promise.all([
      this.prisma.order.findFirst({
        where: { orderNumber: normalizedNumber },
        select: { id: true, userId: true, status: true },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      }),
    ]);

    if (!order) throw new NotFoundException(`Order ${normalizedNumber} not found`);
    if (order.userId !== userId) throw new ForbiddenException();

    const allowedStatuses: string[] = [
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
      OrderStatus.PAID,
      OrderStatus.PROCESSING,
    ];
    if (!allowedStatuses.includes(order.status)) {
      throw new BadRequestException(
        'Zgłoszenie reklamacji lub zwrotu jest możliwe tylko dla zamówień w trakcie realizacji lub dostarczonych. ' +
        `Aktualny status zamówienia: ${order.status}.`,
      );
    }

    // Art. 38 pkt 5 UoK: right of withdrawal does not apply to sealed hygiene/fragrance
    // goods whose packaging was opened after delivery. Block at the API level so direct
    // API callers cannot bypass the client-side checkbox.
    if (dto.type === 'WITHDRAWAL' && dto.sealedOnReturn !== true) {
      throw new BadRequestException(
        'Prawo odstąpienia nie przysługuje dla produktów higienicznych z naruszonymi ' +
        'opakowaniami (art. 38 pkt 5 Ustawy o prawach konsumenta). ' +
        'Produkty muszą być zwrócone w oryginalnym, nienaruszonem opakowaniu.',
      );
    }

    // Art. 27 UoK: right of withdrawal expires 14 days after delivery. Enforce server-side
    // so a direct API call with a backdated deliveryDate cannot open the admin refund flow.
    if (dto.type === 'WITHDRAWAL') {
      if (!dto.deliveryDate) {
        throw new BadRequestException(
          'Odstąpienie od umowy wymaga podania daty dostarczenia przesyłki.',
        );
      }
      const windowEnd = new Date(dto.deliveryDate).getTime() + 14 * 24 * 60 * 60 * 1000;
      if (Date.now() > windowEnd) {
        throw new BadRequestException(
          'Termin na odstąpienie od umowy (14 dni od daty dostarczenia) już minął ' +
          '(art. 27 Ustawy o prawach konsumenta).',
        );
      }
    }

    const request = await this.prisma.returnRequest.create({
      data: {
        orderId: order.id,
        orderNumber: dto.orderNumber.trim().toUpperCase(),
        email: user!.email,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        phone: dto.phone?.trim() ?? null,
        type: dto.type,
        deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
        items: dto.items as unknown as import('@prisma/client').Prisma.InputJsonValue,
        reason: dto.reason?.trim() ?? null,
        requestedResolution: dto.requestedResolution ?? null,
        bankAccount: dto.bankAccount?.trim().toUpperCase() ?? null,
        sealedOnReturn: dto.sealedOnReturn ?? null,
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

  // Records the customer's return shipment tracking number without issuing a refund.
  // An admin must call this before markRefunded() can proceed on a WITHDRAWAL return.
  async recordReturnTracking(id: string, trackingNumber: string): Promise<void> {
    const req = await this.prisma.returnRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException(`Return request ${id} not found`);
    if (req.status === 'COMPLETED' || req.status === 'REJECTED') {
      throw new BadRequestException(
        `Cannot record tracking on a ${req.status} return request`,
      );
    }

    await this.prisma.returnRequest.update({
      where: { id },
      data: { returnTrackingNumber: trackingNumber.trim() },
    });

    this.logger.log(`Return tracking recorded: ${id} → ${trackingNumber}`);
  }

  // Marks the return as COMPLETED: issues the Stripe refund, restores stock,
  // then flips the return request status. Calling order matters — if the Stripe
  // refund fails the return stays APPROVED so the admin can retry.
  async markRefunded(id: string, adminNote?: string): Promise<void> {
    const req = await this.prisma.returnRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException(`Return request ${id} not found`);
    if (req.status !== 'APPROVED') {
      throw new BadRequestException(
        `Return request must be APPROVED before marking as completed (current: ${req.status})`,
      );
    }
    if (!req.orderId) {
      throw new BadRequestException(
        `Return request ${id} has no linked order — process the Stripe refund manually then contact support to update this record`,
      );
    }
    // Art. 32 UoK: merchant may withhold refund until the returned item is received
    // or the customer provides proof of return shipment. Block here so a busy admin
    // clicking "Refund" cannot accidentally refund before verifying physical receipt.
    if (req.type === 'WITHDRAWAL' && !req.returnTrackingNumber) {
      throw new BadRequestException(
        `Return request ${id} has no return tracking number. ` +
        'Record the customer\'s shipment tracking via PATCH /returns/:id/tracking before issuing a refund (art. 32 UoK).',
      );
    }

    // Issues Stripe refund, restores stock, sets order.status → REFUNDED.
    // Throws on Stripe error — intentionally propagated so the return stays APPROVED.
    await this.payments.refundPayment(req.orderId, 'RETURN_APPROVAL');

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
