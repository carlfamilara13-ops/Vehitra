export type CatalogIndexBrand = {
  slug: string;
  name: string;
};

export type CatalogIndexModel = {
  slug: string;
  brandSlug: string | null;
  vehicleType: string;
  name: string;
  isGeneric: boolean;
  sortOrder: number;
};

export function validateCatalogIndex(
  brands: readonly CatalogIndexBrand[],
  models: readonly CatalogIndexModel[],
): string[] {
  const errors: string[] = [];
  const brandSlugs = new Set<string>();

  for (const brand of brands) {
    if (!brand.slug.trim()) errors.push('A brand is missing its slug.');
    if (!brand.name.trim()) errors.push(`${brand.slug || 'A brand'}: name is required.`);
    if (brandSlugs.has(brand.slug)) errors.push(`${brand.slug}: duplicate brand slug.`);
    brandSlugs.add(brand.slug);
  }

  if (models.length === 0) errors.push('The catalog index contains no active models.');

  const modelSlugs = new Set<string>();
  for (const model of models) {
    const label = model.slug || 'A model';
    if (!model.slug.trim()) errors.push('A model is missing its slug.');
    if (!model.name.trim()) errors.push(`${label}: name is required.`);
    if (!model.vehicleType.trim()) errors.push(`${label}: vehicle type is required.`);
    if (!Number.isInteger(model.sortOrder) || model.sortOrder < 0) {
      errors.push(`${label}: sort order must be a non-negative whole number.`);
    }
    if (model.isGeneric !== (model.brandSlug == null)) {
      errors.push(`${label}: generic models have no brand; branded models require one.`);
    }
    if (model.brandSlug != null && !brandSlugs.has(model.brandSlug)) {
      errors.push(`${label}: unknown brand ${model.brandSlug}.`);
    }
    if (modelSlugs.has(model.slug)) errors.push(`${label}: duplicate model slug.`);
    modelSlugs.add(model.slug);
  }

  return errors;
}
