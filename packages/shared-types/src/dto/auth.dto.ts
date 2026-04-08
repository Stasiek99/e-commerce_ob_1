export interface RegisterDto {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface TokensDto {
  accessToken: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}
