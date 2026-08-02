import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
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
import { Observable, throwError } from 'rxjs';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { ProductsService } from './products.service';
import { StorageService } from '../storage/storage.service';
import { validateImageMagicBytes } from '../storage/image-file-filter';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  CreateProductDto,
  UpdateProductDto,
  ProductQueryDto,
  CreateVariantDto,
  FinderMatchQueryDto,
  UpdateVariantDto,
  UpdateVariantStockDto,
} from './dto/product.dto';

// Per-replica cap, not a fleet-wide ceiling — this counter is server-local
// in-memory state (resets to 0 on every restart, so a crash can never leave
// stale Redis keys that lock users out until a TTL expires). With N replicas
// behind the load balancer, the real fleet-wide ceiling is ~N * this value.
const SSE_MAX_CONNS_PER_REPLICA = 500;
const SSE_IDLE_TIMEOUT_MS = 5 * 60 * 1_000;

@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductsController {
  // Server-local counter — see SSE_MAX_CONNS_PER_REPLICA comment above.
  private sseConnCount = 0;

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

  // ── Fragrance finder ───────────────────────────────────────────────────────
  // Both routes are declared before the `:slug` handler further down; Nest
  // matches in declaration order, so a literal segment registered after a
  // parameterized one would be shadowed by it.

  @Public()
  @Get('finder/notes')
  getFinderNotes() {
    return this.productsService.getFinderNotes();
  }

  @Public()
  @Throttle({ burst: { ttl: 10_000, limit: 15 }, sustained: { ttl: 60_000, limit: 60 } })
  @Get('finder/match')
  matchByNotes(@Query() query: FinderMatchQueryDto) {
    return this.productsService.matchByNotes(query);
  }

  @Public()
  @Sse('variants/stock-stream')
  streamVariantStock(
    @Query('ids') ids: string,
  ): Observable<MessageEvent> {
    const variantIds = (ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10);

    if (this.sseConnCount >= SSE_MAX_CONNS_PER_REPLICA) {
      return throwError(
        () => new HttpException(
          'SSE connection limit reached. Try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        ),
      );
    }

    this.sseConnCount++;

    return new Observable<MessageEvent>((subscriber) => {
      let idleTimer: ReturnType<typeof setTimeout>;

      const resetIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          subscriber.next({ data: { reconnect: true } } as unknown as MessageEvent);
          subscriber.complete();
        }, SSE_IDLE_TIMEOUT_MS);
      };

      resetIdle();

      const innerSub = this.productsService.createStockStream(variantIds).subscribe({
        next: (event) => { resetIdle(); subscriber.next(event); },
        error: (err) => subscriber.error(err),
        complete: () => subscriber.complete(),
      });

      return () => {
        clearTimeout(idleTimer);
        innerSub.unsubscribe();
        this.sseConnCount--;
      };
    });
  }

  @Public()
  @Get(':slug/related')
  findRelated(@Param('slug') slug: string, @Query('limit') limit?: string) {
    return this.productsService.findRelated(slug, limit ? Math.min(parseInt(limit, 10), 12) : 6);
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
    @CurrentUser() user: { id: string },
  ) {
    return this.productsService.updateVariantStock(variantId, dto, user.id);
  }

  @Post(':id/images')
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('altText') altText?: string,
  ) {
    const verifiedMime = await validateImageMagicBytes(file.buffer);
    const { url, path } = await this.storageService.uploadProductImage(id, file, verifiedMime);
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
