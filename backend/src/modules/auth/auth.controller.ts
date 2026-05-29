import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { User } from '@prisma/client';
import type IORedis from 'ioredis';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ExchangeTokenDto } from './dto/exchange-token.dto';
import { MagicLinkRequestDto, MagicLinkVerifyDto } from './dto/magic-link.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { Throttle } from '@nestjs/throttler';

import { REFRESH_COOKIE } from './auth.constants';

const OAUTH_EXCHANGE_COOKIE = 'oauth_access_token';

const OAUTH_NONCE_TTL_S = 60;

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  private readonly crossSite: boolean;

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    @Inject('REDIS_CLIENT') private readonly redis: IORedis,
  ) {
    this.crossSite = (this.configService.get<string>('FRONTEND_URL', '') ?? '').startsWith('https://');
  }

  private get cookieOptions() {
    return {
      httpOnly: true,
      secure: this.crossSite,
      sameSite: (this.crossSite ? 'none' : 'lax') as 'none' | 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    };
  }

  // Short-lived cookie used only during the OAuth exchange window.
  // 60 seconds is enough for the frontend callback page to call /auth/token/exchange.
  private get oauthCookieOptions() {
    return {
      httpOnly: true,
      secure: this.crossSite,
      sameSite: (this.crossSite ? 'none' : 'lax') as 'none' | 'lax',
      path: '/',
      maxAge: 60 * 1000,
    };
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 3 } })  // 3 registrations per minute
  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken } = await this.authService.register(dto);
    res.cookie(REFRESH_COOKIE, refreshToken, this.cookieOptions);
    return { accessToken };
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })  // 5 login attempts per minute
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken } = await this.authService.login(
      dto.email,
      dto.password,
    );
    res.cookie(REFRESH_COOKIE, refreshToken, this.cookieOptions);
    return { accessToken };
  }

  @Public()
  @UseGuards(JwtRefreshGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @CurrentUser() user: User,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawRefreshToken = req.cookies?.[REFRESH_COOKIE];
    const { accessToken, refreshToken } = await this.authService.refresh(
      user.id,
      rawRefreshToken,
    );
    res.cookie(REFRESH_COOKIE, refreshToken, this.cookieOptions);
    return { accessToken };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawRefreshToken = req.cookies?.[REFRESH_COOKIE];
    if (rawRefreshToken) {
      await this.authService.logout(rawRefreshToken);
    }
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
  }

  @Public()
  @Throttle({ default: { ttl: 3600000, limit: 10 } })
  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.authService.verifyEmail(dto.token);
  }

  @Throttle({ default: { ttl: 3600000, limit: 3 } })  // 3 resends per hour
  @Post('resend-verification')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resendVerification(@CurrentUser() user: User) {
    await this.authService.resendVerificationEmail(user.id);
  }

  @Public()
  @Throttle({ default: { ttl: 3600000, limit: 3 } })  // 3 requests per hour
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.requestPasswordReset(dto.email);
  }

  @Public()
  @Throttle({ default: { ttl: 3600000, limit: 5 } })  // 5 attempts per hour
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.password);
  }

  @Public()
  @Throttle({ default: { ttl: 3600000, limit: 5 } })  // 5 requests per hour per IP
  @Post('magic-link')
  @HttpCode(HttpStatus.NO_CONTENT)
  async requestMagicLink(@Body() dto: MagicLinkRequestDto) {
    await this.authService.requestMagicLink(dto.email);
  }

  @Public()
  @Throttle({ default: { ttl: 3600000, limit: 10 } })  // 10 attempts per hour
  @Post('magic-link/verify')
  @HttpCode(HttpStatus.OK)
  async verifyMagicLink(
    @Body() dto: MagicLinkVerifyDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken } = await this.authService.consumeMagicLink(dto.token);
    res.cookie(REFRESH_COOKIE, refreshToken, this.cookieOptions);
    return { accessToken };
  }

  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleAuth() {
    // Redirected by Passport to Google
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleCallback(
    @CurrentUser() user: User,
    @Res() res: Response,
  ) {
    const { accessToken, refreshToken } = await this.authService.generateTokenPair(user);
    res.cookie(REFRESH_COOKIE, refreshToken, { ...this.cookieOptions, path: '/' });

    // Store the access token in a short-lived httpOnly cookie so it is never
    // visible in the redirect URL. A one-time nonce is appended to the redirect
    // fragment (#state=<nonce>) and stored in Redis for 60 s. The frontend reads
    // the nonce from window.location.hash and POSTs it to /auth/token/exchange,
    // which verifies + deletes the Redis key before returning the token — preventing
    // any unauthenticated caller (XSS, other tab) from consuming the cookie without
    // possession of the nonce.
    const nonce = randomBytes(32).toString('hex');
    await this.redis.set(`oauth_nonce:${nonce}`, '1', 'EX', OAUTH_NONCE_TTL_S);
    res.cookie(OAUTH_EXCHANGE_COOKIE, accessToken, this.oauthCookieOptions);
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:4200');
    res.redirect(`${frontendUrl}/auth/callback#state=${nonce}`);
  }

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('token/exchange')
  @HttpCode(HttpStatus.OK)
  async exchangeOAuthToken(
    @Body() dto: ExchangeTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const nonceKey = `oauth_nonce:${dto.nonce}`;
    // Atomic getdel: verifies existence and deletes in one round-trip (one-time use)
    const valid = await this.redis.getdel(nonceKey);
    if (!valid) {
      throw new UnauthorizedException('Invalid or expired OAuth nonce');
    }

    const token = req.cookies?.[OAUTH_EXCHANGE_COOKIE] as string | undefined;
    if (!token) {
      throw new UnauthorizedException('OAuth exchange token not found or expired');
    }
    res.clearCookie(OAUTH_EXCHANGE_COOKIE, { path: '/' });
    return { accessToken: token };
  }
}
