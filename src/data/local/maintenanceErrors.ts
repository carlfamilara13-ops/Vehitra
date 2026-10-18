// Shared errors for the local maintenance stores. Mirrors the store-specific errors in
// vehicleStore.ts (VehicleValidationError / VehicleNotFoundError) but is reused by
// mileageStore, serviceStore, installStore and overrideStore.

export class MaintenanceValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors[0] ?? 'Invalid maintenance record');
    this.name = 'MaintenanceValidationError';
  }
}

export class MaintenanceNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Maintenance record not found (${id})`);
    this.name = 'MaintenanceNotFoundError';
  }
}
