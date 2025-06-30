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

    res.status(201).json(newPayment);
  } catch (error: any) {
    console.error("Error creating payment:", error);
    res
      .status(500)
      .json({ message: "Internal server error creating payment." });
  }
  return;
};

/**
 * POST /payments/deposit-request
 * Tenant creates a deposit request (pending approval).
 */
export const createDepositRequest = async (
  req: Request,
  res: Response
): Promise<void> => {
  const tenantCognitoId = req.user?.id;
  if (!tenantCognitoId) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  // only pull leaseId and amount
  const { leaseId, amount } = req.body as {
    leaseId?: number;
    amount?: number;
  };

  // tighten the guard: null/undefined or ≤0 are invalid
  if (leaseId == null || leaseId <= 0 || amount == null || amount <= 0) {
    res.status(400).json({ message: "leaseId and amount required" });
    return;
  }

  const lease = await prisma.lease.findUnique({ where: { id: leaseId } });
  if (!lease || lease.tenantCognitoId !== tenantCognitoId) {
    res
      .status(400)
      .json({ message: "Lease not found or does not belong to you" });
    return;
  }

  try {
    const deposit = await prisma.payment.create({
      data: {
        leaseId,
        amountDue: amount,
        amountPaid: 0,
        dueDate: new Date(),
        paymentDate: new Date(),
        paymentStatus: "Pending",
        type: "Deposit",
        isApproved: false,
        tenantCognitoId,
      },
    });
    res.status(201).json(deposit);
  } catch (err: any) {
    console.error("Error creating deposit request:", err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * GET /payments/deposits/pending
 * Manager lists all deposit requests awaiting approval.
 */
export const listPendingDeposits = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const deposits = await prisma.payment.findMany({
      where: { type: "Deposit", isApproved: false },
      include: { lease: { include: { tenant: true } } },
    });
    res.json(deposits);
  } catch (err: any) {
    console.error("Error listing pending deposits:", err);
    res.status(500).json({ message: err.message });
  }
  return;
};

/**
 * PUT /payments/deposits/:id/approve
 * Manager approves a deposit: mark paid + credit tenant balance.
 */
export const approveDeposit = async (
  req: Request,
  res: Response
): Promise<void> => {
  const id = Number(req.params.id);
  try {
    const p = await prisma.payment.findUnique({ where: { id } });
    if (!p) {
      res.status(404).json({ message: "Deposit not found" });
      return;
    }

    // ---- NEW: Make sure there _is_ a leaseId and it's not null ----
    if (p.leaseId == null) {
      res.status(400).json({ message: "Invalid deposit: no lease associated" });
      return;
    }

    const lease = await prisma.lease.findUnique({ where: { id: p.leaseId } });
    if (!lease) {
      res.status(404).json({ message: "Lease not found" });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // mark approved
      await tx.payment.update({
        where: { id },
        data: {
          isApproved: true,
          paymentStatus: "Paid",
          amountPaid: p.amountDue,
        },
      });
      // credit tenant
      const tenant = await tx.tenant.findUnique({
        where: { cognitoId: lease.tenantCognitoId },
      });
      if (tenant) {
        await tx.tenant.update({
          where: { cognitoId: tenant.cognitoId },
          data: { balance: tenant.balance + p.amountDue },
        });
      }
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error("Error approving deposit:", err);
    res.status(500).json({ message: err.message });
  }
  return;
};

/**
 * PUT /payments/deposits/:id/decline
 * Manager declines a deposit: just flag it back to Pending.
 */
export const declineDeposit = async (
  req: Request,
  res: Response
): Promise<void> => {
  const id = Number(req.params.id);
  try {
    await prisma.payment.update({
      where: { id },
      data: { paymentStatus: "Pending" },
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error("Error declining deposit:", err);
    res.status(500).json({ message: err.message });
  }
  return;
};

/**
 * POST /payments/withdraw
 * Tenant withdraws funds if eligible.
 */
export const withdrawFunds = async (
  req: Request,
  res: Response
): Promise<void> => {
  const tenantCognitoId = req.user?.id;
  if (!tenantCognitoId) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  // Extract the new fields
  const { amount, destinationType, destinationDetails } = req.body as {
    amount: number;
    destinationType: "BankTransfer" | "Crypto";
    destinationDetails: string;
  };

  if (amount <= 0 || !destinationType || !destinationDetails) {
    res
      .status(400)
      .json({
        message: "amount, destinationType, and destinationDetails are required",
      });
    return;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { cognitoId: tenantCognitoId },
  });
  if (!tenant || tenant.balance < amount) {
    res.status(400).json({ message: "Insufficient funds" });
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { cognitoId: tenantCognitoId },
        data: { balance: tenant.balance - amount },
      });
      await tx.payment.create({
        data: {
          leaseId: null,
          amountDue: 0,
          amountPaid: amount,
          dueDate: new Date(),
          paymentDate: new Date(),
          paymentStatus: "Paid",
          type: "Withdrawal",
          isApproved: true,
          destinationType,
          destinationDetails,
          tenantCognitoId,
        },
      });
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error("Error withdrawing funds:", err);
    res.status(500).json({ message: err.message });
  }
};

/**
 * POST /tenants/:cognitoId/fund
 * Manager manually tops-up tenant.
 */
export const fundTenant = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { cognitoId } = req.params;
  const { amount } = req.body as { amount: number };

  if (amount <= 0) {
    res.status(400).json({ message: "Invalid amount" });
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { cognitoId } });
      if (!tenant) {
        throw new Error("Tenant not found");
      }
      await tx.tenant.update({
        where: { cognitoId },
        data: { balance: tenant.balance + amount },
      });
      await tx.payment.create({
        data: {
          leaseId: null,
          amountDue: 0,
          amountPaid: amount,
          dueDate: new Date(),
          paymentDate: new Date(),
          paymentStatus: "Paid",
          type: "Deposit",
          isApproved: true,
        },
      });
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error("Error funding tenant:", err);
    res.status(500).json({ message: err.message });
  }
  return;
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
      where: { tenantCognitoId },
      include: { lease: { include: { property: true } } },
      orderBy: { paymentDate: "desc" },
    });
    res.status(200).json(payments);
  } catch (error: any) {
    console.error("Error retrieving tenant payments:", error);
    res
      .status(500)
      .json({ message: "Internal server error retrieving tenant payments." });
  }
  return;
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
      .text(`${payment.lease!.tenant.name}`)
      .text(`${payment.lease!.tenant.email}`)
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
