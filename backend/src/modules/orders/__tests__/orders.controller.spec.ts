import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CarrierCode, Role } from '@prisma/client';
import { OrdersController } from '../orders.controller';
import { OrdersService } from '../orders.service';
import { CreateOrderDto } from '../dto/create-order.dto';

const mockUser = {
  id: 'user-1',
  email: 'jan@example.com',
  passwordHash: 'hashed',
  firstName: 'Jan',
  lastName: 'Kowalski',
  phone: null,
  googleId: null,
  role: Role.CUSTOMER,
  isEmailVerified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const baseDto: Partial<CreateOrderDto> = {
  carrierCode: CarrierCode.INPOST,
};

describe('OrdersController', () => {
  let controller: OrdersController;
  let ordersService: jest.Mocked<Pick<OrdersService, 'createFromCart' | 'trackByEmailAndNumber'>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        {
          provide: OrdersService,
          useValue: {
            createFromCart: jest.fn(),
            trackByEmailAndNumber: jest.fn(),
            findAllForUser: jest.fn(),
            findEventsForUser: jest.fn(),
            generateInvoiceForUser: jest.fn(),
            findOneForUser: jest.fn(),
            cancelByUser: jest.fn(),
            cancelItemsByUser: jest.fn(),
            getUnreadCount: jest.fn(),
            findAllAdmin: jest.fn(),
            updateStatus: jest.fn(),
            generateInvoice: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(OrdersController);
    ordersService = module.get(OrdersService) as any;
  });

  afterEach(() => jest.clearAllMocks());

  // ── createOrder — guest email guard ──────────────────────────────────────
  // Guards the fix: unauthenticated requests with no guestEmail must be
  // rejected immediately instead of storing undefined as snapshotEmail.

  describe('createOrder — guest email guard', () => {
    it('throws BadRequestException when caller is unauthenticated and guestEmail is absent', () => {
      expect(() =>
        controller.createOrder(undefined, 'sess-1', baseDto as CreateOrderDto),
      ).toThrow(BadRequestException);
    });

    it('throws with the exact guard message so the client knows what to fix', () => {
      expect(() =>
        controller.createOrder(undefined, 'sess-1', baseDto as CreateOrderDto),
      ).toThrow('Guest email is required for unauthenticated orders');
    });

    it('calls createFromCart with guestEmail when caller is unauthenticated', async () => {
      const dto = { ...baseDto, guestEmail: 'guest@example.com' } as CreateOrderDto;
      (ordersService.createFromCart as jest.Mock).mockResolvedValue({ id: 'order-1' });

      await controller.createOrder(undefined, 'sess-1', dto);

      expect(ordersService.createFromCart).toHaveBeenCalledWith(
        undefined,
        'sess-1',
        'guest@example.com',
        dto,
      );
    });

    it('calls createFromCart with user.email when caller is authenticated', async () => {
      (ordersService.createFromCart as jest.Mock).mockResolvedValue({ id: 'order-1' });

      await controller.createOrder(mockUser as any, 'sess-1', baseDto as CreateOrderDto);

      expect(ordersService.createFromCart).toHaveBeenCalledWith(
        'user-1',
        'sess-1',
        'jan@example.com',
        baseDto,
      );
    });

    it('prefers user.email over dto.guestEmail when both are present', async () => {
      const dto = { ...baseDto, guestEmail: 'other@example.com' } as CreateOrderDto;
      (ordersService.createFromCart as jest.Mock).mockResolvedValue({ id: 'order-1' });

      await controller.createOrder(mockUser as any, 'sess-1', dto);

      expect(ordersService.createFromCart).toHaveBeenCalledWith(
        'user-1',
        'sess-1',
        'jan@example.com',
        dto,
      );
    });

    it('does not append the non-null assertion — userEmail is passed as a plain string', async () => {
      const dto = { ...baseDto, guestEmail: 'guest@example.com' } as CreateOrderDto;
      (ordersService.createFromCart as jest.Mock).mockResolvedValue({ id: 'order-1' });

      await controller.createOrder(undefined, undefined, dto);

      const [, , emailArg] = (ordersService.createFromCart as jest.Mock).mock.calls[0];
      expect(typeof emailArg).toBe('string');
      expect(emailArg).toBe('guest@example.com');
    });
  });

  // ── trackOrder — rate-limit guard + delegation ────────────────────────────
  // Guards the fix: GET /orders/track must be throttled at 5 req/min per IP
  // so sequential orderNumber enumeration is not viable.

  describe('trackOrder', () => {
    describe('delegation', () => {
      it('calls trackByEmailAndNumber with email and orderNumber from query params', async () => {
        const payload = { orderNumber: 'ORD-2026-000001', status: 'PAID', items: [] };
        (ordersService.trackByEmailAndNumber as jest.Mock).mockResolvedValue(payload);

        const result = await controller.trackOrder('jan@example.com', 'ORD-2026-000001');

        expect(ordersService.trackByEmailAndNumber).toHaveBeenCalledWith(
          'jan@example.com',
          'ORD-2026-000001',
        );
        expect(result).toBe(payload);
      });

      it('propagates NotFoundException from service when email+orderNumber pair does not match', async () => {
        (ordersService.trackByEmailAndNumber as jest.Mock).mockRejectedValue(
          new NotFoundException('Order not found'),
        );

        await expect(
          controller.trackOrder('nobody@example.com', 'ORD-2026-999999'),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe('rate-limit metadata — enumeration guard', () => {
      it('has a throttle TTL of 60 000 ms on the handler', () => {
        const ttl = Reflect.getMetadata(
          'THROTTLER:TTLdefault',
          OrdersController.prototype.trackOrder,
        );
        expect(ttl).toBe(60_000);
      });

      it('has a throttle limit of 5 requests per window on the handler', () => {
        const limit = Reflect.getMetadata(
          'THROTTLER:LIMITdefault',
          OrdersController.prototype.trackOrder,
        );
        expect(limit).toBe(5);
      });

      it('createOrder does not inherit the tight enumeration throttle', () => {
        const ttl = Reflect.getMetadata(
          'THROTTLER:TTLdefault',
          OrdersController.prototype.createOrder,
        );
        expect(ttl).toBeUndefined();
      });
    });
  });
});
