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

  // Returns the storage path (e.g. "labels/inpost-123.pdf"), NOT a public URL.
  // The shipping-labels bucket must be set to private in Supabase; callers
  // must use getShippingLabelSignedUrl() to produce a time-limited download link.
  async uploadShippingLabel(pdfBuffer: Buffer, filename: string): Promise<string> {
    const path = `labels/${filename}`;

    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await this.supabase.storage
        .from(SHIPPING_LABELS_BUCKET)
        .upload(path, pdfBuffer, { contentType: 'application/pdf', upsert: true });
      if (!error) break;
      if (attempt === 2) throw new Error(`Label upload failed: ${error.message}`);
      await new Promise<void>((r) => setTimeout(r, 500 * 2 ** attempt));
    }

    return path;
  }

  async getShippingLabelSignedUrl(storagePath: string, expiresInSeconds = 14_400): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from(SHIPPING_LABELS_BUCKET)
      .createSignedUrl(storagePath, expiresInSeconds);

    if (error || !data) throw new Error(`Label signing failed: ${error?.message}`);
    return data.signedUrl;
  }

  async deleteShippingLabel(storagePath: string): Promise<void> {
    const { error } = await this.supabase.storage
      .from(SHIPPING_LABELS_BUCKET)
      .remove([storagePath]);
    if (error) throw new Error(`Label delete failed: ${error.message}`);
  }

  async uploadInvoice(pdfBuffer: Buffer, filename: string): Promise<string> {
    const storagePath = `invoices/${filename}`;

    const { error: uploadError } = await this.supabase.storage
      .from(INVOICES_BUCKET)
      .upload(storagePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadError) throw new Error(`Invoice upload failed: ${uploadError.message}`);

    return storagePath;
  }

  async getInvoiceSignedUrl(storagePath: string, expiresInSeconds = 3600): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from(INVOICES_BUCKET)
      .createSignedUrl(storagePath, expiresInSeconds);

    if (error || !data) throw new Error(`Invoice signing failed: ${error?.message}`);
    return data.signedUrl;
  }

  async deleteFile(bucket: string, path: string) {
    const { error } = await this.supabase.storage.from(bucket).remove([path]);
    if (error) throw new Error(`Storage delete failed: ${error.message}`);
  }
}
