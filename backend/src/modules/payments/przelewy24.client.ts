import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { createHash } from 'crypto';

interface P24TransactionData {
  sessionId: string;
  amount: number; // in grosz
  currency: string;
  description: string;
  email: string;
  client: string;
  urlReturn: string;
  urlNotify: string;
  language?: string;
  encoding?: string;
}

@Injectable()
export class Przelewy24Client {
  private readonly client: AxiosInstance;
  private readonly merchantId: number;
  private readonly posId: number;
  private readonly crc: string;
  private readonly logger = new Logger(Przelewy24Client.name);

  constructor(private readonly configService: ConfigService) {
    const sandbox = configService.get<string>('P24_SANDBOX') === 'true';
    const baseURL = sandbox
      ? 'https://sandbox.przelewy24.pl/api/v1'
      : 'https://secure.przelewy24.pl/api/v1';

    this.merchantId = Number(configService.getOrThrow<string>('P24_MERCHANT_ID'));
    this.posId = Number(configService.getOrThrow<string>('P24_POS_ID'));
    this.crc = configService.getOrThrow<string>('P24_CRC');
    const apiKey = configService.getOrThrow<string>('P24_API_KEY');

    this.client = axios.create({
      baseURL,
      auth: {
        username: String(this.posId),
        password: apiKey,
      },
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async registerTransaction(data: P24TransactionData): Promise<{ token: string }> {
    const sign = this.generateSignature({
      sessionId: data.sessionId,
      merchantId: this.merchantId,
      amount: data.amount,
      currency: data.currency,
      crc: this.crc,
    });

    const payload = {
      merchantId: this.merchantId,
      posId: this.posId,
      sessionId: data.sessionId,
      amount: data.amount,
      currency: data.currency,
      description: data.description,
      email: data.email,
      client: data.client,
      urlReturn: data.urlReturn,
      urlNotify: data.urlNotify,
      language: data.language ?? 'pl',
      encoding: data.encoding ?? 'UTF-8',
      sign,
    };

    const response = await this.client.post<{ data: { token: string } }>(
      '/transaction/register',
      payload,
    );

    this.logger.log(`P24 transaction registered: session=${data.sessionId}`);
    return response.data.data;
  }

  async verifyTransaction(data: {
    sessionId: string;
    orderId: number;
    amount: number;
    currency: string;
  }): Promise<void> {
    const sign = this.generateSignature({
      sessionId: data.sessionId,
      orderId: data.orderId,
      amount: data.amount,
      currency: data.currency,
      crc: this.crc,
    });

    await this.client.put('/transaction/verify', {
      merchantId: this.merchantId,
      posId: this.posId,
      sessionId: data.sessionId,
      amount: data.amount,
      currency: data.currency,
      orderId: data.orderId,
      sign,
    });

    this.logger.log(`P24 transaction verified: session=${data.sessionId}`);
  }

  getPaymentUrl(token: string): string {
    const sandbox = this.configService.get<string>('P24_SANDBOX') === 'true';
    const base = sandbox
      ? 'https://sandbox.przelewy24.pl'
      : 'https://secure.przelewy24.pl';
    return `${base}/trnRequest/${token}`;
  }

  private generateSignature(data: Record<string, unknown>): string {
    const json = JSON.stringify(data);
    return createHash('sha384').update(json).digest('hex');
  }
}
