import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderStatus } from '@fragrance-store/shared-types';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../prisma/prisma.service';
import { EmailQueueService } from '../email/email-queue.service';
import { PaymentsService } from '../payments/payments.service';
import { InvoiceService } from '../invoice/invoice.service';
import { CreateReturnRequestDto } from './dto/create-return.dto';
import { encryptIban } from './iban-crypto';

@Injectable()
export class ReturnsService {
  private readonly logger = new Logger(ReturnsService.name);
  private readonly adminEmail: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailQueueService,
    private readonly config: ConfigService,
    private readonly payments: PaymentsService,
    private readonly invoiceService: InvoiceService,
  ) {
    this.adminEmail = this.config.get<string>('ADMIN_DEFAULT_EMAIL', 'admin@aromaterie.pl');
  }

  async create(dto: CreateReturnRequestDto, userId: string) {
    const normalizedNumber = dto.orderNumber.trim().toUpperCase();
    const [order, user, priorReplacementReturn] = await Promise.all([
      this.prisma.order.findFirst({
        where: { orderNumber: normalizedNumber },
        select: {
          id: true,
          userId: true,
          status: true,
          shipment: { select: { deliveredAt: true } },
        },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      }),
      // Art. 27 UoK: if a replacement was previously dispatched and delivered,
      // the 14-day clock restarts from replacementDeliveredAt, not the original delivery.
      dto.type === 'WITHDRAWAL'
        ? this.prisma.returnRequest.findFirst({
            where: {
              orderNumber: normalizedNumber,
              status: 'COMPLETED',
              replacementDeliveredAt: { not: null },
            },
            orderBy: { replacementDeliveredAt: 'desc' },
            select: { replacementDeliveredAt: true },
          })
        : Promise.resolve(null),
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
      // Art. 27 UoK: use the most recent authoritative delivery timestamp.
      // When a replacement was delivered, that date resets the 14-day window
      // (Directive 2011/83/EU Art. 14(1)). Fall back to the original shipment delivery,
      // then to the client-supplied date as a last resort.
      const dbDeliveryDate: Date | null =
        priorReplacementReturn?.replacementDeliveredAt ?? order.shipment?.deliveredAt ?? null;
      const authoritativeDate: Date = dbDeliveryDate ?? new Date(dto.deliveryDate);
      if (dbDeliveryDate) {
        const submitted = new Date(dto.deliveryDate);
        if (submitted < dbDeliveryDate) {
          throw new BadRequestException(
            'Podana data dostarczenia nie może być wcześniejsza niż faktyczna data dostarczenia przesyłki.',
          );
        }
      }
      // Art. 27 UoK: 14-day period starts the day AFTER delivery.
      // +15 sets the window end to the end of the 14th day after delivery,
      // ensuring the full delivery-date + 14 days is always available.
      // authoritativeDate is UTC-anchored (DB timestamps, and date-only strings parse
      // as UTC midnight) — must mutate in UTC too, or a server running ahead of UTC
      // would silently shave hours off this legally mandated window.
      const windowEnd = new Date(authoritativeDate);
      windowEnd.setUTCDate(windowEnd.getUTCDate() + 15);
      windowEnd.setUTCHours(23, 59, 59, 999);
      if (Date.now() > windowEnd.getTime()) {
        throw new BadRequestException(
          'Termin na odstąpienie od umowy (14 dni od daty dostarczenia) już minął ' +
          '(art. 27 Ustawy o prawach konsumenta).',
        );
      }
    }

    const existing = await this.prisma.returnRequest.findFirst({
      where: { orderId: order.id, status: { notIn: ['REJECTED', 'COMPLETED'] } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('A return request for this order is already in progress');
    }

    const ibanKey = this.config.get<string>('IBAN_ENCRYPTION_KEY', '');
    const plainIban = dto.bankAccount?.trim().toUpperCase() ?? null;
    const storedIban =
      plainIban && ibanKey.length === 64 ? encryptIban(plainIban, ibanKey) : plainIban;

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
        bankAccount: storedIban,
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
        adminUrl: this.config.get<string>('FRONTEND_URL')
          ? `${this.config.get<string>('FRONTEND_URL')}/admin/returns/${request.id}`
          : undefined,
        type: request.type as 'WITHDRAWAL' | 'COMPLAINT',
        deliveryDate: dto.deliveryDate,
        items: dto.items,
        reason: request.reason ?? undefined,
        requestedResolution: request.requestedResolution ?? undefined,
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
    if (req.status === 'APPROVED') {
      throw new BadRequestException('Cannot reject an already-approved return request');
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

  // Marks the return as COMPLETED: issues a Stripe partial refund for the
  // returned items only, restores their stock, then flips the request status.
  // Calling order matters — if the Stripe refund fails the return stays APPROVED.
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

    // Fetch order status/discount and all line items so we can compute the partial refund.
    const [order, orderItems] = await Promise.all([
      this.prisma.order.findUniqueOrThrow({
        where: { id: req.orderId },
        select: {
          status: true,
          couponId: true,
          discountInCents: true,
          itemsTotalInCents: true,
          invoiceNumber: true,
        },
      }),
      this.prisma.orderItem.findMany({
        where: { orderId: req.orderId },
        select: {
          id: true,
          productVariantId: true,
          snapshotName: true,
          snapshotPrice: true,
          snapshotVatRate: true,
          quantity: true,
          cancelledQuantity: true,
          cancelledDiscountInCents: true,
        },
      }),
    ]);

    // Match each returned product name against the snapshot names on the order items.
    // req.items is the JSON blob stored at request creation time (ReturnItemDto[]).
    const returnedItems = req.items as Array<{ productName: string; quantity: number }>;
    const refundItems: Array<{
      orderItemId: string;
      productVariantId: string;
      quantity: number;
      priceInCents: number;
      vatRate: number;
      discountAppliedInCents: number;
    }> = [];

    for (const ri of returnedItems) {
      const orderItem = orderItems.find(
        (oi) => oi.snapshotName.trim().toLowerCase() === ri.productName.trim().toLowerCase(),
      );
      if (!orderItem) {
        this.logger.warn(
          `markRefunded: no order item matching "${ri.productName}" for return ${id} — skipping`,
        );
        continue;
      }
      // Clamp to the still-refundable quantity so a second admin click can't over-refund.
      const refundQty = Math.min(ri.quantity, orderItem.quantity - orderItem.cancelledQuantity);
      if (refundQty <= 0) continue;
      refundItems.push({
        orderItemId: orderItem.id,
        productVariantId: orderItem.productVariantId,
        quantity: refundQty,
        priceInCents: orderItem.snapshotPrice,
        vatRate: orderItem.snapshotVatRate,
        discountAppliedInCents: 0,
      });
    }

    if (refundItems.length === 0) {
      throw new BadRequestException(
        `No refundable items found for return request ${id}. ` +
        'All returned items may already be refunded or the product names do not match order line items.',
      );
    }

    // Shared with OrdersService.cancelItemsByUser() so both refund-issuing flows
    // compute the identical discount-prorated price for the identical item/quantity —
    // otherwise a coupon-discounted order refunded through this admin path overpays
    // the customer the full pre-discount price.
    const proratedRefundItems = await this.payments.prorateDiscountForRefundItems(
      order,
      orderItems,
      refundItems,
    );

    // A return request can sit APPROVED for days awaiting the customer's physical
    // return shipment. If Stripe opens a dispute in that window, handleDisputeCreated
    // flips the order to DISPUTE_HOLD (or FRAUD_REVIEW/DISPUTE_LOST_REVIEW) directly,
    // bypassing the normal transition guard — re-check status here, right before the
    // refund fires, so we never refund a payment_intent that is simultaneously the
    // subject of an open chargeback (undermines dispute evidence, risks a double-debit).
    const disputeBlockedStatuses: string[] = [
      OrderStatus.DISPUTE_HOLD,
      OrderStatus.FRAUD_REVIEW,
      OrderStatus.DISPUTE_LOST_REVIEW,
    ];
    if (disputeBlockedStatuses.includes(order.status)) {
      throw new ConflictException(
        `Cannot refund order in status ${order.status} — resolve the active dispute or fraud ` +
        `review before issuing a return refund for request ${id}.`,
      );
    }

    // Issues Stripe partial refund for the returned items, restores their stock,
    // and sets order.status → PARTIALLY_REFUNDED or REFUNDED.
    // Throws on Stripe error — intentionally propagated so the return stays APPROVED.
    const refundAmountInCents = await this.payments.partialRefund(
      req.orderId,
      proratedRefundItems,
      order.status as OrderStatus,
      'RETURN_APPROVAL',
    );

    // Art. 106j VAT act: any price reduction requires a corrective invoice, regardless
    // of which internal flow triggered the refund. Mirrors OrdersService.cancelItemsByUser,
    // the only other producer of InvoiceCorrection rows.
    if (order.invoiceNumber) {
      this.invoiceService
        .processCorrectiveInvoice(
          req.orderId,
          order.invoiceNumber,
          refundAmountInCents,
          'RETURN_APPROVAL',
          proratedRefundItems.map((i) => ({
            orderItemId: i.orderItemId,
            quantity: i.quantity,
            priceInCents: i.priceInCents,
            vatRate: i.vatRate,
          })),
        )
        .catch((err) => {
          this.logger.warn('Corrective invoice generation failed', (err as Error).message);
          Sentry.captureException(err);
        });
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

  // Admin records the date the replacement unit was delivered to the customer.
  // This restarts the Art. 27 UoK 14-day withdrawal clock on any subsequent
  // return request for the same order.
  async setReplacementDeliveredAt(id: string, deliveredAt: Date): Promise<void> {
    const req = await this.prisma.returnRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException(`Return request ${id} not found`);
    if (req.status === 'REJECTED') {
      throw new BadRequestException('Cannot set replacement delivery date on a rejected request');
    }

    await this.prisma.returnRequest.update({
      where: { id },
      data: { replacementDeliveredAt: deliveredAt },
    });

    this.logger.log(
      `Replacement delivered at set for return ${id} (order ${req.orderNumber}): ${deliveredAt.toISOString()}`,
    );
  }
}
