import { ConfigService } from '@nestjs/config';
const config = new ConfigService();
console.log('GOOGLE_CLIENT_ID:', config.get('GOOGLE_CLIENT_ID'));
console.log('GOOGLE_CLIENT_SECRET:', config.get('GOOGLE_CLIENT_SECRET'));
