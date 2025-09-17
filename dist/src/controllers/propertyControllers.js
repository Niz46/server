"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteProperty = exports.updateProperty = exports.createProperty = exports.getProperty = exports.getProperties = void 0;
const client_1 = require("@prisma/client");
const wkt_1 = require("@terraformer/wkt");
const client_s3_1 = require("@aws-sdk/client-s3");
const axios_1 = __importDefault(require("axios"));
const prisma = new client_1.PrismaClient();
// Initialize S3 client (ensure AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME are set in .env)
if (!process.env.AWS_REGION) {
    console.error("Missing AWS_REGION in environment");
    process.exit(1);
}
const s3Client = new client_s3_1.S3Client({
    region: process.env.AWS_REGION,
});
/**
 * GET /properties
 * - Optional query parameters: favoriteIds, priceMin, priceMax, beds, baths, propertyType,
 *   squareFeetMin, squareFeetMax, amenities, availableFrom, latitude, longitude
 * - Returns a JSON array of all properties matching the filters.
 */
const getProperties = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { favoriteIds, priceMin, priceMax, beds, baths, propertyType, squareFeetMin, squareFeetMax, amenities, availableFrom, latitude, longitude, radiusKm, } = req.query;
        // Build safe Prisma where object
        const where = {};
        // favorites
        if (favoriteIds) {
            const ids = favoriteIds
                .split(",")
                .map((s) => Number(s))
                .filter(Boolean);
            if (ids.length)
                where.id = { in: ids };
        }
        // price
        if (priceMin || priceMax) {
            where.pricePerMonth = {};
            if (!isNaN(Number(priceMin)))
                where.pricePerMonth.gte = Number(priceMin);
            if (!isNaN(Number(priceMax)))
                where.pricePerMonth.lte = Number(priceMax);
        }
        // beds / baths
        if (beds && beds !== "any" && !isNaN(Number(beds)))
            where.beds = { gte: Number(beds) };
        if (baths && baths !== "any" && !isNaN(Number(baths)))
            where.baths = { gte: Number(baths) };
        // square feet
        if (!isNaN(Number(squareFeetMin)) || !isNaN(Number(squareFeetMax))) {
            where.squareFeet = {};
            if (!isNaN(Number(squareFeetMin)))
                where.squareFeet.gte = Number(squareFeetMin);
            if (!isNaN(Number(squareFeetMax)))
                where.squareFeet.lte = Number(squareFeetMax);
        }
        // property type (enum)
        if (propertyType && propertyType !== "any")
            where.propertyType = propertyType;
        // amenities - use Prisma array filters (hasSome or hasEvery depending on semantics)
        if (amenities && amenities !== "any") {
            const amenArray = amenities
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
            if (amenArray.length) {
                // choose hasSome (matches if property has any of the requested amenities).
                // use hasEvery if you require ALL provided amenities
                where.amenities = { hasSome: amenArray };
            }
        }
        // Availability filter (optional) — example: if you want properties that do NOT have an active lease overlapping requested date
        // The previous implementation had an EXISTS that likely filtered incorrectly.
        // If you want to filter by availabilityOnDate (availableFrom), you should define what "available" means:
        // e.g. property is available if it has no lease that includes availableFrom (no lease where start <= date <= end)
        let locationFilteredIds = undefined;
        if (availableFrom && availableFrom !== "any") {
            const dt = new Date(availableFrom);
            if (!isNaN(dt.getTime())) {
                // Get property ids that DO NOT have a lease overlapping dt
                const rows = yield prisma.$queryRaw `SELECT id FROM "Property" p WHERE NOT EXISTS (
              SELECT 1 FROM "Lease" l
              WHERE l."propertyId" = p.id
                AND ${dt.toISOString()}::timestamptz BETWEEN l."startDate" AND l."endDate"
            )`;
                const allowedIds = rows.map((r) => r.id);
                // If there are zero allowedIds, just return early
                if (allowedIds.length === 0) {
                    res.status(200).json([]);
                    return;
                }
                where.id = where.id
                    ? Object.assign(Object.assign({}, where.id), { in: allowedIds.filter((id) => Array.isArray(where.id.in) ? where.id.in.includes(id) : true) }) : { in: allowedIds };
            }
        }
        // Geospatial filtering: if lat/lng provided, query for property IDs in radius (meters) using geography
        if (latitude && longitude) {
            const lat = Number(latitude);
            const lng = Number(longitude);
            if (!isNaN(lat) && !isNaN(lng)) {
                const rk = !isNaN(Number(radiusKm)) ? Number(radiusKm) : 5;
                const meters = Math.round(rk * 1000);
                // Safe parameterized raw query to get property IDs within radius (use geography to measure in meters)
                const idsRows = (yield prisma.$queryRaw `SELECT p.id
            FROM "Property" p
            JOIN "Location" l ON p."locationId" = l.id
            WHERE ST_DWithin(
              l.coordinates::geography,
              ST_SetSRID(ST_MakePoint(${lng}::double precision, ${lat}::double precision), 4326)::geography,
              ${meters}::double precision
            )`);
                const ids = idsRows.map((r) => r.id);
                if (ids.length === 0) {
                    res.status(200).json([]); // no properties in radius
                    return;
                }
                // Intersect with any existing id filter
                if (where.id && where.id.in) {
                    where.id.in = where.id.in.filter((existingId) => ids.includes(existingId));
                    if (where.id.in.length === 0) {
                        res.status(200).json([]);
                        return;
                    }
                }
                else {
                    where.id = { in: ids };
                }
            }
        }
        // Final fetch using Prisma (safe & includes relation data)
        const properties = yield prisma.property.findMany({
            where,
            include: {
                location: true,
                manager: true,
            },
            orderBy: { postedDate: "desc" },
        });
        // Convert location coordinates (WKT -> lon/lat) on the server if you still store as geometry/text, but since Location stores geometry,
        // the client can read coordinates using ST_X/ST_Y or we can return them via a small raw query if needed.
        res.status(200).json(properties);
    }
    catch (error) {
        console.error("Error retrieving properties (new safe query):", error);
        res
            .status(500)
            .json({ message: `Error retrieving properties: ${error.message}` });
    }
});
exports.getProperties = getProperties;
/**
 * GET /properties/:id
 * - Returns a single property by its ID, including its Location (with GeoJSON coords).
 */
