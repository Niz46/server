// File: server/src/controllers/leaseControllers.ts

import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs";
import { pipeline } from "stream/promises";

const prisma = new PrismaClient();

const AGREEMENTS_DIR = path.join(__dirname, "../../agreements");
if (!fs.existsSync(AGREEMENTS_DIR))
  fs.mkdirSync(AGREEMENTS_DIR, { recursive: true });

/**
 * GET /leases
 * Returns all leases (with tenant + property included).
 */
export const getLeases = async (req: Request, res: Response): Promise<void> => {
  try {
    const leases = await prisma.lease.findMany({
      include: { tenant: true, property: true },
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
    const payments = await prisma.payment.findMany({ where: { leaseId } });
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
 * Returns all leases for a given property ID.
 */
export const getLeasesByPropertyId = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const propertyId = Number(req.params.id);
    if (isNaN(propertyId)) {
      res.status(400).json({ message: "Invalid propertyId." });
      return;
    }
    const leases = await prisma.lease.findMany({
      where: { propertyId },
      include: { tenant: true, property: true },
    });
    res.status(200).json(leases);
  } catch (error: any) {
    console.error("Error retrieving leases by property ID:", error);
    res.status(500).json({
      message: "Internal server error retrieving leases by property ID.",
    });
  }
};

/**
 * GET /leases/:id/agreement
 * Generates (if needed) and streams the lease agreement PDF.
 */
export const downloadAgreement = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const leaseId = Number(req.params.id);
    const leaseRecord = await prisma.lease.findUnique({
      where: { id: leaseId },
      select: { agreementPath: true },
    });
    let agreementPath = leaseRecord?.agreementPath;

    // If not generated yet, create it
    if (!agreementPath || !fs.existsSync(agreementPath)) {
      agreementPath = path.join(AGREEMENTS_DIR, `lease-${leaseId}.pdf`);
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const ws = fs.createWriteStream(agreementPath);

      doc.pipe(ws);
      doc
        .fontSize(18)
        .text("Lease Agreement", { align: "center" })
        .moveDown()
        .fontSize(12)
        .text(`Lease ID: ${leaseId}`)
        .text(`Date: ${new Date().toLocaleDateString()}`)
        .moveDown()
        .text(
          "This lease agreement is between the property manager and the tenant...",
          {
            align: "justify",
          }
        );
      doc.end();

      await pipeline(doc, ws);
      await prisma.lease.update({
        where: { id: leaseId },
        data: { agreementPath },
      });
    }

    // Stream it back
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=lease_agreement_${leaseId}.pdf`
    );
    fs.createReadStream(agreementPath).pipe(res);
  } catch (err) {
    console.error("Error in downloadAgreement:", err);
    res.status(500).json({ error: "Server error downloading agreement." });
  }
};
