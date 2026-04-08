import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import * as compression from 'compression';
import * as bodyParser from 'body-parser';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  const config = app.get(ConfigService);
  const port = parseInt(process.env.PORT || '3000', 10);
  const origins = config.get<string[]>('cors.origins', ['http://localhost:3001']);

  // ── Security ──────────────────────────────────────────────
  app.use(helmet());
  app.use(compression());
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
  app.enableCors({ origin: origins, credentials: true });

  // ── Global prefix ─────────────────────────────────────────
  app.setGlobalPrefix('api', { exclude: ['health'] });

  // ── Pipes, Filters, Interceptors ──────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: false,           // allow unknown properties for sync endpoints
      forbidNonWhitelisted: false, // don't throw on unknown properties
      transform: true,           // auto-transform payloads to DTO classes
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new TransformInterceptor(),
  );

  // ── Swagger API docs ──────────────────────────────────────
  const swaggerConfig = new DocumentBuilder()
    .setTitle('IEA Growth Intelligence API')
    .setDescription('IEA Growth Intelligence — Commercial Intelligence & Growth System')
    .setVersion('1.0.0')
    .addBearerAuth()
    .addTag('Auth', 'Authentication endpoints')
    .addTag('Users', 'User management')
    .addTag('Vehicles', 'Vehicle fleet management')
    .addTag('Trips', 'Trip planning and tracking')
    .addTag('GPS', 'Real-time GPS tracking')
    .addTag('Fuel', 'Fuel consumption logs')
    .addTag('Odometer', 'Odometer readings')
    .addTag('Dashboard', 'Dashboard KPIs and activity')
    .addTag('Health', 'System health checks')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  // ── Graceful shutdown ─────────────────────────────────────
  app.enableShutdownHooks();

  await app.listen(port);

  logger.log(`IEA Growth Intelligence running on http://localhost:${port}`);
  logger.log(`Swagger docs at http://localhost:${port}/api/docs`);
  logger.log(`Health check at http://localhost:${port}/health`);
}

bootstrap();
