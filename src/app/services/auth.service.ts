// src/app/services/auth.service.ts
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http'; // <--- HttpParams para refresh
import { environment } from '../../environments/environment';
import { Observable, map, tap, throwError, timer } from 'rxjs';              // <-- timer aquí
import { retry, finalize } from 'rxjs/operators';                       // <-- retry + finalize

interface LoginToken {
  token_type: string;
  expires_in: number;
  access_token: string;
  refresh_token?: string;
  // Campos calculados en front:
  exp_abs?: number; // <--- NUEVO: epoch ms cuando expira el access_token
}

export interface LoginResponseOk {
  success: true;
  token: LoginToken;
  whoami: { id: number; email: string };
  allowed_scopes: string[];
  rid: string;
}

export interface LoginResponseError {
  success: false;
  code:
    | 'INVALID_CREDENTIALS'
    | 'CLIENT_REQUIRED'
    | 'SCOPE_NOT_ALLOWED'
    | 'APP_NOT_FOUND'
    | 'CONFIG_MISSING'
    | 'OAUTH_ERROR'
    | 'LOGIN_INTERNAL';
  message: string;
  rid: string;
}

type LoginResponse = LoginResponseOk | LoginResponseError;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private storageKey = 'iam_token';
  private storageKeyWhoAmI = 'iam_whoami';
  private storageKeyScopes = 'iam_allowed_scopes';
  private refreshing = false; // <--- lock simple para evitar tormenta de refresh

  constructor(private http: HttpClient) {}

  /**
   * Login: solo email/password. El backend resuelve app/cliente y scopes.
   * Guardamos exp_abs = now + expires_in*1000 para poder refrescar antes de expirar.
   */
  login(email: string, password: string, scope?: string): Observable<LoginResponse> {
    const payload: any = {
      email,
      password,
      app_slug: environment.appSlug   // body con app_slug
    };
    if (scope && scope.trim()) payload.scope = scope.trim();

    return this.http
      .post<LoginResponse>(`${environment.iamBase}/api/auth/login`, payload)
      .pipe(
        map((res) => { // <--- map para calcular exp_abs
          if (res && res.success && 'token' in res && res.token?.access_token) {
            const expAbs = Date.now() + (res.token.expires_in * 1000);
            const merged: LoginToken = { ...res.token, exp_abs: expAbs };
            localStorage.setItem(this.storageKey, JSON.stringify(merged));
          }
          return res;
        })
      );
  }

  /**
   * Logout: opcionalmente pegarle al backend. Idempotente.
   */
  logout(callBackend: boolean = false): void {
    if (callBackend) {
      const token = this.getToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

      this.http.post(`${environment.iamBase}/api/auth/logout`, {}, { headers })
        .subscribe({ next: () => {}, error: () => {} })
        .add(() => {
          localStorage.removeItem(this.storageKey);
          localStorage.removeItem(this.storageKeyWhoAmI);
          localStorage.removeItem(this.storageKeyScopes);
        });
    } else {
      localStorage.removeItem(this.storageKey);
      localStorage.removeItem(this.storageKeyWhoAmI);
      localStorage.removeItem(this.storageKeyScopes);
    }
  }

  loadWhoAmI(clientId?: number, appId?: number) {
    const headers: any = {};
    if (clientId) headers['X-IAM-Client'] = String(clientId);
    if (appId)    headers['X-App-Id']     = String(appId);

    return this.http.get(`${environment.iamBase}/api/auth/whoami`, { headers })
      .pipe(
        tap((res: any) => {
          localStorage.setItem(this.storageKeyWhoAmI, JSON.stringify(res.whoami || {}));
          localStorage.setItem(this.storageKeyScopes, JSON.stringify(res.allowed_scopes || []));
          //localStorage.setItem('iam_context', JSON.stringify(res.context || {}));
        }),
        map(() => ({ success: true }))
      );
  }

  getWhoAmI()        { return JSON.parse(localStorage.getItem(this.storageKeyWhoAmI) || '{}'); }
  getScopes()        { return JSON.parse(localStorage.getItem(this.storageKeyScopes) || '[]'); }
  getContext()       { return JSON.parse(localStorage.getItem('iam_context') || '{}'); }
  hasScope(s: string){ return this.getScopes().includes(s); }

  /** Lee el paquete completo (access/refresh/exp_abs). */
  getRawToken(): LoginToken | null {
    const raw = localStorage.getItem(this.storageKey);
    if (!raw) return null;
    try {
      const t = JSON.parse(raw) as LoginToken;
      if (!t.exp_abs && t.expires_in) {
        t.exp_abs = Date.now() + (t.expires_in * 1000);
        localStorage.setItem(this.storageKey, JSON.stringify(t));
      }
      return t;
    } catch { return null; }
  }

  getToken(): string | null {
    return this.getRawToken()?.access_token ?? null;
  }

  getMsLeft(): number {
    const t = this.getRawToken();
    return t?.exp_abs ? (t.exp_abs - Date.now()) : 0;
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  /** ¿El access token está por caducar en ≤ thresholdSec? */
  isAccessTokenNearExpiry(thresholdSec = 60): boolean { // <--- NUEVO
    const t = this.getRawToken();
    if (!t?.exp_abs) return false;
    const msLeft = t.exp_abs - Date.now();
    return msLeft <= (thresholdSec * 1000);
  }

  /**
   * Refresh contra IAM /oauth/refresh.
   * Actualiza storage con nuevo access_token y exp_abs.
   */
  refresh(): Observable<LoginToken> {
    const t = this.getRawToken();
    if (!t?.refresh_token) {
      return throwError(() => new Error('NO_REFRESH_TOKEN'));
    }
    if (this.refreshing) {
      return throwError(() => new Error('REFRESH_IN_PROGRESS'));
    }
    this.refreshing = true;

    // Ahora llamamos al endpoint seguro del IAM (JSON), que oculta client_id/secret
    return this.http.post<any>(`${environment.iamBase}/api/auth/refresh`, {
      refresh_token: t.refresh_token
    }).pipe(
      // Backoff exponencial: 3 intentos (500ms → 1000ms → 2000ms) + jitter
      retry({
        count: 3,
        delay: (_err, retryCount) => {
          const base = 500 * Math.pow(2, retryCount - 1);
          const jitter = Math.floor(Math.random() * 250);
          return timer(base + jitter);
        }
      }),
      map((resp) => {
        // Soporta ambas formas: {success, token:{...}} (preferida) o respuesta plana de /oauth/token
        const tok = resp?.token ?? resp;
        if (!tok?.access_token) throw new Error('REFRESH_FAILED');

        const next: LoginToken = {
          token_type: tok.token_type,
          expires_in: tok.expires_in,
          access_token: tok.access_token,
          refresh_token: tok.refresh_token ?? t.refresh_token,
          exp_abs: Date.now() + (tok.expires_in * 1000),
        };
        localStorage.setItem(this.storageKey, JSON.stringify(next));
        return next;
      }),
      finalize(() => { this.refreshing = false; })
    );
  }
}