const getProperty = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { id } = req.params;
        const propertyId = Number(id);
        if (isNaN(propertyId)) {
            res.status(400).json({ message: "Invalid property ID." });
            return;
        }
        const property = yield prisma.property.findUnique({
            where: { id: propertyId },
            include: { location: true },
        });
        if (!property) {
            res.status(404).json({ message: "Property not found." });
            return;
        }
        // Fetch WKT from Location, convert to GeoJSON
        const coordsResult = (yield prisma.$queryRaw `
      SELECT ST_AsText(coordinates) AS coordinates
      FROM "Location"
      WHERE id = ${property.location.id}
    `);
        const wkt = ((_a = coordsResult[0]) === null || _a === void 0 ? void 0 : _a.coordinates) || "";
        let geoJSON = {};
        let [lng, lat] = [0, 0];
        try {
            geoJSON = (0, wkt_1.wktToGeoJSON)(wkt);
            [lng, lat] = geoJSON.coordinates || [0, 0];
        }
        catch (_) {
            // WKT parsing error -> default to (0,0)
        }
        const propertyWithCoords = Object.assign(Object.assign({}, property), { location: Object.assign(Object.assign({}, property.location), { coordinates: { longitude: lng, latitude: lat } }) });
        res.status(200).json(propertyWithCoords);
    }
    catch (error) {
        console.error("Error retrieving property:", error);
        res
            .status(500)
            .json({ message: `Error retrieving property: ${error.message}` });
    }
});
exports.getProperty = getProperty;
/**
 * POST /properties
 */
