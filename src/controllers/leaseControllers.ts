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
        property: true, // Include property details if needed
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

    // Title
    doc
      .fontSize(20)
      .text("PROPERTY MANAGER & INVESTOR AGREEMENT", { align: "center" });
    doc.moveDown(2);

    // Effective Date
    doc
      .fontSize(12)
      .text(
        `This Agreement is made as of ${new Date().toLocaleDateString()} (the “Effective Date”), by and between:`,
        { align: "left" }
      );
    doc.moveDown();

    // Parties
    doc
      .fontSize(12)
      .text(
        `Investor:\n  Name: ${lease.tenant.name}\n  Name: ${lease.property.name}`
      )
      .moveDown()
      .text(
        `Manager:\n  Name: ${"Miles Home"}\n  Email: ${"milestonesrealstates@gmail.com"}`
      )
      .moveDown(2);

    // Recitals
    doc.fontSize(14).text("1. RECITALS", { underline: true }).moveDown(0.5);
    doc
      .fontSize(12)
      .text(
        `1.1 Property. Investor is the sole owner of the real property located at:`
      )
      .text(`${lease.property.description}`)
      .text(`Property: ${lease.property.propertyType}`)
      .text(`Amount: ${lease.property.pricePerMonth}`,  { indent: 20 })
      .moveDown(0.5)
      .text(
        `1.2 Engagement. Investor wishes to engage Manager to manage, operate and maintain the Property, and Manager agrees to provide such services under the terms of this Agreement.`
      )
      .moveDown(1.5);

    // Definitions
    doc.fontSize(14).text("2. DEFINITIONS", { underline: true }).moveDown(0.5);
    doc
      .fontSize(12)
      .list(
        [
          `“Gross Revenue” means all rents, fees and other income derived from the Property.`,
          `“Net Operating Income (NOI)” means Gross Revenue minus all operating expenses.`,
          `“Management Fee” means the fee payable to Manager as described in Section 4.`,
          `“Term” means the period during which this Agreement remains in effect (see Section 6).`,
        ],
        { bulletRadius: 2 }
      )
      .moveDown(1.5);

    // Manager’s Duties
    doc
      .fontSize(14)
      .text("3. MANAGER’S DUTIES", { underline: true })
      .moveDown(0.5);
    doc
      .fontSize(12)
      .text(
        "Manager shall, at Manager’s expense, faithfully and to the best of its ability:",
        { continued: false }
      )
      .moveDown(0.5)
      .list(
        [
          `Leasing & Marketing:
            • Advertise and show the Property.
            • Screen, approve and execute leases with tenants.`,
          `Rent Collection & Accounting:
            • Collect all rents and deposits, issue receipts.
            • Maintain accurate books and records; provide monthly statements.`,
          `Maintenance & Repairs:
            • Oversee routine maintenance, emergency repairs, and preventive upkeep.
            • Obtain Investor’s approval for repairs exceeding $________.`,
          `Compliance & Insurance:
            • Ensure compliance with all laws, codes and HOA rules.
            • Maintain insurance policies as directed by Investor.`,
          `Tenant Relations:
            • Handle tenant communications, disputes and evictions if necessary.`,
        ],
        { bulletRadius: 2 }
      )
      .moveDown(1.5);

    // Compensation
    doc.fontSize(14).text("4. COMPENSATION", { underline: true }).moveDown(0.5);
    doc
      .fontSize(12)
      .text(
        "4.1 Management Fee. Investor shall pay Manager a monthly fee equal to ___% of Gross Revenue, payable by the ___ day of each month."
      )
      .moveDown(0.5)
      .text(
        "4.2 Leasing Fee. For each new lease executed by Manager, Investor shall pay a leasing fee of ___% of the first year’s gross rent."
      )
      .moveDown(0.5)
      .text(
        "4.3 Reimbursement of Expenses. Investor shall promptly reimburse Manager for all reasonable out-of-pocket expenses incurred in the performance of its duties (e.g. maintenance, advertising, legal)."
      )
      .moveDown(1.5);

    // Investor’s Duties
    doc
      .fontSize(14)
      .text("5. INVESTOR’S DUTIES", { underline: true })
      .moveDown(0.5);
    doc
      .fontSize(12)
      .list(
        [
          "Provide Manager with funds necessary to operate the Property (e.g. for repairs, taxes, insurance) as approved.",
          "Maintain valid title to the Property and insurance coverage.",
          "Cooperate with Manager and promptly approve or decline any recommended repairs or capital improvements.",
        ],
        { bulletRadius: 2 }
      )
      .moveDown(1.5);

    // Term & Termination
    doc
      .fontSize(14)
      .text("6. TERM & TERMINATION", { underline: true })
      .moveDown(0.5);
    doc
      .fontSize(12)
      .text(
        "6.1 Term. This Agreement shall commence on the Effective Date and continue for ___ years, then renew automatically for successive ___-year terms unless terminated."
      )
      .moveDown(0.5)
      .text(
        "6.2 Termination for Convenience. Either Party may terminate on ___ days’ prior written notice."
      )
      .moveDown(0.5)
      .text(
        "6.3 Termination for Cause. Either Party may terminate immediately upon breach that is not cured within ___ days of written notice."
      )
      .moveDown(1.5);

    // (Continue with sections 7–12 in the same pattern…)

    // Signatures
    doc
      .moveDown(2)
      .text(
        "IN WITNESS WHEREOF, the Parties hereto have executed this Agreement as of the Effective Date."
      )
      .moveDown(2)
      .text(
        `Investor${
          lease.tenant.name
        }: ____________________________          Date:${lease.startDate.toLocaleDateString()})`
      )
      .moveDown(1)
      .text(
        `Manager: Miles Home LTD          Date: ${lease.startDate.toLocaleDateString()})`
      );

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
