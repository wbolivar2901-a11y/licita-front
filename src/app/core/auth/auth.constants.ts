// src/app/core/auth/auth.constants.ts
import { environment } from '../../../environments/environment';

export class AuthConstants {
  static readonly IAM_BASE = (environment.iamBase || '').replace(/\/+$/,'');
  static readonly API_BASE = (environment.apiBase || '').replace(/\/+$/,'');

  // Endpoints públicos de IAM (sin bearer)
  static readonly IAM_PUBLIC_ENDPOINTS: readonly string[] = [
    '/api/auth/login',
    '/api/auth/refresh',
    '/api/auth/register',
    '/api/auth/password/forgot',
    '/api/auth/password/reset',
    '/api/auth/verify',
  ].map(p => `${AuthConstants.IAM_BASE}${p}`);
}
