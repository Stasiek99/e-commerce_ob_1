import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  // Default handleRequest() throws err straight into Nest's exception filter,
  // which renders a bare JSON error — but this route's only other path is a
  // browser redirect, so a thrown error mid-redirect-chain shows raw JSON
  // instead of bouncing the user back into the app. Stash the error on the
  // request instead and let the controller redirect to a frontend error route.
  handleRequest<TUser = any>(
    err: unknown,
    user: TUser,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (err) {
      context.switchToHttp().getRequest().oauthError = err;
    }
    return user;
  }
}
