// File: server/src/controllers/leaseControllers.ts

import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import fs from "fs";

const prisma = new PrismaClient();

/**
 * GET /leases
 * Returns all leases (with tenant + property included).
 */
export const getLeases = async (req: Request, res: Response): Promise<void> => {
  try {
    const leases = await prisma.lease.findMany({
      include: {
        tenant: true,
        property: true,
      },
    });
    res.status(200).json(leases);
  } catch (error: any) {
    console.error("Error retrieving leases:", error);
    res
      .status(500)
      .json({ message: "Internal server error retrieving leases." });
  }
};

/**
 * GET /leases/:id/payments
 * Returns all payments for a single lease ID.
 */
export const getLeasePayments = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const leaseId = Number(req.params.id);
    if (isNaN(leaseId)) {
      res.status(400).json({ message: "Invalid lease ID." });
      return;
    }

    const payments = await prisma.payment.findMany({
      where: { leaseId },
    });
    res.status(200).json(payments);
  } catch (error: any) {
    console.error("Error retrieving lease payments:", error);
    res
      .status(500)
      .json({ message: "Internal server error retrieving lease payments." });
  }
};

/**
 * GET /properties/:id/leases
 * Returns all leases for a given property ID (including tenant & property).
 */
export const getLeasesByPropertyId = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    // The route is defined as “/:id/leases”, so we read req.params.id
    const propertyId = Number(req.params.id);
    if (isNaN(propertyId)) {
      res.status(400).json({ message: "Invalid propertyId." });
      return;
    }

    const leases = await prisma.lease.findMany({
      where: { propertyId },
      include: {
        tenant: true,
        property: true,
      },
    });

    res.status(200).json(leases);
  } catch (error: any) {
    console.error("Error retrieving leases by property ID:", error);
    res
      .status(500)
      .json({ message: "Internal server error retrieving leases by property ID." });
  }
};

export const downloadAgreement = async (
  req: Request,
  res: Response
): Promise<void> => {
  const leaseId = Number(req.params.id);
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    select: { agreementPath: true },
  });

  if (!lease?.agreementPath || !fs.existsSync(lease.agreementPath)) {
    res.status(404).json({ error: "Lease agreement not found" });
    return;
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=lease_agreement_${leaseId}.pdf`
  );

  fs.createReadStream(lease.agreementPath).pipe(res);
};