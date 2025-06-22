// File: server/src/controllers/paymentControllers.ts

import { Request, Response } from "express";
import PDFDocument from "pdfkit";
import { PrismaClient } from "@prisma/client";
import path from "path";
import fs from "fs";
import { pipeline } from "stream/promises";

const prisma = new PrismaClient();

const RECEIPTS_DIR = path.join(__dirname, "../../receipts");
if (!fs.existsSync(RECEIPTS_DIR))
  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

/**
 * POST /payments
 * Creates a new payment record tied to a given lease, then generates and stores a PDF receipt.
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
    if (amountPaid >= amountDue) {
      paymentStatus = "Paid";
    } else if (amountPaid > 0) {
      paymentStatus = "PartiallyPaid";
    }

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

    // --- PDF generation ---
    const receiptFilename = `receipt-${newPayment.id}.pdf`;
    const receiptPath = path.join(RECEIPTS_DIR, receiptFilename);
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const writeStream = fs.createWriteStream(receiptPath);

    doc.pipe(writeStream);
    doc
      .fontSize(20)
      .text("Payment Receipt", { align: "center" })
      .moveDown(2)
      .fontSize(12)
      .text(`Receipt #: ${newPayment.id}`)
      .text(
        `Date Paid: ${new Date(newPayment.paymentDate).toLocaleDateString()}`
      )
      .text(`Lease ID: ${newPayment.leaseId}`)
      .text(`Amount Due: $${newPayment.amountDue.toFixed(2)}`)
      .text(`Amount Paid: $${newPayment.amountPaid.toFixed(2)}`)
      .text(`Status: ${newPayment.paymentStatus}`)
      .moveDown()
      .text("Thank you for your payment.", { align: "center" });
    doc.end();

    try {
      // Wait until PDF is fully written
      await pipeline(doc, writeStream);

      // Update DB with receipt path
      await prisma.payment.update({
        where: { id: newPayment.id },
        data: { receiptPath },
      });

      // Return full record including path
      res.status(201).json({ ...newPayment, receiptPath });
    } catch (pdfErr) {
      console.error("PDF generation failed:", pdfErr);
      // Even if PDF fails, return the payment record
      res.status(201).json(newPayment);
    }
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
 * Streams the PDF receipt for a given payment ID.
 */
export const downloadReceipt = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const paymentId = Number(req.params.id);
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      select: { receiptPath: true },
    });

    if (!payment?.receiptPath || !fs.existsSync(payment.receiptPath)) {
      res.status(404).json({ error: "Receipt not found" });
      return;
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=receipt_${paymentId}.pdf`
    );
    fs.createReadStream(payment.receiptPath).pipe(res);
  } catch (err) {
    console.error("Error in downloadReceipt:", err);
    res.status(500).json({ error: "Server error" });
  }
};
