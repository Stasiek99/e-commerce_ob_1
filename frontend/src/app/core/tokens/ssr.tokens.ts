import { InjectionToken } from '@angular/core';
import type { Response } from 'express';

export const RESPONSE = new InjectionToken<Response>('RESPONSE');
