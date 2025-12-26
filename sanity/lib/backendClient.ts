import { createClient } from "next-sanity";

const projectId = process.env.SANITY_PROJECT_ID!;
const dataset = process.env.SANITY_DATASET!;
const apiVersion = process.env.SANITY_API_VERSION || "2024-01-01";
const token = process.env.SANITY_API_TOKEN!;

if (!projectId || !dataset || !token) {
  throw new Error("Missing Sanity environment variables");
}

export const backendClient = createClient({
  projectId,
  dataset,
  apiVersion,
  useCdn: false, // ❗ REQUIRED for mutations
  token,         // ❗ REQUIRED for create / patch
});
