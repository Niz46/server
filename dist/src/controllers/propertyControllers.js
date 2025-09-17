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
        // Build dynamic WHERE clause as Prisma.Sql fragments
        const whereConditions = [];
        if (favoriteIds) {
            const ids = favoriteIds
                .split(",")
                .map(Number)
                .filter((n) => !isNaN(n));
            if (ids.length) {
                whereConditions.push(client_1.Prisma.sql `p.id IN (${client_1.Prisma.join(ids)})`);
            }
        }
        if (priceMin) {
            const pm = Number(priceMin);
            if (!isNaN(pm))
                whereConditions.push(client_1.Prisma.sql `p."pricePerMonth" >= ${pm}`);
        }
        if (priceMax) {
            const pM = Number(priceMax);
            if (!isNaN(pM))
                whereConditions.push(client_1.Prisma.sql `p."pricePerMonth" <= ${pM}`);
        }
        if (beds && beds !== "any") {
            const b = Number(beds);
            if (!isNaN(b))
                whereConditions.push(client_1.Prisma.sql `p.beds >= ${b}`);
        }
        if (baths && baths !== "any") {
            const bt = Number(baths);
            if (!isNaN(bt))
                whereConditions.push(client_1.Prisma.sql `p.baths >= ${bt}`);
        }
        if (squareFeetMin) {
            const sfMin = Number(squareFeetMin);
            if (!isNaN(sfMin))
                whereConditions.push(client_1.Prisma.sql `p."squareFeet" >= ${sfMin}`);
        }
        if (squareFeetMax) {
            const sfMax = Number(squareFeetMax);
            if (!isNaN(sfMax))
                whereConditions.push(client_1.Prisma.sql `p."squareFeet" <= ${sfMax}`);
        }
        if (propertyType && propertyType !== "any") {
            whereConditions.push(client_1.Prisma.sql `p."propertyType" = ${propertyType}::"PropertyType"`);
        }
        if (amenities && amenities !== "any") {
            const amenArray = amenities.split(",").map((s) => s.trim());
            if (amenArray.length)
                whereConditions.push(client_1.Prisma.sql `p.amenities @> ${amenArray}`);
        }
        if (availableFrom && availableFrom !== "any") {
            const dateStr = availableFrom;
            const dt = new Date(dateStr);
            if (!isNaN(dt.getTime())) {
                whereConditions.push(client_1.Prisma.sql `EXISTS (
             SELECT 1 FROM "Lease" l
             WHERE l."propertyId" = p.id
               AND l."startDate" <= ${dt.toISOString()}
           )`);
            }
        }
        // Geospatial filter (approximate using degrees, avoids schema-qualified PostGIS calls)
        if (latitude && longitude) {
            const lat = parseFloat(latitude);
            const lng = parseFloat(longitude);
            if (!isNaN(lat) && !isNaN(lng)) {
                // radius in km (fallback to 5km)
                const rk = !isNaN(Number(radiusKm)) ? Number(radiusKm) : 5;
                const meters = rk * 1000;
                // convert meters -> degrees (approx): 1 degree ≈ 111320 meters
                const deg = meters / 111320;
                // Use geometry-based ST_DWithin with degrees (no schema qualification)
                whereConditions.push(client_1.Prisma.sql `ST_DWithin(
            l.coordinates::geometry,
            ST_SetSRID(ST_MakePoint(${lng}::double precision, ${lat}::double precision), 4326)::geometry,
            ${deg}::double precision
          )`);
            }
        }
        // Construct full SQL. Join Property (p) and Location (l).
        const completeQuery = client_1.Prisma.sql `
      SELECT
        p.*,
        json_build_object(
          'id',   l.id,
          'address',    l.address,
          'city',       l.city,
          'state',      l.state,
          'country',    l.country,
          'postalCode', l."postalCode",
          'coordinates', json_build_object(
            'longitude', ST_X(l."coordinates"::geometry),
            'latitude',  ST_Y(l."coordinates"::geometry)
          )
        ) as location
      FROM "Property" p
      JOIN "Location" l ON p."locationId" = l.id
      ${whereConditions.length > 0
            ? client_1.Prisma.sql `WHERE ${client_1.Prisma.join(whereConditions, " AND ")}`
            : client_1.Prisma.empty}
    `;
        const properties = yield prisma.$queryRaw(completeQuery);
        res.status(200).json(properties);
    }
    catch (error) {
        console.error("Error retrieving properties:", error);
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
