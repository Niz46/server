// src/lib/prismaClient.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  // optional: customize logging, error format, etc.
  errorFormat: process.env.NODE_ENV === 'development' ? 'pretty' : 'minimal',
});

export default prisma;