import { Module } from '@nestjs/common';

// AdminJS is mounted as Express middleware in main.ts via setupAdmin().
// Dynamic import() is used there to load the ESM-only @adminjs/* packages.
@Module({})
export class AdminModule {}
