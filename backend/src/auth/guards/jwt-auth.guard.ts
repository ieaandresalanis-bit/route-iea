import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard that requires a valid JWT Bearer token.
 * Apply to controllers or individual routes with @UseGuards(JwtAuthGuard).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
