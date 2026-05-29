import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
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
  let ordersService: jest.Mocked<Pick<OrdersService, 'createFromCart'>>;

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
});
