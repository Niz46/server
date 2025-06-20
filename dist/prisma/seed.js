"use strict";
// File: server/prisma/seed.ts
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const fs_1 = require("fs");
const path_1 = require("path");
const zod_1 = require("zod");
const prisma = new client_1.PrismaClient();
/** 1. Zod Schemas to validate JSON format **/
const locationSchema = zod_1.z.object({
    id: zod_1.z.number().int().positive(),
    address: zod_1.z.string(),
    city: zod_1.z.string(),
    state: zod_1.z.string(),
    country: zod_1.z.string(),
    postalCode: zod_1.z.string(),
    coordinates: zod_1.z.string(), // WKT text
});
const managerSchema = zod_1.z.object({
    id: zod_1.z.number().int().positive(),
    cognitoId: zod_1.z.string().min(1),
    name: zod_1.z.string(),
    email: zod_1.z.string().email(),
    phoneNumber: zod_1.z.string(),
});
const tenantSchema = zod_1.z.object({
    id: zod_1.z.number().int().positive(),
    cognitoId: zod_1.z.string().min(1),
    name: zod_1.z.string(),
    email: zod_1.z.string().email(),
    phoneNumber: zod_1.z.string(),
});
const propertySchema = zod_1.z.object({
    id: zod_1.z.number().int().positive(),
    name: zod_1.z.string(),
    description: zod_1.z.string(),
    pricePerMonth: zod_1.z.number().nonnegative(),
    securityDeposit: zod_1.z.number().nonnegative(),
    applicationFee: zod_1.z.number().nonnegative(),
    photoUrls: zod_1.z.array(zod_1.z.string()),
    amenities: zod_1.z.array(zod_1.z.string()),
    highlights: zod_1.z.array(zod_1.z.string()),
    isPetsAllowed: zod_1.z.boolean(),
    isParkingIncluded: zod_1.z.boolean(),
    beds: zod_1.z.number().int().nonnegative(),
    baths: zod_1.z.number().nonnegative(),
    squareFeet: zod_1.z.number().int().nonnegative(),
    propertyType: zod_1.z.string(),
    postedDate: zod_1.z.string().refine((s) => !isNaN(Date.parse(s)), { message: "Invalid ISO date" }),
    averageRating: zod_1.z.number().optional(),
    numberOfReviews: zod_1.z.number().optional(),
    locationId: zod_1.z.number().int().positive(),
    managerCognitoId: zod_1.z.string().min(1),
});
const leaseSchema = zod_1.z.object({
    id: zod_1.z.number().int().positive(),
    startDate: zod_1.z.string().refine((s) => !isNaN(Date.parse(s)), { message: "Invalid ISO date" }),
    endDate: zod_1.z.string().refine((s) => !isNaN(Date.parse(s)), { message: "Invalid ISO date" }),
    rent: zod_1.z.number().nonnegative(),
    deposit: zod_1.z.number().nonnegative(),
    propertyId: zod_1.z.number().int().positive(),
    tenantCognitoId: zod_1.z.string().min(1),
});
const applicationSchema = zod_1.z.object({
    id: zod_1.z.number().int().positive(),
    applicationDate: zod_1.z.string().refine((s) => !isNaN(Date.parse(s)), { message: "Invalid ISO date" }),
    status: zod_1.z.union([zod_1.z.literal("Pending"), zod_1.z.literal("Denied"), zod_1.z.literal("Approved")]),
    propertyId: zod_1.z.number().int().positive(),
    tenantCognitoId: zod_1.z.string().min(1),
    name: zod_1.z.string(),
    email: zod_1.z.string().email(),
    phoneNumber: zod_1.z.string(),
    message: zod_1.z.string().optional().nullable(),
    leaseId: zod_1.z.number().int().positive().optional().nullable(),
});
const paymentSchema = zod_1.z.object({
    id: zod_1.z.number().int().positive(),
    amountDue: zod_1.z.number().nonnegative(),
    amountPaid: zod_1.z.number().nonnegative(),
    dueDate: zod_1.z.string().refine((s) => !isNaN(Date.parse(s)), { message: "Invalid ISO date" }),
    paymentDate: zod_1.z.string().refine((s) => !isNaN(Date.parse(s)), { message: "Invalid ISO date" }),
    paymentStatus: zod_1.z.union([
        zod_1.z.literal("Pending"),
        zod_1.z.literal("Paid"),
        zod_1.z.literal("PartiallyPaid"),
        zod_1.z.literal("Overdue"),
    ]),
    leaseId: zod_1.z.number().int().positive(),
});
/** Helper to load & validate each JSON file **/
function loadJson(filename, schema) {
    const filePath = (0, path_1.join)(__dirname, "seedData", filename);
    let raw;
    try {
        raw = (0, fs_1.readFileSync)(filePath, "utf-8");
    }
    catch (err) {
        console.error(`Failed to read ${filename}:`, err);
        process.exit(1);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        console.error(`Failed to parse ${filename}:`, err);
        process.exit(1);
    }
    if (!Array.isArray(parsed)) {
        console.error(`${filename} must be a JSON array.`);
        process.exit(1);
    }
    const validated = [];
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
function resetSequence(modelName) {
    return __awaiter(this, void 0, void 0, function* () {
        // e.g. modelName = "Property" → table "Property"
        const quoted = `"${modelName}"`;
        const res = yield prisma[modelName.toLowerCase()].findMany({
            select: { id: true },
            orderBy: { id: "desc" },
            take: 1,
        });
        if (!res.length)
            return;
        const nextId = res[0].id + 1;
        yield prisma.$executeRaw `
    SELECT setval(
      pg_get_serial_sequence(${quoted}, 'id'),
      ${nextId},
      false
    );
  `;
        console.log(`Reset sequence for ${modelName} to ${nextId}`);
    });
}
/** Delete data in exactly the reverse order of foreign-key dependencies **/
function deleteAllData() {
    return __awaiter(this, void 0, void 0, function* () {
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
            const model = prisma[camel];
            if (!model) {
                console.warn(`Model ${modelName} not found—skipping delete.`);
                continue;
            }
            try {
                yield model.deleteMany({});
                console.log(`Cleared data from ${modelName}`);
            }
            catch (err) {
                console.error(`Error clearing data from ${modelName}:`, err);
            }
        }
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        console.log("\n🚀 Starting seed…");
        // 1) Load & validate JSON arrays
        const locations = loadJson("location.json", locationSchema);
        const managers = loadJson("manager.json", managerSchema);
        const tenants = loadJson("tenant.json", tenantSchema);
        const properties = loadJson("property.json", propertySchema);
        const leases = loadJson("lease.json", leaseSchema);
        const applications = loadJson("application.json", applicationSchema);
        const payments = loadJson("payment.json", paymentSchema);
        // 2) Wipe out everything in reverse‐dependency order
        yield deleteAllData();
        // 3) Seed Locations (raw SQL so we can preserve explicit IDs & WKT)
        console.log(`\n🌐 Seeding ${locations.length} locations…`);
        for (const loc of locations) {
            try {
                yield prisma.$executeRaw `
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
            }
            catch (err) {
                console.error(`Error inserting location for ${loc.city}:`, err);
            }
        }
        yield resetSequence("Location");
        console.log("✅ Locations done.");
        // 4) Seed Managers
        console.log(`\n👤 Seeding ${managers.length} managers…`);
        for (const m of managers) {
            try {
                yield prisma.manager.create({
                    data: {
                        id: m.id,
                        cognitoId: m.cognitoId,
                        name: m.name,
                        email: m.email,
                        phoneNumber: m.phoneNumber,
                    },
                });
            }
            catch (err) {
                console.error(`Error creating manager ${m.cognitoId}:`, err);
            }
        }
        yield resetSequence("Manager");
        console.log("✅ Managers done.");
        // 5) Seed Tenants (use upsert so we never violate unique constraint)
        console.log(`\n🏠 Seeding ${tenants.length} tenants…`);
        for (const t of tenants) {
            try {
                yield prisma.tenant.upsert({
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
            }
            catch (err) {
                console.error(`Error upserting tenant ${t.cognitoId}:`, err);
            }
        }
        yield resetSequence("Tenant");
        console.log("✅ Tenants done.");
        // 6) Prepare enum‐validation arrays
        const validAmenities = Object.values(client_1.Amenity);
        const validHighlights = Object.values(client_1.Highlight);
        // 7) Seed Properties
        console.log(`\n🏢 Seeding ${properties.length} properties…`);
        for (const p of properties) {
            // a) Check manager exists
            const managerExists = yield prisma.manager.findUnique({
                where: { cognitoId: p.managerCognitoId },
            });
            if (!managerExists) {
                console.warn(`Skipping property ID ${p.id}: managerCognitoId="${p.managerCognitoId}" not found.`);
                continue;
            }
            // b) Check location exists
            const locationExists = yield prisma.location.findUnique({
                where: { id: p.locationId },
            });
            if (!locationExists) {
                console.warn(`Skipping property ID ${p.id}: locationId=${p.locationId} not found.`);
                continue;
            }
            // c) Filter and validate amenities
            const filteredAmenities = [];
            for (const a of p.amenities) {
                if (validAmenities.includes(a)) {
                    filteredAmenities.push(a);
                }
                else {
                    console.warn(`Property ID ${p.id} – invalid amenity value "${a}" (will be dropped).`);
                }
            }
            // d) Filter and validate highlights
            const filteredHighlights = [];
            for (const h of p.highlights) {
                if (validHighlights.includes(h)) {
                    filteredHighlights.push(h);
                }
                else {
                    console.warn(`Property ID ${p.id} – invalid highlight value "${h}" (will be dropped).`);
                }
            }
            // e) Create the property
            try {
                yield prisma.property.create({
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
                        propertyType: p.propertyType,
                        postedDate: new Date(p.postedDate),
                        averageRating: p.averageRating,
                        numberOfReviews: p.numberOfReviews,
                        locationId: p.locationId,
                        managerCognitoId: p.managerCognitoId,
                    },
                });
            }
            catch (err) {
                console.error(`Error creating property ID ${p.id}:`, err);
            }
        }
        yield resetSequence("Property");
        console.log("✅ Properties done.");
        // f) Print all inserted property IDs for debugging
        const allProperties = yield prisma.property.findMany({ select: { id: true } });
        console.log("→ Inserted property IDs:", allProperties.map((x) => x.id).join(", "));
        // 8) Seed Leases
        console.log(`\n🔑 Seeding ${leases.length} leases…`);
        for (const l of leases) {
            // Check property exists
            const propertyExists = yield prisma.property.findUnique({
                where: { id: l.propertyId },
            });
            if (!propertyExists) {
                console.warn(`Skipping lease ID ${l.id}: propertyId=${l.propertyId} not found.`);
                continue;
            }
            // Check tenant exists
            const tenantExists = yield prisma.tenant.findUnique({
                where: { cognitoId: l.tenantCognitoId },
            });
            if (!tenantExists) {
                console.warn(`Skipping lease ID ${l.id}: tenantCognitoId="${l.tenantCognitoId}" not found.`);
                continue;
            }
            // Create the lease
            try {
                yield prisma.lease.create({
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
            }
            catch (err) {
                console.error(`Error creating lease ID ${l.id}:`, err);
            }
        }
        yield resetSequence("Lease");
        console.log("✅ Leases done.");
        // 9) Seed Applications
        console.log(`\n📄 Seeding ${applications.length} applications…`);
        for (const a of applications) {
            // Check FK references similarly (propertyId, tenantCognitoId, leaseId) if needed…
            try {
                yield prisma.application.create({
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
            }
            catch (err) {
                console.error(`Error creating application ID ${a.id}:`, err);
            }
        }
        yield resetSequence("Application");
        console.log("✅ Applications done.");
        // 10) Seed Payments
        console.log(`\n💳 Seeding ${payments.length} payments…`);
        for (const p of payments) {
            // Check that the referenced leaseId exists
            const leaseExists = yield prisma.lease.findUnique({
                where: { id: p.leaseId },
            });
            if (!leaseExists) {
                console.warn(`Skipping payment ID ${p.id}: leaseId=${p.leaseId} not found.`);
                continue;
            }
            try {
                yield prisma.payment.create({
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
            }
            catch (err) {
                console.error(`Error creating payment ID ${p.id}:`, err);
            }
        }
        yield resetSequence("Payment");
        console.log("✅ Payments done.");
        console.log("\n🎉 Seeding complete!");
    });
}
main()
    .catch((e) => {
    console.error("Uncaught error in seed script:", e);
    process.exit(1);
})
    .finally(() => __awaiter(void 0, void 0, void 0, function* () {
    yield prisma.$disconnect();
}));
