// File: server/src/controllers/propertyControllers.ts

import { Request, Response } from "express";
import { PrismaClient, Prisma, Location } from "@prisma/client";
import { wktToGeoJSON } from "@terraformer/wkt";
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import axios from "axios";

const prisma = new PrismaClient();

// Initialize S3 client (ensure AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME are set in .env)
if (!process.env.AWS_REGION) {
  console.error("Missing AWS_REGION in environment");
  process.exit(1);
}
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
});

/**
 * GET /properties
 * - Optional query parameters: favoriteIds, priceMin, priceMax, beds, baths, propertyType,
 *   squareFeetMin, squareFeetMax, amenities, availableFrom, latitude, longitude
 * - Returns a JSON array of all properties matching the filters.
 */
export const getProperties = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      favoriteIds,
      priceMin,
      priceMax,
      beds,
      baths,
      propertyType,
      squareFeetMin,
      squareFeetMax,
      amenities,
      availableFrom,
      latitude,
      longitude,
    } = req.query;

    // Build dynamic WHERE clause as Prisma.Sql fragments
    const whereConditions: Prisma.Sql[] = [];

    if (favoriteIds) {
      const ids = (favoriteIds as string)
        .split(",")
        .map(Number)
        .filter((n) => !isNaN(n));
      if (ids.length) {
        whereConditions.push(Prisma.sql`p.id IN (${Prisma.join(ids)})`);
      }
    }

    if (priceMin) {
      const pm = Number(priceMin);
      if (!isNaN(pm)) {
        whereConditions.push(Prisma.sql`p."pricePerMonth" >= ${pm}`);
      }
    }
    if (priceMax) {
      const pM = Number(priceMax);
      if (!isNaN(pM)) {
        whereConditions.push(Prisma.sql`p."pricePerMonth" <= ${pM}`);
      }
    }

    if (beds && beds !== "any") {
      const b = Number(beds);
      if (!isNaN(b)) {
        whereConditions.push(Prisma.sql`p.beds >= ${b}`);
      }
    }
    if (baths && baths !== "any") {
      const bt = Number(baths);
      if (!isNaN(bt)) {
        whereConditions.push(Prisma.sql`p.baths >= ${bt}`);
      }
    }

    if (squareFeetMin) {
      const sfMin = Number(squareFeetMin);
      if (!isNaN(sfMin)) {
        whereConditions.push(Prisma.sql`p."squareFeet" >= ${sfMin}`);
      }
    }
    if (squareFeetMax) {
      const sfMax = Number(squareFeetMax);
      if (!isNaN(sfMax)) {
        whereConditions.push(Prisma.sql`p."squareFeet" <= ${sfMax}`);
      }
    }

    if (propertyType && propertyType !== "any") {
      whereConditions.push(
        Prisma.sql`p."propertyType" = ${propertyType}::"PropertyType"`
      );
    }

    if (amenities && amenities !== "any") {
      const amenArray = (amenities as string).split(",").map((s) => s.trim());
      if (amenArray.length) {
        whereConditions.push(Prisma.sql`p.amenities @> ${amenArray}`);
      }
    }

    if (availableFrom && availableFrom !== "any") {
      const dateStr = availableFrom as string;
      const dt = new Date(dateStr);
      if (!isNaN(dt.getTime())) {
        whereConditions.push(
          Prisma.sql`EXISTS (
            SELECT 1
            FROM "Lease" l
            WHERE l."propertyId" = p.id
              AND l."startDate" <= ${dt.toISOString()}
          )`
        );
      }
    }

    if (latitude && longitude) {
      const lat = parseFloat(latitude as string);
      const lng = parseFloat(longitude as string);
      if (!isNaN(lat) && !isNaN(lng)) {
        // Approximate 1000 km radius → ~9° (111 km per degree)
        const km = 1000;
        const deg = km / 111;
        whereConditions.push(
          Prisma.sql`ST_DWithin(
            l.coordinates::geometry,
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326),
            ${deg}
          )`
        );
      }
    }

    // Construct full SQL. Join Property (p) and Location (l).
    const completeQuery = Prisma.sql`
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
      ${
        whereConditions.length > 0
          ? Prisma.sql`WHERE ${Prisma.join(whereConditions, " AND ")}`
          : Prisma.empty
      }
    `;

    const properties = await prisma.$queryRaw(completeQuery);
    res.status(200).json(properties);
  } catch (error: any) {
    console.error("Error retrieving properties:", error);
    res
      .status(500)
      .json({ message: `Error retrieving properties: ${error.message}` });
  }
};

/**
 * GET /properties/:id
 * - Returns a single property by its ID, including its Location (with GeoJSON coords).
 */
export const getProperty = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const propertyId = Number(id);

    if (isNaN(propertyId)) {
      res.status(400).json({ message: "Invalid property ID." });
      return;
    }

    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      include: { location: true },
    });

    if (!property) {
      res.status(404).json({ message: "Property not found." });
      return;
    }

    // Fetch WKT from Location, convert to GeoJSON
    const coordsResult = (await prisma.$queryRaw<
      { coordinates: string }[]
    >`
      SELECT ST_AsText(coordinates) AS coordinates
      FROM "Location"
      WHERE id = ${property.location.id}
    `) as { coordinates: string }[];

    const wkt = coordsResult[0]?.coordinates || "";
    let geoJSON: any = {};
    let [lng, lat] = [0, 0];
    try {
      geoJSON = wktToGeoJSON(wkt);
      [lng, lat] = geoJSON.coordinates || [0, 0];
    } catch (_) {
      // WKT parsing error → default to (0,0)
    }

    const propertyWithCoords = {
      ...property,
      location: {
        ...property.location,
        coordinates: { longitude: lng, latitude: lat },
      },
    };

    res.status(200).json(propertyWithCoords);
  } catch (error: any) {
    console.error("Error retrieving property:", error);
    res.status(500).json({ message: `Error retrieving property: ${error.message}` });
  }
};

