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
    const { id } = req.params;
    const { status } = req.body;

    const app = await prisma.application.findUnique({
      where: { id: Number(id) },
      include: { property: true, tenant: true },
    });
    if (!app) {
      res.status(404).json({ message: "Application not found." });
      return;
    }

    if (status === "Approved") {
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
        },
      });

      await prisma.property.update({
        where: { id: app.propertyId },
        data: {
          tenants: { connect: { cognitoId: app.tenantCognitoId } },
        },
      });

      await prisma.application.update({
        where: { id: Number(id) },
        data: { status, leaseId: newLease.id },
      });
    } else {
      await prisma.application.update({
        where: { id: Number(id) },
        data: { status },
      });
    }

    const updatedApp = await prisma.application.findUnique({
      where: { id: Number(id) },
      include: { property: true, tenant: true, lease: true },
    });
    res.json(updatedApp);
    return;
  } catch (error: any) {
    console.error("Error updating status:", error);
    res
      .status(500)
      .json({ message: `Internal server error: ${error.message}` });
    return;
  }
};
