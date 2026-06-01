import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const PRODUCT_IMAGES_BUCKET = 'product-images';
const SHIPPING_LABELS_BUCKET = 'shipping-labels';
const INVOICES_BUCKET = 'invoices';

@Injectable()
export class StorageService {
  private readonly supabase: SupabaseClient;

  constructor(private readonly configService: ConfigService) {
    this.supabase = createClient(
      configService.getOrThrow<string>('SUPABASE_URL'),
      configService.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
    );
  }

  async uploadProductImage(
    productId: string,
    file: Express.Multer.File,
    verifiedMime: 'image/jpeg' | 'image/png' | 'image/webp',
  ): Promise<{ url: string; path: string }> {
    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    const ext = extMap[verifiedMime];
    const path = `${productId}/${Date.now()}.${ext}`;

    const { error } = await this.supabase.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .upload(path, file.buffer, {
        contentType: verifiedMime,
        upsert: false,
      });

    if (error) throw new Error(`Storage upload failed: ${error.message}`);

    const { data } = this.supabase.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .getPublicUrl(path);

    return { url: data.publicUrl, path };
  }

  async uploadShippingLabel(pdfBuffer: Buffer, filename: string): Promise<string> {
    const path = `labels/${filename}`;

    const { error } = await this.supabase.storage
      .from(SHIPPING_LABELS_BUCKET)
      .upload(path, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (error) throw new Error(`Label upload failed: ${error.message}`);

    const { data } = this.supabase.storage
      .from(SHIPPING_LABELS_BUCKET)
      .getPublicUrl(path);

    return data.publicUrl;
  }

  async uploadInvoice(pdfBuffer: Buffer, filename: string): Promise<string> {
    const storagePath = `invoices/${filename}`;

    const { error: uploadError } = await this.supabase.storage
      .from(INVOICES_BUCKET)
      .upload(storagePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadError) throw new Error(`Invoice upload failed: ${uploadError.message}`);

    // 10-year signed URL — invoices are legal documents and must stay accessible long-term
    const TEN_YEARS_SECONDS = 10 * 365 * 24 * 60 * 60;
    const { data, error: signError } = await this.supabase.storage
      .from(INVOICES_BUCKET)
      .createSignedUrl(storagePath, TEN_YEARS_SECONDS);

    if (signError || !data) throw new Error(`Invoice signing failed: ${signError?.message}`);
    return data.signedUrl;
  }

  async deleteFile(bucket: string, path: string) {
    const { error } = await this.supabase.storage.from(bucket).remove([path]);
    if (error) throw new Error(`Storage delete failed: ${error.message}`);
  }
}