/**
 * POST /properties
 * - Creates a new Property + Location pair.
 * - Expects multipart/form-data with fields:
 *     • address, city, state, country, postalCode, managerCognitoId, pricePerMonth, securityDeposit, etc.
 *     • photos[] (one or more image files)
 */
export const createProperty = async (req: Request, res: Response): Promise<void> => {
  try {
    const files = req.files as Express.Multer.File[];
    const {
      address,
      city,
      state,
      country,
      postalCode,
      managerCognitoId,
      ...propertyData
    } = req.body;

    // 1) Geocode via Nominatim
    const geocodeURL = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
      street: address,
      city,
      country,
      postalcode: postalCode,
      format: "json",
      limit: "1",
    }).toString()}`;

    const geoResp = await axios.get(geocodeURL, {
      headers: { "User-Agent": "RealEstateApp (you@example.com)" },
    });

    let [lon, lat] = [0, 0];
    if (geoResp.data[0]?.lon && geoResp.data[0]?.lat) {
      lon = parseFloat(geoResp.data[0].lon);
      lat = parseFloat(geoResp.data[0].lat);
    }

    // 2) Insert Location
    const [newLocation] = (await prisma.$queryRaw<Location[]>`
      INSERT INTO "Location" (address, city, state, country, "postalCode", coordinates)
      VALUES (
        ${address},
        ${city},
        ${state},
        ${country},
        ${postalCode},
        ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)
      )
      RETURNING id, address, city, state, country, "postalCode", ST_AsText(coordinates) as coordinates;
    `) as Location[];

    // 3) Upload each file to S3 and collect its public URL
    // const photoUrls: string[] = [];
    // if (files && files.length) {
    //   if (!process.env.S3_BUCKET_NAME) {
    //     throw new Error("Missing S3_BUCKET_NAME in environment");
    //   }
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
    //     // uploadResult.Location is the public URL (if bucket is public)
    //     if (uploadResult.Location) {
    //       photoUrls.push(uploadResult.Location);
    //     }
    //   }
    // }

    // 4) Create the Property record
    const newProperty = await prisma.property.create({
      data: {
        ...propertyData,
        locationId: newLocation.id,
        managerCognitoId,
        // photoUrls, // URLs returned by S3 (empty array if none)
        amenities:
          typeof propertyData.amenities === "string"
            ? propertyData.amenities.split(",").map((s: string) => s.trim())
            : [],
        highlights:
          typeof propertyData.highlights === "string"
            ? propertyData.highlights.split(",").map((s: string) => s.trim())
            : [],
        isPetsAllowed: propertyData.isPetsAllowed === "true",
        isParkingIncluded: propertyData.isParkingIncluded === "true",
        pricePerMonth: parseFloat(propertyData.pricePerMonth),
        securityDeposit: parseFloat(propertyData.securityDeposit),
        applicationFee: parseFloat(propertyData.applicationFee),
        beds: parseInt(propertyData.beds, 10),
        baths: parseFloat(propertyData.baths),
        squareFeet: parseInt(propertyData.squareFeet, 10),
      },
      include: {
        location: true,
        manager: true,
      },
    });

    res.status(201).json(newProperty);
  } catch (error: any) {
    console.error("Error creating property:", error);
    res.status(500).json({ message: `Error creating property: ${error.message}` });
  }
};

/**
 * PUT /properties/:id
 * - Updates an existing Property by ID.
 * - If new photos are included, it re-uploads them to S3 and appends their URLs.
 */
export const updateProperty = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const propertyId = Number(id);
    const files = req.files as Express.Multer.File[];

    if (isNaN(propertyId)) {
      res.status(400).json({ message: "Invalid property ID." });
      return;
    }

    const existing = await prisma.property.findUnique({ where: { id: propertyId } });
    if (!existing) {
      res.status(404).json({ message: "Property not found." });
      return;
    }

    const updatedData = req.body;
    const toUpdate: any = { ...updatedData };

    // Handle field conversions
    if (updatedData.amenities && typeof updatedData.amenities === "string") {
      toUpdate.amenities = (updatedData.amenities as string)
        .split(",")
        .map((s) => s.trim());
    }
    if (updatedData.highlights && typeof updatedData.highlights === "string") {
      toUpdate.highlights = (updatedData.highlights as string)
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

    const result = await prisma.property.update({
      where: { id: propertyId },
      data: toUpdate,
      include: { location: true, manager: true },
    });

    res.status(200).json(result);
  } catch (error: any) {
    console.error("Error updating property:", error);
    res.status(500).json({ message: `Error updating property: ${error.message}` });
  }
};

/**
 * DELETE /properties/:id
 * - Deletes a property by its ID.
 */
export const deleteProperty = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const propertyId = Number(id);

    if (isNaN(propertyId)) {
      res.status(400).json({ message: "Invalid property ID." });
      return;
    }

    const existing = await prisma.property.findUnique({ where: { id: propertyId } });
    if (!existing) {
      res.status(404).json({ message: "Property not found." });
      return;
    }

    await prisma.property.delete({ where: { id: propertyId } });
    res.status(204).send();
  } catch (error: any) {
    console.error("Error deleting property:", error);
    res.status(500).json({ message: `Error deleting property: ${error.message}` });
  }
};
