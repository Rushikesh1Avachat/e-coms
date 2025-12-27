import { createClient } from "next-sanity";

export function getBackendClient() {
  if (!process.env.SANITY_API_TOKEN) {
    throw new Error("SANITY_API_TOKEN is missing");
  }

  return createClient({
    projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
    dataset: process.env.NEXT_PUBLIC_SANITY_DATASET!,
    apiVersion: "2024-01-01",
    useCdn: false, // ✅ ALWAYS false for writes
    token: process.env.SANITY_API_TOKEN,
  });
}
