// server/src/controllers/notificationControllers.ts
import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { sendEmail } from '../lib/emailService';

const prisma = new PrismaClient();

/**
 * Send email to all tenants. Only managers can access.
 */
export const sendEmailToAll = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { subject, message } = req.body;
  try {
    const tenants = await prisma.tenant.findMany({ select: { email: true } });
    await Promise.all(
      tenants.map((t) =>
        sendEmail({
          to: t.email,
          subject,
          text: message,
        })
      )
    );
    res.status(200).json({ success: true });
  } catch (err: any) {
    console.error('sendEmailToAll error:', err);
    next(err);
  }
};

/**
 * Send email to a single user. Only managers can access.
 */
export const sendEmailToUser = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { email, subject, message } = req.body;
  try {
    await sendEmail({ to: email, subject, text: message });
    res.status(200).json({ success: true });
  } catch (err: any) {
    console.error('sendEmailToUser error:', err);
    next(err);
  }
};
