import { Controller } from '@nestjs/common';

// Storage operations are handled via ProductsController (upload)
// and ShippingController (label download). This controller is
// intentionally empty — the service is used by other modules.
@Controller('storage')
export class StorageController {}