const createProperty = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const files = req.files || [];
        const _c = req.body, { address, city, state, country, postalCode, managerCognitoId } = _c, propertyData = __rest(_c, ["address", "city", "state", "country", "postalCode", "managerCognitoId"]);
        // 1) Geocode via Nominatim
        const geocodeURL = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
            street: address,
            city,
            country,
            postalcode: postalCode,
            format: "json",
            limit: "1",
        }).toString()}`;
        const geoResp = yield axios_1.default.get(geocodeURL, {
            headers: { "User-Agent": "RealEstateApp (you@example.com)" },
        });
        let [lon, lat] = [0, 0];
        if (((_a = geoResp.data[0]) === null || _a === void 0 ? void 0 : _a.lon) && ((_b = geoResp.data[0]) === null || _b === void 0 ? void 0 : _b.lat)) {
            lon = parseFloat(geoResp.data[0].lon);
            lat = parseFloat(geoResp.data[0].lat);
        }
        // 2) Insert Location (unqualified PostGIS functions and explicit geometry usage)
        const [newLocation] = (yield prisma.$queryRaw `
      INSERT INTO "Location" (address, city, state, country, "postalCode", coordinates)
      VALUES (
        ${address},
        ${city},
        ${state},
        ${country},
        ${postalCode},
        ST_SetSRID(ST_MakePoint(${lon}::double precision, ${lat}::double precision), 4326)
      )
      RETURNING id, address, city, state, country, "postalCode", ST_AsText(coordinates) as coordinates;
    `);
        // 3) (Optional) upload files to S3 — left commented as in your original
        // ...
        // 4) Create property record
        const newProperty = yield prisma.property.create({
            data: Object.assign(Object.assign({}, propertyData), { locationId: newLocation.id, managerCognitoId, amenities: typeof propertyData.amenities === "string"
                    ? propertyData.amenities.split(",").map((s) => s.trim())
                    : [], highlights: typeof propertyData.highlights === "string"
                    ? propertyData.highlights.split(",").map((s) => s.trim())
                    : [], isPetsAllowed: propertyData.isPetsAllowed === "true", isParkingIncluded: propertyData.isParkingIncluded === "true", pricePerMonth: parseFloat(propertyData.pricePerMonth), securityDeposit: parseFloat(propertyData.securityDeposit), applicationFee: parseFloat(propertyData.applicationFee), beds: parseInt(propertyData.beds, 10), baths: parseFloat(propertyData.baths), squareFeet: parseInt(propertyData.squareFeet, 10) }),
            include: {
                location: true,
                manager: true,
            },
        });
        res.status(201).json(newProperty);
    }
    catch (error) {
        console.error("Error creating property:", error);
        res
            .status(500)
            .json({ message: `Error creating property: ${error.message}` });
    }
});
exports.createProperty = createProperty;
// updateProperty and deleteProperty unchanged (use your prior implementations)
/**
 * PUT /properties/:id
 * - Updates an existing Property by ID.
 * - If new photos are included, it re-uploads them to S3 and appends their URLs.
 */
const updateProperty = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const propertyId = Number(id);
        const files = req.files;
        if (isNaN(propertyId)) {
            res.status(400).json({ message: "Invalid property ID." });
            return;
        }
        const existing = yield prisma.property.findUnique({
            where: { id: propertyId },
        });
        if (!existing) {
            res.status(404).json({ message: "Property not found." });
            return;
        }
        const updatedData = req.body;
        const toUpdate = Object.assign({}, updatedData);
        // Handle field conversions
        if (updatedData.amenities && typeof updatedData.amenities === "string") {
            toUpdate.amenities = updatedData.amenities
                .split(",")
                .map((s) => s.trim());
        }
        if (updatedData.highlights && typeof updatedData.highlights === "string") {
            toUpdate.highlights = updatedData.highlights
                .split(",")
                .map((s) => s.trim());
        }
        if (updatedData.pricePerMonth !== undefined) {
            toUpdate.pricePerMonth = parseFloat(updatedData.pricePerMonth);
        }
        if (updatedData.securityDeposit !== undefined) {
            toUpdate.securityDeposit = parseFloat(updatedData.securityDeposit);
        }
        if (updatedData.applicationFee !== undefined) {
            toUpdate.applicationFee = parseFloat(updatedData.applicationFee);
        }
        if (updatedData.beds !== undefined) {
            toUpdate.beds = parseInt(updatedData.beds, 10);
        }
        if (updatedData.baths !== undefined) {
            toUpdate.baths = parseFloat(updatedData.baths);
        }
        if (updatedData.squareFeet !== undefined) {
            toUpdate.squareFeet = parseInt(updatedData.squareFeet, 10);
        }
        if (updatedData.isPetsAllowed !== undefined) {
            toUpdate.isPetsAllowed = updatedData.isPetsAllowed === "true";
        }
        if (updatedData.isParkingIncluded !== undefined) {
            toUpdate.isParkingIncluded = updatedData.isParkingIncluded === "true";
        }
        // Upload new files if provided
        // if (files && files.length) {
        //   if (!process.env.S3_BUCKET_NAME) {
        //     throw new Error("Missing S3_BUCKET_NAME in environment");
        //   }
        //   const newPhotoUrls: string[] = [];
        //   for (const file of files) {
        //     const key = `properties/${Date.now()}-${file.originalname}`;
        //     const uploadParams = {
        //       Bucket: process.env.S3_BUCKET_NAME!, // non-null assertion
        //       Key: key,
        //       Body: file.buffer,
        //       ContentType: file.mimetype,
        //     };
        //     const uploadWatch = new Upload({
        //       client: s3Client,
        //       params: uploadParams,
        //     });
        //     const uploadResult = await uploadWatch.done();
        //     if (uploadResult.Location) {
        //       newPhotoUrls.push(uploadResult.Location);
        //     }
        //   }
        //   // Append to existing URLs
        //   toUpdate.photoUrls = [...existing.photoUrls, ...newPhotoUrls];
        // }
        const result = yield prisma.property.update({
            where: { id: propertyId },
            data: toUpdate,
            include: { location: true, manager: true },
        });
        res.status(200).json(result);
    }
    catch (error) {
        console.error("Error updating property:", error);
        res
            .status(500)
            .json({ message: `Error updating property: ${error.message}` });
    }
});
exports.updateProperty = updateProperty;
/**
 * DELETE /properties/:id
 * - Deletes a property by its ID.
 */
const deleteProperty = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { id } = req.params;
        const propertyId = Number(id);
        if (isNaN(propertyId)) {
            res.status(400).json({ message: "Invalid property ID." });
            return;
        }
        const existing = yield prisma.property.findUnique({
            where: { id: propertyId },
        });
        if (!existing) {
            res.status(404).json({ message: "Property not found." });
            return;
        }
        yield prisma.property.delete({ where: { id: propertyId } });
        res.status(204).send();
    }
    catch (error) {
        console.error("Error deleting property:", error);
        res
            .status(500)
            .json({ message: `Error deleting property: ${error.message}` });
    }
});
exports.deleteProperty = deleteProperty;
