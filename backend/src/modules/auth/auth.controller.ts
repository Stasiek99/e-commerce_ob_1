import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { Throttle } from '@nestjs/throttler';

const REFRESH_COOKIE = 'refresh_token';
const IS_PROD = process.env.NODE_ENV === 'production';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: (IS_PROD ? 'none' : 'lax') as 'none' | 'lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 3 } })  // 3 registrations per minute
  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken } = await this.authService.register(dto);
    res.cookie(REFRESH_COOKIE, refreshToken, COOKIE_OPTIONS);
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
    res.cookie(REFRESH_COOKIE, refreshToken, COOKIE_OPTIONS);
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
    res.cookie(REFRESH_COOKIE, refreshToken, COOKIE_OPTIONS);
    return { accessToken };
  }

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
    res.cookie(REFRESH_COOKIE, refreshToken, { ...COOKIE_OPTIONS, path: '/' });
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:4200');
    res.redirect(`${frontendUrl}/auth/callback?token=${accessToken}`);
  }
}
