// File: server/src/controllers/applicationControllers.ts

import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * GET /applications
 * List applications for a tenant or manager.
 */
export const listApplications = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { userId, userType } = req.query;
    let whereClause = {};

    if (userId && userType) {
      if (userType === "tenant") {
        whereClause = { tenantCognitoId: String(userId) };
      } else if (userType === "manager") {
        whereClause = {
          property: { managerCognitoId: String(userId) },
        };
      }
    }

    const applications = await prisma.application.findMany({
      where: whereClause,
      include: {
        property: { include: { location: true, manager: true } },
        tenant: true,
      },
    });

    function calculateNextPaymentDate(startDate: Date): Date {
      const today = new Date();
      const next = new Date(startDate);
      while (next <= today) {
        next.setMonth(next.getMonth() + 1);
      }
      return next;
    }

    const formatted = await Promise.all(
      applications.map(async (app) => {
        const lease = await prisma.lease.findFirst({
          where: {
            tenant: { cognitoId: app.tenantCognitoId },
            propertyId: app.propertyId,
          },
          orderBy: { startDate: "desc" },
        });

        return {
          ...app,
          property: {
            ...app.property,
            address: app.property.location.address,
          },
          manager: app.property.manager,
          lease: lease
            ? {
                ...lease,
                nextPaymentDate: calculateNextPaymentDate(lease.startDate),
              }
            : null,
        };
      })
    );

    res.json(formatted);
    return;
  } catch (error: any) {
    console.error("Error retrieving applications:", error);
    res
      .status(500)
      .json({ message: `Internal server error: ${error.message}` });
    return;
  }
};

/**
 * POST /applications
 * Create a new application (no lease/payment yet).
 */
export const createApplication = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      applicationDate,
      status,
      propertyId,
      tenantCognitoId,
      name,
      email,
      phoneNumber,
      message,
    } = req.body;

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
    });
    if (!property) {
      res.status(404).json({ message: "Property not found" });
      return;
    }

    const newApp = await prisma.application.create({
      data: {
        applicationDate: new Date(applicationDate),
        status,
        name,
        email,
        phoneNumber,
        message,
        property: { connect: { id: propertyId } },
        tenant: { connect: { cognitoId: tenantCognitoId } },
      },
      include: {
        property: true,
        tenant: true,
      },
    });

    res.status(201).json(newApp);
    return;
  } catch (error: any) {
    console.error("Error creating application:", error);
    res
      .status(500)
      .json({ message: `Internal server error: ${error.message}` });
    return;
  }
};

/**
 * PUT /applications/:id/status
 * Update application status.
 * If approving, create lease + initial Paid payment, attach tenant, then update app.
 */
export const updateApplicationStatus = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const applicationId = Number(req.params.id);
    const { status } = req.body;

    const app = await prisma.application.findUnique({
      where: { id: applicationId },
      include: { property: true, tenant: true },
    });
    if (!app) {
      res.status(404).json({ message: "Application not found." });
      return;
    }

    // If we're approving, try to debit from the tenant's wallet first
    if (status === "Approved") {
      // 1️⃣ load up‐to‐date tenant record
      const tenant = await prisma.tenant.findUnique({
        where: { cognitoId: app.tenantCognitoId },
      });

      // 2️⃣ debit if they have enough balance
      if (tenant && tenant.balance >= app.property.pricePerMonth) {
        await prisma.tenant.update({
          where: { cognitoId: tenant.cognitoId },
          data: {
            balance: tenant.balance - app.property.pricePerMonth,
          },
        });
      }
      // 3️⃣ create the lease and initial rent payment
      const newLease = await prisma.lease.create({
        data: {
          startDate: new Date(),
          endDate: new Date(
            new Date().setFullYear(new Date().getFullYear() + 1)
          ),
          rent: app.property.pricePerMonth,
          deposit: app.property.securityDeposit,
          propertyId: app.propertyId,
          tenantCognitoId: app.tenantCognitoId,
        },
      });

      await prisma.payment.create({
        data: {
          leaseId: newLease.id,
          amountDue: app.property.pricePerMonth,
          amountPaid: app.property.pricePerMonth,
          dueDate: new Date(),
          paymentDate: new Date(),
          paymentStatus: "Paid",
          type: "Rent",
          isApproved: true,
        },
      });

      // 4️⃣ attach tenant to property
      await prisma.property.update({
        where: { id: app.propertyId },
        data: {
          tenants: { connect: { cognitoId: app.tenantCognitoId } },
        },
      });

      // 5️⃣ update application record
      await prisma.application.update({
        where: { id: applicationId },
        data: { status, leaseId: newLease.id },
      });
    } else {
      // simply update status to Denied/Pending
      await prisma.application.update({
        where: { id: applicationId },
        data: { status },
      });
    }

    // return the new state
    const updatedApp = await prisma.application.findUnique({
      where: { id: applicationId },
      include: { property: true, tenant: true, lease: true },
    });
    res.json(updatedApp);
  } catch (error: any) {
    console.error("Error updating application status:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};
