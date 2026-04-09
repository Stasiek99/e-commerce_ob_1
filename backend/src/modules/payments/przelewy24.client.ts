import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

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

interface MockTransaction {
  token: string;
  sessionId: string;
  amount: number;
  orderId?: number;
  status: 'pending' | 'completed' | 'failed';
  createdAt: Date;
}

@Injectable()
export class Przelewy24Client {
  private readonly client: AxiosInstance;
  private readonly merchantId: number;
  private readonly posId: number;
  private readonly crc: string;
  private readonly logger = new Logger(Przelewy24Client.name);
  private readonly mockEnabled: boolean;
  private readonly mockTransactions = new Map<string, MockTransaction>();

  constructor(private readonly configService: ConfigService) {
    this.mockEnabled = configService.get<string>('P24_MOCK_ENABLED') === 'true';
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

    if (this.mockEnabled) {
      this.logger.warn(
        '⚠️  MOCK PRZELEWY24 CLIENT ENABLED - This is for testing only!',
      );
      this.logger.warn(
        'To test failure, use amount ending in .01 (e.g., 249.01 PLN)',
      );
    }
  }

  async registerTransaction(data: P24TransactionData): Promise<{ token: string }> {
    if (this.mockEnabled) {
      return this.mockRegisterTransaction(data);
    }

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
    if (this.mockEnabled) {
      return this.mockVerifyTransaction(data);
    }

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
    if (this.mockEnabled) {
      return `https://mock.przelewy24.pl/trnRequest/${token}?mock=1`;
    }

    const sandbox = this.configService.get<string>('P24_SANDBOX') === 'true';
    const base = sandbox
      ? 'https://sandbox.przelewy24.pl'
      : 'https://secure.przelewy24.pl';
    return `${base}/trnRequest/${token}`;
  }

  // Mock implementation methods
  private mockRegisterTransaction(data: P24TransactionData): { token: string } {
    const token = `MOCK_${uuidv4().replace(/-/g, '').substring(0, 24).toUpperCase()}`;
    const amountEndsInOne = data.amount % 100 === 1;
    const status = amountEndsInOne ? 'failed' : 'pending';

    const transaction: MockTransaction = {
      token,
      sessionId: data.sessionId,
      amount: data.amount,
      status,
      createdAt: new Date(),
    };

    this.mockTransactions.set(data.sessionId, transaction);

    this.logger.log(
      `[MOCK] P24 transaction registered: session=${data.sessionId}, token=${token}, status=${status}`,
    );

    if (amountEndsInOne) {
      this.logger.warn(
        `[MOCK] Amount ends in .01 - will simulate payment FAILURE`,
      );
    } else {
      this.logger.log(
        `[MOCK] Transaction ready for payment - will simulate SUCCESS`,
      );
    }

    return { token };
  }

  private mockVerifyTransaction(data: {
    sessionId: string;
    orderId: number;
    amount: number;
    currency: string;
  }): void {
    const transaction = this.mockTransactions.get(data.sessionId);

    if (!transaction) {
      this.logger.warn(`[MOCK] No transaction found for session ${data.sessionId}`);
      throw new Error(`Transaction not found: ${data.sessionId}`);
    }

    const amountEndsInOne = data.amount % 100 === 1;

    if (amountEndsInOne) {
      this.logger.warn(
        `[MOCK] Simulating payment FAILURE for session ${data.sessionId}`,
      );
      throw new Error('[MOCK] Simulated payment failure');
    }

    transaction.status = 'completed';
    transaction.orderId = data.orderId;

    this.logger.log(
      `[MOCK] P24 transaction verified as SUCCESSFUL: session=${data.sessionId}, orderId=${data.orderId}`,
    );
  }

  verifyWebhookSignature(body: {
    merchantId: number;
    posId: number;
    sessionId: string;
    amount: number;
    originAmount: number;
    currency: string;
    orderId: number;
    methodId: number;
    statement: string;
    sign: string;
  }): boolean {
    if (this.mockEnabled) {
      this.logger.log('[MOCK] Skipping webhook signature verification');
      return true;
    }

    const expected = this.generateSignature({
      merchantId: body.merchantId,
      posId: body.posId,
      sessionId: body.sessionId,
      amount: body.amount,
      originAmount: body.originAmount,
      currency: body.currency,
      orderId: body.orderId,
      methodId: body.methodId,
      statement: body.statement,
      crc: this.crc,
    });

    return expected === body.sign;
  }

  private generateSignature(data: Record<string, unknown>): string {
    const json = JSON.stringify(data);
    return createHash('sha384').update(json).digest('hex');
  }
}
