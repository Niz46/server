"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/lib/prismaClient.ts
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient({
    // optional: customize logging, error format, etc.
    errorFormat: process.env.NODE_ENV === 'development' ? 'pretty' : 'minimal',
});
exports.default = prisma;
