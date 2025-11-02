import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { HttpClient } from '@angular/common/http';           // <-- NUEVO
import { environment } from '../../../environments/environment'; // <-- NUEVO
import { CommonModule } from '@angular/common';               // <-- NUEVO (para *ngIf en el HTML)

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  standalone: true,
  imports: [CommonModule], // <-- NUEVO: habilita *ngIf del template
})
export class DashboardComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private http = inject(HttpClient);                          // <-- NUEVO

  msLeft = 0;
  ngOnInit() {
    setInterval(() => this.msLeft = this.auth.getMsLeft(), 1000);
  }

  // NUEVO: estado para visualizar respuesta/errores
  testResult: any = null;
  testError: any = null;

  onLogout(): void {
    this.auth.logout(true);           // true => llama al backend para revocar tokens
    this.router.navigateByUrl('/login');
  }

  // NUEVO: dispara una petición protegida a LICITA-API
  testPing(): void {
    this.testResult = null;
    this.testError = null;

    console.log('apiBase =>', environment.apiBase);

    this.http.get(`${environment.apiBase}/secure-echo`).subscribe({
      next: (res) => this.testResult = res,
      error: (err) => {
        this.testError = {
          status: err?.status,
          message: err?.message,
          body: err?.error ?? null
        };
      }
    });
  }

  /**
   * Simula la acción del “admin de tenant”:
   * - Llama a IAM: POST /tenant/apps/{appId}/users/{userId}/disable
   * - Debes pasar el client context. Usa header X-IAM-Client si lo resolviste así en IAM.
   *
   * NOTA: reemplaza appId, userId y clientId según tu caso de prueba (o toma whoami del login).
   */
  disableMyself(): void {
    // (A) Si conoces appId y clientId por configuración (caso simple de pruebas):
    const appId = 5;      // <-- AJUSTA a tu app
    const userId =  this.getUserIdFromWhoAmI(); // si lo mantienes del login, o pon un fijo
    const clientId = 1; // <-- AJUSTA al client de pruebas

    this.http.post(
      `${environment.apiBase}/bff/tenant/apps/${appId}/users/${userId}/disable`,
      { client_id: clientId }
    ).subscribe({
      next: (res) => { this.testResult = res; this.testError = null; },
      error: (err) => {
        this.testError = {
          status: err?.status,
          body: err?.error ?? err?.message
        };
      }
    });
  }

  /** Helper si guardaste whoami en localStorage al loguear (opcional) */
  private getUserIdFromWhoAmI(): number {
    try {
      const raw = localStorage.getItem('iam_token');
      // si guardaste whoami aparte, léelo allí. Si no, hardcodea tu userId de prueba.
      // Para la demo rápida:
      return 4; // <-- AJUSTA: tu userId de prueba
    } catch { return 1; }
  }
}
