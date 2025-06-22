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
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);

    doc
      .fontSize(20)
      .text("Payment Receipt", { align: "center" })
      .moveDown(2)
      .fontSize(12)
      .text(`Receipt #: ${payment.id}`)
      .text(`Date Paid: ${payment.paymentDate.toLocaleDateString("en-US")}`)
      .text(`Lease ID: ${payment.leaseId}`)
      .text(`Amount Due: $${payment.amountDue.toFixed(2)}`)
      .text(`Amount Paid: $${payment.amountPaid.toFixed(2)}`)
      .text(`Status: ${payment.paymentStatus}`)
      .moveDown()
      .text("Thank you for your payment.", { align: "center" });

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
