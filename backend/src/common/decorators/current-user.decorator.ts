import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extract the authenticated user from the request.
 * @example handler(@CurrentUser() user: JwtPayload)
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    return ctx.switchToHttp().getRequest().user;
  },
);
