// File: server/prisma/seed.ts

import { PrismaClient, Amenity, Highlight, PropertyType } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";
import { z } from "zod";

const prisma = new PrismaClient();

/** 1. Zod Schemas to validate JSON format **/
const locationSchema = z.object({
  id: z.number().int().positive(),
  address: z.string(),
  city: z.string(),
  state: z.string(),
  country: z.string(),
  postalCode: z.string(),
  coordinates: z.string(), // WKT text
});
type LocationRecord = z.infer<typeof locationSchema>;

const managerSchema = z.object({
  id: z.number().int().positive(),
  cognitoId: z.string().min(1),
  name: z.string(),
  email: z.string().email(),
  phoneNumber: z.string(),
});
type ManagerRecord = z.infer<typeof managerSchema>;

const tenantSchema = z.object({
  id: z.number().int().positive(),
  cognitoId: z.string().min(1),
  name: z.string(),
  email: z.string().email(),
  phoneNumber: z.string(),
});
type TenantRecord = z.infer<typeof tenantSchema>;

const propertySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  description: z.string(),
  pricePerMonth: z.number().nonnegative(),
  securityDeposit: z.number().nonnegative(),
  applicationFee: z.number().nonnegative(),
  photoUrls: z.array(z.string()),
  amenities: z.array(z.string()),
  highlights: z.array(z.string()),
  isPetsAllowed: z.boolean(),
  isParkingIncluded: z.boolean(),
  beds: z.number().int().nonnegative(),
  baths: z.number().nonnegative(),
  squareFeet: z.number().int().nonnegative(),
  propertyType: z.string(),
  postedDate: z
    .string()
    .refine((s) => !isNaN(Date.parse(s)), { message: "Invalid ISO date" }),
  averageRating: z.number().optional(),
  numberOfReviews: z.number().optional(),
  locationId: z.number().int().positive(),
  managerCognitoId: z.string().min(1),
});
type PropertyRecord = z.infer<typeof propertySchema>;

const leaseSchema = z.object({
  id: z.number().int().positive(),
  startDate: z
    .string()
    .refine((s) => !isNaN(Date.parse(s)), { message: "Invalid ISO date" }),
  endDate: z
    .string()
    .refine((s) => !isNaN(Date.parse(s)), { message: "Invalid ISO date" }),
  rent: z.number().nonnegative(),
  deposit: z.number().nonnegative(),
  propertyId: z.number().int().positive(),
  tenantCognitoId: z.string().min(1),
});
type LeaseRecord = z.infer<typeof leaseSchema>;

const applicationSchema = z.object({
  id: z.number().int().positive(),
  applicationDate: z
    .string()
    .refine((s) => !isNaN(Date.parse(s)), { message: "Invalid ISO date" }),
  status: z.union([
    z.literal("Pending"),
    z.literal("Denied"),
    z.literal("Approved"),
  ]),
  propertyId: z.number().int().positive(),
  tenantCognitoId: z.string().min(1),
  name: z.string(),
  email: z.string().email(),
  phoneNumber: z.string(),
  message: z.string().optional().nullable(),
  leaseId: z.number().int().positive().optional().nullable(),
});
type ApplicationRecord = z.infer<typeof applicationSchema>;

const paymentSchema = z.object({
  id: z.number().int().positive(),
  amountDue: z.number().nonnegative(),
  amountPaid: z.number().nonnegative(),
  dueDate: z
    .string()
    .refine((s) => !isNaN(Date.parse(s)), { message: "Invalid ISO date" }),
  paymentDate: z
    .string()
    .refine((s) => !isNaN(Date.parse(s)), { message: "Invalid ISO date" }),
  paymentStatus: z.union([
    z.literal("Pending"),
    z.literal("Paid"),
    z.literal("PartiallyPaid"),
    z.literal("Overdue"),
  ]),
  leaseId: z.number().int().positive(),
});
type PaymentRecord = z.infer<typeof paymentSchema>;

