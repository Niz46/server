// File: server/src/controllers/paymentControllers.ts

import { Request, Response } from "express";
import PDFDocument from "pdfkit";
import { PrismaClient } from "@prisma/client";
import path from "path";
import fs from "fs";

const prisma = new PrismaClient();

const RECEIPTS_DIR = path.join(__dirname, "../../receipts");
if (!fs.existsSync(RECEIPTS_DIR)) fs.mkdirSync(RECEIPTS_DIR);

/**
 * POST /payments
 * Creates a new payment record tied to a given lease.
 * Expects JSON body with:
 *   • leaseId: number
 *   • amountDue: number
 *   • amountPaid: number
 *   • dueDate: string (ISO date)
 *   • paymentDate: string (ISO date)
 *
 * Only tenants may call this endpoint.
 */
export const createPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { leaseId, amountDue, amountPaid, dueDate, paymentDate } = req.body;

    const lease = await prisma.lease.findUnique({ where: { id: Number(leaseId) } });
    if (!lease) {
      res.status(400).json({ message: "Invalid leaseId." });
      return;
    }

    // Determine paymentStatus based on amountPaid vs amountDue
    let paymentStatus: "Paid" | "PartiallyPaid" | "Pending" | "Overdue" = "Pending";
    if (amountPaid >= amountDue) {
      paymentStatus = "Paid";
    } else if (amountPaid > 0 && amountPaid < amountDue) {
      paymentStatus = "PartiallyPaid";
    }

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

     // --- PDF generation starts here ---
    const receiptFilename = `receipt-${newPayment.id}.pdf`;
    const receiptPath = path.join(RECEIPTS_DIR, receiptFilename);

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const writeStream = fs.createWriteStream(receiptPath);
    doc.pipe(writeStream);

    // Simple receipt layout—customize as needed
    doc
      .fontSize(20)
      .text("Payment Receipt", { align: "center" })
      .moveDown(2);

    doc.fontSize(12).text(`Receipt #: ${newPayment.id}`);
    doc.text(`Date Paid: ${new Date(newPayment.paymentDate).toLocaleDateString()}`);
    doc.text(`Lease ID: ${newPayment.leaseId}`);
    doc.text(`Amount Due: $${newPayment.amountDue.toFixed(2)}`);
    doc.text(`Amount Paid: $${newPayment.amountPaid.toFixed(2)}`);
    doc.text(`Status: ${newPayment.paymentStatus}`);
    doc.moveDown();

    doc.text("Thank you for your payment.", { align: "center" });

    doc.end();

    // once the PDF is written, update the payment record
    writeStream.on("finish", async () => {
      console.log("📝 Receipt generated at:", receiptPath);
      await prisma.payment.update({
        where: { id: newPayment.id },
        data: { receiptPath }, 
      });
      // finally, return to client
      console.log("   Database updated with receiptPath")
      res.status(201).json(newPayment);
    });

    writeStream.on("error", (err) => {
      console.error("PDF write error:", err);
      // still respond with payment, but without receiptPath
      res.status(201).json(newPayment);
    });
    // --- PDF generation ends here ---

    res.status(201).json(newPayment);
  } catch (error: any) {
    console.error("Error creating payment:", error);
    res.status(500).json({ message: "Internal server error creating payment." });
  }
};

/**
 * GET /payments/tenant/:tenantCognitoId
 * Returns all payments (with lease info) for a given tenantCognitoId.
 * Both manager & tenant can access this.
 */
export const getPaymentsByTenant = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { tenantCognitoId } = req.params;
    // Find all payments where the lease’s tenantCognitoId matches
    const payments = await prisma.payment.findMany({
      where: {
        lease: { tenantCognitoId },
      },
      include: {
        lease: {
          include: {
            property: true,
          },
        },
      },
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
 * Downloads the receipt PDF for a given payment ID.
 * Only manager & tenant can access this.
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

    console.log(`→ downloadReceipt called for payment ${paymentId}`);
    console.log(`   stored receiptPath =`, payment?.receiptPath);

    if (!payment?.receiptPath || !fs.existsSync(payment.receiptPath)) {
      console.warn("   Receipt file missing on disk");
      res.status(404).json({ error: "Receipt not found" });
      return;
    }

    // stream it
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
