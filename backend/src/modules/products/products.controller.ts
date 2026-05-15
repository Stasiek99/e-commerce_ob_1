import {
  Body,
  Controller,
  Delete,
  Get,
  MessageEvent,
  Param,
  Patch,
  Post,
  Query,
  Sse,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { ProductsService } from './products.service';
import { StorageService } from '../storage/storage.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import {
  CreateProductDto,
  UpdateProductDto,
  ProductQueryDto,
  CreateVariantDto,
  UpdateVariantDto,
  UpdateVariantStockDto,
} from './dto/product.dto';

@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly storageService: StorageService,
  ) {}

  @Public()
  @Throttle({ burst: { ttl: 1_000, limit: 3 }, sustained: { ttl: 60_000, limit: 20 } })
  @Get()
  findAll(@Query() query: ProductQueryDto) {
    return this.productsService.findAll(query);
  }

  @Public()
  @Get('facets')
  getFacets(@Query('category') category?: string) {
    return this.productsService.getFacets({ category });
  }

  @Public()
  @Throttle({ burst: { ttl: 10_000, limit: 15 }, sustained: { ttl: 60_000, limit: 50 } })
  @Get('suggest')
  suggest(@Query('q') q: string) {
    if (!q || q.trim().length < 2 || q.trim().length > 100) return [];
    return this.productsService.suggest(q);
  }

  @Public()
  @Sse('variants/stock-stream')
  streamVariantStock(@Query('ids') ids: string): Observable<MessageEvent> {
    const variantIds = (ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10);
    return this.productsService.createStockStream(variantIds);
  }

  @Public()
  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    return this.productsService.findBySlug(slug);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }

  @Post(':id/variants')
  @Roles(Role.ADMIN)
  createVariant(@Param('id') id: string, @Body() dto: CreateVariantDto) {
    return this.productsService.createVariant(id, dto);
  }

  @Patch(':id/variants/:variantId')
  @Roles(Role.ADMIN)
  updateVariant(@Param('variantId') variantId: string, @Body() dto: UpdateVariantDto) {
    return this.productsService.updateVariant(variantId, dto);
  }

  @Patch('admin/variants/:variantId/stock')
  @Roles(Role.ADMIN)
  updateVariantStock(
    @Param('variantId') variantId: string,
    @Body() dto: UpdateVariantStockDto,
  ) {
    return this.productsService.updateVariantStock(variantId, dto);
  }

  @Post(':id/images')
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('altText') altText?: string,
  ) {
    const { url, path } = await this.storageService.uploadProductImage(id, file);
    return this.productsService.addImage(id, url, path, altText);
  }

  @Delete(':id/images/:imageId')
  @Roles(Role.ADMIN)
  async removeImage(@Param('imageId') imageId: string) {
    const image = await this.productsService.removeImage(imageId);
    await this.storageService.deleteFile('product-images', image.storagePath);
    return { success: true };
  }
}