/** Helper to load & validate each JSON file **/
function loadJson<T>(filename: string, schema: z.ZodSchema<T>): T[] {
  const filePath = join(__dirname, "seedData", filename);
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err) {
    console.error(`Failed to read ${filename}:`, err);
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to parse ${filename}:`, err);
    process.exit(1);
  }

  if (!Array.isArray(parsed)) {
    console.error(`${filename} must be a JSON array.`);
    process.exit(1);
  }

  const validated: T[] = [];
  for (const item of parsed) {
    const result = schema.safeParse(item);
    if (!result.success) {
      console.error(`Validation error in ${filename} for item:`, item);
      console.error(result.error.format());
      process.exit(1);
    }
    validated.push(result.data);
  }
  return validated;
}

/** Helper: reset PostgreSQL sequence to match max(id)+1 **/
async function resetSequence(modelName: string) {
  // e.g. modelName = "Property" → table "Property"
  const quoted = `"${modelName}"`;
  const res = await (prisma as any)[modelName.toLowerCase()].findMany({
    select: { id: true },
    orderBy: { id: "desc" },
    take: 1,
  });
  if (!res.length) return;
  const nextId = res[0].id + 1;
  await prisma.$executeRaw`
    SELECT setval(
      pg_get_serial_sequence(${quoted}, 'id'),
      ${nextId},
      false
    );
  `;
  console.log(`Reset sequence for ${modelName} to ${nextId}`);
}

/** Delete data in exactly the reverse order of foreign-key dependencies **/
async function deleteAllData() {
  const modelsInOrder = [
    "Location",
    "Manager",
    "Tenant",
    "Property",
    "Lease",
    "Application",
    "Payment",
  ];
  for (const modelName of modelsInOrder.slice().reverse()) {
    const camel = modelName.charAt(0).toLowerCase() + modelName.slice(1);
    const model = (prisma as any)[camel];
    if (!model) {
      console.warn(`Model ${modelName} not found—skipping delete.`);
      continue;
    }
    try {
      await model.deleteMany({});
      console.log(`Cleared data from ${modelName}`);
    } catch (err) {
      console.error(`Error clearing data from ${modelName}:`, err);
    }
  }
}

async function main() {
  console.log("\n🚀 Starting seed…");

  // 1) Load & validate JSON arrays
  const locations = loadJson<LocationRecord>("location.json", locationSchema);
  const managers = loadJson<ManagerRecord>("manager.json", managerSchema);
  const tenants = loadJson<TenantRecord>("tenant.json", tenantSchema);
  const properties = loadJson<PropertyRecord>("property.json", propertySchema);
  const leases = loadJson<LeaseRecord>("lease.json", leaseSchema);
  const applications = loadJson<ApplicationRecord>(
    "application.json",
    applicationSchema
  );
  const payments = loadJson<PaymentRecord>("payment.json", paymentSchema);

  // 2) Wipe out everything in reverse‐dependency order
  await deleteAllData();

  // 3) Seed Locations (raw SQL so we can preserve explicit IDs & WKT)
  console.log(`\n🌐 Seeding ${locations.length} locations…`);
  for (const loc of locations) {
    try {
      await prisma.$executeRaw`
        INSERT INTO "Location" (
          id,
          address,
          city,
          state,
          country,
          "postalCode",
          coordinates
        )
        VALUES (
          ${loc.id},
          ${loc.address},
          ${loc.city},
          ${loc.state},
          ${loc.country},
          ${loc.postalCode},
          ST_GeomFromText(${loc.coordinates}, 4326)
        );
      `;
      console.log(`Inserted location for ${loc.city}`);
    } catch (err) {
      console.error(`Error inserting location for ${loc.city}:`, err);
    }
  }
  await resetSequence("Location");
  console.log("✅ Locations done.");

  // 4) Seed Managers
  console.log(`\n👤 Seeding ${managers.length} managers…`);
  for (const m of managers) {
    try {
      await prisma.manager.create({
        data: {
          id: m.id,
          cognitoId: m.cognitoId,
          name: m.name,
          email: m.email,
          phoneNumber: m.phoneNumber,
        },
      });
    } catch (err) {
      console.error(`Error creating manager ${m.cognitoId}:`, err);
    }
  }
  await resetSequence("Manager");
  console.log("✅ Managers done.");

  // 5) Seed Tenants (use upsert so we never violate unique constraint)
  console.log(`\n🏠 Seeding ${tenants.length} tenants…`);
  for (const t of tenants) {
    try {
      await prisma.tenant.upsert({
        where: { cognitoId: t.cognitoId },
        update: {}, // do nothing if found
        create: {
          id: t.id,
          cognitoId: t.cognitoId,
          name: t.name,
          email: t.email,
          phoneNumber: t.phoneNumber,
        },
      });
    } catch (err) {
      console.error(`Error upserting tenant ${t.cognitoId}:`, err);
    }
  }
  await resetSequence("Tenant");
  console.log("✅ Tenants done.");

  // 6) Prepare enum‐validation arrays
  const validAmenities = Object.values(Amenity);
  const validHighlights = Object.values(Highlight);

  // 7) Seed Properties
  console.log(`\n🏢 Seeding ${properties.length} properties…`);
  for (const p of properties) {
    // a) Check manager exists
    const managerExists = await prisma.manager.findUnique({
      where: { cognitoId: p.managerCognitoId },
    });
    if (!managerExists) {
      console.warn(
        `Skipping property ID ${p.id}: managerCognitoId="${p.managerCognitoId}" not found.`
      );
      continue;
    }

    // b) Check location exists
    const locationExists = await prisma.location.findUnique({
      where: { id: p.locationId },
    });
    if (!locationExists) {
      console.warn(
        `Skipping property ID ${p.id}: locationId=${p.locationId} not found.`
      );
      continue;
    }

    // c) Filter and validate amenities
    const filteredAmenities: Amenity[] = [];
    for (const a of p.amenities) {
      if (validAmenities.includes(a as Amenity)) {
        filteredAmenities.push(a as Amenity);
      } else {
        console.warn(
          `Property ID ${p.id} – invalid amenity value "${a}" (will be dropped).`
        );
      }
    }

    // d) Filter and validate highlights
    const filteredHighlights: Highlight[] = [];
    for (const h of p.highlights) {
      if (validHighlights.includes(h as Highlight)) {
        filteredHighlights.push(h as Highlight);
      } else {
        console.warn(
          `Property ID ${p.id} – invalid highlight value "${h}" (will be dropped).`
        );
      }
    }

    // e) Create the property
    try {
      await prisma.property.create({
        data: {
          id: p.id,
          name: p.name,
          description: p.description,
          pricePerMonth: p.pricePerMonth,
          securityDeposit: p.securityDeposit,
          applicationFee: p.applicationFee,
          photoUrls: p.photoUrls,
          amenities: filteredAmenities,
          highlights: filteredHighlights,
          isPetsAllowed: p.isPetsAllowed,
          isParkingIncluded: p.isParkingIncluded,
          beds: p.beds,
          baths: p.baths,
          squareFeet: p.squareFeet,
          propertyType: p.propertyType as PropertyType,
          postedDate: new Date(p.postedDate),
          averageRating: p.averageRating,
          numberOfReviews: p.numberOfReviews,
          locationId: p.locationId,
          managerCognitoId: p.managerCognitoId,
        },
      });
    } catch (err) {
      console.error(`Error creating property ID ${p.id}:`, err);
    }
  }
  await resetSequence("Property");
  console.log("✅ Properties done.");

  // f) Print all inserted property IDs for debugging
  const allProperties = await prisma.property.findMany({
    select: { id: true },
  });
  console.log(
    "→ Inserted property IDs:",
    allProperties.map((x) => x.id).join(", ")
  );

  // 8) Seed Leases
  console.log(`\n🔑 Seeding ${leases.length} leases…`);
  for (const l of leases) {
    // Check property exists
    const propertyExists = await prisma.property.findUnique({
      where: { id: l.propertyId },
    });
    if (!propertyExists) {
      console.warn(
        `Skipping lease ID ${l.id}: propertyId=${l.propertyId} not found.`
      );
      continue;
    }

    // Check tenant exists
    const tenantExists = await prisma.tenant.findUnique({
      where: { cognitoId: l.tenantCognitoId },
    });
    if (!tenantExists) {
      console.warn(
        `Skipping lease ID ${l.id}: tenantCognitoId="${l.tenantCognitoId}" not found.`
      );
      continue;
    }

    // Create the lease
    try {
      await prisma.lease.create({
        data: {
          id: l.id,
          startDate: new Date(l.startDate),
          endDate: new Date(l.endDate),
          rent: l.rent,
          deposit: l.deposit,
          propertyId: l.propertyId,
          tenantCognitoId: l.tenantCognitoId,
        },
      });
    } catch (err) {
      console.error(`Error creating lease ID ${l.id}:`, err);
    }
  }
  await resetSequence("Lease");
  console.log("✅ Leases done.");

  // 9) Seed Applications
  console.log(`\n📄 Seeding ${applications.length} applications…`);
  for (const a of applications) {
    // Check FK references similarly (propertyId, tenantCognitoId, leaseId) if needed…
    try {
      await prisma.application.create({
        data: {
          id: a.id,
          applicationDate: new Date(a.applicationDate),
          status: a.status,
          propertyId: a.propertyId,
          tenantCognitoId: a.tenantCognitoId,
          name: a.name,
          email: a.email,
          phoneNumber: a.phoneNumber,
          message: a.message,
          leaseId: a.leaseId,
        },
      });
    } catch (err) {
      console.error(`Error creating application ID ${a.id}:`, err);
    }
  }
  await resetSequence("Application");
  console.log("✅ Applications done.");

  // 10) Seed Payments
  console.log(`\n💳 Seeding ${payments.length} payments…`);
  for (const p of payments) {
    // Check that the referenced leaseId exists
    const leaseExists = await prisma.lease.findUnique({
      where: { id: p.leaseId },
    });
    if (!leaseExists) {
      console.warn(
        `Skipping payment ID ${p.id}: leaseId=${p.leaseId} not found.`
      );
      continue;
    }
    try {
      await prisma.payment.create({
        data: {
          id: p.id,
          amountDue: p.amountDue,
          amountPaid: p.amountPaid,
          dueDate: new Date(p.dueDate),
          paymentDate: new Date(p.paymentDate),
          paymentStatus: p.paymentStatus,
          leaseId: p.leaseId,
        },
      });
    } catch (err) {
      console.error(`Error creating payment ID ${p.id}:`, err);
    }
  }
  await resetSequence("Payment");
  console.log("✅ Payments done.");

  console.log("\n🎉 Seeding complete!");
}

main()
  .catch((e) => {
    console.error("Uncaught error in seed script:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
