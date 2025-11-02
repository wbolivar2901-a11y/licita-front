// src/app/core/auth/auth-headers.util.ts
import { HttpRequest } from '@angular/common/http';
import { AuthConstants } from './auth.constants';

export class AuthHeadersUtil {
  /** ¿La URL es de LICITA-API? */
  static isLicita(url: string): boolean {
    return !!AuthConstants.API_BASE && url.startsWith(AuthConstants.API_BASE);
  }

  /** ¿La URL es de IAM? */
  static isIam(url: string): boolean {
    return !!AuthConstants.IAM_BASE && url.startsWith(AuthConstants.IAM_BASE);
  }

  /** ¿Es preflight CORS? */
  static isPreflight(method: string): boolean {
    return method.toUpperCase() === 'OPTIONS';
  }

  /** ¿Debe llevar Bearer? Regla: LICITA siempre; IAM excepto públicos. */
  static requiresAuth(url: string, method: string): boolean {
    if (this.isPreflight(method)) return false;

    const isLicita = this.isLicita(url);
    const isIam    = this.isIam(url);

    if (isLicita) return true;
    if (isIam) {
      // IAM: solo si NO es público
      return !AuthConstants.IAM_PUBLIC_ENDPOINTS.some(p => url.startsWith(p));
    }
    return false;
  }

  /** ¿Es el refresh de IAM (bypass total)? */
  static isIamRefresh(url: string): boolean {
    return this.isIam(url) && url.startsWith(`${AuthConstants.IAM_BASE}/api/auth/refresh`);
  }

  /** Inyecta header Authorization si procede */
  static withBearer(req: HttpRequest<any>, token: string | null, method: string): HttpRequest<any> {
    if (!token || !this.requiresAuth(req.url, method)) return req;
    return req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
}
