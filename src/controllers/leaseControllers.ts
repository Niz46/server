// File: server/src/controllers/leaseControllers.ts

import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import PDFDocument from "pdfkit";

const prisma = new PrismaClient();

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
 * Dynamically generates and streams a lease agreement PDF.
 */
export const downloadAgreement = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const leaseId = Number(req.params.id);
    if (isNaN(leaseId)) {
      res.status(400).json({ error: "Invalid lease ID." });
      return;
    }

    // Fetch lease details (including tenant and property if needed)
    const lease = await prisma.lease.findUnique({
      where: { id: leaseId },
      include: {
        tenant: true,
        property: {
          include: {
            location: true, // Include property location details
          }
        },
      },
    });

    if (!lease) {
      res.status(404).json({ error: "Lease not found." });
      return;
    }

    // Set headers for PDF download
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=lease_agreement_${leaseId}.pdf`
    );

    // Stream PDF directly
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);

    // Header
    doc.fontSize(18).text("Lease Agreement", { align: "center" }).moveDown();

    // Lease info
    doc
      .fontSize(12)
      .text(`Lease ID: ${lease.id}`)
      .text(`Property: ${lease.property.location.address}`)
      .text(`Tenant: ${lease.tenant.name} (${lease.tenant.cognitoId})`)
      .text(`Start Date: ${lease.startDate.toLocaleDateString()}`)
      .text(`End Date: ${lease.endDate.toLocaleDateString()}`)
      .moveDown();

    // Body placeholder
    doc
      .text(
        "This Lease Agreement is entered into between the Manager and the Tenant. " +
          "The Manager agrees to lease the property to the Tenant under the following terms and conditions...",
        { align: "justify" }
      )
      .moveDown();

    // Signature lines
    doc
      .moveDown(2)
      .text("__________________________", { continued: true })
      .text("    ")
      .text("__________________________")
      .text("   Manager Signature", { continued: true })
      .text("    ")
      .text("Tenant Signature");

    doc.end();
  } catch (err: any) {
    console.error("Error streaming agreement:", err);
    // If headers already sent, just end; otherwise send JSON
    if (!res.headersSent) {
      res.status(500).json({ error: "Server error generating agreement." });
    } else {
      res.end();
    }
  }
};
