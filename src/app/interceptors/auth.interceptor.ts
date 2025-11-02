// src/app/interceptors/auth.interceptor.ts
import { Injectable } from '@angular/core';
import {
  HttpInterceptor, HttpRequest, HttpHandler, HttpEvent, HttpErrorResponse
} from '@angular/common/http';
import { Observable, throwError, switchMap, catchError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { Router } from '@angular/router';
import { AuthHeadersUtil } from '../core/auth/auth-headers.util';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private isRefreshing = false;

  constructor(private auth: AuthService, private router: Router) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const method = req.method || 'GET';
    const token  = this.auth.getToken();

    // 1) Adjuntar Bearer según reglas (LICITA siempre, IAM salvo públicos)
    let cloned = AuthHeadersUtil.withBearer(req, token, method);

    // 2) BYPASS total para refresh de IAM
    if (AuthHeadersUtil.isIamRefresh(req.url)) {
      return next.handle(cloned);
    }

    // 3) Auto-refresh preventivo SOLO para LICITA (tu política actual)
    if (AuthHeadersUtil.isLicita(req.url) && this.auth.isAccessTokenNearExpiry(60) && token && !this.isRefreshing) {
      this.isRefreshing = true;
      return this.auth.refresh().pipe(
        switchMap(() => {
          const newToken = this.auth.getToken();
          this.isRefreshing = false;
          cloned = AuthHeadersUtil.withBearer(req, newToken, method);
          return next.handle(cloned);
        }),
        catchError(err => {
          this.isRefreshing = false;
          this.auth.logout();
          this.router.navigateByUrl('/login');
          return throwError(() => err);
        })
      );
    }

    // 4) Manejo de 401 SOLO para LICITA (retry tras refresh una vez)
    return next.handle(cloned).pipe(
      catchError((err: HttpErrorResponse) => {
        if (AuthHeadersUtil.isLicita(req.url) && err.status === 401) {
          const raw = this.auth.getRawToken();
          if (raw?.refresh_token && !this.isRefreshing) {
            this.isRefreshing = true;
            return this.auth.refresh().pipe(
              switchMap(() => {
                const newToken = this.auth.getToken();
                this.isRefreshing = false;
                const retry = AuthHeadersUtil.withBearer(req, newToken, method);
                return next.handle(retry);
              }),
              catchError(e2 => {
                this.isRefreshing = false;
                this.auth.logout();
                this.router.navigateByUrl('/login');
                return throwError(() => e2);
              })
            );
          }
          this.auth.logout();
          this.router.navigateByUrl('/login');
        }
        return throwError(() => err);
      })
    );
  }
}
