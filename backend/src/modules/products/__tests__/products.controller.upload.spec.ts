import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { ProductsController } from '../products.controller';
import { ProductsService } from '../products.service';
import { StorageService } from '../../storage/storage.service';

// Minimal magic-byte sequences for file-type v16 detection.
const JPEG_MAGIC = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><circle r="50"/></svg>');

const makeMulterFile = (
  buffer: Buffer,
  mimetype = 'image/jpeg',
): Express.Multer.File => ({
  buffer,
  mimetype,
  fieldname: 'file',
  originalname: 'photo.jpg',
  encoding: '7bit',
  size: buffer.length,
  destination: '',
  filename: '',
  path: '',
  stream: null as any,
});

const mockStorageService = {
  uploadProductImage: jest.fn(),
  deleteFile: jest.fn(),
};

const mockProductsService = {
  addImage: jest.fn(),
  removeImage: jest.fn(),
  // stub remaining methods so NestJS injection doesn't complain
  findAll: jest.fn(),
  findBySlug: jest.fn(),
  findRelated: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  createVariant: jest.fn(),
  updateVariant: jest.fn(),
  updateVariantStock: jest.fn(),
  getFacets: jest.fn(),
  getStockLevel: jest.fn(),
  watchStock: jest.fn(),
};

describe('ProductsController — uploadImage (magic-byte validation)', () => {
  let controller: ProductsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        { provide: ProductsService, useValue: mockProductsService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: 'REDIS_CLIENT', useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(ProductsController);
    jest.clearAllMocks();
  });

  afterEach(() => jest.clearAllMocks());

  describe('blocked paths', () => {
    it('throws BadRequestException for SVG bytes even when Content-Type header says image/jpeg', async () => {
      const svgDisguisedAsJpeg = makeMulterFile(SVG_BYTES, 'image/jpeg');

      await expect(
        controller.uploadImage('product-1', svgDisguisedAsJpeg),
      ).rejects.toThrow(BadRequestException);
    });

    it('does not call StorageService when magic bytes are rejected', async () => {
      const svgFile = makeMulterFile(SVG_BYTES, 'image/jpeg');

      await expect(
        controller.uploadImage('product-1', svgFile),
      ).rejects.toThrow(BadRequestException);

      expect(mockStorageService.uploadProductImage).not.toHaveBeenCalled();
    });

    it('does not call ProductsService.addImage when magic bytes are rejected', async () => {
      const svgFile = makeMulterFile(SVG_BYTES, 'image/png');

      await expect(
        controller.uploadImage('product-1', svgFile),
      ).rejects.toThrow(BadRequestException);

      expect(mockProductsService.addImage).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('uploads and persists the image when bytes match JPEG', async () => {
      const file = makeMulterFile(JPEG_MAGIC);
      mockStorageService.uploadProductImage.mockResolvedValue({
        url: 'https://cdn.example.com/product-1/123.jpg',
        path: 'product-1/123.jpg',
      });
      mockProductsService.addImage.mockResolvedValue({ id: 'img-1', url: 'https://cdn.example.com/product-1/123.jpg' });

      const result = await controller.uploadImage('product-1', file, 'alt text');

      expect(mockStorageService.uploadProductImage).toHaveBeenCalledWith(
        'product-1',
        file,
        'image/jpeg',
      );
      expect(mockProductsService.addImage).toHaveBeenCalledWith(
        'product-1',
        'https://cdn.example.com/product-1/123.jpg',
        'product-1/123.jpg',
        'alt text',
      );
      expect(result).toMatchObject({ id: 'img-1' });
    });

    it('passes the MIME derived from magic bytes — not file.mimetype — to StorageService', async () => {
      // Bytes are valid JPEG but the multipart header claims image/png.
      // The verified MIME from file-type (image/jpeg) must win.
      const jpegWithWrongMimeHeader = makeMulterFile(JPEG_MAGIC, 'image/png');
      mockStorageService.uploadProductImage.mockResolvedValue({
        url: 'https://cdn.example.com/product-1/123.jpg',
        path: 'product-1/123.jpg',
      });
      mockProductsService.addImage.mockResolvedValue({ id: 'img-1' });

      await controller.uploadImage('product-1', jpegWithWrongMimeHeader);

      expect(mockStorageService.uploadProductImage).toHaveBeenCalledWith(
        'product-1',
        jpegWithWrongMimeHeader,
        'image/jpeg', // magic-bytes verdict, not 'image/png' from header
      );
    });
  });
});
