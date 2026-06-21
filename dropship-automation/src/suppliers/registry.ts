import type { Config } from "../config.js";
import { PrintfulAdapter } from "./printful.js";
import type { SupplierAdapter } from "./types.js";

export function buildSupplierRegistry(config: Config): Map<string, SupplierAdapter> {
  const printful = new PrintfulAdapter(config.printful.apiKey);
  return new Map<string, SupplierAdapter>([[printful.name, printful]]);
}
