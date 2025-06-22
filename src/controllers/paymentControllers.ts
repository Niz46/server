// server/src/controllers/paymentControllers.ts

import { Request, Response } from "express";
import PDFDocument from "pdfkit";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * POST /payments
 * Creates a new payment record tied to a given lease.
 * Only tenants may call this endpoint.
 */
export const createPayment = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { leaseId, amountDue, amountPaid, dueDate, paymentDate } = req.body;
    const lease = await prisma.lease.findUnique({
      where: { id: Number(leaseId) },
    });
    if (!lease) {
      res.status(400).json({ message: "Invalid leaseId." });
      return;
    }

    // Determine paymentStatus
    let paymentStatus: "Paid" | "PartiallyPaid" | "Pending" = "Pending";
    if (amountPaid >= amountDue) paymentStatus = "Paid";
    else if (amountPaid > 0) paymentStatus = "PartiallyPaid";

    // Create the payment record
    const newPayment = await prisma.payment.create({
      data: {
        leaseId: lease.id,
        amountDue: parseFloat(amountDue),
        amountPaid: parseFloat(amountPaid),
        dueDate: new Date(dueDate),
        paymentDate: new Date(paymentDate),
        paymentStatus,
      },
    });

    // Return the created payment immediately (receipt will be generated on GET)
    res.status(201).json(newPayment);
  } catch (error: any) {
    console.error("Error creating payment:", error);
    res
      .status(500)
      .json({ message: "Internal server error creating payment." });
  }
};
/**
 * GET /payments/tenant/:tenantCognitoId
 * Returns all payments (with lease info) for a given tenantCognitoId.
 */
export const getPaymentsByTenant = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { tenantCognitoId } = req.params;
    const payments = await prisma.payment.findMany({
      where: { lease: { tenantCognitoId } },
      include: { lease: { include: { property: true } } },
    });
    res.status(200).json(payments);
  } catch (error: any) {
    console.error("Error retrieving tenant payments:", error);
    res
      .status(500)
      .json({ message: "Internal server error retrieving tenant payments." });
  }
};

/**
 * GET /payments/:id/receipt
 * Streams a dynamically-generated PDF receipt for a given payment ID.
 */
export const downloadReceipt = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const paymentId = Number(req.params.id);
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        lease: {
          include: { property: true, tenant: true },
        },
      },
    });

    if (!payment) {
      res.status(404).json({ error: "Payment not found." });
      return;
    }

    // Set headers for PDF download
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=receipt_${paymentId}.pdf`
    );

    // Generate PDF in-memory and pipe to response
    // inside your downloadReceipt controller
    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      pdfVersion: "1.4",
      info: {
        Title: "Payment Receipt",
        Author: "Miles Home Real Estate",
        Subject: `Receipt for Payment #${payment.id}`,
      },
    });
    doc.pipe(res);

    // ── HEADER ──────────────────────────────────────────────────────────────────────
    // (If you have a logo, replace the text with:
    //    doc.image('/path/to/logo.png', { fit:[100,50], align:'left' });
    // )
    doc
      .fontSize(24)
      .font("Helvetica-Bold")
      .text("Miles Home Real Estate", { align: "left" });

    doc
      .fontSize(12)
      .font("Helvetica")
      .text(`Receipt #${payment.id}`, { align: "right" })
      .text(`Date: ${payment.paymentDate.toLocaleDateString("en-US")}`, {
        align: "right",
      })
      .moveDown(2);

    // ── BILL TO / CUSTOMER ──────────────────────────────────────────────────────────
    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .text("Bill To:", { continued: false })
      .moveDown(0.5)
      .fontSize(12)
      .font("Helvetica")
      .text(`${payment.lease.tenant.name}`)
      .text(`${payment.lease.tenant.email}`)
      .moveDown(1.5);

    // ── PAYMENT DETAILS TABLE ───────────────────────────────────────────────────────
    const tableTop = doc.y;
    const labelX = 50;
    const valueX = 300;

    // Column headers
    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("Description", labelX, tableTop)
      .text("Amount", valueX, tableTop)
      .moveDown(0.5);

    // Horizontal line
    doc.moveTo(labelX, doc.y).lineTo(550, doc.y).stroke().moveDown(0.5);

    // Rows
    const rows = [
      { desc: "Amount Paid", value: `$${payment.amountPaid.toFixed(2)}` },
      { desc: "Payment Status", value: payment.paymentStatus },
    ];

    rows.forEach((row) => {
      doc
        .font("Helvetica")
        .text(row.desc, labelX, doc.y)
        .text(row.value, valueX, doc.y, { width: 100, align: "right" })
        .moveDown(0.5);
    });

    // Totals line
    doc
      .moveTo(labelX, doc.y + 5)
      .lineTo(550, doc.y + 5)
      .stroke()
      .moveDown(1);

    // ── THANK YOU & FOOTER ─────────────────────────────────────────────────────────
    doc
      .fontSize(12)
      .font("Helvetica-Oblique")
      .text("Thank you for your business!", { align: "center" })
      .moveDown(2);

    // Signature line
    doc
      .font("Helvetica")
      .text("Miles Home LTD", labelX, doc.y)
      .text("Authorized Signature", labelX, doc.y + 15)
      .moveDown(1);

    // Optional: company contact in footer
    doc
      .fontSize(10)
      .font("Helvetica")
      .text(
        "Miles Home Real Estate • 123 Main St, Springfield • (144) 026-99164 • milestonesrealstates@gmail.com",
        50,
        780,
        { align: "center", width: 500 }
      );

    doc.end();
  } catch (err: any) {
    console.error("Error streaming receipt:", err);
    // If streaming fails mid-PDF, we can’t send JSON, so just close connection
    if (!res.headersSent) {
      res.status(500).json({ error: "Server error generating receipt." });
    } else {
      res.end();
    }
  }
};
